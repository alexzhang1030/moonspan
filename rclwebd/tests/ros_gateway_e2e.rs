//! End-to-end walking-skeleton evidence over real rcl (row J-FT): a live
//! `ros2 topic pub` talker reaches a WebSocket client through the gateway,
//! and a WebSocket publish crosses DDS back into the gateway.
//!
//! Requires `--features ros` and a sourced ROS 2 Jazzy environment
//! (`just ros-test`). Domain 44 isolates the traffic.

#![cfg(feature = "ros")]

mod common;

use common::{TestClient, corr};
use rclweb::{
    BootstrapRecord, CdrEndian, CdrReader, CdrWriter, FramePayload, OPCODE_ROS_SAMPLE, parse_frame,
};
use rclwebd::ros::RclBackend;
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use std::time::{Duration, Instant};

const DOMAIN: u8 = 44;
const TALKER_TEXT: &str = "Hello World: rclwebd e2e";

async fn start_rcl_gateway() -> String {
    let backend = Arc::new(RclBackend::spawn(DOMAIN).expect("rcl init"));
    let config = Arc::new(rclwebd::GatewayConfig {
        gateway_instance_id: "gw-e2e".to_owned(),
        domain_id: DOMAIN,
        ..rclwebd::GatewayConfig::default()
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind");
    let addr = listener.local_addr().expect("local addr").to_string();
    tokio::spawn(async move {
        let _ = rclwebd::serve(listener, config, backend).await;
    });
    addr
}

fn start_talker() -> Child {
    Command::new("ros2")
        .args([
            "topic",
            "pub",
            "--rate",
            "10",
            "/chatter",
            "std_msgs/msg/String",
            &format!("{{data: '{TALKER_TEXT}'}}"),
        ])
        .env("ROS_DOMAIN_ID", DOMAIN.to_string())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn ros2 topic pub (sourced ROS 2 environment required)")
}

async fn ready(client: &mut TestClient) {
    let record = client.bootstrap(&TestClient::default_hello()).await;
    assert!(matches!(record, BootstrapRecord::ServerHello(_)));
    client
        .send_control(&TestClient::authenticate_msg(&corr(0x01)))
        .await;
    let (_, effects) = client.recv_ingested().await.expect("session ready");
    assert!(effects.entered_ready);
}

async fn open_ready_channel(
    client: &mut TestClient,
    channel_id: u32,
    operation_kind: u64,
    topic: &str,
) {
    client
        .send_control(&TestClient::open_topic_msg_on_domain(
            &corr(channel_id as u8),
            channel_id,
            operation_kind,
            topic,
            "std_msgs/msg/String",
            1,
            DOMAIN,
        ))
        .await;
    let (bytes, _) = client.recv_ingested().await.expect("channel ready");
    let frame = parse_frame(&bytes, None).expect("parse channel ready");
    let FramePayload::Control(msg) = frame.payload else {
        panic!("expected control payload");
    };
    assert_eq!(msg.kind, 9, "ChannelReady");
    match msg.fields.get(&33) {
        Some(rclweb::CborValue::Unsigned(0)) => {}
        other => panic!("channel {channel_id} not allowed: result {other:?} ({msg:?})"),
    }
}

fn decode_sample_string(bytes: &[u8]) -> (u32, u64, String) {
    let frame = parse_frame(bytes, None).expect("parse sample frame");
    assert_eq!(frame.opcode, OPCODE_ROS_SAMPLE);
    assert_ne!(
        frame.flags & 0x0001,
        0,
        "reliable channel sets ROS_RELIABLE"
    );
    let FramePayload::Application(payload) = frame.payload else {
        panic!("expected application payload");
    };
    let mut reader = CdrReader::open_default(payload).expect("open cdr");
    let text = reader.read_string(None).expect("read string");
    (frame.channel_id, frame.sequence, text)
}

#[tokio::test]
async fn live_talker_reaches_websocket_client_and_publish_crosses_dds() {
    let addr = start_rcl_gateway().await;
    let mut talker = start_talker();

    // Run the body in a task so a panic still reaches the talker cleanup.
    let body = tokio::spawn(async move {
        let mut client = TestClient::connect(&addr).await;
        ready(&mut client).await;

        // Direction 1: live ROS talker → gateway → WebSocket client.
        open_ready_channel(&mut client, 7, 0, "/chatter").await;
        let mut expected_seq = 0u64;
        let deadline = Instant::now() + Duration::from_secs(30);
        while expected_seq < 3 {
            assert!(Instant::now() < deadline, "no talker samples within 30s");
            let Some((bytes, _)) = client.recv_ingested().await else {
                panic!("connection closed while waiting for samples");
            };
            let (channel_id, sequence, text) = decode_sample_string(&bytes);
            assert_eq!(channel_id, 7);
            assert_eq!(sequence, expected_seq, "contiguous reliable sequence");
            assert_eq!(text, TALKER_TEXT);
            expected_seq += 1;
        }

        // Direction 2: WebSocket publish → gateway → DDS → gateway →
        // WebSocket subscribe (round trip through real rcl entities).
        open_ready_channel(&mut client, 8, 0, "/rclwebd_e2e_echo").await;
        open_ready_channel(&mut client, 9, 1, "/rclwebd_e2e_echo").await;
        let mut writer = CdrWriter::new_default(CdrEndian::Little).expect("writer");
        writer
            .write_string("echo through dds", None)
            .expect("write string");
        let message = writer.to_bytes();

        let mut publish_seq = 0u64;
        let deadline = Instant::now() + Duration::from_secs(20);
        let echoed = loop {
            assert!(Instant::now() < deadline, "no echo within 20s");
            client.send_sample(9, publish_seq, true, &message).await;
            publish_seq += 1;
            match tokio::time::timeout(Duration::from_millis(500), client.recv_ingested()).await {
                Ok(Some((bytes, _))) => break bytes,
                Ok(None) => panic!("connection closed while waiting for echo"),
                Err(_) => continue,
            }
        };
        let (channel_id, _, text) = decode_sample_string(&echoed);
        assert_eq!(channel_id, 8, "echo arrives on the subscribe channel");
        assert_eq!(text, "echo through dds");
    });
    let result = body.await;

    let _ = talker.kill();
    let _ = talker.wait();
    result.expect("e2e body");
}
