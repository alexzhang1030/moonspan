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

pub use control::{
    DEFAULT_QOS_DEPTH, DEMO_SCHEMA_HASH, ZERO_CORRELATION, authenticate, close_channel, heartbeat,
    open_topic,
};
pub use types::{
    AppCommand, AppEvent, EngineTelemetry, HostEvent, MAX_HOST_EVENTS_PER_POLL,
    MAX_OUTBOUND_PER_POLL, OutboundMessage, PollOutcome, ReleasedBuffer, STD_MSGS_STRING,
};

use crate::cdr::{CdrEndian, CdrReader, CdrWriter};
use crate::protocol::bootstrap::{
    BufferCapabilities, ClientHello, RequestedLimits, TransportCapabilities,
};
use crate::protocol::cbor::CborValue;
use crate::protocol::control::{
    CONTROL_KIND_CHANNEL_READY, CONTROL_KIND_ERROR, CONTROL_KIND_HEARTBEAT,
    CONTROL_KIND_SESSION_READY,
};
use crate::protocol::frame::{
    DecodedFrame, FLAG_ROS_RELIABLE, FrameOptions, FramePayload, OPCODE_CONTROL_CBOR,
    OPCODE_ROS_SAMPLE,
};
use crate::protocol::{
    FrameHeader, encode_client_hello, encode_control_frame, encode_frame, parse_bootstrap,
    parse_frame,
};
use crate::session::{ChannelState, Role, Session, SessionEffects, SessionPhase};
use std::collections::HashMap;

const HEARTBEAT_INTERVAL_MS: u64 = 15_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PendingKind {
    Subscribe,
    Publish,
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
struct RetainedBuffer {
    bytes: Vec<u8>,
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
            started: false,
            closed: false,
            last_timer_ms: None,
            next_heartbeat_ms: None,
            heartbeat_counter: 0,
            telemetry: EngineTelemetry::default(),
        }
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
        Ok(writer.to_bytes())
    }

    /// Decode a `std_msgs/msg/String` CDR payload.
    pub fn decode_std_msgs_string(payload: &[u8]) -> Result<String, String> {
        let mut reader = CdrReader::open_default(payload).map_err(|e| e.to_string())?;
        reader.read_string(None).map_err(|e| e.to_string())
    }

    /// Drive one host turn: ingest a bounded event batch, return outbound work,
    /// application events, released buffers, and the next deadline.
    pub fn poll(&mut self, events: &[HostEvent]) -> PollOutcome {
        #[cfg(not(target_arch = "wasm32"))]
        let started = std::time::Instant::now();
        let mut outcome = PollOutcome::default();
        if self.closed {
            outcome.events.push(AppEvent::Closed {
                phase: self.session.phase(),
            });
            self.telemetry.poll_turns = self.telemetry.poll_turns.saturating_add(1);
            #[cfg(not(target_arch = "wasm32"))]
            {
                self.telemetry.poll_nanos_total = self
                    .telemetry
                    .poll_nanos_total
                    .saturating_add(started.elapsed().as_nanos() as u64);
            }
            return outcome;
        }
        let limit = events.len().min(MAX_HOST_EVENTS_PER_POLL);
        for event in events.iter().take(limit) {
            self.handle_event(event, &mut outcome);
            if self.closed {
                break;
            }
        }
        self.sweep_released(&mut outcome);
        outcome.next_deadline_ms = self.next_heartbeat_ms;
        self.telemetry.poll_turns = self.telemetry.poll_turns.saturating_add(1);
        #[cfg(not(target_arch = "wasm32"))]
        {
            self.telemetry.poll_nanos_total = self
                .telemetry
                .poll_nanos_total
                .saturating_add(started.elapsed().as_nanos() as u64);
        }
        outcome
    }

    fn handle_event(&mut self, event: &HostEvent, outcome: &mut PollOutcome) {
        match event {
            HostEvent::Command(cmd) => self.handle_command(cmd, outcome),
            HostEvent::WsBytes { buffer_id, bytes } => {
                self.handle_ws_bytes(*buffer_id, bytes, outcome);
            }
            HostEvent::Timer { now_ms } => self.handle_timer(*now_ms, outcome),
            HostEvent::ReleaseLease { lease_id } => {
                self.release_lease(*lease_id);
            }
        }
    }

    fn handle_command(&mut self, cmd: &AppCommand, outcome: &mut PollOutcome) {
        match cmd {
            AppCommand::Start {
                transferable_arraybuffer,
            } => {
                if self.started {
                    return;
                }
                self.started = true;
                let hello = ClientHello {
                    wire_versions: vec![0],
                    transport_capabilities: TransportCapabilities {
                        webtransport_http3: false,
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
            AppCommand::Authenticate {
                correlation,
                scheme,
                token,
            } => {
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
            AppCommand::SendSample {
                channel_id,
                string_data,
            } => {
                self.send_sample(*channel_id, string_data, outcome);
            }
            AppCommand::Unsubscribe {
                correlation,
                channel_id,
            } => {
                let msg = close_channel(correlation, *channel_id);
                if !self.push_control(&msg, outcome) {
                    self.fail(outcome, 1, "close_channel_encode_failed");
                    return;
                }
                self.pending_opens.remove(channel_id);
                self.active_subscribes.remove(channel_id);
                self.active_publishes.remove(channel_id);
            }
            AppCommand::Close => {
                self.closed = true;
                outcome.events.push(AppEvent::Closed {
                    phase: self.session.phase(),
                });
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
        let depth = if qos_depth == 0 {
            control::DEFAULT_QOS_DEPTH
        } else {
            qos_depth
        };
        let msg = open_topic(
            correlation,
            channel_id,
            operation_kind,
            topic,
            type_name,
            u64::from(qos_reliability),
            depth,
            domain_id,
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

    fn send_sample(&mut self, channel_id: u32, string_data: &str, outcome: &mut PollOutcome) {
        let Some(pub_ch) = self.active_publishes.get_mut(&channel_id) else {
            outcome.events.push(AppEvent::PublishFailed {
                channel_id,
                code: 25,
                message: "publish_channel_not_ready".to_owned(),
            });
            return;
        };
        let Ok(payload) = Self::encode_std_msgs_string(string_data) else {
            outcome.events.push(AppEvent::PublishFailed {
                channel_id,
                code: 1,
                message: "cdr_encode_failed".to_owned(),
            });
            return;
        };
        let flags = if pub_ch.reliable {
            FLAG_ROS_RELIABLE
        } else {
            0
        };
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
        let Ok(bytes) = encode_frame(&header, &[], &payload) else {
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

    fn handle_ws_bytes(&mut self, buffer_id: u32, bytes: &[u8], outcome: &mut PollOutcome) {
        // Retain a copy so sample leases outlive this poll turn. The host's
        // `buffer_id` is recorded so it can appear in `released_buffers` once
        // leases clear (the host may free its transferable AB independently;
        // the engine's copy is the lease backing store).
        // This retention is the browser-side controllable copy (budget slot 2).
        self.telemetry.copies_into_engine = self.telemetry.copies_into_engine.saturating_add(1);
        self.telemetry.bytes_copied_into_engine = self
            .telemetry
            .bytes_copied_into_engine
            .saturating_add(bytes.len() as u64);
        let id = if buffer_id == 0 {
            self.alloc_buffer(bytes.to_vec())
        } else {
            self.retained.insert(
                buffer_id,
                RetainedBuffer {
                    bytes: bytes.to_vec(),
                    lease_refs: 0,
                    ingest_done: false,
                },
            );
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
            outcome.events.push(AppEvent::Error {
                code: 1,
                message: "bootstrap_failed".to_owned(),
            });
            outcome.events.push(AppEvent::Closed {
                phase: self.session.phase(),
            });
            return;
        }
        if effects.entered_selected_plane {
            let version = self.session.selected_wire_version().unwrap_or(0);
            outcome.events.push(AppEvent::BootstrapComplete {
                selected_wire_version: version,
            });
        }
    }

    fn handle_frame(&mut self, buffer_id: u32, outcome: &mut PollOutcome) {
        let Some(bytes) = self.retained.get(&buffer_id).map(|b| b.bytes.clone()) else {
            return;
        };
        let frame = match parse_frame(&bytes, Some(&self.frame_options)) {
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
                self.handle_sample(buffer_id, &frame, &bytes, outcome);
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
                // SessionReady carries served domains as array key 10.
                let domain_id = field_domain(fields).unwrap_or(0);
                let gateway_instance_id = field_text(fields, 7).unwrap_or("").to_owned();
                outcome.events.push(AppEvent::SessionReady {
                    support_row,
                    domain_id,
                    gateway_instance_id,
                });
                if let Some(now) = self.last_timer_ms {
                    self.next_heartbeat_ms = Some(now.saturating_add(HEARTBEAT_INTERVAL_MS));
                }
            }
            CONTROL_KIND_CHANNEL_READY => {
                let channel_id = effects
                    .channel_failed
                    .or_else(|| field_uint(fields, 29).map(|v| v as u32))
                    .unwrap_or(0);
                let result = field_uint(fields, 33).unwrap_or(3);
                if result == 0 || result == 2 {
                    let pending = self.pending_opens.remove(&channel_id);
                    let (kind, topic, type_name, requested_rel) = match pending {
                        Some(p) => (p.kind, p.topic, p.type_name, p.qos_reliability),
                        None => (PendingKind::Subscribe, String::new(), String::new(), 1u8),
                    };
                    let effective_rel =
                        field_effective_reliability(fields).unwrap_or(requested_rel);
                    match kind {
                        PendingKind::Subscribe => {
                            outcome.events.push(AppEvent::Subscribed {
                                channel_id,
                                topic: topic.clone(),
                                type_name: type_name.clone(),
                            });
                            self.active_subscribes.insert(
                                channel_id,
                                PendingOpen {
                                    kind,
                                    topic,
                                    type_name,
                                    qos_reliability: effective_rel,
                                },
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
                                ActivePublish {
                                    topic,
                                    type_name,
                                    reliable: effective_rel != 2,
                                    seq_out: 0,
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
                            outcome.events.push(AppEvent::SubscribeFailed {
                                channel_id,
                                code,
                                message,
                            });
                        }
                        PendingKind::Publish => {
                            outcome.events.push(AppEvent::PublishFailed {
                                channel_id,
                                code,
                                message,
                            });
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
            CONTROL_KIND_ERROR if effects.session_error => {
                let code = field_uint(fields, 48).unwrap_or(25) as u8;
                let message = field_text(fields, 51).unwrap_or("session_error").to_owned();
                self.fail(outcome, code, &message);
            }
            _ => {}
        }
    }

    fn handle_sample(
        &mut self,
        buffer_id: u32,
        frame: &DecodedFrame<'_>,
        full_bytes: &[u8],
        outcome: &mut PollOutcome,
    ) {
        let FramePayload::Application(payload) = &frame.payload else {
            return;
        };
        let payload_offset = payload.as_ptr() as usize - full_bytes.as_ptr() as usize;
        let payload_len = payload.len();
        if payload_offset + payload_len > full_bytes.len() {
            self.fail(outcome, 25, "sample_payload_out_of_bounds");
            return;
        }

        let type_name = self
            .active_subscribes
            .get(&frame.channel_id)
            .map(|s| s.type_name.as_str())
            .unwrap_or("");
        let string_data = if type_name == STD_MSGS_STRING
            || type_name == "std_msgs/String"
            || type_name.is_empty()
        {
            Self::decode_std_msgs_string(payload).ok()
        } else {
            None
        };

        let lease_id = self.next_lease_id;
        self.next_lease_id = self.next_lease_id.saturating_add(1);
        if let Some(buf) = self.retained.get_mut(&buffer_id) {
            buf.lease_refs = buf.lease_refs.saturating_add(1);
        }
        self.leases.insert(
            lease_id,
            Lease {
                buffer_id,
                payload_offset,
                payload_len,
            },
        );

        // Hosts read the CDR payload through [`Self::lease_payload_view`]
        // into the retained slab. The SDK String path delivers `string_data`
        // (no extra controllable copy).
        outcome.events.push(AppEvent::Sample {
            channel_id: frame.channel_id,
            lease_id,
            sequence: frame.sequence,
            source_time_ns: frame.source_time_ns,
            string_data,
        });
        self.telemetry.samples_emitted = self.telemetry.samples_emitted.saturating_add(1);
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

    fn alloc_buffer(&mut self, bytes: Vec<u8>) -> u32 {
        let id = self.next_buffer_id;
        self.next_buffer_id = self.next_buffer_id.saturating_add(1);
        self.retained.insert(
            id,
            RetainedBuffer {
                bytes,
                lease_refs: 0,
                ingest_done: false,
            },
        );
        id
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
        let reclaim: Vec<u32> = self
            .retained
            .iter()
            .filter(|(_, b)| b.ingest_done && b.lease_refs == 0)
            .map(|(id, _)| *id)
            .collect();
        for id in reclaim {
            if let Some(buf) = self.retained.remove(&id) {
                outcome.released_buffers.push(ReleasedBuffer {
                    buffer_id: id,
                    len: buf.bytes.len() as u32,
                });
            }
        }
    }

    fn fail(&mut self, outcome: &mut PollOutcome, code: u8, message: &str) {
        self.closed = true;
        outcome.events.push(AppEvent::Error {
            code,
            message: message.to_owned(),
        });
        outcome.events.push(AppEvent::Closed {
            phase: self.session.phase(),
        });
    }

    /// Borrow retained buffer bytes by id (used by the wasm ABI to expose
    /// payload views without a second materialization).
    #[must_use]
    pub fn buffer_bytes(&self, buffer_id: u32) -> Option<&[u8]> {
        self.retained.get(&buffer_id).map(|b| b.bytes.as_slice())
    }

    /// Look up which retained buffer backs a lease.
    #[must_use]
    pub fn lease_buffer_id(&self, lease_id: u32) -> Option<u32> {
        self.leases.get(&lease_id).map(|l| l.buffer_id)
    }

    /// Borrowed CDR payload view for an outstanding sample lease.
    #[must_use]
    pub fn lease_payload_view(&self, lease_id: u32) -> Option<&[u8]> {
        let lease = self.leases.get(&lease_id)?;
        let buf = self.retained.get(&lease.buffer_id)?;
        buf.bytes
            .get(lease.payload_offset..lease.payload_offset + lease.payload_len)
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
