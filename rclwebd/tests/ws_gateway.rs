//! Gateway WebSocket integration: full R2WP v0.1 walking-skeleton flows
//! against a real tokio/axum endpoint with the in-memory backend.

mod common;

use common::{TestClient, corr, start_gateway};
use rclweb::{
    BootstrapRecord, CborValue, ChannelState, FrameHeader, FramePayload, OPCODE_ROS_SAMPLE,
    encode_frame, parse_frame,
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
    let hello = TestClient::default_hello();
    let record = client.bootstrap(&hello).await;
    let BootstrapRecord::ServerHello(server_hello) = record else {
        panic!("expected ServerHello, got {record:?}");
    };
    assert_eq!(server_hello.selected_wire_version, 0);
    assert!(server_hello.transport_capabilities.binary_wss);
    assert!(server_hello.extension_capabilities.is_empty());

    let auth_corr = corr(0xA1);
    client
        .send_control(&TestClient::authenticate_msg(&auth_corr))
        .await;
    let (bytes, effects) = client.recv_ingested().await.expect("session ready");
    assert!(effects.entered_ready);
    assert!(effects.auth_correlation_matched);
    let (kind, fields) = control_fields(&bytes);
    assert_eq!(kind, 2, "SessionReady");
    assert_eq!(text(&fields, 8), "J-FT");
    assert_eq!(text(&fields, 18), "jazzy");
    assert_eq!(text(&fields, 19), "rmw_fastrtps_cpp");
    assert_eq!(text(&fields, 7), "gw-test");
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
    let (bytes, effects) = client.recv_ingested().await.expect("channel ready");
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

    // The mock backend allocated entity 1 for the first create.
    for (index, payload) in [b"one".as_slice(), b"two", b"three"].iter().enumerate() {
        assert!(backend.emit(1, payload), "emit sample {index}");
    }
    for (expected_seq, expected_payload) in [(0u64, b"one".as_slice()), (1, b"two"), (2, b"three")]
    {
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
    client
        .send_control(&TestClient::close_channel_msg(&corr(0xC3), 7))
        .await;
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
    let (bytes, _) = client.recv_ingested().await.expect("channel ready");
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
    client
        .send_raw(b"XXXX\x00\x01\x00\x00\x00\x00\x00\x00".to_vec())
        .await;
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
    let hello = rclweb::ClientHello {
        wire_versions: vec![7],
        ..TestClient::default_hello()
    };
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
        let (bytes, _) = client.recv_ingested().await.expect("channel ready");
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
    let (bytes, _) = client.recv_ingested().await.expect("channel ready again");
    let (kind, fields) = control_fields(&bytes);
    assert_eq!(kind, 9);
    assert_eq!(uint(&fields, 33), 0);
    assert_eq!(backend.live_subscriptions(), 1);
}
