//! Emit hex fixtures for the R1-04 SDK scripted-peer tests.

use rclweb::cdr::build_synthetic_xyz_cdr;
use rclweb::protocol::bootstrap::{
  BufferCapabilities, EffectiveLimits, ServerHello, TransportCapabilities,
};
use rclweb::protocol::cbor::CborValue;
use rclweb::protocol::encode::{
  FrameHeader, encode_control_frame, encode_server_hello, write_frame_header,
};
use rclweb::protocol::frame::{FRAME_HEADER_LENGTH, OPCODE_ROS_SAMPLE};
use rclweb::types::{
  GeneratedMessage, encode_generated_cdr, sample_nested_sample, sample_primitive_scalars,
};
use rclweb::{ClientEngine, STD_MSGS_STRING};
use serde_json::json;
use std::borrow::Cow;

fn hex(bytes: &[u8]) -> String {
  bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn bytes_val(bytes: &[u8]) -> CborValue<'static> {
  CborValue::Bytes(Cow::Owned(bytes.to_vec()))
}

fn text_val(text: &str) -> CborValue<'static> {
  CborValue::Text(Cow::Owned(text.to_owned()))
}

fn channel_ready_map(correlation: &[u8; 16], channel_id: u32) -> CborValue<'static> {
  CborValue::Map(vec![
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
  ])
}

fn main() {
  let server_hello = encode_server_hello(&ServerHello {
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
  .expect("server hello");

  let auth_corr = [0xa1u8; 16];
  let session_ready = encode_control_frame(
    0,
    0,
    &CborValue::Map(vec![
      (1, CborValue::Unsigned(2)),
      (2, bytes_val(&auth_corr)),
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
          (1, CborValue::Map(vec![(1, CborValue::Bool(false)), (2, CborValue::Bool(true))])),
          (2, CborValue::Map(vec![(1, CborValue::Bool(true)), (2, CborValue::Bool(false))])),
          (3, CborValue::Array(Vec::new())),
        ]),
      ),
    ]),
  )
  .expect("session ready");

  let sub_corr = [0xb1u8; 16];
  let channel_ready =
    encode_control_frame(0, 1, &channel_ready_map(&sub_corr, 1)).expect("channel ready");

  let service_corr = [0xe1u8; 16];
  let service_channel_ready = encode_control_frame(0, 1, &channel_ready_map(&service_corr, 1))
    .expect("service channel ready");

  let action_corr = [0xe3u8; 16];
  let action_channel_ready =
    encode_control_frame(0, 1, &channel_ready_map(&action_corr, 1)).expect("action channel ready");

  let node_id = [0xaau8; 16];
  let graph_snapshot = encode_control_frame(
    0,
    1,
    &CborValue::Map(vec![
      (1, CborValue::Unsigned(3)),
      (2, bytes_val(&[0u8; 16])),
      (14, CborValue::Unsigned(1)),
      (7, text_val("gw-test")),
      (8, text_val("J-FT")),
      (
        22,
        CborValue::Array(vec![CborValue::Map(vec![
          (55, bytes_val(&node_id)),
          (1, text_val("/talker")),
          (9, CborValue::Unsigned(0)),
        ])]),
      ),
      (23, CborValue::Array(Vec::new())),
    ]),
  )
  .expect("graph snapshot");

  let payload = ClientEngine::encode_std_msgs_string("hello-from-fixture").unwrap();
  let sample = ros_sample(1, &payload);

  // Four XYZ points (48-byte payload) so SDK tests stay small.
  let pc2_payload = build_synthetic_xyz_cdr(4).expect("pc2 cdr");
  let point_cloud2_sample = ros_sample(1, &pc2_payload);

  let primitive_payload =
    encode_generated_cdr(&GeneratedMessage::PrimitiveScalars(sample_primitive_scalars()))
      .expect("primitive cdr");
  let primitive_scalars_sample = ros_sample(1, &primitive_payload);

  let nested_payload =
    encode_generated_cdr(&GeneratedMessage::NestedSample(sample_nested_sample()))
      .expect("nested cdr");
  let nested_sample = ros_sample(1, &nested_payload);

  let _ = STD_MSGS_STRING;
  println!(
    "{}",
    serde_json::to_string_pretty(&json!({
        "serverHello": hex(&server_hello),
        "sessionReady": hex(&session_ready),
        "channelReady": hex(&channel_ready),
        "serviceChannelReady": hex(&service_channel_ready),
        "actionChannelReady": hex(&action_channel_ready),
        "graphSnapshot": hex(&graph_snapshot),
        "sample": hex(&sample),
        "pointCloud2Sample": hex(&point_cloud2_sample),
        "primitiveScalarsSample": hex(&primitive_scalars_sample),
        "nestedSample": hex(&nested_sample),
        "authCorrelationHex": hex(&auth_corr),
        "subCorrelationHex": hex(&sub_corr),
        "serviceCorrelationHex": hex(&service_corr),
        "actionCorrelationHex": hex(&action_corr),
    }))
    .expect("json"),
  );
}

fn ros_sample(channel_id: u32, payload: &[u8]) -> Vec<u8> {
  let mut sample = vec![0u8; FRAME_HEADER_LENGTH + payload.len()];
  write_frame_header(
    &FrameHeader {
      version: 0,
      opcode: OPCODE_ROS_SAMPLE,
      flags: 0,
      channel_id,
      sequence: 0,
      source_time_ns: 0,
      priority: 2,
      clock_id: 0,
    },
    payload.len() as u32,
    0,
    &mut sample,
  )
  .expect("header");
  sample[FRAME_HEADER_LENGTH..].copy_from_slice(payload);
  sample
}
