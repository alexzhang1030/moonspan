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
  session_ready_bytes_for_row(seq, correlation, "J-FT", "jazzy")
}

fn session_ready_bytes_for_row(
  seq: u64,
  correlation: &[u8; 16],
  support_row: &str,
  ros_distro: &str,
) -> Vec<u8> {
  let msg = CborValue::Map(vec![
    (1, CborValue::Unsigned(2)),
    (2, bytes_val(correlation)),
    (7, text_val("gw-test")),
    (8, text_val(support_row)),
    (10, CborValue::Array(vec![CborValue::Unsigned(0)])),
    (12, CborValue::Map(Vec::new())),
    (13, text_val("policy-v0")),
    (18, text_val(ros_distro)),
    (19, text_val("rmw_fastrtps_cpp")),
    (20, text_val("0.1.0")),
    (21, text_val("anonymous")),
    (53, bytes_val(&[0u8; 32])),
    (
      54,
      CborValue::Map(vec![
        (1, CborValue::Map(vec![(1, CborValue::Bool(false)), (2, CborValue::Bool(true))])),
        (2, CborValue::Map(vec![(1, CborValue::Bool(true)), (2, CborValue::Bool(false))])),
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
  engine.poll(vec![HostEvent::WsBytes { buffer_id: 0, bytes }])
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
  let start = engine.poll(vec![HostEvent::Command(AppCommand::Start {
    transferable_arraybuffer: true,
    webtransport: false,
  })]);
  assert_eq!(start.outbound.len(), 1);
  assert_eq!(engine.phase(), SessionPhase::AwaitServerHello);

  let boot = feed(&mut engine, server_hello_bytes());
  assert!(boot.events.iter().any(|e| matches!(e, AppEvent::BootstrapComplete { .. })));

  let auth_corr = corr(0xA1);
  let auth = engine.poll(vec![HostEvent::Command(AppCommand::Authenticate {
    correlation: auth_corr,
    scheme: "token".into(),
    token: b"anonymous".to_vec(),
  })]);
  assert_eq!(auth.outbound.len(), 1);

  let ready = feed(&mut engine, session_ready_bytes(0, &auth_corr));
  assert!(
    ready
      .events
      .iter()
      .any(|e| matches!(e, AppEvent::SessionReady { support_row, .. } if support_row == "J-FT"))
  );
  assert_eq!(engine.phase(), SessionPhase::Ready);

  let sub_corr = corr(0xB2);
  let sub = engine.poll(vec![HostEvent::Command(AppCommand::Subscribe {
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
  let AppEvent::Sample { channel_id, lease_id, string_data, .. } = sample
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
  assert_eq!(engine.lease_payload_view(lease_id), Some(payload.as_slice()));

  let released = engine.poll(vec![HostEvent::ReleaseLease { lease_id }]);
  assert!(
    released.released_buffers.iter().any(|b| b.buffer_id != 0 || b.len > 0)
      || !engine.buffer_bytes(lease_id).is_some()
  );
  // Lease backing store should be gone after release + sweep.
  assert!(engine.lease_buffer_id(lease_id).is_none());
}

#[test]
fn scripted_peer_publish_sends_ros_sample() {
  let mut engine = ClientEngine::new();
  let _ = engine.poll(vec![HostEvent::Command(AppCommand::Start {
    transferable_arraybuffer: true,
    webtransport: false,
  })]);
  let _ = feed(&mut engine, server_hello_bytes());
  let auth_corr = corr(0xA1);
  let _ = engine.poll(vec![HostEvent::Command(AppCommand::Authenticate {
    correlation: auth_corr,
    scheme: "token".into(),
    token: b"anonymous".to_vec(),
  })]);
  let _ = feed(&mut engine, session_ready_bytes(0, &auth_corr));

  let pub_corr = corr(0xC3);
  let opened = engine.poll(vec![HostEvent::Command(AppCommand::Publish {
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

  let sent = engine.poll(vec![HostEvent::Command(AppCommand::SendSample {
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
  assert_eq!(ClientEngine::decode_std_msgs_string(payload).unwrap(), "hello from client");
}

#[test]
fn close_command_terminates() {
  let mut engine = ClientEngine::new();
  let _ = engine.poll(vec![HostEvent::Command(AppCommand::Start {
    transferable_arraybuffer: true,
    webtransport: false,
  })]);
  let out = engine.poll(vec![HostEvent::Command(AppCommand::Close)]);
  assert!(out.events.iter().any(|e| matches!(e, AppEvent::Closed { .. })));
}

#[test]
fn large_point_cloud2_sample_borrowed_view_and_single_retain_copy() {
  use crate::cdr::{SENSOR_MSGS_POINT_CLOUD2, build_synthetic_xyz_cdr};

  let mut engine = ClientEngine::new();
  let _ = engine.poll(vec![HostEvent::Command(AppCommand::Start {
    transferable_arraybuffer: true,
    webtransport: false,
  })]);
  let _ = feed(&mut engine, server_hello_bytes());
  let auth_corr = corr(0xC3);
  let _ = engine.poll(vec![HostEvent::Command(AppCommand::Authenticate {
    correlation: auth_corr,
    scheme: "token".into(),
    token: b"anonymous".to_vec(),
  })]);
  let _ = feed(&mut engine, session_ready_bytes(0, &auth_corr));

  let sub_corr = corr(0xD4);
  let _ = engine.poll(vec![HostEvent::Command(AppCommand::Subscribe {
    correlation: sub_corr,
    channel_id: 9,
    topic: "/points".into(),
    type_name: SENSOR_MSGS_POINT_CLOUD2.into(),
    qos_reliability: 2,
    qos_depth: 1,
    domain_id: 0,
  })]);
  let _ = feed(&mut engine, channel_ready_allow_bytes(1, &sub_corr, 9));

  // ~1 MiB point payload (87_381 * 12).
  const POINTS: u32 = 87_381;
  let cdr = build_synthetic_xyz_cdr(POINTS).expect("synthetic pc2");
  assert!(cdr.len() > 1_000_000);

  let before = engine.telemetry();
  let frame = sample_frame(9, 0, &cdr);
  let frame_len = frame.len();
  let sample = feed(&mut engine, frame);
  let after = engine.telemetry();

  assert_eq!(after.copies_into_engine - before.copies_into_engine, 1);
  assert_eq!(after.bytes_copied_into_engine - before.bytes_copied_into_engine, frame_len as u64);

  let AppEvent::Sample { channel_id, lease_id, string_data, .. } =
    sample.events.iter().find(|e| matches!(e, AppEvent::Sample { .. })).expect("sample event")
  else {
    unreachable!()
  };
  assert_eq!(*channel_id, 9);
  assert!(string_data.is_none());

  let view = engine.lease_point_cloud2_view(*lease_id).expect("lease").expect("pc2 decode");
  assert_eq!(view.width, POINTS);
  assert_eq!(view.data.len(), POINTS as usize * 12);

  let payload = engine.lease_payload_view(*lease_id).expect("payload");
  let payload_start = payload.as_ptr() as usize;
  let data_start = view.data.as_ptr() as usize;
  assert!(
    data_start >= payload_start && data_start + view.data.len() <= payload_start + payload.len(),
    "PointCloud2 data must borrow from the leased CDR payload"
  );

  let _ = engine.poll(vec![HostEvent::ReleaseLease { lease_id: *lease_id }]);
}

#[test]
fn unused_zero_correlation_constant() {
  assert_eq!(ZERO_CORRELATION, [0u8; 16]);
}

fn through_ready(engine: &mut ClientEngine) -> u64 {
  let _ = engine.poll(vec![HostEvent::Command(AppCommand::Start {
    transferable_arraybuffer: true,
    webtransport: false,
  })]);
  let _ = feed(engine, server_hello_bytes());
  let auth_corr = corr(0xA1);
  let _ = engine.poll(vec![HostEvent::Command(AppCommand::Authenticate {
    correlation: auth_corr,
    scheme: "token".into(),
    token: b"anonymous".to_vec(),
  })]);
  let _ = feed(engine, session_ready_bytes(0, &auth_corr));
  // Next inbound control sequence after SessionReady (seq 0).
  1
}

#[test]
fn service_client_call_emits_request_and_response_event() {
  use crate::protocol::extension::{OPERATION_ID_EXTENSION_TYPE, R2wpExtension};
  use crate::protocol::frame::{
    FLAG_ROS_RELIABLE, OPCODE_SERVICE_REQUEST, OPCODE_SERVICE_RESPONSE,
  };
  use crate::protocol::{FrameHeader, encode_extension_area, encode_frame};

  let mut engine = ClientEngine::new();
  let mut ctrl_seq = through_ready(&mut engine);

  let open_corr = corr(0xB1);
  let opened = engine.poll(vec![HostEvent::Command(AppCommand::OpenService {
    correlation: open_corr,
    channel_id: 5,
    name: "/add_two_ints".into(),
    type_name: "example_interfaces/srv/AddTwoInts".into(),
    domain_id: 0,
    client: true,
  })]);
  assert_eq!(opened.outbound.len(), 1);

  let ready = feed(&mut engine, channel_ready_allow_bytes(ctrl_seq, &open_corr, 5));
  ctrl_seq += 1;
  assert!(
    ready
      .events
      .iter()
      .any(|e| matches!(e, AppEvent::ServiceReady { channel_id: 5, client: true, .. }))
  );

  let opid = [0x11u8; 16];
  let request = b"req-bytes".to_vec();
  let sent = engine.poll(vec![HostEvent::Command(AppCommand::CallService {
    channel_id: 5,
    operation_id: opid,
    request: request.clone(),
  })]);
  assert_eq!(sent.outbound.len(), 1);
  let frame = parse_frame(&sent.outbound[0].bytes, None).expect("request frame");
  assert_eq!(frame.opcode, OPCODE_SERVICE_REQUEST);
  assert_eq!(frame.channel_id, 5);
  assert_eq!(frame.flags & FLAG_ROS_RELIABLE, FLAG_ROS_RELIABLE);
  assert!(
    frame.extensions.iter().any(|e| e.type_id == OPERATION_ID_EXTENSION_TYPE && e.value == opid)
  );
  let FramePayload::Application(payload) = &frame.payload else {
    panic!("expected application payload");
  };
  assert_eq!(*payload, request.as_slice());

  let response_payload = b"resp-bytes";
  let ext = encode_extension_area(&[R2wpExtension {
    type_id: OPERATION_ID_EXTENSION_TYPE,
    critical: true,
    value: &opid,
  }])
  .unwrap();
  let resp_bytes = encode_frame(
    &FrameHeader {
      version: 0,
      opcode: OPCODE_SERVICE_RESPONSE,
      flags: FLAG_ROS_RELIABLE,
      channel_id: 5,
      sequence: 0,
      source_time_ns: 0,
      priority: 2,
      clock_id: 0,
    },
    &ext,
    response_payload,
  )
  .unwrap();
  let inbound = feed(&mut engine, resp_bytes);
  let AppEvent::ServiceResponse { channel_id, operation_id, lease_id, .. } = inbound
    .events
    .iter()
    .find(|e| matches!(e, AppEvent::ServiceResponse { .. }))
    .cloned()
    .expect("service response event")
  else {
    panic!("expected ServiceResponse");
  };
  assert_eq!(channel_id, 5);
  assert_eq!(operation_id, opid);
  assert_eq!(engine.lease_payload_view(lease_id), Some(response_payload.as_slice()));
  let _ = ctrl_seq;
}

#[test]
fn graph_snapshot_control_emits_app_event() {
  use crate::protocol::control::CONTROL_KIND_GRAPH_SNAPSHOT;

  let mut engine = ClientEngine::new();
  let ctrl_seq = through_ready(&mut engine);

  let msg = CborValue::Map(vec![
    (1, CborValue::Unsigned(u64::from(CONTROL_KIND_GRAPH_SNAPSHOT))),
    (2, bytes_val(&ZERO_CORRELATION)),
    (7, text_val("gw-test")),
    (8, text_val("J-FT")),
    (14, CborValue::Unsigned(7)),
    (
      22,
      CborValue::Array(vec![CborValue::Map(vec![
        (55, bytes_val(&[0xAAu8; 16])),
        (1, text_val("/talker")),
        (9, CborValue::Unsigned(0)),
      ])]),
    ),
    (23, CborValue::Array(Vec::new())),
  ]);
  let bytes = encode_control_frame(0, ctrl_seq, &msg).expect("graph snapshot");
  let out = feed(&mut engine, bytes);
  let AppEvent::GraphSnapshot { generation, nodes_json, endpoints_json } = out
    .events
    .iter()
    .find(|e| matches!(e, AppEvent::GraphSnapshot { .. }))
    .cloned()
    .expect("graph snapshot event")
  else {
    panic!("expected GraphSnapshot");
  };
  assert_eq!(generation, 7);
  assert!(nodes_json.contains("/talker"));
  assert!(nodes_json.contains("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"));
  assert_eq!(endpoints_json, "[]");
}

#[test]
fn h_ft_session_ready_subscribe_emits_moonspan_open_channel() {
  use crate::protocol::frame::OPCODE_CONTROL_CBOR;
  use crate::types::SCHEME_MOONSPAN_SCHEMA_V1;

  let mut engine = ClientEngine::new();
  let _ = engine.poll(vec![HostEvent::Command(AppCommand::Start {
    transferable_arraybuffer: true,
    webtransport: false,
  })]);
  let _ = feed(&mut engine, server_hello_bytes());
  let auth_corr = corr(0xA1);
  let _ = engine.poll(vec![HostEvent::Command(AppCommand::Authenticate {
    correlation: auth_corr,
    scheme: "token".into(),
    token: b"anonymous".to_vec(),
  })]);
  let ready = feed(&mut engine, session_ready_bytes_for_row(0, &auth_corr, "H-FT", "humble"));
  assert!(
    ready
      .events
      .iter()
      .any(|e| matches!(e, AppEvent::SessionReady { support_row, .. } if support_row == "H-FT"))
  );
  assert_eq!(engine.support_row_id(), "H-FT");

  let type_name = "moonspan_cdr_interfaces/msg/PrimitiveScalars";
  let sub = engine.poll(vec![HostEvent::Command(AppCommand::Subscribe {
    correlation: corr(0xB2),
    channel_id: 7,
    topic: "/primitives".into(),
    type_name: type_name.into(),
    qos_reliability: 1,
    qos_depth: 5,
    domain_id: 0,
  })]);
  assert_eq!(sub.outbound.len(), 1);
  let bytes = &sub.outbound[0].bytes;
  let frame = parse_frame(bytes, None).expect("parse open");
  assert_eq!(frame.opcode, OPCODE_CONTROL_CBOR);
  let FramePayload::Control(msg) = frame.payload else {
    panic!("expected control");
  };
  assert_eq!(msg.kind, 8, "OpenChannel");
  let row = match msg.fields.get(&8) {
    Some(CborValue::Text(t)) => t.as_ref(),
    other => panic!("expected support_row text, got {other:?}"),
  };
  assert_eq!(row, "H-FT");
  let CborValue::Map(identity) = msg.fields.get(&3).expect("schema identity") else {
    panic!("expected identity map");
  };
  let identity: std::collections::BTreeMap<u64, &CborValue<'_>> =
    identity.iter().map(|(k, v)| (*k, v)).collect();
  let scheme = match identity.get(&1) {
    Some(CborValue::Text(t)) => t.as_ref(),
    other => panic!("expected scheme, got {other:?}"),
  };
  assert_eq!(scheme, SCHEME_MOONSPAN_SCHEMA_V1);
}
