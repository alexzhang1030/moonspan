//! Synchronous client connection engine (gateway mirror, `Role::Client`).
//!
//! Drives [`crate::Session`] plus the protocol encoders to produce
//! ClientHello / Authenticate / OpenChannel and consume ServerHello /
//! SessionReady / ChannelReady / ROS_SAMPLE. No browser APIs — the wasm poll
//! ABI and TypeScript Worker host sit above this module (ADR 0004).

mod control;
mod types;

#[cfg(test)]
mod tests;

pub use crate::cdr::SENSOR_MSGS_POINT_CLOUD2;
pub use control::{
  DEFAULT_QOS_DEPTH, DEMO_BUNDLE_HASH, DEMO_SCHEMA_HASH, ZERO_CORRELATION, authenticate,
  close_channel, heartbeat, open_action, open_service, open_topic, resolve_open_schema_identity,
  schema_scheme_for_support_row,
};
pub use types::{
  AppCommand, AppEvent, EngineTelemetry, HostEvent, MAX_HOST_EVENTS_PER_POLL,
  MAX_OUTBOUND_PER_POLL, OutboundMessage, PollOutcome, ReleasedBuffer, STD_MSGS_STRING,
};

use crate::cdr::{
  CdrEndian, CdrError, CdrReader, CdrWriter, PointCloud2View, decode_point_cloud2,
  encode_point_cloud2_from_sdk_meta,
};
use crate::protocol::bootstrap::{
  BufferCapabilities, ClientHello, RequestedLimits, TransportCapabilities,
};
use crate::protocol::cbor::CborValue;
use crate::protocol::control::{
  CONTROL_KIND_CHANNEL_READY, CONTROL_KIND_ERROR, CONTROL_KIND_GRAPH_DELTA,
  CONTROL_KIND_GRAPH_SNAPSHOT, CONTROL_KIND_HEARTBEAT, CONTROL_KIND_SESSION_READY,
};
use crate::protocol::extension::{OPERATION_ID_EXTENSION_TYPE, R2wpExtension};
use crate::protocol::frame::{
  DecodedFrame, FLAG_ROS_RELIABLE, FRAME_HEADER_LENGTH, FrameOptions, FramePayload,
  OPCODE_ACTION_CANCEL, OPCODE_ACTION_FEEDBACK, OPCODE_ACTION_GOAL, OPCODE_ACTION_RESULT,
  OPCODE_ACTION_STATUS, OPCODE_CONTROL_CBOR, OPCODE_ROS_SAMPLE, OPCODE_SERVICE_REQUEST,
  OPCODE_SERVICE_RESPONSE, parse_frame_declared, retain_declared_len,
};
use crate::protocol::{
  FrameHeader, encode_client_hello, encode_control_frame, encode_extension_area, encode_frame,
  parse_bootstrap, parse_frame,
};
use crate::session::{ChannelState, Role, Session, SessionEffects, SessionPhase};
use crate::types::{
  CdrRepresentation, GeneratedOpKind, WIRE_ERROR_SCHEMA_UNAVAILABLE, decode_host_value,
  encode_generated_cdr, generated_op_type_name, lookup_phase1_root_for_open,
};
use bytes::Bytes;
use std::borrow::Cow;
use std::collections::HashMap;

const HEARTBEAT_INTERVAL_MS: u64 = 15_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PendingKind {
  Subscribe,
  Publish,
  ServiceClient,
  ServiceServer,
  ActionClient,
  ActionServer,
}

#[derive(Debug)]
struct PendingOpen {
  kind: PendingKind,
  topic: String,
  type_name: String,
  /// Client-requested reliability (may differ from effective until ChannelReady).
  qos_reliability: u8,
}

#[derive(Debug)]
struct ActivePublish {
  #[allow(dead_code)]
  topic: String,
  #[allow(dead_code)]
  type_name: String,
  reliable: bool,
  seq_out: u64,
}

#[derive(Debug)]
struct ActiveService {
  #[allow(dead_code)]
  name: String,
  type_name: String,
  #[allow(dead_code)]
  client: bool,
  /// Next channel-wide outbound sequence.
  next_seq: u64,
  /// Per-operation outbound sequence keyed by `operation_id`.
  seq_out: HashMap<[u8; 16], u64>,
}

#[derive(Debug)]
struct ActiveAction {
  #[allow(dead_code)]
  name: String,
  type_name: String,
  #[allow(dead_code)]
  client: bool,
  next_seq: u64,
  seq_out: HashMap<[u8; 16], u64>,
}

#[derive(Debug)]
struct RetainedBuffer {
  /// Inbound frame bytes. `Bytes` so parse/lease paths share without a deep copy.
  /// Host-retain ingest stores only the R2WP header+extension prefix.
  bytes: Bytes,
  /// Header-declared frame size (`32 + ext + payload`). May exceed `bytes.len()`.
  declared_len: usize,
  /// Number of outstanding sample leases pointing into this buffer.
  lease_refs: u32,
  /// True once the host has finished the poll that ingested these bytes
  /// (i.e. the buffer is no longer needed for parsing).
  ingest_done: bool,
}

#[derive(Debug)]
struct Lease {
  buffer_id: u32,
  payload_offset: usize,
  payload_len: usize,
}

/// Client-role connection engine.
#[derive(Debug)]
pub struct ClientEngine {
  session: Session,
  frame_options: FrameOptions,
  control_seq_out: u64,
  control_seq_in: u64,
  next_buffer_id: u32,
  next_lease_id: u32,
  retained: HashMap<u32, RetainedBuffer>,
  leases: HashMap<u32, Lease>,
  pending_opens: HashMap<u32, PendingOpen>,
  active_subscribes: HashMap<u32, PendingOpen>,
  active_publishes: HashMap<u32, ActivePublish>,
  active_services: HashMap<u32, ActiveService>,
  active_actions: HashMap<u32, ActiveAction>,
  /// Support row from the last SessionReady (`J-FT` until Ready).
  support_row_id: String,
  started: bool,
  closed: bool,
  last_timer_ms: Option<u64>,
  next_heartbeat_ms: Option<u64>,
  heartbeat_counter: u64,
  telemetry: EngineTelemetry,
}

impl Default for ClientEngine {
  fn default() -> Self {
    Self::new()
  }
}

impl ClientEngine {
  #[must_use]
  pub fn new() -> Self {
    Self {
      session: Session::new(Role::Client),
      frame_options: FrameOptions::default(),
      control_seq_out: 0,
      control_seq_in: 0,
      next_buffer_id: 1,
      next_lease_id: 1,
      retained: HashMap::new(),
      leases: HashMap::new(),
      pending_opens: HashMap::new(),
      active_subscribes: HashMap::new(),
      active_publishes: HashMap::new(),
      active_services: HashMap::new(),
      active_actions: HashMap::new(),
      support_row_id: "J-FT".to_owned(),
      started: false,
      closed: false,
      last_timer_ms: None,
      next_heartbeat_ms: None,
      heartbeat_counter: 0,
      telemetry: EngineTelemetry::default(),
    }
  }

  #[must_use]
  pub fn support_row_id(&self) -> &str {
    &self.support_row_id
  }

  #[must_use]
  pub fn telemetry(&self) -> EngineTelemetry {
    self.telemetry
  }

  #[must_use]
  pub fn phase(&self) -> SessionPhase {
    self.session.phase()
  }

  #[must_use]
  pub fn channel_state(&self, id: u32) -> ChannelState {
    self.session.channel_state(id)
  }

  /// Encode a `std_msgs/msg/String` CDR payload (little-endian representation).
  pub fn encode_std_msgs_string(text: &str) -> Result<Vec<u8>, String> {
    let mut writer = CdrWriter::new_default(CdrEndian::Little).map_err(|e| e.to_string())?;
    writer.write_string(text, None).map_err(|e| e.to_string())?;
    Ok(writer.into_bytes())
  }

  /// Decode a `std_msgs/msg/String` CDR payload.
  pub fn decode_std_msgs_string(payload: &[u8]) -> Result<String, String> {
    let mut reader = CdrReader::open_default(payload).map_err(|e| e.to_string())?;
    reader.read_string(None).map_err(|e| e.to_string())
  }

  /// Drive one host turn: ingest a bounded event batch, return outbound work,
  /// application events, released buffers, and the next deadline.
  ///
  /// Takes ownership of events so inbound `WsBytes` payloads move into the
  /// retained slab. Sample-body host-retain (ADR 0017) keeps only the R2WP
  /// prefix here; control/bootstrap still retain the full frame.
  pub fn poll(&mut self, events: Vec<HostEvent>) -> PollOutcome {
    self.run_poll(|this, outcome| {
      let limit = events.len().min(MAX_HOST_EVENTS_PER_POLL);
      for event in events.into_iter().take(limit) {
        this.handle_event(event, outcome);
        if this.closed {
          break;
        }
      }
    })
  }

  /// Ingest one WebSocket frame. Same retain/lease contract as
  /// `poll(vec![HostEvent::WsBytes { .. }])` without allocating that event vec
  /// (wasm sample hot path).
  pub fn poll_ws_bytes(&mut self, buffer_id: u32, bytes: Vec<u8>) -> PollOutcome {
    self.run_poll(|this, outcome| {
      this.handle_ws_bytes(buffer_id, Bytes::from(bytes), outcome);
    })
  }

  fn run_poll(&mut self, body: impl FnOnce(&mut Self, &mut PollOutcome)) -> PollOutcome {
    #[cfg(not(target_arch = "wasm32"))]
    let started = std::time::Instant::now();
    let mut outcome = PollOutcome::default();
    if self.closed {
      outcome.events.push(AppEvent::Closed { phase: self.session.phase() });
    } else {
      body(self, &mut outcome);
      self.sweep_released(&mut outcome);
      outcome.next_deadline_ms = self.next_heartbeat_ms;
    }
    self.telemetry.poll_turns = self.telemetry.poll_turns.saturating_add(1);
    #[cfg(not(target_arch = "wasm32"))]
    {
      self.telemetry.poll_nanos_total =
        self.telemetry.poll_nanos_total.saturating_add(started.elapsed().as_nanos() as u64);
    }
    outcome
  }

  fn handle_event(&mut self, event: HostEvent, outcome: &mut PollOutcome) {
    match event {
      HostEvent::Command(cmd) => self.handle_command(&cmd, outcome),
      HostEvent::WsBytes { buffer_id, bytes } => {
        self.handle_ws_bytes(buffer_id, Bytes::from(bytes), outcome);
      }
      HostEvent::Timer { now_ms } => self.handle_timer(now_ms, outcome),
      HostEvent::ReleaseLease { lease_id } => {
        self.release_lease(lease_id);
      }
    }
  }

  fn handle_command(&mut self, cmd: &AppCommand, outcome: &mut PollOutcome) {
    match cmd {
      AppCommand::Start { transferable_arraybuffer, webtransport } => {
        if self.started {
          return;
        }
        self.started = true;
        let hello = ClientHello {
          wire_versions: vec![0],
          transport_capabilities: TransportCapabilities {
            webtransport_http3: *webtransport,
            // Always offer binary_wss so WS peers AND-negotiate;
            // WT-only peers may leave binary_wss false on their side.
            binary_wss: true,
            max_datagram_size: None,
          },
          buffer_capabilities: BufferCapabilities {
            transferable_arraybuffer: *transferable_arraybuffer,
            shared_arraybuffer: false,
          },
          requested_limits: RequestedLimits::default(),
          extension_capabilities: Vec::new(),
        };
        match encode_client_hello(&hello) {
          Ok(bytes) => {
            if !self.push_bootstrap_outbound(bytes, outcome) {
              self.fail(outcome, 1, "client_hello_record_failed");
            }
          }
          Err(_) => self.fail(outcome, 1, "client_hello_encode_failed"),
        }
      }
      AppCommand::Authenticate { correlation, scheme, token } => {
        let msg = authenticate(correlation, scheme, token);
        if !self.push_control(&msg, outcome) {
          self.fail(outcome, 1, "authenticate_encode_failed");
        }
      }
      AppCommand::Subscribe {
        correlation,
        channel_id,
        topic,
        type_name,
        qos_reliability,
        qos_depth,
        domain_id,
      } => {
        self.open_channel_cmd(
          correlation,
          *channel_id,
          0,
          topic,
          type_name,
          *qos_reliability,
          *qos_depth,
          *domain_id,
          PendingKind::Subscribe,
          outcome,
        );
      }
      AppCommand::Publish {
        correlation,
        channel_id,
        topic,
        type_name,
        qos_reliability,
        qos_depth,
        domain_id,
      } => {
        self.open_channel_cmd(
          correlation,
          *channel_id,
          1,
          topic,
          type_name,
          *qos_reliability,
          *qos_depth,
          *domain_id,
          PendingKind::Publish,
          outcome,
        );
      }
      AppCommand::SendSample { channel_id, string_data } => {
        self.send_sample(*channel_id, string_data, outcome);
      }
      AppCommand::SendPointCloud2 {
        channel_id,
        header,
        height,
        width,
        fields,
        point_step,
        row_step,
        is_bigendian,
        is_dense,
        data,
      } => {
        let view = PointCloud2View {
          header: header.clone(),
          height: *height,
          width: *width,
          fields: fields.clone(),
          is_bigendian: *is_bigendian,
          point_step: *point_step,
          row_step: *row_step,
          data,
          is_dense: *is_dense,
        };
        match encode_point_cloud2_from_sdk_meta(&view) {
          Ok(payload) => self.send_sample_payload(*channel_id, &payload, outcome),
          Err(_) => {
            outcome.events.push(AppEvent::PublishFailed {
              channel_id: *channel_id,
              code: 1,
              message: "cdr_encode_failed".to_owned(),
            });
          }
        }
      }
      AppCommand::SendGenerated { channel_id, type_name, value } => {
        let encoded = crate::types::decode_host_value(type_name, value)
          .ok()
          .and_then(|msg| crate::types::encode_generated_cdr(&msg).ok());
        match encoded {
          Some(payload) => self.send_sample_payload(*channel_id, &payload, outcome),
          None => {
            outcome.events.push(AppEvent::PublishFailed {
              channel_id: *channel_id,
              code: 1,
              message: "cdr_encode_failed".to_owned(),
            });
          }
        }
      }
      AppCommand::OpenService { correlation, channel_id, name, type_name, domain_id, client } => {
        let kind = if *client { PendingKind::ServiceClient } else { PendingKind::ServiceServer };
        if self.emit_schema_unavailable_if_needed(type_name, *channel_id, kind, outcome) {
          return;
        }
        let msg = open_service(
          correlation,
          *channel_id,
          *client,
          name,
          type_name,
          *domain_id,
          &self.support_row_id,
        );
        if !self.push_control(&msg, outcome) {
          self.fail(outcome, 1, "open_service_encode_failed");
          return;
        }
        self.pending_opens.insert(
          *channel_id,
          PendingOpen {
            kind,
            topic: name.to_owned(),
            type_name: type_name.to_owned(),
            qos_reliability: 1,
          },
        );
      }
      AppCommand::CallService { channel_id, operation_id, request } => {
        match self.encode_op_payload(*channel_id, GeneratedOpKind::Request, request) {
          Ok(payload) => self.send_service_action_frame(
            *channel_id,
            OPCODE_SERVICE_REQUEST,
            operation_id,
            payload.as_ref(),
            true,
            outcome,
          ),
          Err(()) => Self::fail_service(*channel_id, outcome),
        }
      }
      AppCommand::SendServiceResponse { channel_id, operation_id, response } => {
        match self.encode_op_payload(*channel_id, GeneratedOpKind::Response, response) {
          Ok(payload) => self.send_service_action_frame(
            *channel_id,
            OPCODE_SERVICE_RESPONSE,
            operation_id,
            payload.as_ref(),
            true,
            outcome,
          ),
          Err(()) => Self::fail_service(*channel_id, outcome),
        }
      }
      AppCommand::OpenAction { correlation, channel_id, name, type_name, domain_id, client } => {
        let kind = if *client { PendingKind::ActionClient } else { PendingKind::ActionServer };
        if self.emit_schema_unavailable_if_needed(type_name, *channel_id, kind, outcome) {
          return;
        }
        let msg = open_action(
          correlation,
          *channel_id,
          *client,
          name,
          type_name,
          *domain_id,
          &self.support_row_id,
        );
        if !self.push_control(&msg, outcome) {
          self.fail(outcome, 1, "open_action_encode_failed");
          return;
        }
        self.pending_opens.insert(
          *channel_id,
          PendingOpen {
            kind,
            topic: name.to_owned(),
            type_name: type_name.to_owned(),
            qos_reliability: 1,
          },
        );
      }
      AppCommand::SendActionGoal { channel_id, operation_id, goal } => {
        match self.encode_op_payload(*channel_id, GeneratedOpKind::Goal, goal) {
          Ok(payload) => self.send_service_action_frame(
            *channel_id,
            OPCODE_ACTION_GOAL,
            operation_id,
            payload.as_ref(),
            true,
            outcome,
          ),
          Err(()) => Self::fail_action(*channel_id, outcome),
        }
      }
      AppCommand::CancelAction { channel_id, operation_id } => {
        self.send_service_action_frame(
          *channel_id,
          OPCODE_ACTION_CANCEL,
          operation_id,
          &[],
          true,
          outcome,
        );
      }
      AppCommand::SendActionFeedback { channel_id, operation_id, feedback } => {
        match self.encode_op_payload(*channel_id, GeneratedOpKind::Feedback, feedback) {
          Ok(payload) => self.send_service_action_frame(
            *channel_id,
            OPCODE_ACTION_FEEDBACK,
            operation_id,
            payload.as_ref(),
            false,
            outcome,
          ),
          Err(()) => Self::fail_action(*channel_id, outcome),
        }
      }
      AppCommand::SendActionResult { channel_id, operation_id, result } => {
        match self.encode_op_payload(*channel_id, GeneratedOpKind::Result, result) {
          Ok(payload) => self.send_service_action_frame(
            *channel_id,
            OPCODE_ACTION_RESULT,
            operation_id,
            payload.as_ref(),
            true,
            outcome,
          ),
          Err(()) => Self::fail_action(*channel_id, outcome),
        }
      }
      AppCommand::SendActionStatus { channel_id, operation_id, status } => {
        self.send_service_action_frame(
          *channel_id,
          OPCODE_ACTION_STATUS,
          operation_id,
          status,
          false,
          outcome,
        );
      }
      AppCommand::Unsubscribe { correlation, channel_id } => {
        let msg = close_channel(correlation, *channel_id);
        if !self.push_control(&msg, outcome) {
          self.fail(outcome, 1, "close_channel_encode_failed");
          return;
        }
        self.pending_opens.remove(channel_id);
        self.active_subscribes.remove(channel_id);
        self.active_publishes.remove(channel_id);
        self.active_services.remove(channel_id);
        self.active_actions.remove(channel_id);
      }
      AppCommand::Close => {
        self.closed = true;
        outcome.events.push(AppEvent::Closed { phase: self.session.phase() });
      }
    }
  }

  #[allow(clippy::too_many_arguments)]
  fn open_channel_cmd(
    &mut self,
    correlation: &[u8; 16],
    channel_id: u32,
    operation_kind: u64,
    topic: &str,
    type_name: &str,
    qos_reliability: u8,
    qos_depth: u32,
    domain_id: u8,
    kind: PendingKind,
    outcome: &mut PollOutcome,
  ) {
    if self.emit_schema_unavailable_if_needed(type_name, channel_id, kind, outcome) {
      return;
    }
    let depth = if qos_depth == 0 { control::DEFAULT_QOS_DEPTH } else { qos_depth };
    let msg = open_topic(
      correlation,
      channel_id,
      operation_kind,
      topic,
      type_name,
      u64::from(qos_reliability),
      depth,
      domain_id,
      &self.support_row_id,
    );
    if !self.push_control(&msg, outcome) {
      self.fail(outcome, 1, "open_channel_encode_failed");
      return;
    }
    self.pending_opens.insert(
      channel_id,
      PendingOpen {
        kind,
        topic: topic.to_owned(),
        type_name: type_name.to_owned(),
        qos_reliability,
      },
    );
  }

  /// Phase 1 roots: registry lookup before activation (row + CDR_LE).
  /// Missing material → schema_unavailable (wire code 10). Non-roots skip.
  fn emit_schema_unavailable_if_needed(
    &self,
    type_name: &str,
    channel_id: u32,
    kind: PendingKind,
    outcome: &mut PollOutcome,
  ) -> bool {
    match lookup_phase1_root_for_open(type_name, &self.support_row_id, CdrRepresentation::Le) {
      Ok(_) => false,
      Err(err) => {
        let code = err.code.wire_error_code().unwrap_or(WIRE_ERROR_SCHEMA_UNAVAILABLE);
        let message = err.to_string();
        match kind {
          PendingKind::Subscribe => {
            outcome.events.push(AppEvent::SubscribeFailed { channel_id, code, message });
          }
          PendingKind::Publish => {
            outcome.events.push(AppEvent::PublishFailed { channel_id, code, message });
          }
          PendingKind::ServiceClient | PendingKind::ServiceServer => {
            outcome.events.push(AppEvent::ServiceFailed { channel_id, code, message });
          }
          PendingKind::ActionClient | PendingKind::ActionServer => {
            outcome.events.push(AppEvent::ActionFailed { channel_id, code, message });
          }
        }
        true
      }
    }
  }

  fn send_sample(&mut self, channel_id: u32, string_data: &str, outcome: &mut PollOutcome) {
    let Ok(payload) = Self::encode_std_msgs_string(string_data) else {
      outcome.events.push(AppEvent::PublishFailed {
        channel_id,
        code: 1,
        message: "cdr_encode_failed".to_owned(),
      });
      return;
    };
    self.send_sample_payload(channel_id, &payload, outcome);
  }

  fn send_sample_payload(&mut self, channel_id: u32, payload: &[u8], outcome: &mut PollOutcome) {
    let Some(pub_ch) = self.active_publishes.get_mut(&channel_id) else {
      outcome.events.push(AppEvent::PublishFailed {
        channel_id,
        code: 25,
        message: "publish_channel_not_ready".to_owned(),
      });
      return;
    };
    let flags = if pub_ch.reliable { FLAG_ROS_RELIABLE } else { 0 };
    let sequence = pub_ch.seq_out;
    let header = FrameHeader {
      version: 0,
      opcode: OPCODE_ROS_SAMPLE,
      flags,
      channel_id,
      sequence,
      source_time_ns: 0,
      priority: 2,
      clock_id: 0,
    };
    let Ok(bytes) = encode_frame(&header, &[], payload) else {
      outcome.events.push(AppEvent::PublishFailed {
        channel_id,
        code: 1,
        message: "sample_frame_encode_failed".to_owned(),
      });
      return;
    };
    let Ok(frame) = parse_frame(&bytes, Some(&self.frame_options)) else {
      outcome.events.push(AppEvent::PublishFailed {
        channel_id,
        code: 1,
        message: "sample_frame_parse_failed".to_owned(),
      });
      return;
    };
    if self.session.record_send_frame(&frame).is_err() {
      outcome.events.push(AppEvent::PublishFailed {
        channel_id,
        code: 25,
        message: "sample_frame_record_failed".to_owned(),
      });
      return;
    }
    pub_ch.seq_out = pub_ch.seq_out.saturating_add(1);
    self.push_outbound(bytes, outcome);
    self.telemetry.samples_sent = self.telemetry.samples_sent.saturating_add(1);
  }

  /// Host-value → CDR for Phase 1 generated service/action roots; otherwise pass through.
  fn encode_op_payload<'a>(
    &self,
    channel_id: u32,
    op: GeneratedOpKind,
    bytes: &'a [u8],
  ) -> Result<Cow<'a, [u8]>, ()> {
    let type_name = self
      .active_services
      .get(&channel_id)
      .map(|s| s.type_name.as_str())
      .or_else(|| self.active_actions.get(&channel_id).map(|a| a.type_name.as_str()));
    let Some(type_name) = type_name else {
      return Ok(Cow::Borrowed(bytes));
    };
    let Some(section) = generated_op_type_name(type_name, op) else {
      return Ok(Cow::Borrowed(bytes));
    };
    let msg = decode_host_value(section, bytes).map_err(|_| ())?;
    let cdr = encode_generated_cdr(&msg).map_err(|_| ())?;
    Ok(Cow::Owned(cdr))
  }

  fn fail_service(channel_id: u32, outcome: &mut PollOutcome) {
    outcome.events.push(AppEvent::ServiceFailed {
      channel_id,
      code: 1,
      message: "cdr_encode_failed".to_owned(),
    });
  }

  fn fail_action(channel_id: u32, outcome: &mut PollOutcome) {
    outcome.events.push(AppEvent::ActionFailed {
      channel_id,
      code: 1,
      message: "cdr_encode_failed".to_owned(),
    });
  }

  /// Encode an outbound service/action frame with an OPERATION_ID extension.
  fn send_service_action_frame(
    &mut self,
    channel_id: u32,
    opcode: u8,
    operation_id: &[u8; 16],
    payload: &[u8],
    reliable: bool,
    outcome: &mut PollOutcome,
  ) {
    let sequence = if let Some(svc) = self.active_services.get_mut(&channel_id) {
      let seq = svc.next_seq;
      svc.next_seq = svc.next_seq.saturating_add(1);
      svc.seq_out.insert(*operation_id, seq);
      seq
    } else if let Some(act) = self.active_actions.get_mut(&channel_id) {
      let seq = act.next_seq;
      act.next_seq = act.next_seq.saturating_add(1);
      act.seq_out.insert(*operation_id, seq);
      seq
    } else {
      let pending = self.pending_opens.get(&channel_id).map(|p| p.kind);
      match pending {
        Some(PendingKind::ActionClient | PendingKind::ActionServer) => {
          outcome.events.push(AppEvent::ActionFailed {
            channel_id,
            code: 25,
            message: "action_channel_not_ready".to_owned(),
          });
        }
        _ => {
          outcome.events.push(AppEvent::ServiceFailed {
            channel_id,
            code: 25,
            message: "service_action_channel_not_ready".to_owned(),
          });
        }
      }
      return;
    };

    let flags = if reliable { FLAG_ROS_RELIABLE } else { 0 };
    let Ok(ext_area) = encode_extension_area(&[R2wpExtension {
      type_id: OPERATION_ID_EXTENSION_TYPE,
      critical: true,
      value: operation_id,
    }]) else {
      outcome.events.push(AppEvent::ServiceFailed {
        channel_id,
        code: 1,
        message: "operation_id_encode_failed".to_owned(),
      });
      return;
    };
    let header = FrameHeader {
      version: 0,
      opcode,
      flags,
      channel_id,
      sequence,
      source_time_ns: 0,
      priority: 2,
      clock_id: 0,
    };
    let Ok(bytes) = encode_frame(&header, &ext_area, payload) else {
      outcome.events.push(AppEvent::ServiceFailed {
        channel_id,
        code: 1,
        message: "service_action_frame_encode_failed".to_owned(),
      });
      return;
    };
    let Ok(frame) = parse_frame(&bytes, Some(&self.frame_options)) else {
      outcome.events.push(AppEvent::ServiceFailed {
        channel_id,
        code: 1,
        message: "service_action_frame_parse_failed".to_owned(),
      });
      return;
    };
    if self.session.record_send_frame(&frame).is_err() {
      outcome.events.push(AppEvent::ServiceFailed {
        channel_id,
        code: 25,
        message: "service_action_frame_record_failed".to_owned(),
      });
      return;
    }
    self.push_outbound(bytes, outcome);
  }

  fn handle_ws_bytes(&mut self, buffer_id: u32, bytes: Bytes, outcome: &mut PollOutcome) {
    // Count the bytes actually retained. Sample ingest copies only the R2WP
    // prefix (ADR 0017); control/bootstrap still copy the full frame.
    self.telemetry.copies_into_engine = self.telemetry.copies_into_engine.saturating_add(1);
    self.telemetry.bytes_copied_into_engine =
      self.telemetry.bytes_copied_into_engine.saturating_add(bytes.len() as u64);
    let id = if buffer_id == 0 {
      self.alloc_buffer(bytes)
    } else {
      self.retained.insert(buffer_id, Self::new_retained(bytes));
      self.next_buffer_id = self.next_buffer_id.max(buffer_id.saturating_add(1));
      buffer_id
    };

    let phase = self.session.phase();
    if !phase.in_selected_plane() {
      self.handle_bootstrap(id, outcome);
    } else {
      self.handle_frame(id, outcome);
    }

    if let Some(buf) = self.retained.get_mut(&id) {
      buf.ingest_done = true;
    }
  }

  fn handle_bootstrap(&mut self, buffer_id: u32, outcome: &mut PollOutcome) {
    let Some(bytes) = self.retained.get(&buffer_id).map(|b| b.bytes.clone()) else {
      return;
    };
    let record = match parse_bootstrap(&bytes) {
      Ok(record) => record,
      Err(err) => {
        self.fail(outcome, err.code as u8, err.reason);
        return;
      }
    };
    let effects = match self.session.ingest_bootstrap(&record) {
      Ok(effects) => effects,
      Err(err) => {
        self.fail(outcome, err.code as u8, err.reason);
        return;
      }
    };
    if effects.bootstrap_failed {
      self.closed = true;
      outcome.events.push(AppEvent::Error { code: 1, message: "bootstrap_failed".to_owned() });
      outcome.events.push(AppEvent::Closed { phase: self.session.phase() });
      return;
    }
    if effects.entered_selected_plane {
      let version = self.session.selected_wire_version().unwrap_or(0);
      outcome.events.push(AppEvent::BootstrapComplete { selected_wire_version: version });
    }
  }

  fn handle_frame(&mut self, buffer_id: u32, outcome: &mut PollOutcome) {
    let Some(buf) = self.retained.get(&buffer_id) else {
      return;
    };
    let bytes = buf.bytes.clone();
    let declared_len = buf.declared_len;
    let frame = match parse_frame_declared(&bytes, declared_len, Some(&self.frame_options)) {
      Ok(frame) => frame,
      Err(err) => {
        self.fail(outcome, err.code as u8, err.reason);
        return;
      }
    };
    let effects = match self.session.ingest_frame(&frame) {
      Ok(effects) => effects,
      Err(err) => {
        self.fail(outcome, err.code as u8, err.reason);
        return;
      }
    };

    match frame.opcode {
      OPCODE_CONTROL_CBOR => {
        if frame.sequence != self.control_seq_in {
          self.fail(outcome, 25, "control_sequence_mismatch");
          return;
        }
        self.control_seq_in += 1;
        let FramePayload::Control(msg) = &frame.payload else {
          self.fail(outcome, 25, "missing_control_payload");
          return;
        };
        self.handle_control(msg.kind, &msg.fields, &effects, outcome);
      }
      OPCODE_ROS_SAMPLE => {
        self.handle_sample(buffer_id, &frame, declared_len, outcome);
      }
      OPCODE_SERVICE_REQUEST
      | OPCODE_SERVICE_RESPONSE
      | OPCODE_ACTION_GOAL
      | OPCODE_ACTION_FEEDBACK
      | OPCODE_ACTION_RESULT
      | OPCODE_ACTION_STATUS
      | OPCODE_ACTION_CANCEL => {
        self.handle_service_action(buffer_id, &frame, declared_len, outcome);
      }
      _ => {}
    }
  }

  fn handle_control(
    &mut self,
    kind: u8,
    fields: &std::collections::BTreeMap<u64, CborValue<'_>>,
    effects: &SessionEffects,
    outcome: &mut PollOutcome,
  ) {
    match kind {
      CONTROL_KIND_SESSION_READY if effects.entered_ready => {
        let support_row = field_text(fields, 8).unwrap_or("J-FT").to_owned();
        self.support_row_id = support_row.clone();
        // SessionReady carries served domains as array key 10.
        let domain_id = field_domain(fields).unwrap_or(0);
        let gateway_instance_id = field_text(fields, 7).unwrap_or("").to_owned();
        outcome.events.push(AppEvent::SessionReady { support_row, domain_id, gateway_instance_id });
        if let Some(now) = self.last_timer_ms {
          self.next_heartbeat_ms = Some(now.saturating_add(HEARTBEAT_INTERVAL_MS));
        }
      }
      CONTROL_KIND_CHANNEL_READY => {
        let channel_id =
          effects.channel_failed.or_else(|| field_uint(fields, 29).map(|v| v as u32)).unwrap_or(0);
        let result = field_uint(fields, 33).unwrap_or(3);
        if result == 0 || result == 2 {
          let pending = self.pending_opens.remove(&channel_id);
          let (kind, topic, type_name, requested_rel) = match pending {
            Some(p) => (p.kind, p.topic, p.type_name, p.qos_reliability),
            None => (PendingKind::Subscribe, String::new(), String::new(), 1u8),
          };
          let effective_rel = field_effective_reliability(fields).unwrap_or(requested_rel);
          match kind {
            PendingKind::Subscribe => {
              outcome.events.push(AppEvent::Subscribed {
                channel_id,
                topic: topic.clone(),
                type_name: type_name.clone(),
              });
              self.active_subscribes.insert(
                channel_id,
                PendingOpen { kind, topic, type_name, qos_reliability: effective_rel },
              );
            }
            PendingKind::Publish => {
              outcome.events.push(AppEvent::Published {
                channel_id,
                topic: topic.clone(),
                type_name: type_name.clone(),
                qos_reliability: effective_rel,
              });
              self.active_publishes.insert(
                channel_id,
                ActivePublish { topic, type_name, reliable: effective_rel != 2, seq_out: 0 },
              );
            }
            PendingKind::ServiceClient | PendingKind::ServiceServer => {
              let client = kind == PendingKind::ServiceClient;
              outcome.events.push(AppEvent::ServiceReady {
                channel_id,
                name: topic.clone(),
                type_name: type_name.clone(),
                client,
              });
              self.active_services.insert(
                channel_id,
                ActiveService {
                  name: topic,
                  type_name,
                  client,
                  next_seq: 0,
                  seq_out: HashMap::new(),
                },
              );
            }
            PendingKind::ActionClient | PendingKind::ActionServer => {
              let client = kind == PendingKind::ActionClient;
              outcome.events.push(AppEvent::ActionReady {
                channel_id,
                name: topic.clone(),
                type_name: type_name.clone(),
                client,
              });
              self.active_actions.insert(
                channel_id,
                ActiveAction {
                  name: topic,
                  type_name,
                  client,
                  next_seq: 0,
                  seq_out: HashMap::new(),
                },
              );
            }
          }
        } else {
          let (code, message) = channel_ready_error_body(fields);
          let pending = self.pending_opens.remove(&channel_id);
          let kind = pending.map(|p| p.kind).unwrap_or(PendingKind::Subscribe);
          match kind {
            PendingKind::Subscribe => {
              outcome.events.push(AppEvent::SubscribeFailed { channel_id, code, message });
            }
            PendingKind::Publish => {
              outcome.events.push(AppEvent::PublishFailed { channel_id, code, message });
            }
            PendingKind::ServiceClient | PendingKind::ServiceServer => {
              outcome.events.push(AppEvent::ServiceFailed { channel_id, code, message });
            }
            PendingKind::ActionClient | PendingKind::ActionServer => {
              outcome.events.push(AppEvent::ActionFailed { channel_id, code, message });
            }
          }
        }
      }
      CONTROL_KIND_HEARTBEAT => {
        let counter = field_uint(fields, 40).unwrap_or(0);
        outcome.events.push(AppEvent::Heartbeat { counter });
        // Reply so the gateway keeps the session alive.
        self.heartbeat_counter = self.heartbeat_counter.saturating_add(1);
        let reply = heartbeat(self.heartbeat_counter);
        let _ = self.push_control(&reply, outcome);
      }
      CONTROL_KIND_GRAPH_SNAPSHOT if effects.graph_snapshot.is_some() => {
        let generation = effects.graph_snapshot.unwrap_or(0);
        outcome.events.push(AppEvent::GraphSnapshot {
          generation,
          nodes_json: graph_nodes_json(fields),
          endpoints_json: graph_endpoints_json(fields),
        });
      }
      CONTROL_KIND_GRAPH_DELTA if effects.graph_delta.is_some() => {
        let generation = effects.graph_delta.unwrap_or(0);
        outcome.events.push(AppEvent::GraphDelta { generation });
      }
      CONTROL_KIND_ERROR => {
        if effects.session_error {
          let code = field_uint(fields, 48).unwrap_or(25) as u8;
          let message = field_text(fields, 51).unwrap_or("session_error").to_owned();
          self.fail(outcome, code, &message);
        } else if let Some(channel_id) = effects.operation_cancelled {
          let code = field_uint(fields, 48).unwrap_or(15) as u8;
          let message = field_text(fields, 51).unwrap_or("operation_cancelled").to_owned();
          outcome.events.push(AppEvent::OperationCancelled { channel_id, code, message });
        } else if let Some(channel_id) = effects.channel_failed {
          let (code, message) = channel_ready_error_body(fields);
          let code = field_uint(fields, 48).unwrap_or(u64::from(code)) as u8;
          let message = field_text(fields, 51).map(str::to_owned).unwrap_or(message);
          let pending = self.pending_opens.remove(&channel_id);
          match pending.map(|p| p.kind) {
            Some(PendingKind::Publish) => {
              outcome.events.push(AppEvent::PublishFailed { channel_id, code, message });
            }
            Some(PendingKind::ServiceClient | PendingKind::ServiceServer) => {
              outcome.events.push(AppEvent::ServiceFailed { channel_id, code, message });
            }
            Some(PendingKind::ActionClient | PendingKind::ActionServer) => {
              outcome.events.push(AppEvent::ActionFailed { channel_id, code, message });
            }
            _ => {
              outcome.events.push(AppEvent::SubscribeFailed { channel_id, code, message });
            }
          }
        }
      }
      _ => {}
    }
  }

  fn handle_sample(
    &mut self,
    buffer_id: u32,
    frame: &DecodedFrame<'_>,
    declared_len: usize,
    outcome: &mut PollOutcome,
  ) {
    let FramePayload::Application(payload) = &frame.payload else {
      return;
    };
    let payload_offset = FRAME_HEADER_LENGTH + usize::from(frame.extension_len);
    let payload_len = frame.payload_len as usize;
    if payload_offset.checked_add(payload_len).is_none_or(|end| end > declared_len) {
      self.fail(outcome, 25, "sample_payload_out_of_bounds");
      return;
    }

    let string_data = if cfg!(target_arch = "wasm32") {
      // Host TextDecoder reads the leased CDR. Embedding the body in the poll
      // result copied every String sample an extra time.
      None
    } else if payload.len() == payload_len {
      let type_name =
        self.active_subscribes.get(&frame.channel_id).map(|s| s.type_name.as_str()).unwrap_or("");
      if type_name == STD_MSGS_STRING || type_name == "std_msgs/String" || type_name.is_empty() {
        Self::decode_std_msgs_string(payload).ok()
      } else {
        None
      }
    } else {
      None
    };

    let lease_id = self.next_lease_id;
    self.next_lease_id = self.next_lease_id.saturating_add(1);
    if let Some(buf) = self.retained.get_mut(&buffer_id) {
      buf.lease_refs = buf.lease_refs.saturating_add(1);
    }
    self.leases.insert(lease_id, Lease { buffer_id, payload_offset, payload_len });

    // Hosts read the CDR payload through [`Self::lease_payload_view`]
    // into the retained slab, or through a host-backed sentinel
    // (`ptr == 0 && len > 0`) when only the R2WP prefix was retained.
    // Native tests deliver `string_data` on the event when the payload is
    // inline; wasm leaves it empty so the host decodes the lease or the
    // retained JS buffer (no extra copy of the String body through the
    // poll result).
    outcome.events.push(AppEvent::Sample {
      channel_id: frame.channel_id,
      lease_id,
      sequence: frame.sequence,
      source_time_ns: frame.source_time_ns,
      string_data,
    });
    self.telemetry.samples_emitted = self.telemetry.samples_emitted.saturating_add(1);
  }

  fn handle_service_action(
    &mut self,
    buffer_id: u32,
    frame: &DecodedFrame<'_>,
    declared_len: usize,
    outcome: &mut PollOutcome,
  ) {
    let FramePayload::Application(_payload) = &frame.payload else {
      return;
    };
    let payload_offset = FRAME_HEADER_LENGTH + usize::from(frame.extension_len);
    let payload_len = frame.payload_len as usize;
    if payload_offset.checked_add(payload_len).is_none_or(|end| end > declared_len) {
      self.fail(outcome, 25, "service_action_payload_out_of_bounds");
      return;
    }

    // ACTION_CANCEL has no dedicated AppEvent in R3-01; payload is empty and
    // cancellation is also signaled via operation-scoped Error.
    if frame.opcode == OPCODE_ACTION_CANCEL {
      return;
    }

    let operation_id = match frame_operation_id(frame) {
      Some(id) => id,
      None if frame.opcode == OPCODE_ACTION_STATUS => [0u8; 16],
      None => {
        self.fail(outcome, 25, "missing_operation_id");
        return;
      }
    };

    let lease_id = self.next_lease_id;
    self.next_lease_id = self.next_lease_id.saturating_add(1);
    if let Some(buf) = self.retained.get_mut(&buffer_id) {
      buf.lease_refs = buf.lease_refs.saturating_add(1);
    }
    self.leases.insert(lease_id, Lease { buffer_id, payload_offset, payload_len });

    let channel_id = frame.channel_id;
    let sequence = frame.sequence;
    let event = match frame.opcode {
      OPCODE_SERVICE_REQUEST => {
        AppEvent::ServiceRequest { channel_id, operation_id, lease_id, sequence }
      }
      OPCODE_SERVICE_RESPONSE => {
        AppEvent::ServiceResponse { channel_id, operation_id, lease_id, sequence }
      }
      OPCODE_ACTION_GOAL => AppEvent::ActionGoal { channel_id, operation_id, lease_id, sequence },
      OPCODE_ACTION_FEEDBACK => {
        AppEvent::ActionFeedback { channel_id, operation_id, lease_id, sequence }
      }
      OPCODE_ACTION_RESULT => {
        AppEvent::ActionResult { channel_id, operation_id, lease_id, sequence }
      }
      OPCODE_ACTION_STATUS => {
        AppEvent::ActionStatus { channel_id, operation_id, lease_id, sequence }
      }
      _ => {
        self.release_lease(lease_id);
        return;
      }
    };
    outcome.events.push(event);
  }

  fn handle_timer(&mut self, now_ms: u64, outcome: &mut PollOutcome) {
    self.last_timer_ms = Some(now_ms);
    if !self.session.phase().is_ready() {
      return;
    }
    let Some(deadline) = self.next_heartbeat_ms else {
      self.next_heartbeat_ms = Some(now_ms.saturating_add(HEARTBEAT_INTERVAL_MS));
      return;
    };
    if now_ms >= deadline {
      self.heartbeat_counter = self.heartbeat_counter.saturating_add(1);
      let msg = heartbeat(self.heartbeat_counter);
      let _ = self.push_control(&msg, outcome);
      self.next_heartbeat_ms = Some(now_ms.saturating_add(HEARTBEAT_INTERVAL_MS));
    }
  }

  fn push_bootstrap_outbound(&mut self, bytes: Vec<u8>, outcome: &mut PollOutcome) -> bool {
    let record = match parse_bootstrap(&bytes) {
      Ok(record) => record,
      Err(_) => return false,
    };
    if self.session.record_send_bootstrap(&record).is_err() {
      return false;
    }
    self.push_outbound(bytes, outcome);
    true
  }

  fn push_control(&mut self, message: &CborValue<'_>, outcome: &mut PollOutcome) -> bool {
    let Ok(bytes) = encode_control_frame(0, self.control_seq_out, message) else {
      return false;
    };
    let Ok(frame) = parse_frame(&bytes, Some(&self.frame_options)) else {
      return false;
    };
    if self.session.record_send_frame(&frame).is_err() {
      return false;
    }
    self.control_seq_out = self.control_seq_out.saturating_add(1);
    self.push_outbound(bytes, outcome);
    true
  }

  fn push_outbound(&mut self, bytes: Vec<u8>, outcome: &mut PollOutcome) {
    if outcome.outbound.len() >= MAX_OUTBOUND_PER_POLL {
      return;
    }
    let buffer_id = self.next_buffer_id;
    self.next_buffer_id = self.next_buffer_id.saturating_add(1);
    outcome.outbound.push(OutboundMessage { buffer_id, bytes });
  }

  fn alloc_buffer(&mut self, bytes: Bytes) -> u32 {
    let id = self.next_buffer_id;
    self.next_buffer_id = self.next_buffer_id.saturating_add(1);
    self.retained.insert(id, Self::new_retained(bytes));
    id
  }

  fn new_retained(bytes: Bytes) -> RetainedBuffer {
    let declared_len = retain_declared_len(bytes.as_ref());
    RetainedBuffer { bytes, declared_len, lease_refs: 0, ingest_done: false }
  }

  fn release_lease(&mut self, lease_id: u32) {
    let Some(lease) = self.leases.remove(&lease_id) else {
      return;
    };
    if let Some(buf) = self.retained.get_mut(&lease.buffer_id) {
      buf.lease_refs = buf.lease_refs.saturating_sub(1);
    }
    self.telemetry.leases_released = self.telemetry.leases_released.saturating_add(1);
  }

  fn sweep_released(&mut self, outcome: &mut PollOutcome) {
    self.retained.retain(|&id, buf| {
      if buf.ingest_done && buf.lease_refs == 0 {
        outcome
          .released_buffers
          .push(ReleasedBuffer { buffer_id: id, len: buf.bytes.len() as u32 });
        false
      } else {
        true
      }
    });
  }

  fn fail(&mut self, outcome: &mut PollOutcome, code: u8, message: &str) {
    self.closed = true;
    outcome.events.push(AppEvent::Error { code, message: message.to_owned() });
    outcome.events.push(AppEvent::Closed { phase: self.session.phase() });
  }

  /// Borrow retained buffer bytes by id (used by the wasm ABI to expose
  /// payload views without a second materialization).
  #[must_use]
  pub fn buffer_bytes(&self, buffer_id: u32) -> Option<&[u8]> {
    self.retained.get(&buffer_id).map(|b| b.bytes.as_ref())
  }

  /// Look up which retained buffer backs a lease.
  #[must_use]
  pub fn lease_buffer_id(&self, lease_id: u32) -> Option<u32> {
    self.leases.get(&lease_id).map(|l| l.buffer_id)
  }

  /// Borrowed CDR payload view for an outstanding sample lease.
  ///
  /// Returns `None` when the lease is unknown, or when the payload lives on
  /// the host (only the R2WP prefix was retained). Use
  /// [`Self::lease_payload_abi`] for the poll-result sentinel.
  #[must_use]
  pub fn lease_payload_view(&self, lease_id: u32) -> Option<&[u8]> {
    let lease = self.leases.get(&lease_id)?;
    let buf = self.retained.get(&lease.buffer_id)?;
    buf.bytes.get(lease.payload_offset..lease.payload_offset + lease.payload_len)
  }

  /// Poll-result `(ptr, len)` for a lease.
  ///
  /// `(0, len)` with `len > 0` means the CDR body is host-backed. Wasm
  /// allocators never return a non-empty region at address 0.
  #[must_use]
  pub fn lease_payload_abi(&self, lease_id: u32) -> (u32, u32) {
    let Some(lease) = self.leases.get(&lease_id) else {
      return (0, 0);
    };
    match self.lease_payload_view(lease_id) {
      Some(view) => (view.as_ptr() as u32, view.len() as u32),
      None => (0, lease.payload_len as u32),
    }
  }

  /// Decode PointCloud2 from a lease as an O(1) borrowed view (R2-02).
  ///
  /// Returns `None` if the lease is unknown. Payload decode errors are
  /// surfaced as `Err` without materializing the point `data` field.
  pub fn lease_point_cloud2_view(
    &self,
    lease_id: u32,
  ) -> Option<Result<PointCloud2View<'_>, CdrError>> {
    let payload = self.lease_payload_view(lease_id)?;
    Some((|| {
      let mut reader = CdrReader::open_default(payload)?;
      let view = decode_point_cloud2(&mut reader)?;
      reader.ensure_complete_with_zero_tail(0)?;
      Ok(view)
    })())
  }
}

fn field_uint(fields: &std::collections::BTreeMap<u64, CborValue<'_>>, key: u64) -> Option<u64> {
  match fields.get(&key) {
    Some(CborValue::Unsigned(v)) => Some(*v),
    _ => None,
  }
}

fn field_text<'a>(
  fields: &'a std::collections::BTreeMap<u64, CborValue<'_>>,
  key: u64,
) -> Option<&'a str> {
  match fields.get(&key) {
    Some(CborValue::Text(t)) => Some(t.as_ref()),
    _ => None,
  }
}

fn field_domain(fields: &std::collections::BTreeMap<u64, CborValue<'_>>) -> Option<u8> {
  match fields.get(&10) {
    Some(CborValue::Array(items)) => match items.first() {
      Some(CborValue::Unsigned(v)) if *v <= u64::from(u8::MAX) => Some(*v as u8),
      _ => None,
    },
    Some(CborValue::Unsigned(v)) if *v <= u64::from(u8::MAX) => Some(*v as u8),
    _ => None,
  }
}

fn field_effective_reliability(
  fields: &std::collections::BTreeMap<u64, CborValue<'_>>,
) -> Option<u8> {
  let CborValue::Map(entries) = fields.get(&57)? else {
    return None;
  };
  for (k, v) in entries {
    if *k == 1
      && let CborValue::Unsigned(n) = v
      && *n <= u64::from(u8::MAX)
    {
      return Some(*n as u8);
    }
  }
  None
}

fn channel_ready_error_body(
  fields: &std::collections::BTreeMap<u64, CborValue<'_>>,
) -> (u8, String) {
  if let Some(CborValue::Map(entries)) = fields.get(&15) {
    let mut code = 3u8;
    let mut message = "channel_ready_failed".to_owned();
    for (k, v) in entries {
      match (*k, v) {
        (48, CborValue::Unsigned(c)) if *c <= u64::from(u8::MAX) => code = *c as u8,
        (51, CborValue::Text(t)) => message = t.as_ref().to_owned(),
        _ => {}
      }
    }
    return (code, message);
  }
  (3, "channel_ready_failed".to_owned())
}

fn frame_operation_id(frame: &DecodedFrame<'_>) -> Option<[u8; 16]> {
  for ext in &frame.extensions {
    if ext.type_id == OPERATION_ID_EXTENSION_TYPE {
      if ext.value.len() != 16 {
        return None;
      }
      let mut id = [0u8; 16];
      id.copy_from_slice(ext.value);
      return Some(id);
    }
  }
  None
}

fn hex_encode(bytes: &[u8]) -> String {
  const HEX: &[u8; 16] = b"0123456789abcdef";
  let mut out = String::with_capacity(bytes.len() * 2);
  for b in bytes {
    out.push(HEX[(b >> 4) as usize] as char);
    out.push(HEX[(b & 0xf) as usize] as char);
  }
  out
}

fn json_escape(s: &str) -> String {
  let mut out = String::with_capacity(s.len());
  for c in s.chars() {
    match c {
      '"' => out.push_str("\\\""),
      '\\' => out.push_str("\\\\"),
      '\n' => out.push_str("\\n"),
      '\r' => out.push_str("\\r"),
      '\t' => out.push_str("\\t"),
      c if c.is_control() => out.push_str(&format!("\\u{:04x}", c as u32)),
      c => out.push(c),
    }
  }
  out
}

fn map_field_text<'a>(entries: &'a [(u64, CborValue<'_>)], key: u64) -> Option<&'a str> {
  for (k, v) in entries {
    if *k == key {
      if let CborValue::Text(t) = v {
        return Some(t.as_ref());
      }
      return None;
    }
  }
  None
}

fn map_field_bytes<'a>(entries: &'a [(u64, CborValue<'_>)], key: u64) -> Option<&'a [u8]> {
  for (k, v) in entries {
    if *k == key {
      if let CborValue::Bytes(b) = v {
        return Some(b.as_ref());
      }
      return None;
    }
  }
  None
}

fn map_field_uint(entries: &[(u64, CborValue<'_>)], key: u64) -> Option<u64> {
  for (k, v) in entries {
    if *k == key {
      if let CborValue::Unsigned(n) = v {
        return Some(*n);
      }
      return None;
    }
  }
  None
}

fn graph_nodes_json(fields: &std::collections::BTreeMap<u64, CborValue<'_>>) -> String {
  let Some(CborValue::Array(nodes)) = fields.get(&22) else {
    return "[]".to_owned();
  };
  let mut out = String::from("[");
  for (i, node) in nodes.iter().enumerate() {
    if i > 0 {
      out.push(',');
    }
    let CborValue::Map(entries) = node else {
      out.push_str("{}");
      continue;
    };
    let id = map_field_bytes(entries, 55).map(hex_encode).unwrap_or_default();
    let name = map_field_text(entries, 1).unwrap_or("");
    let domain_id = map_field_uint(entries, 9).unwrap_or(0);
    out.push_str(&format!(
      "{{\"id\":\"{}\",\"name\":\"{}\",\"domain_id\":{}}}",
      id,
      json_escape(name),
      domain_id
    ));
  }
  out.push(']');
  out
}

fn graph_endpoints_json(fields: &std::collections::BTreeMap<u64, CborValue<'_>>) -> String {
  let Some(CborValue::Array(endpoints)) = fields.get(&23) else {
    return "[]".to_owned();
  };
  let mut out = String::from("[");
  for (i, ep) in endpoints.iter().enumerate() {
    if i > 0 {
      out.push(',');
    }
    let CborValue::Map(entries) = ep else {
      out.push_str("{}");
      continue;
    };
    let id = map_field_bytes(entries, 56).map(hex_encode).unwrap_or_default();
    let node_id = map_field_bytes(entries, 55).map(hex_encode).unwrap_or_default();
    let name = map_field_text(entries, 1).unwrap_or("");
    let kind = map_field_uint(entries, 2).unwrap_or(0);
    let type_name = map_field_text(entries, 3).unwrap_or("");
    let domain_id = map_field_uint(entries, 9).unwrap_or(0);
    out.push_str(&format!(
            "{{\"id\":\"{}\",\"node_id\":\"{}\",\"name\":\"{}\",\"kind\":{},\"type_name\":\"{}\",\"domain_id\":{}}}",
            id,
            node_id,
            json_escape(name),
            kind,
            json_escape(type_name),
            domain_id
        ));
  }
  out.push(']');
  out
}
