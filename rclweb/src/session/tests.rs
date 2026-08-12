//! Focused transition-matrix tests for the v0.1 session/channel state machine.

use super::{
    ChannelResult, ChannelState, FIELD_CHANNEL_ID, FIELD_CHANNEL_RESULT, FIELD_CORRELATION_ID,
    FIELD_OPERATION_KIND, OperationKind, Role, Session, SessionPhase,
};
use crate::protocol::bootstrap::{
    BootstrapErrorRecord, BootstrapRecord, BufferCapabilities, ClientHello, EffectiveLimits,
    RequestedLimits, ServerHello, TransportCapabilities,
};
use crate::protocol::cbor::CborValue;
use crate::protocol::control::{
    CONTROL_KIND_AUTHENTICATE, CONTROL_KIND_CHANNEL_READY, CONTROL_KIND_CLOSE_CHANNEL,
    CONTROL_KIND_ERROR, CONTROL_KIND_HEARTBEAT, CONTROL_KIND_OPEN_CHANNEL,
    CONTROL_KIND_SESSION_READY, ControlMessage,
};
use crate::protocol::frame::{DecodedFrame, FramePayload, OPCODE_CONTROL_CBOR, OPCODE_ROS_SAMPLE};
use std::borrow::Cow;
use std::collections::BTreeMap;

fn transport() -> TransportCapabilities {
    TransportCapabilities {
        webtransport_http3: false,
        binary_wss: true,
        max_datagram_size: None,
    }
}

fn buffer() -> BufferCapabilities {
    BufferCapabilities {
        transferable_arraybuffer: true,
        shared_arraybuffer: false,
    }
}

fn client_hello() -> BootstrapRecord {
    BootstrapRecord::ClientHello(ClientHello {
        wire_versions: vec![0],
        transport_capabilities: transport(),
        buffer_capabilities: buffer(),
        requested_limits: RequestedLimits::default(),
        extension_capabilities: vec![],
    })
}

fn server_hello() -> BootstrapRecord {
    BootstrapRecord::ServerHello(ServerHello {
        selected_wire_version: 0,
        transport_capabilities: transport(),
        buffer_capabilities: buffer(),
        effective_limits: EffectiveLimits {
            max_channels: 64,
            max_session_bytes: 1_048_576,
            max_message_bytes: 1_048_576,
            max_control_payload_bytes: 65_536,
        },
        extension_capabilities: vec![],
    })
}

fn bootstrap_error() -> BootstrapRecord {
    BootstrapRecord::BootstrapError(BootstrapErrorRecord {
        code: 2,
        message: Some("denied".into()),
        detail: None,
    })
}

fn corr(n: u8) -> CborValue<'static> {
    CborValue::Bytes(Cow::Owned(vec![n; 16]))
}

fn control_frame(kind: u8, fields: BTreeMap<u64, CborValue<'static>>) -> DecodedFrame<'static> {
    let mut fields = fields;
    fields.insert(1, CborValue::Unsigned(u64::from(kind)));
    DecodedFrame {
        version: 0,
        opcode: OPCODE_CONTROL_CBOR,
        flags: 0,
        channel_id: 0,
        sequence: 0,
        source_time_ns: 0,
        payload_len: 0,
        extension_len: 0,
        priority: 0,
        clock_id: 0,
        extensions: vec![],
        payload: FramePayload::Control(ControlMessage { kind, fields }),
    }
}

fn authenticate(corr_byte: u8) -> DecodedFrame<'static> {
    let mut fields = BTreeMap::new();
    fields.insert(FIELD_CORRELATION_ID, corr(corr_byte));
    control_frame(CONTROL_KIND_AUTHENTICATE, fields)
}

fn session_ready(corr_byte: u8) -> DecodedFrame<'static> {
    let mut fields = BTreeMap::new();
    fields.insert(FIELD_CORRELATION_ID, corr(corr_byte));
    control_frame(CONTROL_KIND_SESSION_READY, fields)
}

fn heartbeat() -> DecodedFrame<'static> {
    let mut fields = BTreeMap::new();
    fields.insert(FIELD_CORRELATION_ID, corr(0));
    control_frame(CONTROL_KIND_HEARTBEAT, fields)
}

fn open_channel(id: u32, kind: OperationKind, corr_byte: u8) -> DecodedFrame<'static> {
    let mut fields = BTreeMap::new();
    fields.insert(FIELD_CORRELATION_ID, corr(corr_byte));
    fields.insert(FIELD_CHANNEL_ID, CborValue::Unsigned(u64::from(id)));
    fields.insert(
        FIELD_OPERATION_KIND,
        CborValue::Unsigned(u64::from(kind as u8)),
    );
    control_frame(CONTROL_KIND_OPEN_CHANNEL, fields)
}

fn channel_ready(id: u32, result: ChannelResult, corr_byte: u8) -> DecodedFrame<'static> {
    let mut fields = BTreeMap::new();
    fields.insert(FIELD_CORRELATION_ID, corr(corr_byte));
    fields.insert(FIELD_CHANNEL_ID, CborValue::Unsigned(u64::from(id)));
    fields.insert(
        FIELD_CHANNEL_RESULT,
        CborValue::Unsigned(u64::from(result as u8)),
    );
    control_frame(CONTROL_KIND_CHANNEL_READY, fields)
}

fn close_channel(id: u32) -> DecodedFrame<'static> {
    let mut fields = BTreeMap::new();
    fields.insert(FIELD_CORRELATION_ID, corr(0));
    fields.insert(FIELD_CHANNEL_ID, CborValue::Unsigned(u64::from(id)));
    control_frame(CONTROL_KIND_CLOSE_CHANNEL, fields)
}

fn ros_sample(channel_id: u32) -> DecodedFrame<'static> {
    DecodedFrame {
        version: 0,
        opcode: OPCODE_ROS_SAMPLE,
        flags: 0,
        channel_id,
        sequence: 1,
        source_time_ns: 0,
        payload_len: 0,
        extension_len: 0,
        priority: 2,
        clock_id: 0,
        extensions: vec![],
        payload: FramePayload::Application(&[]),
    }
}

fn error_session(corr_byte: u8) -> DecodedFrame<'static> {
    let mut fields = BTreeMap::new();
    fields.insert(FIELD_CORRELATION_ID, corr(corr_byte));
    // scope session = 0 at key 49 (1831) — SM does not require full CDDL fields.
    fields.insert(0x31, CborValue::Unsigned(0));
    fields.insert(0x30, CborValue::Unsigned(25));
    control_frame(CONTROL_KIND_ERROR, fields)
}

/// Drive ClientHello → ServerHello on a server session (ingest ClientHello, send ServerHello).
fn server_through_hello(server: &mut Session) {
    assert_eq!(server.phase(), SessionPhase::AwaitClientHello);
    server.ingest_bootstrap(&client_hello()).unwrap();
    assert_eq!(server.phase(), SessionPhase::AwaitServerHello);
    let fx = server.record_send_bootstrap(&server_hello()).unwrap();
    assert!(fx.entered_selected_plane);
    assert_eq!(server.phase(), SessionPhase::SelectedAwaitAuthenticate);
}

/// Drive ClientHello → ServerHello on a client session.
fn client_through_hello(client: &mut Session) {
    client.record_send_bootstrap(&client_hello()).unwrap();
    let fx = client.ingest_bootstrap(&server_hello()).unwrap();
    assert!(fx.entered_selected_plane);
    assert_eq!(client.phase(), SessionPhase::SelectedAwaitAuthenticate);
}

fn server_through_ready(server: &mut Session) {
    server_through_hello(server);
    server.ingest_frame(&authenticate(1)).unwrap();
    assert_eq!(server.phase(), SessionPhase::SelectedAwaitSessionReady);
    let fx = server.record_send_frame(&session_ready(1)).unwrap();
    assert!(fx.entered_ready);
    assert!(fx.auth_correlation_matched);
    assert_eq!(server.phase(), SessionPhase::Ready);
}

fn client_through_ready(client: &mut Session) {
    client_through_hello(client);
    client.record_send_frame(&authenticate(1)).unwrap();
    let fx = client.ingest_frame(&session_ready(1)).unwrap();
    assert!(fx.entered_ready);
    assert!(fx.auth_correlation_matched);
    assert_eq!(client.phase(), SessionPhase::Ready);
}

#[test]
fn happy_path_server_topic_subscribe() {
    let mut s = Session::new(Role::Server);
    server_through_ready(&mut s);

    let open = open_channel(1, OperationKind::TopicSubscribe, 2);
    let fx = s.ingest_frame(&open).unwrap();
    assert_eq!(fx.channel_opened, Some(1));
    assert_eq!(s.channel_state(1), ChannelState::Pending);

    let ready = channel_ready(1, ChannelResult::Allow, 2);
    let fx = s.record_send_frame(&ready).unwrap();
    assert!(fx.channel_correlation_matched);
    assert_eq!(s.channel_state(1), ChannelState::Active);

    // TOPIC_SUBSCRIBE: ROS_SAMPLE is server → client (local send).
    s.record_send_frame(&ros_sample(1)).unwrap();

    let fx = s.ingest_frame(&close_channel(1)).unwrap();
    assert_eq!(fx.channel_closed, Some(1));
    assert_eq!(s.channel_state(1), ChannelState::Closed);
}

#[test]
fn happy_path_client_topic_subscribe() {
    let mut c = Session::new(Role::Client);
    client_through_ready(&mut c);

    c.record_send_frame(&open_channel(1, OperationKind::TopicSubscribe, 2))
        .unwrap();
    assert_eq!(c.channel_state(1), ChannelState::Pending);

    let fx = c
        .ingest_frame(&channel_ready(1, ChannelResult::Allow, 2))
        .unwrap();
    assert!(fx.channel_correlation_matched);
    assert_eq!(c.channel_state(1), ChannelState::Active);

    // Receive sample from server.
    c.ingest_frame(&ros_sample(1)).unwrap();

    let fx = c.record_send_frame(&close_channel(1)).unwrap();
    assert_eq!(fx.channel_closed, Some(1));
    assert_eq!(c.channel_state(1), ChannelState::Closed);
}

#[test]
fn data_before_ready_session_not_ready() {
    let mut s = Session::new(Role::Server);
    server_through_hello(&mut s);
    let err = s.ingest_frame(&ros_sample(1)).unwrap_err();
    assert_eq!(err.code, 27);
    assert_eq!(err.name, "session_not_ready");
    assert_eq!(err.step, 17);
}

#[test]
fn open_channel_before_ready_session_not_ready() {
    let mut s = Session::new(Role::Server);
    server_through_hello(&mut s);
    let err = s
        .ingest_frame(&open_channel(1, OperationKind::TopicSubscribe, 1))
        .unwrap_err();
    assert_eq!(err.code, 27);
    assert_eq!(err.name, "session_not_ready");
}

#[test]
fn heartbeat_before_ready_rejected_after_ready_ok() {
    let mut s = Session::new(Role::Server);
    server_through_hello(&mut s);
    let err = s.ingest_frame(&heartbeat()).unwrap_err();
    assert_eq!(err.code, 27);

    s.ingest_frame(&authenticate(1)).unwrap();
    s.record_send_frame(&session_ready(1)).unwrap();
    let fx = s.ingest_frame(&heartbeat()).unwrap();
    assert!(fx.heartbeat);
}

#[test]
fn ros_sample_pending_protocol_violation_inactive_unknown_channel() {
    let mut s = Session::new(Role::Server);
    server_through_ready(&mut s);

    // Never opened → unknown_channel (step 20).
    let err = s.record_send_frame(&ros_sample(9)).unwrap_err();
    assert_eq!(err.code, 7);
    assert_eq!(err.name, "unknown_channel");
    assert_eq!(err.step, 20);

    s.ingest_frame(&open_channel(1, OperationKind::TopicSubscribe, 2))
        .unwrap();
    // Pending → protocol_violation step 19.
    let err = s.record_send_frame(&ros_sample(1)).unwrap_err();
    assert_eq!(err.code, 25);
    assert_eq!(err.step, 19);
    assert_eq!(err.reason, "data_on_pending_channel");

    // Fail the channel.
    s.record_send_frame(&channel_ready(1, ChannelResult::Deny, 2))
        .unwrap();
    assert_eq!(s.channel_state(1), ChannelState::Failed);
    let err = s.record_send_frame(&ros_sample(1)).unwrap_err();
    assert_eq!(err.code, 7);

    // Open another, activate, close, then data → unknown_channel.
    s.ingest_frame(&open_channel(2, OperationKind::TopicSubscribe, 3))
        .unwrap();
    s.record_send_frame(&channel_ready(2, ChannelResult::Allow, 3))
        .unwrap();
    s.ingest_frame(&close_channel(2)).unwrap();
    let err = s.record_send_frame(&ros_sample(2)).unwrap_err();
    assert_eq!(err.code, 7);
}

#[test]
fn ros_sample_wrong_direction_on_topic_subscribe() {
    let mut s = Session::new(Role::Server);
    server_through_ready(&mut s);
    s.ingest_frame(&open_channel(1, OperationKind::TopicSubscribe, 2))
        .unwrap();
    s.record_send_frame(&channel_ready(1, ChannelResult::Allow, 2))
        .unwrap();
    // Ingest from client (peer) on TOPIC_SUBSCRIBE → wrong direction.
    let err = s.ingest_frame(&ros_sample(1)).unwrap_err();
    assert_eq!(err.code, 25);
    assert_eq!(err.step, 22);
    assert_eq!(err.reason, "ros_sample_wrong_direction");
}

#[test]
fn bootstrap_error_terminates_without_selected_plane() {
    let mut s = Session::new(Role::Server);
    s.ingest_bootstrap(&client_hello()).unwrap();
    let fx = s.record_send_bootstrap(&bootstrap_error()).unwrap();
    assert!(fx.bootstrap_failed);
    assert_eq!(s.phase(), SessionPhase::BootstrapFailed);
    assert!(!s.phase().in_selected_plane());
    let err = s.ingest_frame(&authenticate(1)).unwrap_err();
    assert_eq!(err.name, "protocol_violation");
}

#[test]
fn double_client_hello_and_wrong_bootstrap_order() {
    let mut s = Session::new(Role::Server);
    s.ingest_bootstrap(&client_hello()).unwrap();
    let err = s.ingest_bootstrap(&client_hello()).unwrap_err();
    assert_eq!(err.code, 25);
    assert_eq!(err.reason, "duplicate_or_late_client_hello");

    let mut s2 = Session::new(Role::Server);
    let err = s2.ingest_bootstrap(&server_hello()).unwrap_err();
    // ServerHello from peer (client) is wrong direction for ingest on server...
    // ingest uses peer as sender: Server.peer() = Client sending ServerHello → wrong direction.
    assert_eq!(err.reason, "wrong_bootstrap_direction");

    let mut s3 = Session::new(Role::Server);
    let err = s3.record_send_bootstrap(&server_hello()).unwrap_err();
    assert_eq!(err.reason, "server_hello_out_of_order");
}

#[test]
fn channel_id_reuse_after_open_channel() {
    let mut s = Session::new(Role::Server);
    server_through_ready(&mut s);
    s.ingest_frame(&open_channel(1, OperationKind::TopicSubscribe, 2))
        .unwrap();
    let err = s
        .ingest_frame(&open_channel(1, OperationKind::TopicPublish, 3))
        .unwrap_err();
    assert_eq!(err.reason, "channel_id_reuse");
    assert_eq!(err.code, 25);
}

#[test]
fn authenticate_after_ready_and_session_ready_before_auth() {
    let mut s = Session::new(Role::Server);
    server_through_ready(&mut s);
    let err = s.ingest_frame(&authenticate(9)).unwrap_err();
    assert_eq!(err.reason, "authenticate_out_of_order");

    let mut s2 = Session::new(Role::Server);
    server_through_hello(&mut s2);
    let err = s2.record_send_frame(&session_ready(1)).unwrap_err();
    assert_eq!(err.reason, "session_ready_out_of_order");
}

#[test]
fn topic_publish_accepts_client_to_server_sample() {
    let mut s = Session::new(Role::Server);
    server_through_ready(&mut s);
    s.ingest_frame(&open_channel(1, OperationKind::TopicPublish, 2))
        .unwrap();
    s.record_send_frame(&channel_ready(1, ChannelResult::Limited, 2))
        .unwrap();
    s.ingest_frame(&ros_sample(1)).unwrap();
    let err = s.record_send_frame(&ros_sample(1)).unwrap_err();
    assert_eq!(err.reason, "ros_sample_wrong_direction");
}

#[test]
fn auth_error_fails_session_with_correlation() {
    let mut s = Session::new(Role::Server);
    server_through_hello(&mut s);
    s.ingest_frame(&authenticate(4)).unwrap();
    let fx = s.record_send_frame(&error_session(4)).unwrap();
    assert!(fx.session_error);
    assert!(fx.auth_correlation_matched);
    assert_eq!(s.phase(), SessionPhase::Failed);
}
