//! Per-connection R2WP session engine.
//!
//! One task owns the transport, the server-role [`rclweb::Session`] state
//! machine, the per-channel sequence domains, and the sample queue. The core
//! crate does all wire parsing; this module wires parsed messages to the ROS
//! backend and builds the responses. Every outbound control frame is
//! re-parsed with the core parser and recorded through the session state
//! machine before it is sent, so a message builder that drifts from the
//! contract fails at the source instead of on the peer.

use crate::backend::{
    ActionInbound, ChannelSpec, EntityId, GraphEndpointInfo, RosBackend, ServiceRequest,
    SubscriptionSample,
};
use crate::budgets::SampleWriteQueue;
use crate::config::{ActiveTransport, GatewayConfig, new_session_id};
use crate::control;
use crate::qos::{RequestedQos, resolve_effective};
use bytes::Bytes;
use rclweb::protocol::control::{
    CONTROL_KIND_AUTHENTICATE, CONTROL_KIND_CLOSE_CHANNEL, CONTROL_KIND_ERROR,
    CONTROL_KIND_HEARTBEAT, CONTROL_KIND_OPEN_CHANNEL,
};
use rclweb::protocol::extension::{OPERATION_ID_EXTENSION_TYPE, R2wpExtension};
use rclweb::protocol::frame::{FLAG_RETAINED, FLAG_ROS_RELIABLE};
use rclweb::session::OperationKind;
use rclweb::{
    BootstrapErrorRecord, BootstrapRecord, CborValue, ControlMessage, FrameHeader, FrameOptions,
    FramePayload, OPCODE_ACTION_CANCEL, OPCODE_ACTION_FEEDBACK, OPCODE_ACTION_GOAL,
    OPCODE_ACTION_RESULT, OPCODE_ACTION_STATUS, OPCODE_CONTROL_CBOR, OPCODE_ROS_SAMPLE,
    OPCODE_SERVICE_REQUEST, OPCODE_SERVICE_RESPONSE, ProtocolError, Role, ServerHello, Session,
    encode_bootstrap_error, encode_control_frame, encode_extension_area, encode_frame,
    encode_server_hello, parse_bootstrap, parse_frame, write_frame_header,
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
    /// Per-(operation_id) outbound sequences for service/action responses.
    op_seq_out: HashMap<[u8; 16], u64>,
    /// Per-(operation_id) inbound sequences for service/action requests.
    op_seq_in: HashMap<[u8; 16], u64>,
}

struct ConnState<'a> {
    config: &'a GatewayConfig,
    active: ActiveTransport,
    session: Session,
    frame_options: FrameOptions,
    server_hello: Option<ServerHello>,
    control_seq_out: u64,
    control_seq_in: u64,
    heartbeat_counter: u64,
    channels: HashMap<u32, ChannelRuntime>,
    graph_generation: Option<u64>,
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

fn frame_operation_id(frame: &rclweb::DecodedFrame<'_>) -> Option<[u8; 16]> {
    for ext in &frame.extensions {
        if ext.type_id == OPERATION_ID_EXTENSION_TYPE && ext.value.len() == 16 {
            let mut id = [0u8; 16];
            id.copy_from_slice(ext.value);
            return Some(id);
        }
    }
    None
}

impl<'a> ConnState<'a> {
    fn new(config: &'a GatewayConfig, active: ActiveTransport) -> Self {
        Self {
            config,
            active,
            session: Session::new(Role::Server),
            frame_options: FrameOptions::default(),
            server_hello: None,
            control_seq_out: 0,
            control_seq_in: 0,
            heartbeat_counter: 0,
            channels: HashMap::new(),
            graph_generation: None,
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

    /// Encode, self-parse, record, and queue one outbound application frame
    /// (service/action) with an optional `OPERATION_ID` extension.
    fn push_app_frame(
        &mut self,
        outcome: &mut Outcome,
        header: &FrameHeader,
        operation_id: Option<[u8; 16]>,
        payload: &[u8],
    ) -> bool {
        let extension_area = if let Some(opid) = operation_id {
            let ext = R2wpExtension {
                type_id: OPERATION_ID_EXTENSION_TYPE,
                critical: true,
                value: &opid,
            };
            match encode_extension_area(&[ext]) {
                Ok(area) => area,
                Err(_) => {
                    outcome.close = true;
                    return false;
                }
            }
        } else {
            Vec::new()
        };
        let Ok(bytes) = encode_frame(header, &extension_area, payload) else {
            outcome.close = true;
            return false;
        };
        let recorded = match parse_frame(&bytes, Some(&self.frame_options)) {
            Ok(frame) => self.session.record_send_frame(&frame).is_ok(),
            Err(_) => false,
        };
        debug_assert!(recorded, "outbound app frame failed self-parse");
        if !recorded {
            outcome.close = true;
            return false;
        }
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
        service_tx: &mpsc::Sender<ServiceRequest>,
        action_tx: &mpsc::Sender<ActionInbound>,
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
        self.handle_frame(
            bytes,
            backend,
            sample_tx,
            service_tx,
            action_tx,
            &mut outcome,
        )
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
        match control::negotiate_server_hello(hello, self.config, self.active) {
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
        service_tx: &mpsc::Sender<ServiceRequest>,
        action_tx: &mpsc::Sender<ActionInbound>,
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
                self.handle_control(
                    msg, &effects, backend, sample_tx, service_tx, action_tx, outcome,
                )
                .await;
            }
            OPCODE_ROS_SAMPLE => {
                self.handle_publish_sample(&frame, backend, outcome).await;
            }
            OPCODE_SERVICE_REQUEST | OPCODE_SERVICE_RESPONSE => {
                self.handle_service_frame(&frame, backend, outcome).await;
            }
            OPCODE_ACTION_GOAL
            | OPCODE_ACTION_CANCEL
            | OPCODE_ACTION_FEEDBACK
            | OPCODE_ACTION_RESULT
            | OPCODE_ACTION_STATUS => {
                self.handle_action_frame(&frame, backend, outcome).await;
            }
            _ => {
                // The session state machine rejects other opcodes in v0.1.
            }
        }
    }

    async fn push_graph_snapshot<B: RosBackend>(
        &mut self,
        backend: &B,
        outcome: &mut Outcome,
        generation: u64,
    ) {
        let view = match backend.graph_view().await {
            Ok(view) => view,
            Err(err) => {
                let message = control::session_error(err.code, &err.message);
                self.push_control(outcome, &message);
                outcome.close = true;
                return;
            }
        };
        let snap =
            control::graph_snapshot(self.config, &control::ZERO_CORRELATION, generation, &view);
        if self.push_control(outcome, &snap) {
            self.graph_generation = Some(generation);
        }
    }

    async fn push_graph_delta_for_endpoint(
        &mut self,
        outcome: &mut Outcome,
        endpoint: &GraphEndpointInfo,
    ) {
        let Some(base) = self.graph_generation else {
            return;
        };
        let generation = base.saturating_add(1);
        let ops = vec![control::graph_delta_add_endpoint(
            endpoint,
            self.config.support_row,
        )];
        let delta = control::graph_delta(
            self.config,
            &control::ZERO_CORRELATION,
            base,
            generation,
            ops,
        );
        if self.push_control(outcome, &delta) {
            self.graph_generation = Some(generation);
        }
    }

    #[allow(clippy::too_many_arguments)]
    async fn handle_control<B: RosBackend>(
        &mut self,
        msg: &ControlMessage<'_>,
        effects: &rclweb::SessionEffects,
        backend: &B,
        sample_tx: &mpsc::Sender<SubscriptionSample>,
        service_tx: &mpsc::Sender<ServiceRequest>,
        action_tx: &mpsc::Sender<ActionInbound>,
        outcome: &mut Outcome,
    ) {
        match msg.kind {
            CONTROL_KIND_AUTHENTICATE => {
                let correlation = field_bytes(msg, 2).unwrap_or(&control::ZERO_CORRELATION);
                let scheme = field_text(msg, 16).unwrap_or("");
                let token = field_bytes(msg, 17).unwrap_or(&[]);
                let decision = crate::auth::authenticate(self.config, scheme, token);
                if !decision.allow {
                    let err = control::session_error_with_correlation(
                        correlation,
                        crate::auth::AUTHENTICATION_FAILED,
                        &decision.reason,
                    );
                    let _ = self.push_control(outcome, &err);
                    outcome.close = true;
                    return;
                }
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
                    &decision.subject,
                );
                if !self.push_control(outcome, &ready) {
                    return;
                }
                self.push_graph_snapshot(backend, outcome, 1).await;
            }
            CONTROL_KIND_OPEN_CHANNEL => {
                if let Some(channel_id) = effects.channel_opened {
                    self.open_channel(
                        channel_id, msg, backend, sample_tx, service_tx, action_tx, outcome,
                    )
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

    #[allow(clippy::too_many_arguments)]
    async fn open_channel<B: RosBackend>(
        &mut self,
        channel_id: u32,
        msg: &ControlMessage<'_>,
        backend: &B,
        sample_tx: &mpsc::Sender<SubscriptionSample>,
        service_tx: &mpsc::Sender<ServiceRequest>,
        action_tx: &mpsc::Sender<ActionInbound>,
        outcome: &mut Outcome,
    ) {
        let correlation = field_bytes(msg, 2).unwrap_or(&control::ZERO_CORRELATION);
        let correlation = correlation.to_vec();
        let kind = match field_uint(msg, 30) {
            Some(0) => OperationKind::TopicSubscribe,
            Some(1) => OperationKind::TopicPublish,
            Some(2) => OperationKind::ServiceClient,
            Some(3) => OperationKind::ServiceServer,
            Some(4) => OperationKind::ActionClient,
            Some(5) => OperationKind::ActionServer,
            _ => {
                // The session state machine already rejected other kinds.
                outcome.close = true;
                return;
            }
        };
        let topic = field_text(msg, 31).unwrap_or_default().to_owned();
        let type_name = field_text(msg, 4).unwrap_or_default().to_owned();
        let priority = field_uint(msg, 32).unwrap_or(2) as u8;

        let failure: Option<(u8, &str)> = if field_text(msg, 8) != Some(self.config.support_row.id)
        {
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
            topic: topic.clone(),
            type_name: type_name.clone(),
            qos: effective,
        };
        let created = match kind {
            OperationKind::TopicSubscribe => {
                backend.create_subscription(&spec, sample_tx.clone()).await
            }
            OperationKind::TopicPublish => backend.create_publisher(&spec).await,
            OperationKind::ServiceClient => backend.create_client(&spec).await,
            OperationKind::ServiceServer => backend.create_service(&spec, service_tx.clone()).await,
            OperationKind::ActionClient => backend.create_action_client(&spec).await,
            OperationKind::ActionServer => {
                backend.create_action_server(&spec, action_tx.clone()).await
            }
        };
        match created {
            Ok(entity) => {
                let reliable = match kind {
                    OperationKind::ServiceClient
                    | OperationKind::ServiceServer
                    | OperationKind::ActionClient
                    | OperationKind::ActionServer => true,
                    _ => effective.reliable,
                };
                self.channels.insert(
                    channel_id,
                    ChannelRuntime {
                        kind,
                        entity,
                        reliable,
                        transient_local: effective.transient_local,
                        priority,
                        seq_out: 0,
                        seq_in: 0,
                        op_seq_out: HashMap::new(),
                        op_seq_in: HashMap::new(),
                    },
                );
                let reply = match kind {
                    OperationKind::ServiceClient | OperationKind::ServiceServer => {
                        control::channel_ready_service_allow(
                            self.config,
                            &correlation,
                            channel_id,
                            priority,
                        )
                    }
                    OperationKind::ActionClient | OperationKind::ActionServer => {
                        control::channel_ready_action_allow(
                            self.config,
                            &correlation,
                            channel_id,
                            priority,
                        )
                    }
                    _ => control::channel_ready_allow(
                        self.config,
                        &correlation,
                        channel_id,
                        priority,
                        &effective,
                    ),
                };
                if !self.push_control(outcome, &reply) {
                    if let Some(runtime) = self.channels.remove(&channel_id) {
                        backend.destroy(runtime.entity).await;
                    }
                    return;
                }
                // Prefer emitting a GraphDelta when the mock graph gains an endpoint.
                if let Ok(view) = backend.graph_view().await
                    && let Some(endpoint) = view
                        .endpoints
                        .iter()
                        .find(|ep| ep.name == topic && ep.type_name == type_name)
                {
                    self.push_graph_delta_for_endpoint(outcome, endpoint).await;
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
            if frame.sequence > runtime.seq_in {
                crate::telemetry::PROCESS_TELEMETRY.add_sequence_gap(1);
            }
            runtime.seq_in = frame.sequence + 1;
        } else {
            // Stale sequence disposition: drop without error.
            crate::telemetry::PROCESS_TELEMETRY.add_stale_sequence(1);
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

    fn next_op_seq_out(runtime: &mut ChannelRuntime, opid: [u8; 16]) -> u64 {
        let entry = runtime.op_seq_out.entry(opid).or_insert(0);
        let seq = *entry;
        *entry = seq.saturating_add(1);
        seq
    }

    fn admit_op_seq_in(
        runtime: &mut ChannelRuntime,
        opid: [u8; 16],
        sequence: u64,
    ) -> Result<(), ()> {
        let entry = runtime.op_seq_in.entry(opid).or_insert(0);
        if sequence != *entry {
            return Err(());
        }
        *entry = sequence.saturating_add(1);
        Ok(())
    }

    async fn handle_service_frame<B: RosBackend>(
        &mut self,
        frame: &rclweb::DecodedFrame<'_>,
        backend: &B,
        outcome: &mut Outcome,
    ) {
        let Some(runtime) = self.channels.get_mut(&frame.channel_id) else {
            outcome.close = true;
            return;
        };
        let Some(opid) = frame_operation_id(frame) else {
            let err = ProtocolError::protocol_violation("missing_operation_id", 0, 25);
            self.fail_session(outcome, &err);
            return;
        };
        if Self::admit_op_seq_in(runtime, opid, frame.sequence).is_err() {
            let err = ProtocolError::protocol_violation("reliable_sequence_mismatch", 8, 25);
            self.fail_session(outcome, &err);
            return;
        }
        let FramePayload::Application(payload) = &frame.payload else {
            outcome.close = true;
            return;
        };
        let entity = runtime.entity;
        let channel_id = frame.channel_id;
        let kind = runtime.kind;
        let priority = runtime.priority;

        match (kind, frame.opcode) {
            (OperationKind::ServiceClient, OPCODE_SERVICE_REQUEST) => {
                match backend.call(entity, opid, payload.to_vec()).await {
                    Ok(response) => {
                        let Some(runtime) = self.channels.get_mut(&channel_id) else {
                            return;
                        };
                        let seq = Self::next_op_seq_out(runtime, opid);
                        let header = FrameHeader {
                            version: 0,
                            opcode: OPCODE_SERVICE_RESPONSE,
                            flags: FLAG_ROS_RELIABLE,
                            channel_id,
                            sequence: seq,
                            source_time_ns: 0,
                            priority,
                            clock_id: 0,
                        };
                        self.push_app_frame(outcome, &header, Some(opid), &response);
                    }
                    Err(err) => {
                        let reply = control::channel_error(channel_id, err.code, &err.message);
                        self.push_control(outcome, &reply);
                    }
                }
            }
            (OperationKind::ServiceServer, OPCODE_SERVICE_RESPONSE) => {
                if let Err(err) = backend
                    .send_service_response(entity, opid, payload.to_vec())
                    .await
                {
                    let reply = control::channel_error(channel_id, err.code, &err.message);
                    self.push_control(outcome, &reply);
                }
            }
            _ => {
                // Direction mismatches are rejected by the session SM first.
            }
        }
    }

    async fn handle_action_frame<B: RosBackend>(
        &mut self,
        frame: &rclweb::DecodedFrame<'_>,
        backend: &B,
        outcome: &mut Outcome,
    ) {
        let Some(runtime) = self.channels.get_mut(&frame.channel_id) else {
            outcome.close = true;
            return;
        };
        let Some(opid) = frame_operation_id(frame) else {
            let err = ProtocolError::protocol_violation("missing_operation_id", 0, 25);
            self.fail_session(outcome, &err);
            return;
        };
        // ACTION_STATUS may use the all-zero stream id; still track sequences.
        if Self::admit_op_seq_in(runtime, opid, frame.sequence).is_err() {
            let err = ProtocolError::protocol_violation("reliable_sequence_mismatch", 8, 25);
            self.fail_session(outcome, &err);
            return;
        }
        let FramePayload::Application(payload) = &frame.payload else {
            outcome.close = true;
            return;
        };
        let entity = runtime.entity;
        let channel_id = frame.channel_id;
        let kind = runtime.kind;
        let priority = runtime.priority;

        match (kind, frame.opcode) {
            (OperationKind::ActionClient, OPCODE_ACTION_GOAL) => {
                match backend
                    .send_action_goal(entity, opid, payload.to_vec())
                    .await
                {
                    Ok(result) => {
                        let Some(runtime) = self.channels.get_mut(&channel_id) else {
                            return;
                        };
                        let seq = Self::next_op_seq_out(runtime, opid);
                        let header = FrameHeader {
                            version: 0,
                            opcode: OPCODE_ACTION_RESULT,
                            flags: FLAG_ROS_RELIABLE,
                            channel_id,
                            sequence: seq,
                            source_time_ns: 0,
                            priority,
                            clock_id: 0,
                        };
                        self.push_app_frame(outcome, &header, Some(opid), &result);
                    }
                    Err(err) => {
                        let reply = control::channel_error(channel_id, err.code, &err.message);
                        self.push_control(outcome, &reply);
                    }
                }
            }
            (OperationKind::ActionClient, OPCODE_ACTION_CANCEL) => {
                if let Err(err) = backend.cancel_action(entity, opid, payload.to_vec()).await {
                    let reply = control::channel_error(channel_id, err.code, &err.message);
                    self.push_control(outcome, &reply);
                }
            }
            (OperationKind::ActionServer, OPCODE_ACTION_FEEDBACK) => {
                if let Err(err) = backend
                    .send_action_feedback(entity, opid, payload.to_vec())
                    .await
                {
                    let reply = control::channel_error(channel_id, err.code, &err.message);
                    self.push_control(outcome, &reply);
                }
            }
            (OperationKind::ActionServer, OPCODE_ACTION_RESULT) => {
                if let Err(err) = backend
                    .send_action_result(entity, opid, payload.to_vec())
                    .await
                {
                    let reply = control::channel_error(channel_id, err.code, &err.message);
                    self.push_control(outcome, &reply);
                }
            }
            (OperationKind::ActionServer, OPCODE_ACTION_STATUS) => {
                if let Err(err) = backend
                    .send_action_status(entity, opid, payload.to_vec())
                    .await
                {
                    let reply = control::channel_error(channel_id, err.code, &err.message);
                    self.push_control(outcome, &reply);
                }
            }
            _ => {}
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

    /// Admit a subscription sample into the write queue with budget policy.
    fn admit_sample(&mut self, sample: SubscriptionSample, queue: &mut SampleWriteQueue) {
        let Some(runtime) = self.channels.get(&sample.channel_id) else {
            return;
        };
        if runtime.kind != OperationKind::TopicSubscribe {
            return;
        }
        let reliable = runtime.reliable;
        let channel_id = sample.channel_id;
        let frame_len = sample.frame_buf.len();
        if reliable {
            if !queue.try_reserve_reliable(frame_len) {
                crate::telemetry::PROCESS_TELEMETRY.add_reliable_queue_drop(1);
                return;
            }
            let Some(frame) = self.frame_sample(sample) else {
                return;
            };
            queue.push_reliable(channel_id, frame);
        } else {
            let Some(frame) = self.frame_sample(sample) else {
                return;
            };
            let before_gap = queue.dispositions.sequence_gap;
            queue.admit_best_effort(channel_id, frame);
            let gap_delta = queue.dispositions.sequence_gap.saturating_sub(before_gap);
            if gap_delta > 0 {
                crate::telemetry::PROCESS_TELEMETRY.add_sequence_gap(gap_delta);
            }
        }
    }

    /// Frame an inbound service request for a ServiceServer channel.
    fn push_service_request(&mut self, outcome: &mut Outcome, request: ServiceRequest) {
        let Some(runtime) = self.channels.get_mut(&request.channel_id) else {
            return;
        };
        if runtime.kind != OperationKind::ServiceServer {
            return;
        }
        let priority = runtime.priority;
        let channel_id = request.channel_id;
        let opid = request.operation_id;
        let seq = Self::next_op_seq_out(runtime, opid);
        let payload = request.payload().to_vec();
        let header = FrameHeader {
            version: 0,
            opcode: OPCODE_SERVICE_REQUEST,
            flags: FLAG_ROS_RELIABLE,
            channel_id,
            sequence: seq,
            source_time_ns: 0,
            priority,
            clock_id: 0,
        };
        self.push_app_frame(outcome, &header, Some(opid), &payload);
    }

    /// Frame an inbound action goal/cancel for an ActionServer channel.
    fn push_action_inbound(&mut self, outcome: &mut Outcome, inbound: ActionInbound) {
        let channel_id = inbound.channel_id();
        let Some(runtime) = self.channels.get_mut(&channel_id) else {
            return;
        };
        if runtime.kind != OperationKind::ActionServer {
            return;
        }
        let priority = runtime.priority;
        let opid = inbound.operation_id();
        let seq = Self::next_op_seq_out(runtime, opid);
        let opcode = match &inbound {
            ActionInbound::Goal { .. } => OPCODE_ACTION_GOAL,
            ActionInbound::Cancel { .. } => OPCODE_ACTION_CANCEL,
        };
        let payload_start = crate::backend::SAMPLE_HEADER_PREFIX;
        let payload = inbound.frame_buf()[payload_start..].to_vec();
        let header = FrameHeader {
            version: 0,
            opcode,
            flags: FLAG_ROS_RELIABLE,
            channel_id,
            sequence: seq,
            source_time_ns: 0,
            priority,
            clock_id: 0,
        };
        self.push_app_frame(outcome, &header, Some(opid), &payload);
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
    active: ActiveTransport,
) {
    // Deep enough that ROS take rarely blocks on try_send; the write queue is
    // the budgeted latest-wins surface (sample_queue_depth / max_bytes).
    let depth = config.sample_queue_depth.max(1);
    let (sample_tx, mut sample_rx) = mpsc::channel::<SubscriptionSample>(depth);
    let (service_tx, mut service_rx) = mpsc::channel::<ServiceRequest>(depth);
    let (action_tx, mut action_rx) = mpsc::channel::<ActionInbound>(depth);
    let mut write_queue =
        SampleWriteQueue::new(config.sample_queue_depth, config.sample_queue_max_bytes);
    let mut conn = ConnState::new(config, active);
    loop {
        tokio::select! {
            inbound = transport.recv() => {
                let Some(Ok(bytes)) = inbound else {
                    break;
                };
                let outcome = conn
                    .handle_inbound(&bytes, backend, &sample_tx, &service_tx, &action_tx)
                    .await;
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
                if flush_write_queue(&mut transport, &mut write_queue)
                    .await
                    .is_err()
                {
                    break;
                }
            }
            sample = sample_rx.recv() => {
                let Some(sample) = sample else {
                    break;
                };
                conn.admit_sample(sample, &mut write_queue);
                if flush_write_queue(&mut transport, &mut write_queue)
                    .await
                    .is_err()
                {
                    break;
                }
            }
            request = service_rx.recv() => {
                let Some(request) = request else {
                    break;
                };
                let mut outcome = Outcome::default();
                conn.push_service_request(&mut outcome, request);
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
            inbound = action_rx.recv() => {
                let Some(inbound) = inbound else {
                    break;
                };
                let mut outcome = Outcome::default();
                conn.push_action_inbound(&mut outcome, inbound);
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
        }
    }
    transport.close().await;
    conn.teardown(backend).await;
}

async fn flush_write_queue<T: Transport>(
    transport: &mut T,
    write_queue: &mut SampleWriteQueue,
) -> Result<(), ()> {
    while let Some(frame) = write_queue.pop_front() {
        if transport.send(frame).await.is_err() {
            return Err(());
        }
        write_queue.record_delivered();
        crate::telemetry::PROCESS_TELEMETRY.add_delivered(1);
    }
    Ok(())
}
