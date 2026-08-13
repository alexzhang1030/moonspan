//! Gateway WebSocket integration: full R2WP v0.1 walking-skeleton flows
//! against a real tokio/axum endpoint with the in-memory backend.

mod common;

use common::{TestClient, corr, start_gateway, start_gateway_with_config, start_gateway_with_row};
use rclweb::{
  BootstrapRecord, CborValue, ChannelState, FrameHeader, FramePayload, OPCODE_ROS_SAMPLE,
  SCHEME_RCLWEB_SCHEMA_V1, encode_frame, parse_frame, schema_identity_for_type,
};
use std::collections::BTreeMap;

fn control_fields(bytes: &[u8]) -> (u8, BTreeMap<u64, CborValue<'_>>) {
  let frame = parse_frame(bytes, None).expect("parse control frame");
  match frame.payload {
    FramePayload::Control(msg) => (msg.kind, msg.fields),
    FramePayload::Application(_) => panic!("expected control payload"),
  }
}

fn uint(fields: &BTreeMap<u64, CborValue<'_>>, key: u64) -> u64 {
  match fields.get(&key) {
    Some(CborValue::Unsigned(v)) => *v,
    other => panic!("expected unsigned at key {key}, got {other:?}"),
  }
}

fn text<'a>(fields: &'a BTreeMap<u64, CborValue<'_>>, key: u64) -> &'a str {
  match fields.get(&key) {
    Some(CborValue::Text(t)) => t.as_ref(),
    other => panic!("expected text at key {key}, got {other:?}"),
  }
}

async fn ready_session(client: &mut TestClient) {
  ready_session_expecting(client, "J-FT", "jazzy", "rmw_fastrtps_cpp").await;
}

async fn ready_session_expecting(
  client: &mut TestClient,
  support_row_id: &str,
  ros_distro: &str,
  rmw_identifier: &str,
) {
  let hello = TestClient::default_hello();
  let record = client.bootstrap(&hello).await;
  let BootstrapRecord::ServerHello(server_hello) = record else {
    panic!("expected ServerHello, got {record:?}");
  };
  assert_eq!(server_hello.selected_wire_version, 0);
  assert!(server_hello.transport_capabilities.binary_wss);
  assert!(server_hello.extension_capabilities.is_empty());

  let auth_corr = corr(0xA1);
  client.send_control(&TestClient::authenticate_msg(&auth_corr)).await;
  let (bytes, effects) = client.recv_ingested().await.expect("session ready");
  assert!(effects.entered_ready);
  assert!(effects.auth_correlation_matched);
  let (kind, fields) = control_fields(&bytes);
  assert_eq!(kind, 2, "SessionReady");
  assert_eq!(text(&fields, 8), support_row_id);
  assert_eq!(text(&fields, 18), ros_distro);
  assert_eq!(text(&fields, 19), rmw_identifier);
  assert_eq!(text(&fields, 7), "gw-test");
  assert_eq!(text(&fields, 21), "anonymous");

  // R3-01: GraphSnapshot generation=1 follows SessionReady.
  let (bytes, effects) = client.recv_ingested().await.expect("graph snapshot");
  assert_eq!(effects.graph_snapshot, Some(1));
  let (kind, fields) = control_fields(&bytes);
  assert_eq!(kind, 3, "GraphSnapshot");
  assert_eq!(uint(&fields, 14), 1, "generation");
  assert_eq!(text(&fields, 8), support_row_id);
  assert_eq!(client.session.graph_generation(), Some(1));
}

/// After a successful OpenChannel, drain an optional GraphDelta (generation N+1).
async fn expect_channel_ready_then_optional_delta(
  client: &mut TestClient,
) -> (Vec<u8>, rclweb::SessionEffects) {
  let (bytes, effects) = client.recv_ingested().await.expect("channel ready");
  let (kind, _) = control_fields(&bytes);
  assert_eq!(kind, 9, "ChannelReady");
  // GraphDelta may follow when the mock graph gains an endpoint.
  // Peek by attempting a short wait only if generation advanced — the gateway
  // always emits delta on successful open, so consume it.
  let (delta_bytes, delta_fx) = client.recv_ingested().await.expect("graph delta");
  let (delta_kind, _) = control_fields(&delta_bytes);
  assert_eq!(delta_kind, 4, "GraphDelta");
  assert!(delta_fx.graph_delta.is_some());
  let _ = delta_fx;
  (bytes, effects)
}

#[tokio::test]
async fn subscribe_channel_streams_samples() {
  let (addr, backend) = start_gateway().await;
  let mut client = TestClient::connect(&addr).await;
  ready_session(&mut client).await;

  let open_corr = corr(0xB2);
  client
    .send_control(&TestClient::open_topic_msg(
      &open_corr,
      7,
      0, // TOPIC_SUBSCRIBE
      "/chatter",
      "std_msgs/msg/String",
      1, // RELIABLE
    ))
    .await;
  let (bytes, effects) = expect_channel_ready_then_optional_delta(&mut client).await;
  assert!(effects.channel_correlation_matched);
  let (kind, fields) = control_fields(&bytes);
  assert_eq!(kind, 9, "ChannelReady");
  assert_eq!(uint(&fields, 29), 7);
  assert_eq!(uint(&fields, 33), 0, "result allow");
  assert_eq!(uint(&fields, 59), 2, "effective priority echo");
  let CborValue::Map(qos) = fields.get(&57).expect("effective qos") else {
    panic!("expected qos map");
  };
  let qos: BTreeMap<u64, CborValue<'_>> = qos.iter().map(|(k, v)| (*k, v.clone())).collect();
  assert_eq!(uint(&qos, 1), 1, "reliable");
  assert_eq!(uint(&qos, 3), 1, "keep last");
  assert_eq!(uint(&qos, 4), 5, "depth from request");
  assert_eq!(uint(&qos, 7), 1, "concrete liveliness");
  let CborValue::Map(budgets) = fields.get(&12).expect("effective budgets") else {
    panic!("expected budgets map");
  };
  let budgets: BTreeMap<u64, CborValue<'_>> =
    budgets.iter().map(|(k, v)| (*k, v.clone())).collect();
  assert!(uint(&budgets, 1) >= 1, "max_samples");
  assert!(uint(&budgets, 2) >= 1, "max_bytes");
  assert!(uint(&budgets, 3) >= 1, "max_message_bytes");
  assert_eq!(client.session.channel_state(7), ChannelState::Active);
  assert_eq!(backend.created.lock().unwrap()[0].topic, "/chatter");
  assert_eq!(client.session.graph_generation(), Some(2));

  // The mock backend allocated entity 1 for the first create.
  for (index, payload) in [b"one".as_slice(), b"two", b"three"].iter().enumerate() {
    assert!(backend.emit(1, payload), "emit sample {index}");
  }
  for (expected_seq, expected_payload) in [(0u64, b"one".as_slice()), (1, b"two"), (2, b"three")] {
    let (bytes, _) = client.recv_ingested().await.expect("sample frame");
    let frame = parse_frame(&bytes, None).expect("parse sample");
    assert_eq!(frame.opcode, OPCODE_ROS_SAMPLE);
    assert_eq!(frame.channel_id, 7);
    assert_eq!(frame.sequence, expected_seq);
    assert_eq!(frame.flags & 0x0001, 0x0001, "ROS_RELIABLE iff reliable");
    match frame.payload {
      FramePayload::Application(p) => assert_eq!(p, expected_payload),
      FramePayload::Control(_) => panic!("expected sample payload"),
    }
  }

  // Heartbeat round-trip.
  client.send_control(&TestClient::heartbeat_msg(1)).await;
  let (bytes, effects) = client.recv_ingested().await.expect("heartbeat reply");
  assert!(effects.heartbeat);
  let (kind, _) = control_fields(&bytes);
  assert_eq!(kind, 12);

  // Close: backend entity destroyed; later samples are dropped.
  client.send_control(&TestClient::close_channel_msg(&corr(0xC3), 7)).await;
  tokio::time::timeout(std::time::Duration::from_secs(5), async {
    while backend.live_subscriptions() != 0 {
      tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
  })
  .await
  .expect("subscription destroyed after close");
  assert!(!backend.emit(1, b"late"), "emit after destroy fails");
}

#[tokio::test]
async fn publish_channel_forwards_serialized_payloads() {
  let (addr, backend) = start_gateway().await;
  let mut client = TestClient::connect(&addr).await;
  ready_session(&mut client).await;

  client
    .send_control(&TestClient::open_topic_msg(
      &corr(0xD4),
      9,
      1, // TOPIC_PUBLISH
      "/cmd",
      "std_msgs/msg/String",
      1,
    ))
    .await;
  let (bytes, _) = expect_channel_ready_then_optional_delta(&mut client).await;
  let (kind, fields) = control_fields(&bytes);
  assert_eq!(kind, 9);
  assert_eq!(uint(&fields, 33), 0);

  client.send_sample(9, 0, true, b"payload-a").await;
  client.send_sample(9, 1, true, b"payload-b").await;

  // Heartbeat as a synchronization barrier: its reply proves both samples
  // were processed first (single ordered connection task).
  client.send_control(&TestClient::heartbeat_msg(1)).await;
  let (_, effects) = client.recv_ingested().await.expect("heartbeat reply");
  assert!(effects.heartbeat);

  let published = backend.published.lock().unwrap();
  assert_eq!(published.len(), 2);
  assert_eq!(published[0].1, b"payload-a");
  assert_eq!(published[1].1, b"payload-b");
}

#[tokio::test]
async fn unknown_type_fails_channel_and_data_on_it_errors() {
  let (addr, _backend) = start_gateway().await;
  let mut client = TestClient::connect(&addr).await;
  ready_session(&mut client).await;

  client
    .send_control(&TestClient::open_topic_msg(
      &corr(0xE5),
      3,
      0,
      "/mystery",
      "mystery_msgs/msg/Unknown",
      1,
    ))
    .await;
  let (bytes, effects) = client.recv_ingested().await.expect("channel ready failure");
  assert_eq!(effects.channel_failed, Some(3));
  let (kind, fields) = control_fields(&bytes);
  assert_eq!(kind, 9);
  assert_eq!(uint(&fields, 33), 3, "result error");
  let CborValue::Map(body) = fields.get(&15).expect("error body") else {
    panic!("expected error body map");
  };
  let body: BTreeMap<u64, CborValue<'_>> = body.iter().map(|(k, v)| (*k, v.clone())).collect();
  assert_eq!(uint(&body, 48), 10, "schema_unavailable");
  assert_eq!(client.session.channel_state(3), ChannelState::Failed);

  // Data on the failed channel: server answers unknown_channel (7) and
  // closes. Sent raw because the client-side machine would reject it too.
  let sample = encode_frame(
    &FrameHeader {
      version: 0,
      opcode: OPCODE_ROS_SAMPLE,
      flags: 0x0001,
      channel_id: 3,
      sequence: 0,
      source_time_ns: 0,
      priority: 2,
      clock_id: 0,
    },
    &[],
    b"x",
  )
  .unwrap();
  client.send_raw(sample).await;
  let bytes = client.recv_frame_raw().await.expect("error frame");
  let (kind, fields) = control_fields(&bytes);
  assert_eq!(kind, 15, "Error");
  assert_eq!(uint(&fields, 48), 7, "unknown_channel");
  client.expect_closed().await;
}

#[tokio::test]
async fn malformed_bootstrap_yields_bootstrap_error_and_close() {
  let (addr, _backend) = start_gateway().await;
  let mut client = TestClient::connect(&addr).await;
  client.send_raw(b"XXXX\x00\x01\x00\x00\x00\x00\x00\x00".to_vec()).await;
  let bytes = client.recv_frame_raw().await.expect("bootstrap error");
  let record = rclweb::parse_bootstrap(&bytes).expect("parse bootstrap error");
  let BootstrapRecord::BootstrapError(err) = record else {
    panic!("expected BootstrapError, got {record:?}");
  };
  assert_eq!(err.code, 1, "malformed_bootstrap");
  client.expect_closed().await;
}

#[tokio::test]
async fn no_common_version_yields_code_2() {
  let (addr, _backend) = start_gateway().await;
  let mut client = TestClient::connect(&addr).await;
  let hello = rclweb::ClientHello { wire_versions: vec![7], ..TestClient::default_hello() };
  let bytes = rclweb::encode_client_hello(&hello).unwrap();
  client.send_raw(bytes).await;
  let bytes = client.recv_frame_raw().await.expect("bootstrap error");
  let BootstrapRecord::BootstrapError(err) =
    rclweb::parse_bootstrap(&bytes).expect("parse bootstrap error")
  else {
    panic!("expected BootstrapError");
  };
  assert_eq!(err.code, 2, "no_common_version");
  client.expect_closed().await;
}

#[tokio::test]
async fn ready_required_control_before_ready_yields_error_27() {
  let (addr, _backend) = start_gateway().await;
  let mut client = TestClient::connect(&addr).await;
  let record = client.bootstrap(&TestClient::default_hello()).await;
  assert!(matches!(record, BootstrapRecord::ServerHello(_)));

  // OpenChannel before Authenticate (unchecked: the client machine would
  // reject it locally too).
  client
    .send_control_unchecked(&TestClient::open_topic_msg(
      &corr(0xF6),
      1,
      0,
      "/chatter",
      "std_msgs/msg/String",
      1,
    ))
    .await;
  let bytes = client.recv_frame_raw().await.expect("error frame");
  let (kind, fields) = control_fields(&bytes);
  assert_eq!(kind, 15, "Error");
  assert_eq!(uint(&fields, 48), 27, "session_not_ready");
  assert_eq!(uint(&fields, 49), 0, "session scope");
  client.expect_closed().await;
}

#[tokio::test]
async fn fresh_session_reconnect_reopens_subscribe() {
  let (addr, backend) = start_gateway().await;

  // First session.
  {
    let mut client = TestClient::connect(&addr).await;
    ready_session(&mut client).await;
    client
      .send_control(&TestClient::open_topic_msg(
        &corr(0xB2),
        7,
        0,
        "/chatter",
        "std_msgs/msg/String",
        1,
      ))
      .await;
    let (bytes, _) = expect_channel_ready_then_optional_delta(&mut client).await;
    let (kind, fields) = control_fields(&bytes);
    assert_eq!(kind, 9);
    assert_eq!(uint(&fields, 33), 0);
    // Drop the client (transport close) — gateway tears down entities.
  }

  tokio::time::timeout(std::time::Duration::from_secs(5), async {
    while backend.live_subscriptions() != 0 {
      tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
  })
  .await
  .expect("first session subscription destroyed");

  // Fresh reconnect: new ClientHello / Auth / OpenChannel.
  let mut client = TestClient::connect(&addr).await;
  ready_session(&mut client).await;
  client
    .send_control(&TestClient::open_topic_msg(
      &corr(0xB3),
      7,
      0,
      "/chatter",
      "std_msgs/msg/String",
      1,
    ))
    .await;
  let (bytes, _) = expect_channel_ready_then_optional_delta(&mut client).await;
  let (kind, fields) = control_fields(&bytes);
  assert_eq!(kind, 9);
  assert_eq!(uint(&fields, 33), 0);
  assert_eq!(backend.live_subscriptions(), 1);
}

#[tokio::test]
async fn service_client_round_trip_echoes_payload() {
  let (addr, backend) = start_gateway().await;
  let mut client = TestClient::connect(&addr).await;
  ready_session(&mut client).await;

  client
    .send_control(&TestClient::open_service_msg(
      &corr(0x51),
      11,
      2, // SERVICE_CLIENT
      "/add_two_ints",
      "example_interfaces/srv/AddTwoInts",
    ))
    .await;
  let (bytes, effects) = expect_channel_ready_then_optional_delta(&mut client).await;
  assert!(effects.channel_correlation_matched);
  let (kind, fields) = control_fields(&bytes);
  assert_eq!(kind, 9);
  assert_eq!(uint(&fields, 33), 0);
  assert!(fields.contains_key(&60), "effective_service_qos");
  assert!(!fields.contains_key(&57), "topic qos absent on service");
  assert_eq!(client.session.channel_state(11), ChannelState::Active);
  assert_eq!(backend.created.lock().unwrap()[0].type_name, "example_interfaces/srv/AddTwoInts");

  let opid = [0x42u8; 16];
  let request = b"req-bytes".as_slice();
  client.send_service_request(11, 0, opid, request).await;
  let (bytes, _) = client.recv_ingested().await.expect("service response");
  let frame = parse_frame(&bytes, None).expect("parse response");
  assert_eq!(frame.opcode, rclweb::OPCODE_SERVICE_RESPONSE);
  assert_eq!(frame.channel_id, 11);
  assert_eq!(frame.sequence, 0);
  assert_eq!(frame.flags & 0x0001, 0x0001);
  let ext_opid = frame.extensions.iter().find(|e| e.type_id == 2).expect("OPERATION_ID");
  assert_eq!(ext_opid.value, &opid);
  match frame.payload {
    FramePayload::Application(p) => {
      assert_eq!(p[0], 0xE0, "echo marker");
      assert_eq!(&p[1..], request);
    }
    FramePayload::Control(_) => panic!("expected application payload"),
  }
}

#[tokio::test]
async fn h_ft_session_ready_and_humble_subscribe() {
  let (addr, backend) = start_gateway_with_row(rclwebd::SUPPORT_ROW_H_FT).await;
  let mut client = TestClient::connect(&addr).await;
  ready_session_expecting(&mut client, "H-FT", "humble", "rmw_fastrtps_cpp").await;

  let type_name = "rclweb_cdr_interfaces/msg/PrimitiveScalars";
  let (scheme, value) = schema_identity_for_type(type_name, SCHEME_RCLWEB_SCHEMA_V1)
    .expect("lookup")
    .expect("phase1 rclweb identity");
  assert_eq!(scheme, SCHEME_RCLWEB_SCHEMA_V1);

  let open_corr = corr(0xB1);
  client
    .send_control(&TestClient::open_topic_msg_on_row(
      &open_corr,
      9,
      0,
      "/primitives",
      type_name,
      1,
      0,
      "H-FT",
      &scheme,
      &value,
    ))
    .await;
  let (bytes, effects) = expect_channel_ready_then_optional_delta(&mut client).await;
  assert!(effects.channel_correlation_matched);
  let (kind, fields) = control_fields(&bytes);
  assert_eq!(kind, 9, "ChannelReady");
  assert_eq!(uint(&fields, 29), 9);
  assert_eq!(uint(&fields, 33), 0, "result allow");
  assert_eq!(text(&fields, 8), "H-FT");
  assert_eq!(client.session.channel_state(9), ChannelState::Active);
  assert_eq!(backend.created.lock().unwrap()[0].topic, "/primitives");

  assert!(backend.emit(1, b"h-ft-sample"));
  let (bytes, _) = client.recv_ingested().await.expect("sample");
  let frame = parse_frame(&bytes, None).expect("parse sample");
  assert_eq!(frame.opcode, OPCODE_ROS_SAMPLE);
  assert_eq!(frame.channel_id, 9);
  match frame.payload {
    FramePayload::Application(p) => assert_eq!(p, b"h-ft-sample"),
    FramePayload::Control(_) => panic!("expected sample payload"),
  }
}

#[tokio::test]
async fn h_ft_rejects_wrong_row_open_channel() {
  let (addr, _backend) = start_gateway_with_row(rclwebd::SUPPORT_ROW_H_FT).await;
  let mut client = TestClient::connect(&addr).await;
  ready_session_expecting(&mut client, "H-FT", "humble", "rmw_fastrtps_cpp").await;

  // OpenChannel still claims J-FT while the gateway is H-FT.
  client
    .send_control(&TestClient::open_topic_msg(
      &corr(0xB2),
      4,
      0,
      "/chatter",
      "std_msgs/msg/String",
      1,
    ))
    .await;
  let (bytes, effects) = client.recv_ingested().await.expect("channel ready failure");
  assert_eq!(effects.channel_failed, Some(4));
  let (kind, fields) = control_fields(&bytes);
  assert_eq!(kind, 9);
  assert_eq!(uint(&fields, 33), 3, "result error");
  let CborValue::Map(body) = fields.get(&15).expect("error body") else {
    panic!("expected error body map");
  };
  let body: BTreeMap<u64, CborValue<'_>> = body.iter().map(|(k, v)| (*k, v.clone())).collect();
  assert_eq!(uint(&body, 48), 25, "support_row_mismatch");
  assert_eq!(client.session.channel_state(4), ChannelState::Failed);
}

#[tokio::test]
async fn oidc_mode_rejects_anonymous_token() {
  let (addr, _backend) = start_gateway_with_config(rclwebd::GatewayConfig {
    gateway_instance_id: "gw-test".to_owned(),
    auth_mode: rclwebd::AuthMode::Oidc,
    oidc: Some(rclwebd::OidcSettings {
      issuer: "https://issuer.test".to_owned(),
      audience: "rclwebd".to_owned(),
      hs_secret: Some(b"test-secret-32-bytes-minimum-ok".to_vec()),
      jwks: None,
    }),
    ..rclwebd::GatewayConfig::default()
  })
  .await;
  let mut client = TestClient::connect(&addr).await;
  let hello = TestClient::default_hello();
  let _ = client.bootstrap(&hello).await;
  client.send_control(&TestClient::authenticate_msg(&corr(0xA1))).await;
  let bytes = client.recv_frame_raw().await.expect("auth error");
  let (kind, fields) = control_fields(&bytes);
  assert_eq!(kind, 15, "Error");
  assert_eq!(uint(&fields, 48), 26, "authentication_failed");
}

#[tokio::test]
async fn oidc_mode_accepts_valid_jwt_subject() {
  let secret = b"test-secret-32-bytes-minimum-ok";
  let token = rclwebd::mint_hs256_token(secret, "https://issuer.test", "rclwebd", "alice");
  let (addr, _backend) = start_gateway_with_config(rclwebd::GatewayConfig {
    gateway_instance_id: "gw-test".to_owned(),
    auth_mode: rclwebd::AuthMode::Oidc,
    oidc: Some(rclwebd::OidcSettings {
      issuer: "https://issuer.test".to_owned(),
      audience: "rclwebd".to_owned(),
      hs_secret: Some(secret.to_vec()),
      jwks: None,
    }),
    ..rclwebd::GatewayConfig::default()
  })
  .await;
  let mut client = TestClient::connect(&addr).await;
  let hello = TestClient::default_hello();
  let _ = client.bootstrap(&hello).await;
  client
    .send_control(&TestClient::authenticate_msg_with(&corr(0xA1), "oidc", token.as_bytes()))
    .await;
  let (bytes, effects) = client.recv_ingested().await.expect("session ready");
  assert!(effects.entered_ready);
  let (kind, fields) = control_fields(&bytes);
  assert_eq!(kind, 2, "SessionReady");
  assert_eq!(text(&fields, 21), "alice");
}

#[tokio::test]
async fn off_mode_ignores_token_and_stays_anonymous() {
  let (addr, _backend) = start_gateway().await;
  let mut client = TestClient::connect(&addr).await;
  let hello = TestClient::default_hello();
  let _ = client.bootstrap(&hello).await;
  client.send_control(&TestClient::authenticate_msg_with(&corr(0xA1), "token", b"operator")).await;
  let (bytes, effects) = client.recv_ingested().await.expect("session ready");
  assert!(effects.entered_ready);
  let (kind, fields) = control_fields(&bytes);
  assert_eq!(kind, 2, "SessionReady");
  assert_eq!(text(&fields, 21), "anonymous");
}

fn enforce_config(policy_json: &str) -> rclwebd::GatewayConfig {
  rclwebd::GatewayConfig {
    gateway_instance_id: "gw-test".to_owned(),
    acl_mode: rclwebd::AclMode::Enforce,
    acl: Some(rclwebd::AclPolicy::from_json(policy_json).expect("test policy")),
    ..rclwebd::GatewayConfig::default()
  }
}

/// Expect a ChannelReady failure with the given wire code on `channel_id`.
async fn expect_channel_denied(client: &mut TestClient, channel_id: u32, code: u64) {
  let (bytes, effects) = client.recv_ingested().await.expect("channel ready failure");
  assert_eq!(effects.channel_failed, Some(channel_id));
  let (kind, fields) = control_fields(&bytes);
  assert_eq!(kind, 9, "ChannelReady");
  assert_eq!(uint(&fields, 33), 3, "result error");
  let CborValue::Map(body) = fields.get(&15).expect("error body") else {
    panic!("expected error body map");
  };
  let body: BTreeMap<u64, CborValue<'_>> = body.iter().map(|(k, v)| (*k, v.clone())).collect();
  assert_eq!(uint(&body, 48), code, "wire error code");
  assert_eq!(client.session.channel_state(channel_id), ChannelState::Failed);
}

#[tokio::test]
async fn acl_enforce_is_default_deny_with_wire_code_12() {
  // Anyone may subscribe /chatter; nothing else is admitted.
  let policy = r#"{
    "revision": "matrix-test-1",
    "rules": [{"subjects": ["*"], "operations": ["subscribe"], "names": ["/chatter"]}]
  }"#;
  let (addr, backend) = start_gateway_with_config(enforce_config(policy)).await;

  // /configz reports the mode, rule count, and the policy has no secrets to leak.
  let (status, _, body) = http_get(&addr, "/configz").await;
  assert_eq!(status, 200);
  let config: serde_json::Value = serde_json::from_str(&body).expect("configz json");
  assert_eq!(config["acl_mode"], "enforce");
  assert_eq!(config["acl_rules"], 1);

  let mut client = TestClient::connect(&addr).await;
  ready_session(&mut client).await;

  // Allowed: subscribe /chatter.
  client
    .send_control(&TestClient::open_topic_msg(
      &corr(0xC1),
      5,
      0, // TOPIC_SUBSCRIBE
      "/chatter",
      "std_msgs/msg/String",
      1,
    ))
    .await;
  let (bytes, _) = expect_channel_ready_then_optional_delta(&mut client).await;
  let (_, fields) = control_fields(&bytes);
  assert_eq!(uint(&fields, 33), 0, "result allow");
  assert_eq!(backend.created.lock().unwrap()[0].topic, "/chatter");

  // Denied: publish on the same name (no publish rule).
  client
    .send_control(&TestClient::open_topic_msg(
      &corr(0xC2),
      6,
      1, // TOPIC_PUBLISH
      "/chatter",
      "std_msgs/msg/String",
      1,
    ))
    .await;
  expect_channel_denied(&mut client, 6, 12).await;

  // Denied: subscribe on an unlisted name (default-deny).
  client
    .send_control(&TestClient::open_topic_msg(
      &corr(0xC3),
      7,
      0,
      "/other",
      "std_msgs/msg/String",
      1,
    ))
    .await;
  expect_channel_denied(&mut client, 7, 12).await;

  // The backend only ever saw the allowed channel.
  assert_eq!(backend.created.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn acl_enforce_scopes_by_oidc_subject() {
  let secret = b"test-secret-32-bytes-minimum-ok";
  let policy = r#"{
    "rules": [
      {"subjects": ["*"], "operations": ["subscribe"], "names": ["/chatter"]},
      {"subjects": ["alice"], "operations": ["publish"], "names": ["/cmd_vel"]}
    ]
  }"#;
  let config = rclwebd::GatewayConfig {
    auth_mode: rclwebd::AuthMode::Oidc,
    oidc: Some(rclwebd::OidcSettings {
      issuer: "https://issuer.test".to_owned(),
      audience: "rclwebd".to_owned(),
      hs_secret: Some(secret.to_vec()),
      jwks: None,
    }),
    ..enforce_config(policy)
  };
  let (addr, backend) = start_gateway_with_config(config).await;

  let open_cmd_vel = |correlation: [u8; 16], channel_id: u32| {
    TestClient::open_topic_msg(
      &correlation,
      channel_id,
      1, // TOPIC_PUBLISH
      "/cmd_vel",
      "std_msgs/msg/String",
      1,
    )
  };

  // alice: publish /cmd_vel admitted.
  let alice = rclwebd::mint_hs256_token(secret, "https://issuer.test", "rclwebd", "alice");
  let mut client = TestClient::connect(&addr).await;
  let _ = client.bootstrap(&TestClient::default_hello()).await;
  client
    .send_control(&TestClient::authenticate_msg_with(&corr(0xA1), "oidc", alice.as_bytes()))
    .await;
  let (_, effects) = client.recv_ingested().await.expect("session ready");
  assert!(effects.entered_ready);
  let _ = client.recv_ingested().await.expect("graph snapshot");
  client.send_control(&open_cmd_vel(corr(0xC4), 3)).await;
  let (bytes, _) = expect_channel_ready_then_optional_delta(&mut client).await;
  let (_, fields) = control_fields(&bytes);
  assert_eq!(uint(&fields, 33), 0, "alice publish allowed");
  assert_eq!(backend.created.lock().unwrap().len(), 1);

  // bob: same OpenChannel denied with wire code 12.
  let bob = rclwebd::mint_hs256_token(secret, "https://issuer.test", "rclwebd", "bob");
  let mut client = TestClient::connect(&addr).await;
  let _ = client.bootstrap(&TestClient::default_hello()).await;
  client
    .send_control(&TestClient::authenticate_msg_with(&corr(0xA2), "oidc", bob.as_bytes()))
    .await;
  let (_, effects) = client.recv_ingested().await.expect("session ready");
  assert!(effects.entered_ready);
  let _ = client.recv_ingested().await.expect("graph snapshot");
  client.send_control(&open_cmd_vel(corr(0xC5), 3)).await;
  expect_channel_denied(&mut client, 3, 12).await;
  assert_eq!(backend.created.lock().unwrap().len(), 1, "bob never reached the backend");
}

async fn http_exchange(addr: &str, request: &str) -> (u16, String, String) {
  use tokio::io::{AsyncReadExt, AsyncWriteExt};
  let mut last = String::new();
  for _ in 0..50 {
    match tokio::net::TcpStream::connect(addr).await {
      Ok(mut stream) => {
        if stream.write_all(request.as_bytes()).await.is_err() {
          tokio::time::sleep(std::time::Duration::from_millis(20)).await;
          continue;
        }
        let mut buf = Vec::new();
        let _ = stream.read_to_end(&mut buf).await;
        let text = String::from_utf8_lossy(&buf).into_owned();
        if buf.is_empty() {
          last = "empty response".to_owned();
          tokio::time::sleep(std::time::Duration::from_millis(20)).await;
          continue;
        }
        let (head, body) = text.split_once("\r\n\r\n").unwrap_or((text.as_str(), ""));
        let status = head
          .lines()
          .next()
          .and_then(|line| line.split_whitespace().nth(1))
          .and_then(|code| code.parse().ok())
          .unwrap_or(0);
        return (status, head.to_owned(), body.to_owned());
      }
      Err(err) => {
        last = err.to_string();
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
      }
    }
  }
  panic!("http connect {addr}: {last}");
}

async fn http_get(addr: &str, path: &str) -> (u16, String, String) {
  http_exchange(addr, &format!("GET {path} HTTP/1.1\r\nHost: {addr}\r\nConnection: close\r\n\r\n"))
    .await
}

#[tokio::test]
async fn healthz_stays_plain_ok_and_readyz_is_json() {
  let (addr, _backend) = start_gateway().await;
  let (status, head, body) = http_get(&addr, "/healthz").await;
  assert_eq!(status, 200, "healthz; head={head:?} body={body:?}");
  assert_eq!(body.trim(), "ok", "R1-05 harness requires plain ok");

  let (status, _, body) = http_get(&addr, "/livez").await;
  assert_eq!(status, 200);
  assert!(body.contains("\"status\":\"ok\""));

  let (status, _, body) = http_get(&addr, "/readyz").await;
  assert_eq!(status, 200);
  assert!(body.contains("\"status\":\"ready\""));
  assert!(body.contains("\"support_row_id\":\"J-FT\""));
  assert!(body.contains("\"draining\":false"));
}

#[tokio::test]
async fn configz_and_metrics_are_scrapeable() {
  let (addr, _backend) = start_gateway().await;
  let (status, _, body) = http_get(&addr, "/configz").await;
  assert_eq!(status, 200);
  assert!(body.contains("\"support_row_id\":\"J-FT\""));
  assert!(body.contains("\"auth_mode\":\"off\""));
  assert!(!body.contains("super-secret-value"));

  let (status, headers, body) = http_get(&addr, "/metrics").await;
  assert_eq!(status, 200);
  assert!(headers.to_ascii_lowercase().contains("text/plain"));
  assert!(body.contains("rclwebd_payload_copies_total"));
  assert!(body.contains("rclwebd_sessions 0"));
  assert!(body.contains("rclwebd_draining 0"));
}

#[tokio::test]
async fn drain_keeps_healthz_ok_rejects_new_ws_and_keeps_live_session() {
  let (addr, _backend) = start_gateway().await;
  let mut client = TestClient::connect(&addr).await;
  ready_session(&mut client).await;

  let (status, _, body) = http_exchange(
    &addr,
    &format!(
      "POST /drain HTTP/1.1\r\nHost: {addr}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
    ),
  )
  .await;
  assert_eq!(status, 200);
  assert!(body.contains("\"status\":\"draining\""));

  let (status, _, body) = http_get(&addr, "/readyz").await;
  assert_eq!(status, 503);
  assert!(body.contains("\"reason\":\"draining\""));

  let (status, _, body) = http_get(&addr, "/healthz").await;
  assert_eq!(status, 200);
  assert_eq!(body.trim(), "ok");

  let (status, _, body) = http_get(&addr, "/metrics").await;
  assert_eq!(status, 200);
  assert!(body.contains("rclwebd_draining 1"));
  assert!(body.contains("rclwebd_sessions 1"));

  client.send_control(&TestClient::heartbeat_msg(1)).await;
  let (_, effects) = client.recv_ingested().await.expect("heartbeat after drain");
  assert!(effects.heartbeat);

  let result = tokio_tungstenite::connect_async(format!("ws://{addr}/ws")).await;
  let err = match result {
    Ok(_) => panic!("new websocket should be rejected while draining"),
    Err(err) => err.to_string(),
  };
  assert!(
    err.contains("503") || err.to_ascii_lowercase().contains("service unavailable"),
    "expected 503, got {err}"
  );
}

#[tokio::test]
async fn isolation_headers_opt_in() {
  let (addr, _backend) = start_gateway_with_config(rclwebd::GatewayConfig {
    gateway_instance_id: "gw-test".to_owned(),
    isolation_headers: true,
    cors_origins: vec!["https://app.example".to_owned()],
    ..rclwebd::GatewayConfig::default()
  })
  .await;
  let (status, headers, _) = http_exchange(
        &addr,
        &format!(
            "GET /livez HTTP/1.1\r\nHost: {addr}\r\nOrigin: https://app.example\r\nConnection: close\r\n\r\n"
        ),
    )
    .await;
  assert_eq!(status, 200);
  let headers = headers.to_ascii_lowercase();
  assert!(headers.contains("cross-origin-opener-policy: same-origin"));
  assert!(headers.contains("cross-origin-embedder-policy: require-corp"));
  assert!(headers.contains("access-control-allow-origin: https://app.example"));
}
