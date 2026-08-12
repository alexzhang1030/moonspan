//! Serialized-only rcl FFI attachment tests (row J-FT).
//!
//! Require `--features ros` and a sourced ROS 2 Jazzy environment
//! (`just ros-test`). Domains 42/43/44/45 isolate the loopback traffic.

#![cfg(feature = "ros")]

use rclweb::{CdrEndian, CdrReader, CdrWriter};
use rclwebd::backend::{ChannelSpec, RosBackend};
use rclwebd::qos::{RequestedQos, resolve_effective};
use rclwebd::ros::{LINKED_TYPES, RclBackend, typesupport};
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

fn cdr_add_two_ints_request(a: i64, b: i64) -> Vec<u8> {
    let mut writer = CdrWriter::new_default(CdrEndian::Little).expect("writer");
    writer.write_i64(a).expect("write a");
    writer.write_i64(b).expect("write b");
    writer.to_bytes()
}

fn decode_add_two_ints_sum(payload: &[u8]) -> i64 {
    let mut reader = CdrReader::open_default(payload).expect("open cdr");
    reader.read_i64().expect("read sum")
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
        if topics.iter().any(|(name, types)| name == topic && types.iter().any(|t| t == type_name))
        {
            break;
        }
        assert!(Instant::now() < deadline, "topic not visible in graph: {topics:?}");
        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    // Publish serialized CDR until discovery lets one through.
    let message = cdr_string_message("hello rclwebd loopback");
    let deadline = Instant::now() + Duration::from_secs(15);
    let sample = loop {
        backend.publish(pub_entity, message.clone()).await.expect("serialized publish");
        match tokio::time::timeout(Duration::from_millis(200), samples.recv()).await {
            Ok(Some(sample)) => break sample,
            Ok(None) => panic!("sample channel closed"),
            Err(_) => assert!(Instant::now() < deadline, "no sample within 15s"),
        }
    };

    assert_eq!(sample.channel_id, 1);
    assert_eq!(sample.payload(), &message[..], "bytes pass through intact");
    assert_eq!(decode_cdr_string(sample.payload()), "hello rclwebd loopback");

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

    assert!(typesupport::message_type_support("std_msgs/msg/String").is_some());
    assert!(typesupport::message_type_support("sensor_msgs/msg/PointCloud2").is_some());
    assert!(LINKED_TYPES.contains(&"std_msgs/msg/String"));
    assert!(LINKED_TYPES.contains(&"sensor_msgs/msg/PointCloud2"));
}

#[test]
fn add_two_ints_typesupport_resolves_via_dlopen() {
    assert!(
        typesupport::service_type_support("example_interfaces/srv/AddTwoInts").is_some(),
        "AddTwoInts service typesupport must resolve via dlopen"
    );
}

#[tokio::test]
async fn live_service_add_two_ints_round_trip() {
    let backend = RclBackend::spawn(44).expect("rcl init on domain 44");
    let service_name = "/rclwebd_add_two_ints";
    let type_name = "example_interfaces/srv/AddTwoInts";

    let (service_sink, mut service_rx) = mpsc::channel(8);
    let service_entity = backend
        .create_service(&reliable_spec(10, service_name, type_name), service_sink)
        .await
        .expect("create service server");

    let client_entity = backend
        .create_client(&reliable_spec(11, service_name, type_name))
        .await
        .expect("create service client");

    // Allow discovery between client and server on the same node.
    tokio::time::sleep(Duration::from_millis(500)).await;

    let request_cdr = cdr_add_two_ints_request(40, 2);
    let opid = [0x11u8; 16];

    tokio::pin! {
        let call_fut = backend.call(client_entity, opid, request_cdr);
        let service_fut = async {
            let deadline = Instant::now() + Duration::from_secs(10);
            while Instant::now() < deadline {
                match tokio::time::timeout(Duration::from_millis(200), service_rx.recv()).await {
                    Ok(Some(request)) => {
                        let mut reader = CdrReader::open_default(request.payload()).expect("cdr");
                        let a = reader.read_i64().expect("a");
                        let b = reader.read_i64().expect("b");
                        let mut writer = CdrWriter::new_default(CdrEndian::Little).expect("writer");
                        writer.write_i64(a + b).expect("sum");
                        let response_cdr = writer.to_bytes();
                        backend
                            .send_service_response(service_entity, request.operation_id, response_cdr)
                            .await
                            .expect("send response");
                        return;
                    }
                    Ok(None) => panic!("service request channel closed"),
                    Err(_) => continue,
                }
            }
            panic!("no service request received within 10s");
        };
    }

    let (response_cdr, ()) = tokio::join!(call_fut, service_fut);
    let response_cdr = response_cdr.expect("service call");
    assert_eq!(decode_add_two_ints_sum(&response_cdr), 42);

    backend.destroy(client_entity).await;
    backend.destroy(service_entity).await;
}

#[test]
fn fibonacci_action_typesupport_resolves_via_dlopen() {
    assert!(
        typesupport::action_type_support("example_interfaces/action/Fibonacci").is_some(),
        "Fibonacci action typesupport must resolve via dlopen"
    );
}

fn cdr_fibonacci_goal(order: i32) -> Vec<u8> {
    let mut writer = CdrWriter::new_default(CdrEndian::Little).expect("writer");
    writer.write_i32(order).expect("write order");
    writer.to_bytes()
}

fn cdr_fibonacci_get_result_response(status: i8) -> Vec<u8> {
    let mut writer = CdrWriter::new_default(CdrEndian::Little).expect("writer");
    writer.write_i8(status).expect("write status");
    writer.write_sequence_length(0, None).expect("empty sequence");
    writer.to_bytes()
}

fn decode_get_result_status(payload: &[u8]) -> i8 {
    let mut reader = CdrReader::open_default(payload).expect("open cdr");
    reader.read_i8().expect("read status")
}

#[tokio::test]
async fn live_action_fibonacci_round_trip() {
    let backend = RclBackend::spawn(45).expect("rcl init on domain 45");
    let action_name = "/rclwebd_fibonacci";
    let type_name = "example_interfaces/action/Fibonacci";

    let (server_sink, mut server_rx) = mpsc::channel(8);
    let server_entity = backend
        .create_action_server(&reliable_spec(20, action_name, type_name), server_sink)
        .await
        .expect("create action server");

    let client_entity = backend
        .create_action_client(&reliable_spec(21, action_name, type_name))
        .await
        .expect("create action client");

    // Allow discovery between client and server on the same node.
    tokio::time::sleep(Duration::from_millis(500)).await;

    let goal_cdr = cdr_fibonacci_goal(0);
    let opid = [0x22u8; 16];

    tokio::pin! {
        let call_fut = backend.send_action_goal(client_entity, opid, goal_cdr.clone());
        let server_fut = async {
            let deadline = Instant::now() + Duration::from_secs(10);
            while Instant::now() < deadline {
                match tokio::time::timeout(Duration::from_millis(200), server_rx.recv()).await {
                    Ok(Some(inbound)) => {
                        assert_eq!(inbound.channel_id(), 20);
                        assert_eq!(inbound.operation_id(), opid);
                        assert_eq!(inbound.payload(), goal_cdr.as_slice());
                        let result_cdr = cdr_fibonacci_get_result_response(4);
                        backend
                            .send_action_result(server_entity, inbound.operation_id(), result_cdr)
                            .await
                            .expect("send action result");
                        return;
                    }
                    Ok(None) => panic!("action inbound channel closed"),
                    Err(_) => continue,
                }
            }
            panic!("no action goal received within 10s");
        };
    }

    let (result_cdr, ()) = tokio::join!(call_fut, server_fut);
    let result_cdr = result_cdr.expect("action goal");
    assert_eq!(decode_get_result_status(&result_cdr), 4);

    backend.destroy(client_entity).await;
    backend.destroy(server_entity).await;
}
