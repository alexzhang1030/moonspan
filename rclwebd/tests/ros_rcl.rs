//! Serialized-only rcl FFI attachment tests (row J-FT).
//!
//! Require `--features ros` and a sourced ROS 2 Jazzy environment
//! (`just ros-test`). Domains 42/43 isolate the loopback traffic.

#![cfg(feature = "ros")]

use rclweb::{CdrEndian, CdrReader, CdrWriter};
use rclwebd::backend::{ChannelSpec, RosBackend};
use rclwebd::qos::{RequestedQos, resolve_effective};
use rclwebd::ros::RclBackend;
use std::time::{Duration, Instant};
use tokio::sync::mpsc;

fn cdr_string_message(text: &str) -> Vec<u8> {
    let mut writer = CdrWriter::new_default(CdrEndian::Little).expect("writer");
    writer.write_string(text, None).expect("write string");
    writer.to_bytes()
}

fn decode_cdr_string(payload: &[u8]) -> String {
    let mut reader = CdrReader::open_default(payload).expect("open cdr");
    reader.read_string(None).expect("read string")
}

fn reliable_spec(channel_id: u32, topic: &str, type_name: &str) -> ChannelSpec {
    ChannelSpec {
        channel_id,
        topic: topic.to_owned(),
        type_name: type_name.to_owned(),
        qos: resolve_effective(&RequestedQos {
            reliability: 1,
            durability: 0,
            history_kind: 1,
            history_depth: Some(10),
            liveliness: 0,
        }),
    }
}

#[tokio::test]
async fn serialized_loopback_publish_take_and_graph() {
    let backend = RclBackend::spawn(42).expect("rcl init on domain 42");
    let topic = "/rclwebd_loopback";
    let type_name = "std_msgs/msg/String";

    let (sink, mut samples) = mpsc::channel(16);
    let sub_entity = backend
        .create_subscription(&reliable_spec(1, topic, type_name), sink)
        .await
        .expect("create serialized subscription");
    let pub_entity = backend
        .create_publisher(&reliable_spec(2, topic, type_name))
        .await
        .expect("create serialized publisher");

    // Graph query: our topic is visible with its type.
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let topics = backend.graph_topics().await.expect("graph query");
        if topics
            .iter()
            .any(|(name, types)| name == topic && types.iter().any(|t| t == type_name))
        {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "topic not visible in graph: {topics:?}"
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    // Publish serialized CDR until discovery lets one through.
    let message = cdr_string_message("hello rclwebd loopback");
    let deadline = Instant::now() + Duration::from_secs(15);
    let sample = loop {
        backend
            .publish(pub_entity, message.clone())
            .await
            .expect("serialized publish");
        match tokio::time::timeout(Duration::from_millis(200), samples.recv()).await {
            Ok(Some(sample)) => break sample,
            Ok(None) => panic!("sample channel closed"),
            Err(_) => assert!(Instant::now() < deadline, "no sample within 15s"),
        }
    };

    assert_eq!(sample.channel_id, 1);
    assert_eq!(sample.payload(), &message[..], "bytes pass through intact");
    assert_eq!(
        decode_cdr_string(sample.payload()),
        "hello rclwebd loopback"
    );

    backend.destroy(sub_entity).await;
    backend.destroy(pub_entity).await;
}

#[tokio::test]
async fn unknown_type_is_schema_unavailable() {
    let backend = RclBackend::spawn(43).expect("rcl init on domain 43");
    let (sink, _samples) = mpsc::channel(1);
    let err = backend
        .create_subscription(&reliable_spec(1, "/nope", "mystery_msgs/msg/Unknown"), sink)
        .await
        .expect_err("unknown type must fail");
    assert_eq!(err.code, 10, "schema_unavailable");

    // The statically linked registry serves exactly the demo types.
    assert!(rclwebd::ros::LINKED_TYPES.contains(&"std_msgs/msg/String"));
    assert!(rclwebd::ros::LINKED_TYPES.contains(&"sensor_msgs/msg/PointCloud2"));
}
