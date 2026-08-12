//! Client engine ↔ gateway collision: both sides drive the same session
//! state machine over a real WebSocket (R1-04).

mod common;

use common::start_gateway;
use futures_util::StreamExt;
use rclweb::{AppCommand, AppEvent, ClientEngine, HostEvent, STD_MSGS_STRING};
use std::time::Duration;

fn corr(tag: u8) -> [u8; 16] {
  [tag; 16]
}

/// Drive the client engine against the live gateway until `pred` matches an event.
async fn pump_until<F>(
  engine: &mut ClientEngine,
  ws: &mut tokio_tungstenite::WebSocketStream<
    tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
  >,
  mut pred: F,
) -> AppEvent
where
  F: FnMut(&AppEvent) -> bool,
{
  use futures_util::SinkExt;
  use tokio_tungstenite::tungstenite::Message;

  let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
  loop {
    // Flush outbound first.
    let outcome = engine.poll(vec![]);
    for msg in outcome.outbound {
      ws.send(Message::Binary(bytes::Bytes::from(msg.bytes))).await.expect("ws send");
    }
    for event in &outcome.events {
      if pred(event) {
        return event.clone();
      }
      if matches!(event, AppEvent::Error { .. } | AppEvent::Closed { .. }) {
        panic!("engine failed early: {event:?}");
      }
    }

    let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
    let msg = tokio::time::timeout(remaining, ws.next())
      .await
      .expect("recv timeout")
      .expect("ws closed")
      .expect("ws error");
    let Message::Binary(bin) = msg else {
      continue;
    };
    let outcome = engine.poll(vec![HostEvent::WsBytes { buffer_id: 0, bytes: bin.to_vec() }]);
    for msg in outcome.outbound {
      ws.send(Message::Binary(bytes::Bytes::from(msg.bytes))).await.expect("ws send");
    }
    for event in &outcome.events {
      if pred(event) {
        return event.clone();
      }
      if matches!(event, AppEvent::Error { .. } | AppEvent::Closed { .. }) {
        panic!("engine failed: {event:?}");
      }
    }
  }
}

#[tokio::test]
async fn client_engine_collides_with_gateway_subscribe_path() {
  use futures_util::SinkExt;
  use tokio_tungstenite::tungstenite::Message;

  let (addr, backend) = start_gateway().await;
  let (mut ws, _) =
    tokio_tungstenite::connect_async(format!("ws://{addr}/ws")).await.expect("connect");

  let mut engine = ClientEngine::new();
  let start = engine.poll(vec![HostEvent::Command(AppCommand::Start {
    transferable_arraybuffer: true,
    webtransport: false,
  })]);
  for msg in start.outbound {
    ws.send(Message::Binary(bytes::Bytes::from(msg.bytes))).await.expect("send hello");
  }

  let boot =
    pump_until(&mut engine, &mut ws, |e| matches!(e, AppEvent::BootstrapComplete { .. })).await;
  assert!(matches!(boot, AppEvent::BootstrapComplete { selected_wire_version: 0 }));

  let auth_corr = corr(0xA1);
  let auth = engine.poll(vec![HostEvent::Command(AppCommand::Authenticate {
    correlation: auth_corr,
    scheme: "token".into(),
    token: b"anonymous".to_vec(),
  })]);
  for msg in auth.outbound {
    ws.send(Message::Binary(bytes::Bytes::from(msg.bytes))).await.expect("send auth");
  }

  let ready =
    pump_until(&mut engine, &mut ws, |e| matches!(e, AppEvent::SessionReady { .. })).await;
  let AppEvent::SessionReady { support_row, gateway_instance_id, .. } = ready else {
    panic!("expected SessionReady");
  };
  assert_eq!(support_row, "J-FT");
  assert_eq!(gateway_instance_id, "gw-test");

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
  for msg in sub.outbound {
    ws.send(Message::Binary(bytes::Bytes::from(msg.bytes))).await.expect("send open");
  }

  let subscribed =
    pump_until(&mut engine, &mut ws, |e| matches!(e, AppEvent::Subscribed { channel_id: 7, .. }))
      .await;
  assert!(matches!(
      subscribed,
      AppEvent::Subscribed {
          channel_id: 7,
          ref topic,
          ref type_name,
      } if topic == "/chatter" && type_name == STD_MSGS_STRING
  ));

  let payload = ClientEngine::encode_std_msgs_string("collision-ok").unwrap();
  assert!(backend.emit(1, &payload));

  let sample =
    pump_until(&mut engine, &mut ws, |e| matches!(e, AppEvent::Sample { channel_id: 7, .. })).await;
  let AppEvent::Sample { string_data, lease_id, .. } = sample else {
    panic!("expected sample");
  };
  assert_eq!(string_data.as_deref(), Some("collision-ok"));
  // The CDR payload stays reachable as a borrowed view under the lease.
  let view = engine.lease_payload_view(lease_id).expect("payload view");
  assert!(!view.is_empty(), "borrowed payload should be non-empty");

  // Lease release reclaims the retained inbound slab.
  let released = engine.poll(vec![HostEvent::ReleaseLease { lease_id }]);
  assert!(
    !released.released_buffers.is_empty() || engine.lease_buffer_id(lease_id).is_none(),
    "lease should clear"
  );

  // Both state machines agree the channel is active and samples parse.
  assert_eq!(engine.channel_state(7), rclweb::ChannelState::Active);
}

#[tokio::test]
async fn client_engine_collides_with_gateway_publish_path() {
  use futures_util::SinkExt;
  use tokio_tungstenite::tungstenite::Message;

  let (addr, backend) = start_gateway().await;
  let (mut ws, _) =
    tokio_tungstenite::connect_async(format!("ws://{addr}/ws")).await.expect("connect");

  let mut engine = ClientEngine::new();
  let start = engine.poll(vec![HostEvent::Command(AppCommand::Start {
    transferable_arraybuffer: true,
    webtransport: false,
  })]);
  for msg in start.outbound {
    ws.send(Message::Binary(bytes::Bytes::from(msg.bytes))).await.expect("send hello");
  }

  let _ =
    pump_until(&mut engine, &mut ws, |e| matches!(e, AppEvent::BootstrapComplete { .. })).await;

  let auth_corr = corr(0xA1);
  let auth = engine.poll(vec![HostEvent::Command(AppCommand::Authenticate {
    correlation: auth_corr,
    scheme: "token".into(),
    token: b"anonymous".to_vec(),
  })]);
  for msg in auth.outbound {
    ws.send(Message::Binary(bytes::Bytes::from(msg.bytes))).await.expect("send auth");
  }
  let _ = pump_until(&mut engine, &mut ws, |e| matches!(e, AppEvent::SessionReady { .. })).await;

  let pub_corr = corr(0xD4);
  let opened = engine.poll(vec![HostEvent::Command(AppCommand::Publish {
    correlation: pub_corr,
    channel_id: 9,
    topic: "/cmd".into(),
    type_name: STD_MSGS_STRING.into(),
    qos_reliability: 1,
    qos_depth: 5,
    domain_id: 0,
  })]);
  for msg in opened.outbound {
    ws.send(Message::Binary(bytes::Bytes::from(msg.bytes))).await.expect("send open publish");
  }
  let published =
    pump_until(&mut engine, &mut ws, |e| matches!(e, AppEvent::Published { channel_id: 9, .. }))
      .await;
  assert!(matches!(
      published,
      AppEvent::Published {
          channel_id: 9,
          ref topic,
          ..
      } if topic == "/cmd"
  ));

  let sent = engine.poll(vec![HostEvent::Command(AppCommand::SendSample {
    channel_id: 9,
    string_data: "from-engine".into(),
  })]);
  assert_eq!(sent.outbound.len(), 1);
  for msg in sent.outbound {
    ws.send(Message::Binary(bytes::Bytes::from(msg.bytes))).await.expect("send sample");
  }

  let expected = ClientEngine::encode_std_msgs_string("from-engine").unwrap();
  tokio::time::timeout(Duration::from_secs(5), async {
    loop {
      {
        let published_payloads = backend.published.lock().unwrap();
        if published_payloads.iter().any(|(_, payload)| payload == &expected) {
          return;
        }
      }
      tokio::time::sleep(Duration::from_millis(10)).await;
    }
  })
  .await
  .expect("gateway should forward the engine publish payload");
}

#[tokio::test]
async fn client_engine_outbound_client_hello_self_parses() {
  let mut engine = ClientEngine::new();
  let out = engine.poll(vec![HostEvent::Command(AppCommand::Start {
    transferable_arraybuffer: true,
    webtransport: false,
  })]);
  assert_eq!(out.outbound.len(), 1);
  let record = rclweb::parse_bootstrap(&out.outbound[0].bytes).expect("client hello");
  assert!(matches!(record, rclweb::BootstrapRecord::ClientHello(_)));
}
