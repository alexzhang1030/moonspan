//! Per-connection R2WP session engine.
//!
//! One task owns the transport, the server-role [`rclweb::Session`] state
//! machine, the per-channel sequence domains, and the sample queue. The core
//! crate does all wire parsing; this module wires parsed messages to the ROS
//! backend and builds the responses. Every outbound control frame is
//! re-parsed with the core parser and recorded through the session state
//! machine before it is sent, so a message builder that drifts from the
//! contract fails at the source instead of on the peer.

use crate::backend::{ChannelSpec, EntityId, RosBackend, SubscriptionSample};
use crate::config::{GatewayConfig, SUPPORT_ROW_ID, new_session_id};
use crate::control;
use crate::qos::{RequestedQos, resolve_effective};
use bytes::Bytes;
use rclweb::protocol::control::{
    CONTROL_KIND_AUTHENTICATE, CONTROL_KIND_CLOSE_CHANNEL, CONTROL_KIND_ERROR,
    CONTROL_KIND_HEARTBEAT, CONTROL_KIND_OPEN_CHANNEL,
};
use rclweb::protocol::frame::{FLAG_RETAINED, FLAG_ROS_RELIABLE};
use rclweb::session::OperationKind;
use rclweb::{
    BootstrapErrorRecord, BootstrapRecord, CborValue, ControlMessage, FrameHeader, FrameOptions,
    FramePayload, OPCODE_CONTROL_CBOR, OPCODE_ROS_SAMPLE, ProtocolError, Role, ServerHello,
    Session, encode_bootstrap_error, encode_control_frame, encode_server_hello, parse_bootstrap,
    parse_frame, write_frame_header,
};
use std::collections::HashMap;
use tokio::sync::mpsc;

/// Transport failure (connection-fatal).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TransportError {
    pub reason: String,
}

impl std::fmt::Display for TransportError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "transport error: {}", self.reason)
    }
}

impl std::error::Error for TransportError {}

/// Binary message transport (one complete bootstrap record or frame per
/// message, per the R2WP WebSocket profile).
pub trait Transport: Send {
    /// Next complete binary message; `None` when the peer closed.
    fn recv(&mut self) -> impl Future<Output = Option<Result<Bytes, TransportError>>> + Send;
    /// Send one complete binary message.
    fn send(&mut self, bytes: Bytes) -> impl Future<Output = Result<(), TransportError>> + Send;
    /// Initiate an orderly transport close (best effort).
    fn close(&mut self) -> impl Future<Output = ()> + Send;
}

struct ChannelRuntime {
    kind: OperationKind,
    entity: EntityId,
    reliable: bool,
    transient_local: bool,
    priority: u8,
    seq_out: u64,
    seq_in: u64,
}

struct ConnState<'a> {
    config: &'a GatewayConfig,
    session: Session,
    frame_options: FrameOptions,
    server_hello: Option<ServerHello>,
    control_seq_out: u64,
    control_seq_in: u64,
    heartbeat_counter: u64,
    channels: HashMap<u32, ChannelRuntime>,
}

#[derive(Default)]
struct Outcome {
    outbound: Vec<Bytes>,
    close: bool,
}

const BOOTSTRAP_ERROR_CODES: [u8; 6] = [1, 2, 4, 16, 24, 25];

fn bootstrap_error_code(err: &ProtocolError) -> u8 {
    let code = err.code as u8;
    if BOOTSTRAP_ERROR_CODES.contains(&code) {
        code
    } else {
        1
    }
}

/// Wire error codes are 1..=28 excluding 20; anything else degrades to
/// protocol_violation.
fn wire_error_code(err: &ProtocolError) -> u8 {
    let code = err.code as u8;
    if (1..=28).contains(&code) && code != 20 {
        code
    } else {
        25
    }
}

impl<'a> ConnState<'a> {
    fn new(config: &'a GatewayConfig) -> Self {
        Self {
            config,
            session: Session::new(Role::Server),
            frame_options: FrameOptions::default(),
            server_hello: None,
            control_seq_out: 0,
            control_seq_in: 0,
            heartbeat_counter: 0,
            channels: HashMap::new(),
        }
    }

    /// Encode, self-parse, record, and queue one outbound control message.
    /// A failure here is a builder bug; the connection closes.
    fn push_control(&mut self, outcome: &mut Outcome, message: &CborValue<'_>) -> bool {
        let Ok(bytes) = encode_control_frame(0, self.control_seq_out, message) else {
            outcome.close = true;
            return false;
        };
        let recorded = match parse_frame(&bytes, Some(&self.frame_options)) {
            Ok(frame) => self.session.record_send_frame(&frame).is_ok(),
            Err(_) => false,
        };
        debug_assert!(recorded, "outbound control message failed self-parse");
        if !recorded {
            outcome.close = true;
            return false;
        }
        self.control_seq_out += 1;
        outcome.outbound.push(Bytes::from(bytes));
        true
    }

    fn push_bootstrap_error(&mut self, outcome: &mut Outcome, code: u8, message: &str) {
        let record = BootstrapErrorRecord {
            code,
            message: Some(message.to_owned()),
            detail: None,
        };
        if let Ok(bytes) = encode_bootstrap_error(&record) {
            outcome.outbound.push(Bytes::from(bytes));
        }
        outcome.close = true;
    }

    fn fail_session(&mut self, outcome: &mut Outcome, err: &ProtocolError) {
        if self.session.phase().in_selected_plane() {
            let message = control::session_error(wire_error_code(err), err.reason);
            self.push_control(outcome, &message);
        } else {
            self.push_bootstrap_error(outcome, bootstrap_error_code(err), err.reason);
        }
        outcome.close = true;
    }

    async fn handle_inbound<B: RosBackend>(
        &mut self,
        bytes: &[u8],
        backend: &B,
        sample_tx: &mpsc::Sender<SubscriptionSample>,
    ) -> Outcome {
        let mut outcome = Outcome::default();
        if self.session.phase().is_terminal() {
            outcome.close = true;
            return outcome;
        }
        if !self.session.phase().in_selected_plane() {
            self.handle_bootstrap(bytes, &mut outcome);
            return outcome;
        }
        self.handle_frame(bytes, backend, sample_tx, &mut outcome)
            .await;
        outcome
    }

    fn handle_bootstrap(&mut self, bytes: &[u8], outcome: &mut Outcome) {
        let record = match parse_bootstrap(bytes) {
            Ok(record) => record,
            Err(err) => {
                self.push_bootstrap_error(outcome, bootstrap_error_code(&err), err.reason);
                return;
            }
        };
        if let Err(err) = self.session.ingest_bootstrap(&record) {
            self.push_bootstrap_error(outcome, bootstrap_error_code(&err), err.reason);
            return;
        }
        let BootstrapRecord::ClientHello(hello) = &record else {
            // ingest_bootstrap rejects server-originated records from the peer.
            outcome.close = true;
            return;
        };
        match control::negotiate_server_hello(hello, self.config) {
            Ok(server_hello) => match encode_server_hello(&server_hello) {
                Ok(response) => {
                    let recorded = self
                        .session
                        .record_send_bootstrap(&BootstrapRecord::ServerHello(server_hello.clone()))
                        .is_ok();
                    debug_assert!(recorded, "server hello failed to record");
                    if !recorded {
                        outcome.close = true;
                        return;
                    }
                    self.server_hello = Some(server_hello);
                    outcome.outbound.push(Bytes::from(response));
                }
                Err(_) => outcome.close = true,
            },
            Err(code) => {
                self.push_bootstrap_error(outcome, code, "hello_negotiation_failed");
            }
        }
    }

    async fn handle_frame<B: RosBackend>(
        &mut self,
        bytes: &[u8],
        backend: &B,
        sample_tx: &mpsc::Sender<SubscriptionSample>,
        outcome: &mut Outcome,
    ) {
        let frame = match parse_frame(bytes, Some(&self.frame_options)) {
            Ok(frame) => frame,
            Err(err) => {
                self.fail_session(outcome, &err);
                return;
            }
        };
        let effects = match self.session.ingest_frame(&frame) {
            Ok(effects) => effects,
            Err(err) => {
                self.fail_session(outcome, &err);
                return;
            }
        };

        match frame.opcode {
            OPCODE_CONTROL_CBOR => {
                // Reliable control stream: exact-next sequence (step 25).
                if frame.sequence != self.control_seq_in {
                    let err = ProtocolError::protocol_violation("control_sequence_mismatch", 8, 25);
                    self.fail_session(outcome, &err);
                    return;
                }
                self.control_seq_in += 1;
                let FramePayload::Control(msg) = &frame.payload else {
                    // parse_frame guarantees a control payload for this opcode.
                    outcome.close = true;
                    return;
                };
                self.handle_control(msg, &effects, backend, sample_tx, outcome)
                    .await;
            }
            OPCODE_ROS_SAMPLE => {
                self.handle_publish_sample(&frame, backend, outcome).await;
            }
            _ => {
                // The session state machine rejects other opcodes in v0.1.
            }
        }
    }

    async fn handle_control<B: RosBackend>(
        &mut self,
        msg: &ControlMessage<'_>,
        effects: &rclweb::SessionEffects,
        backend: &B,
        sample_tx: &mpsc::Sender<SubscriptionSample>,
        outcome: &mut Outcome,
    ) {
        match msg.kind {
            CONTROL_KIND_AUTHENTICATE => {
                // R1 accepts every credential; identity/policy land in R4.
                let correlation = field_bytes(msg, 2).unwrap_or(&control::ZERO_CORRELATION);
                let Some(server_hello) = self.server_hello.clone() else {
                    outcome.close = true;
                    return;
                };
                let session_id = new_session_id();
                let ready = control::session_ready(
                    self.config,
                    &server_hello,
                    correlation,
                    &session_id,
                    "anonymous",
                );
                self.push_control(outcome, &ready);
            }
            CONTROL_KIND_OPEN_CHANNEL => {
                if let Some(channel_id) = effects.channel_opened {
                    self.open_channel(channel_id, msg, backend, sample_tx, outcome)
                        .await;
                }
            }
            CONTROL_KIND_CLOSE_CHANNEL => {
                if let Some(channel_id) = effects.channel_closed
                    && let Some(runtime) = self.channels.remove(&channel_id)
                {
                    backend.destroy(runtime.entity).await;
                }
            }
            CONTROL_KIND_HEARTBEAT => {
                self.heartbeat_counter += 1;
                let reply = control::heartbeat(self.heartbeat_counter);
                self.push_control(outcome, &reply);
            }
            CONTROL_KIND_ERROR if effects.session_error => {
                outcome.close = true;
            }
            _ => {}
        }
    }

    async fn open_channel<B: RosBackend>(
        &mut self,
        channel_id: u32,
        msg: &ControlMessage<'_>,
        backend: &B,
        sample_tx: &mpsc::Sender<SubscriptionSample>,
        outcome: &mut Outcome,
    ) {
        let correlation = field_bytes(msg, 2).unwrap_or(&control::ZERO_CORRELATION);
        let correlation = correlation.to_vec();
        let kind = match field_uint(msg, 30) {
            Some(0) => OperationKind::TopicSubscribe,
            Some(1) => OperationKind::TopicPublish,
            _ => {
                // The session state machine already rejected other kinds.
                outcome.close = true;
                return;
            }
        };
        let topic = field_text(msg, 31).unwrap_or_default().to_owned();
        let type_name = field_text(msg, 4).unwrap_or_default().to_owned();
        let priority = field_uint(msg, 32).unwrap_or(2) as u8;

        let failure: Option<(u8, &str)> = if field_text(msg, 8) != Some(SUPPORT_ROW_ID) {
            Some((25, "support_row_mismatch"))
        } else if field_uint(msg, 9) != Some(u64::from(self.config.domain_id)) {
            Some((12, "domain_not_served"))
        } else if field_uint(msg, 5) != Some(1) {
            // v0.1 serves CDR1 sample payloads only.
            Some((8, "unsupported_payload_encoding"))
        } else {
            None
        };
        if let Some((code, reason)) = failure {
            let reply = control::channel_ready_error(&correlation, channel_id, code, reason);
            self.push_control(outcome, &reply);
            return;
        }

        let requested = msg
            .fields
            .get(&11)
            .map(RequestedQos::from_wire)
            .unwrap_or_default();
        let effective = resolve_effective(&requested);
        let spec = ChannelSpec {
            channel_id,
            topic,
            type_name,
            qos: effective,
        };
        let created = match kind {
            OperationKind::TopicSubscribe => {
                backend.create_subscription(&spec, sample_tx.clone()).await
            }
            OperationKind::TopicPublish => backend.create_publisher(&spec).await,
        };
        match created {
            Ok(entity) => {
                self.channels.insert(
                    channel_id,
                    ChannelRuntime {
                        kind,
                        entity,
                        reliable: effective.reliable,
                        transient_local: effective.transient_local,
                        priority,
                        seq_out: 0,
                        seq_in: 0,
                    },
                );
                let reply = control::channel_ready_allow(
                    self.config,
                    &correlation,
                    channel_id,
                    priority,
                    &effective,
                );
                if !self.push_control(outcome, &reply) {
                    // Builder failure: release the entity we just created.
                    if let Some(runtime) = self.channels.remove(&channel_id) {
                        backend.destroy(runtime.entity).await;
                    }
                }
            }
            Err(err) => {
                let reply =
                    control::channel_ready_error(&correlation, channel_id, err.code, &err.message);
                self.push_control(outcome, &reply);
            }
        }
    }

    async fn handle_publish_sample<B: RosBackend>(
        &mut self,
        frame: &rclweb::DecodedFrame<'_>,
        backend: &B,
        outcome: &mut Outcome,
    ) {
        // Session state machine validated readiness, channel state, and
        // direction; steps 23–25 (flags vs effective QoS, sequence) live here.
        let Some(runtime) = self.channels.get_mut(&frame.channel_id) else {
            outcome.close = true;
            return;
        };
        debug_assert_eq!(runtime.kind, OperationKind::TopicPublish);
        let reliable_flag = frame.flags & FLAG_ROS_RELIABLE != 0;
        if reliable_flag != runtime.reliable {
            let err = ProtocolError::unsupported_flags("ros_reliable_iff_effective", 2, 23);
            self.fail_session(outcome, &err);
            return;
        }
        if frame.flags & FLAG_RETAINED != 0 && !runtime.transient_local {
            let err = ProtocolError::unsupported_flags("retained_requires_transient_local", 2, 24);
            self.fail_session(outcome, &err);
            return;
        }
        if runtime.reliable {
            if frame.sequence != runtime.seq_in {
                let err = ProtocolError::protocol_violation("reliable_sequence_mismatch", 8, 25);
                self.fail_session(outcome, &err);
                return;
            }
            runtime.seq_in += 1;
        } else if frame.sequence >= runtime.seq_in {
            // Best-effort: gaps admit (sequence_gap disposition).
            runtime.seq_in = frame.sequence + 1;
        } else {
            // Stale sequence disposition: drop without error.
            return;
        }
        let FramePayload::Application(payload) = &frame.payload else {
            outcome.close = true;
            return;
        };
        let entity = runtime.entity;
        let channel_id = frame.channel_id;
        if let Err(err) = backend.publish(entity, payload.to_vec()).await {
            let reply = control::channel_error(channel_id, err.code, &err.message);
            self.push_control(outcome, &reply);
        }
    }

    /// Fill the reserved header prefix of a subscription sample in place.
    fn frame_sample(&mut self, sample: SubscriptionSample) -> Option<Bytes> {
        let runtime = self.channels.get_mut(&sample.channel_id)?;
        if runtime.kind != OperationKind::TopicSubscribe {
            return None;
        }
        let payload_len = sample.frame_buf.len() - crate::backend::SAMPLE_HEADER_PREFIX;
        let header = FrameHeader {
            version: 0,
            opcode: OPCODE_ROS_SAMPLE,
            flags: if runtime.reliable {
                FLAG_ROS_RELIABLE
            } else {
                0
            },
            channel_id: sample.channel_id,
            sequence: runtime.seq_out,
            source_time_ns: 0,
            priority: runtime.priority,
            clock_id: 0,
        };
        let mut frame_buf = sample.frame_buf;
        write_frame_header(&header, payload_len as u32, 0, &mut frame_buf).ok()?;
        runtime.seq_out += 1;
        crate::telemetry::PROCESS_TELEMETRY.record_sample_framed();
        Some(Bytes::from(frame_buf))
    }

    async fn teardown<B: RosBackend>(&mut self, backend: &B) {
        for (_, runtime) in self.channels.drain() {
            backend.destroy(runtime.entity).await;
        }
    }
}

fn field_uint(msg: &ControlMessage<'_>, key: u64) -> Option<u64> {
    match msg.fields.get(&key) {
        Some(CborValue::Unsigned(v)) => Some(*v),
        _ => None,
    }
}

fn field_bytes<'m>(msg: &'m ControlMessage<'_>, key: u64) -> Option<&'m [u8]> {
    match msg.fields.get(&key) {
        Some(CborValue::Bytes(b)) => Some(b.as_ref()),
        _ => None,
    }
}

fn field_text<'m>(msg: &'m ControlMessage<'_>, key: u64) -> Option<&'m str> {
    match msg.fields.get(&key) {
        Some(CborValue::Text(t)) => Some(t.as_ref()),
        _ => None,
    }
}

/// Drive one connection to completion: bootstrap, session, channels, samples.
pub async fn run_connection<T: Transport, B: RosBackend>(
    mut transport: T,
    backend: &B,
    config: &GatewayConfig,
) {
    let (sample_tx, mut sample_rx) =
        mpsc::channel::<SubscriptionSample>(config.sample_queue_depth.max(1));
    let mut conn = ConnState::new(config);
    loop {
        tokio::select! {
            inbound = transport.recv() => {
                let Some(Ok(bytes)) = inbound else {
                    break;
                };
                let outcome = conn.handle_inbound(&bytes, backend, &sample_tx).await;
                let mut send_failed = false;
                for message in outcome.outbound {
                    if transport.send(message).await.is_err() {
                        send_failed = true;
                        break;
                    }
                }
                if outcome.close || send_failed {
                    break;
                }
            }
            sample = sample_rx.recv() => {
                let Some(sample) = sample else {
                    break;
                };
                if let Some(frame) = conn.frame_sample(sample)
                    && transport.send(frame).await.is_err()
                {
                    break;
                }
            }
        }
    }
    transport.close().await;
    conn.teardown(backend).await;
}
