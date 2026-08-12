//! Unit tests for the client connection engine (scripted peer bytes).

use super::{AppCommand, AppEvent, ClientEngine, HostEvent, STD_MSGS_STRING, ZERO_CORRELATION};
use crate::protocol::bootstrap::{
    BufferCapabilities, EffectiveLimits, ServerHello, TransportCapabilities,
};
use crate::protocol::cbor::CborValue;
use crate::protocol::encode::{
    FrameHeader, encode_control_frame, encode_server_hello, write_frame_header,
};
use crate::protocol::frame::{FRAME_HEADER_LENGTH, FramePayload, OPCODE_ROS_SAMPLE, parse_frame};
use crate::session::SessionPhase;
use std::borrow::Cow;

fn corr(tag: u8) -> [u8; 16] {
    [tag; 16]
}

fn bytes_val(bytes: &[u8]) -> CborValue<'static> {
    CborValue::Bytes(Cow::Owned(bytes.to_vec()))
}

fn text_val(text: &str) -> CborValue<'static> {
    CborValue::Text(Cow::Owned(text.to_owned()))
}

fn server_hello_bytes() -> Vec<u8> {
    encode_server_hello(&ServerHello {
        selected_wire_version: 0,
        transport_capabilities: TransportCapabilities {
            webtransport_http3: false,
            binary_wss: true,
            max_datagram_size: None,
        },
        buffer_capabilities: BufferCapabilities {
            transferable_arraybuffer: true,
            shared_arraybuffer: false,
        },
        effective_limits: EffectiveLimits {
            max_channels: 64,
            max_session_bytes: 64 * 1024 * 1024,
            max_message_bytes: 4 * 1024 * 1024,
            max_control_payload_bytes: 64 * 1024,
        },
        extension_capabilities: Vec::new(),
    })
    .expect("encode server hello")
}

fn session_ready_bytes(seq: u64, correlation: &[u8; 16]) -> Vec<u8> {
    let msg = CborValue::Map(vec![
        (1, CborValue::Unsigned(2)),
        (2, bytes_val(correlation)),
        (7, text_val("gw-test")),
        (8, text_val("J-FT")),
        (10, CborValue::Array(vec![CborValue::Unsigned(0)])),
        (12, CborValue::Map(Vec::new())),
        (13, text_val("policy-v0")),
        (18, text_val("jazzy")),
        (19, text_val("rmw_fastrtps_cpp")),
        (20, text_val("0.1.0")),
        (21, text_val("anonymous")),
        (53, bytes_val(&[0u8; 32])),
        (
            54,
            CborValue::Map(vec![
                (
                    1,
                    CborValue::Map(vec![
                        (1, CborValue::Bool(false)),
                        (2, CborValue::Bool(true)),
                    ]),
                ),
                (
                    2,
                    CborValue::Map(vec![
                        (1, CborValue::Bool(true)),
                        (2, CborValue::Bool(false)),
                    ]),
                ),
                (3, CborValue::Array(Vec::new())),
            ]),
        ),
    ]);
    encode_control_frame(0, seq, &msg).expect("encode session ready")
}

fn channel_ready_allow_bytes(seq: u64, correlation: &[u8; 16], channel_id: u32) -> Vec<u8> {
    let msg = CborValue::Map(vec![
        (1, CborValue::Unsigned(9)),
        (2, bytes_val(correlation)),
        (29, CborValue::Unsigned(u64::from(channel_id))),
        (33, CborValue::Unsigned(0)),
        (12, CborValue::Map(Vec::new())),
        (59, CborValue::Unsigned(2)),
        (
            57,
            CborValue::Map(vec![
                (1, CborValue::Unsigned(1)),
                (2, CborValue::Unsigned(2)),
                (3, CborValue::Unsigned(1)),
                (4, CborValue::Unsigned(5)),
                (7, CborValue::Unsigned(1)),
            ]),
        ),
        (9, CborValue::Unsigned(0)),
        (8, text_val("J-FT")),
    ]);
    encode_control_frame(0, seq, &msg).expect("encode channel ready")
}

fn sample_frame(channel_id: u32, sequence: u64, payload: &[u8]) -> Vec<u8> {
    let mut buf = vec![0u8; FRAME_HEADER_LENGTH + payload.len()];
    write_frame_header(
        &FrameHeader {
            version: 0,
            opcode: OPCODE_ROS_SAMPLE,
            flags: 0,
            channel_id,
            sequence,
            source_time_ns: 0,
            priority: 2,
            clock_id: 0,
        },
        payload.len() as u32,
        0,
        &mut buf,
    )
    .expect("header");
    buf[FRAME_HEADER_LENGTH..].copy_from_slice(payload);
    buf
}

fn feed(engine: &mut ClientEngine, bytes: Vec<u8>) -> super::PollOutcome {
    engine.poll(&[HostEvent::WsBytes {
        buffer_id: 0,
        bytes,
    }])
}

#[test]
fn string_cdr_round_trip() {
    let encoded = ClientEngine::encode_std_msgs_string("hello rclweb").unwrap();
    let decoded = ClientEngine::decode_std_msgs_string(&encoded).unwrap();
    assert_eq!(decoded, "hello rclweb");
}

#[test]
fn scripted_peer_reaches_subscribed_and_sample() {
    let mut engine = ClientEngine::new();
    let start = engine.poll(&[HostEvent::Command(AppCommand::Start {
        transferable_arraybuffer: true,
    })]);
    assert_eq!(start.outbound.len(), 1);
    assert_eq!(engine.phase(), SessionPhase::AwaitServerHello);

    let boot = feed(&mut engine, server_hello_bytes());
    assert!(
        boot.events
            .iter()
            .any(|e| matches!(e, AppEvent::BootstrapComplete { .. }))
    );

    let auth_corr = corr(0xA1);
    let auth = engine.poll(&[HostEvent::Command(AppCommand::Authenticate {
        correlation: auth_corr,
        scheme: "token".into(),
        token: b"anonymous".to_vec(),
    })]);
    assert_eq!(auth.outbound.len(), 1);

    let ready = feed(&mut engine, session_ready_bytes(0, &auth_corr));
    assert!(
        ready.events.iter().any(
            |e| matches!(e, AppEvent::SessionReady { support_row, .. } if support_row == "J-FT")
        )
    );
    assert_eq!(engine.phase(), SessionPhase::Ready);

    let sub_corr = corr(0xB2);
    let sub = engine.poll(&[HostEvent::Command(AppCommand::Subscribe {
        correlation: sub_corr,
        channel_id: 7,
        topic: "/chatter".into(),
        type_name: STD_MSGS_STRING.into(),
        qos_reliability: 1,
        qos_depth: 5,
        domain_id: 0,
    })]);
    assert_eq!(sub.outbound.len(), 1);

    let ch = feed(&mut engine, channel_ready_allow_bytes(1, &sub_corr, 7));
    assert!(ch.events.iter().any(|e| matches!(
        e,
        AppEvent::Subscribed {
            channel_id: 7,
            topic,
            type_name,
        } if topic == "/chatter" && type_name == STD_MSGS_STRING
    )));

    let payload = ClientEngine::encode_std_msgs_string("ping").unwrap();
    let sample = feed(&mut engine, sample_frame(7, 0, &payload));
    let AppEvent::Sample {
        channel_id,
        lease_id,
        string_data,
        ..
    } = sample
        .events
        .iter()
        .find(|e| matches!(e, AppEvent::Sample { .. }))
        .cloned()
        .expect("sample event")
    else {
        panic!("expected sample");
    };
    assert_eq!(channel_id, 7);
    assert_eq!(string_data.as_deref(), Some("ping"));
    // The CDR payload stays reachable as a borrowed view under the lease.
    assert_eq!(
        engine.lease_payload_view(lease_id),
        Some(payload.as_slice())
    );

    let released = engine.poll(&[HostEvent::ReleaseLease { lease_id }]);
    assert!(
        released
            .released_buffers
            .iter()
            .any(|b| b.buffer_id != 0 || b.len > 0)
            || !engine.buffer_bytes(lease_id).is_some()
    );
    // Lease backing store should be gone after release + sweep.
    assert!(engine.lease_buffer_id(lease_id).is_none());
}

#[test]
fn scripted_peer_publish_sends_ros_sample() {
    let mut engine = ClientEngine::new();
    let _ = engine.poll(&[HostEvent::Command(AppCommand::Start {
        transferable_arraybuffer: true,
    })]);
    let _ = feed(&mut engine, server_hello_bytes());
    let auth_corr = corr(0xA1);
    let _ = engine.poll(&[HostEvent::Command(AppCommand::Authenticate {
        correlation: auth_corr,
        scheme: "token".into(),
        token: b"anonymous".to_vec(),
    })]);
    let _ = feed(&mut engine, session_ready_bytes(0, &auth_corr));

    let pub_corr = corr(0xC3);
    let opened = engine.poll(&[HostEvent::Command(AppCommand::Publish {
        correlation: pub_corr,
        channel_id: 3,
        topic: "/chatter".into(),
        type_name: STD_MSGS_STRING.into(),
        qos_reliability: 1,
        qos_depth: 5,
        domain_id: 0,
    })]);
    assert_eq!(opened.outbound.len(), 1);

    let ready = feed(&mut engine, channel_ready_allow_bytes(1, &pub_corr, 3));
    assert!(ready.events.iter().any(|e| matches!(
        e,
        AppEvent::Published {
            channel_id: 3,
            topic,
            type_name,
            qos_reliability: 1,
        } if topic == "/chatter" && type_name == STD_MSGS_STRING
    )));

    let sent = engine.poll(&[HostEvent::Command(AppCommand::SendSample {
        channel_id: 3,
        string_data: "hello from client".into(),
    })]);
    assert_eq!(sent.outbound.len(), 1);
    assert_eq!(engine.telemetry().samples_sent, 1);
    let frame = parse_frame(&sent.outbound[0].bytes, None).expect("sample frame");
    assert_eq!(frame.opcode, OPCODE_ROS_SAMPLE);
    assert_eq!(frame.channel_id, 3);
    assert_eq!(frame.sequence, 0);
    let FramePayload::Application(payload) = &frame.payload else {
        panic!("expected application payload");
    };
    assert_eq!(
        ClientEngine::decode_std_msgs_string(payload).unwrap(),
        "hello from client"
    );
}

#[test]
fn close_command_terminates() {
    let mut engine = ClientEngine::new();
    let _ = engine.poll(&[HostEvent::Command(AppCommand::Start {
        transferable_arraybuffer: true,
    })]);
    let out = engine.poll(&[HostEvent::Command(AppCommand::Close)]);
    assert!(
        out.events
            .iter()
            .any(|e| matches!(e, AppEvent::Closed { .. }))
    );
}

#[test]
fn unused_zero_correlation_constant() {
    assert_eq!(ZERO_CORRELATION, [0u8; 16]);
}
