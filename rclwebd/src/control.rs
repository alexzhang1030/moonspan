//! Server-side control-message builders and hello negotiation.
//!
//! Builders produce `CborValue` maps that the core encoders serialize; the
//! connection re-parses every outbound control frame with the core parser
//! before sending, so a builder that drifts from the contract fails loudly.

use crate::backend::{GraphEndpointInfo, GraphNodeInfo, GraphView};
use crate::budgets::effective_budgets_map;
use crate::config::{
  ActiveTransport, GatewayConfig, MAX_CHANNELS_CEILING, MAX_CONTROL_PAYLOAD_BYTES_CEILING,
  MAX_MESSAGE_BYTES_CEILING, MAX_SESSION_BYTES_CEILING, SupportRow,
};
use crate::qos::EffectiveQos;
use rclweb::{
  BufferCapabilities, CborValue, ClientHello, EffectiveLimits, ServerHello, TransportCapabilities,
};
use std::borrow::Cow;

pub const ZERO_CORRELATION: [u8; 16] = [0u8; 16];

/// Demo RIHS01 hash used wherever the gateway needs a Jazzy placeholder schema identity.
pub const RIHS_DEMO: &str =
  "RIHS01_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

/// Demo rclweb-schema-v1 value (64 lowercase hex) for Humble graph placeholders.
pub const BUNDLE_DEMO: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

/// Negotiate a ServerHello for the active transport.
///
/// Transport booleans are AND of peer offers. The transport in use must remain
/// true after negotiation (registry `transport_booleans`). Returns bootstrap
/// error code 2 (`no_common_version`) or 25 (`protocol_violation`).
pub fn negotiate_server_hello(
  hello: &ClientHello,
  config: &GatewayConfig,
  active: ActiveTransport,
) -> Result<ServerHello, u8> {
  if !hello.wire_versions.contains(&0) {
    return Err(2);
  }

  let offer_wt = config.offer_webtransport;
  let webtransport_http3 = hello.transport_capabilities.webtransport_http3 && offer_wt;
  let binary_wss = hello.transport_capabilities.binary_wss;

  match active {
    ActiveTransport::BinaryWebSocket if !binary_wss => return Err(25),
    ActiveTransport::WebTransportHttp3 if !webtransport_http3 => return Err(25),
    _ => {}
  }

  let effective = |requested: Option<u64>, hard: u64, ceiling: u64| -> u64 {
    requested.unwrap_or(hard).min(hard).min(ceiling)
  };
  let limits = &hello.requested_limits;
  Ok(ServerHello {
    selected_wire_version: 0,
    transport_capabilities: TransportCapabilities {
      webtransport_http3,
      binary_wss,
      max_datagram_size: None,
    },
    buffer_capabilities: BufferCapabilities {
      transferable_arraybuffer: hello.buffer_capabilities.transferable_arraybuffer,
      // Requires extension capability 2, which v0.1 does not negotiate.
      shared_arraybuffer: false,
    },
    effective_limits: EffectiveLimits {
      max_channels: effective(
        limits.max_channels.map(u64::from),
        u64::from(config.max_channels),
        u64::from(MAX_CHANNELS_CEILING),
      ) as u32,
      max_session_bytes: effective(
        limits.max_session_bytes,
        config.max_session_bytes,
        MAX_SESSION_BYTES_CEILING,
      ),
      max_message_bytes: effective(
        limits.max_message_bytes.map(u64::from),
        u64::from(config.max_message_bytes),
        u64::from(MAX_MESSAGE_BYTES_CEILING),
      ) as u32,
      max_control_payload_bytes: effective(
        limits.max_control_payload_bytes.map(u64::from),
        u64::from(config.max_control_payload_bytes),
        u64::from(MAX_CONTROL_PAYLOAD_BYTES_CEILING),
      ) as u32,
    },
    // v0.1 negotiates no extension capabilities (resume and
    // shared_arraybuffer are parked).
    extension_capabilities: Vec::new(),
  })
}

fn bytes_value(bytes: &[u8]) -> CborValue<'static> {
  CborValue::Bytes(Cow::Owned(bytes.to_vec()))
}

fn text_value(text: &str) -> CborValue<'static> {
  CborValue::Text(Cow::Owned(text.to_owned()))
}

fn negotiated_capabilities_value(hello: &ServerHello) -> CborValue<'static> {
  let mut transport = vec![
    (1, CborValue::Bool(hello.transport_capabilities.webtransport_http3)),
    (2, CborValue::Bool(hello.transport_capabilities.binary_wss)),
  ];
  if let Some(size) = hello.transport_capabilities.max_datagram_size {
    transport.push((3, CborValue::Unsigned(u64::from(size))));
  }
  CborValue::Map(vec![
    (1, CborValue::Map(transport)),
    (
      2,
      CborValue::Map(vec![
        (1, CborValue::Bool(hello.buffer_capabilities.transferable_arraybuffer)),
        (2, CborValue::Bool(hello.buffer_capabilities.shared_arraybuffer)),
      ]),
    ),
    (
      3,
      CborValue::Array(
        hello.extension_capabilities.iter().map(|id| CborValue::Unsigned(u64::from(*id))).collect(),
      ),
    ),
  ])
}

/// SessionReady in response to Authenticate.
///
/// `negotiated_capabilities` must equal the ServerHello fields exactly, so the
/// builder takes the sent hello as input.
#[must_use]
pub fn session_ready(
  config: &GatewayConfig,
  server_hello: &ServerHello,
  correlation: &[u8],
  session_id: &[u8; 32],
  effective_identity: &str,
) -> CborValue<'static> {
  let row = config.support_row;
  CborValue::Map(vec![
    (1, CborValue::Unsigned(2)),
    (2, bytes_value(correlation)),
    (7, text_value(&config.gateway_instance_id)),
    (8, text_value(row.id)),
    (10, CborValue::Array(vec![CborValue::Unsigned(u64::from(config.domain_id))])),
    (
      12,
      effective_budgets_map(
        u64::from(config.max_channels),
        config.max_session_bytes,
        u64::from(config.max_message_bytes),
      ),
    ),
    (13, text_value(&config.policy_revision)),
    (18, text_value(row.ros_distro)),
    (19, text_value(row.rmw_identifier)),
    (20, text_value(&config.adapter_abi_version)),
    (21, text_value(effective_identity)),
    (53, bytes_value(session_id)),
    (54, negotiated_capabilities_value(server_hello)),
  ])
}

/// ChannelReady success (`allow`) with concrete effective QoS.
#[must_use]
pub fn channel_ready_allow(
  config: &GatewayConfig,
  correlation: &[u8],
  channel_id: u32,
  effective_priority: u8,
  effective_qos: &EffectiveQos,
) -> CborValue<'static> {
  CborValue::Map(vec![
    (1, CborValue::Unsigned(9)),
    (2, bytes_value(correlation)),
    (29, CborValue::Unsigned(u64::from(channel_id))),
    (33, CborValue::Unsigned(0)),
    (
      12,
      effective_budgets_map(
        config.sample_queue_depth as u64,
        config.sample_queue_max_bytes as u64,
        u64::from(config.max_message_bytes),
      ),
    ),
    (59, CborValue::Unsigned(u64::from(effective_priority))),
    (57, effective_qos.to_wire()),
    (9, CborValue::Unsigned(u64::from(config.domain_id))),
    (8, text_value(config.support_row.id)),
  ])
}

/// ChannelReady failure (`error`) with an embedded channel-scope error body.
#[must_use]
pub fn channel_ready_error(
  correlation: &[u8],
  channel_id: u32,
  code: u8,
  message: &str,
) -> CborValue<'static> {
  CborValue::Map(vec![
    (1, CborValue::Unsigned(9)),
    (2, bytes_value(correlation)),
    (29, CborValue::Unsigned(u64::from(channel_id))),
    (33, CborValue::Unsigned(3)),
    (
      15,
      CborValue::Map(vec![
        (48, CborValue::Unsigned(u64::from(code))),
        (49, CborValue::Unsigned(1)),
        (51, text_value(message)),
      ]),
    ),
  ])
}

/// Phase-one Service effective QoS: RELIABLE + VOLATILE + KEEP_LAST depth 5 + AUTOMATIC.
#[must_use]
pub fn effective_service_qos_wire() -> CborValue<'static> {
  CborValue::Map(vec![
    (1, CborValue::Unsigned(1)), // RELIABLE
    (2, CborValue::Unsigned(2)), // VOLATILE
    (3, CborValue::Unsigned(1)), // KEEP_LAST
    (4, CborValue::Unsigned(5)), // depth
    (7, CborValue::Unsigned(1)), // AUTOMATIC
  ])
}

/// Phase-one Action effective QoS: goal/result/cancel = service profile;
/// feedback/status = reliable volatile keep-last depth 5 automatic.
#[must_use]
pub fn effective_action_qos_wire() -> CborValue<'static> {
  let service = effective_service_qos_wire();
  let topic = CborValue::Map(vec![
    (1, CborValue::Unsigned(1)),
    (2, CborValue::Unsigned(2)),
    (3, CborValue::Unsigned(1)),
    (4, CborValue::Unsigned(5)),
    (7, CborValue::Unsigned(1)),
  ]);
  CborValue::Map(vec![
    (1, service.clone()),
    (2, service.clone()),
    (3, service),
    (4, topic.clone()),
    (5, topic),
  ])
}

/// ChannelReady success for ServiceClient / ServiceServer (`effective_service_qos` key 60).
#[must_use]
pub fn channel_ready_service_allow(
  config: &GatewayConfig,
  correlation: &[u8],
  channel_id: u32,
  effective_priority: u8,
) -> CborValue<'static> {
  CborValue::Map(vec![
    (1, CborValue::Unsigned(9)),
    (2, bytes_value(correlation)),
    (29, CborValue::Unsigned(u64::from(channel_id))),
    (33, CborValue::Unsigned(0)),
    (
      12,
      effective_budgets_map(
        config.sample_queue_depth as u64,
        config.sample_queue_max_bytes as u64,
        u64::from(config.max_message_bytes),
      ),
    ),
    (59, CborValue::Unsigned(u64::from(effective_priority))),
    (60, effective_service_qos_wire()),
    (9, CborValue::Unsigned(u64::from(config.domain_id))),
    (8, text_value(config.support_row.id)),
  ])
}

/// ChannelReady success for ActionClient / ActionServer (`effective_action_qos` key 58).
#[must_use]
pub fn channel_ready_action_allow(
  config: &GatewayConfig,
  correlation: &[u8],
  channel_id: u32,
  effective_priority: u8,
) -> CborValue<'static> {
  CborValue::Map(vec![
    (1, CborValue::Unsigned(9)),
    (2, bytes_value(correlation)),
    (29, CborValue::Unsigned(u64::from(channel_id))),
    (33, CborValue::Unsigned(0)),
    (
      12,
      effective_budgets_map(
        config.sample_queue_depth as u64,
        config.sample_queue_max_bytes as u64,
        u64::from(config.max_message_bytes),
      ),
    ),
    (59, CborValue::Unsigned(u64::from(effective_priority))),
    (58, effective_action_qos_wire()),
    (9, CborValue::Unsigned(u64::from(config.domain_id))),
    (8, text_value(config.support_row.id)),
  ])
}

fn demo_schema_identity(row: SupportRow) -> CborValue<'static> {
  let (scheme, value) = if row.id.starts_with('H') {
    (row.schema_scheme(), BUNDLE_DEMO)
  } else {
    (row.schema_scheme(), RIHS_DEMO)
  };
  CborValue::Map(vec![(1, text_value(scheme)), (2, text_value(value))])
}

fn advertised_topic_qos_wire() -> CborValue<'static> {
  CborValue::Map(vec![
    (1, CborValue::Unsigned(1)),
    (2, CborValue::Unsigned(2)),
    (3, CborValue::Unsigned(1)),
    (4, CborValue::Unsigned(5)),
    (7, CborValue::Unsigned(1)),
  ])
}

fn advertised_action_qos_wire() -> CborValue<'static> {
  let profile = advertised_topic_qos_wire();
  CborValue::Map(vec![
    (1, profile.clone()),
    (2, profile.clone()),
    (3, profile.clone()),
    (4, profile.clone()),
    (5, profile),
  ])
}

fn pad_id16(id: &[u8]) -> Vec<u8> {
  let mut out = [0u8; 16];
  let n = id.len().min(16);
  out[16 - n..].copy_from_slice(&id[id.len() - n..]);
  out.to_vec()
}

fn graph_node_value(node: &GraphNodeInfo) -> CborValue<'static> {
  let mut entries = vec![(55, bytes_value(&pad_id16(&node.id))), (1, text_value(&node.name))];
  if let Some(ns) = &node.namespace {
    entries.push((2, text_value(ns)));
  }
  entries.push((9, CborValue::Unsigned(u64::from(node.domain_id))));
  CborValue::Map(entries)
}

fn graph_endpoint_value(endpoint: &GraphEndpointInfo, row: SupportRow) -> CborValue<'static> {
  let mut entries = vec![
    (56, bytes_value(&pad_id16(&endpoint.id))),
    (55, bytes_value(&pad_id16(&endpoint.node_id))),
    (1, text_value(&endpoint.name)),
    (2, CborValue::Unsigned(u64::from(endpoint.kind))),
    (3, text_value(&endpoint.type_name)),
    (4, demo_schema_identity(row)),
    (5, CborValue::Unsigned(1)),
    (6, CborValue::Unsigned(0)),
  ];
  if endpoint.kind <= 3 {
    entries.push((7, advertised_topic_qos_wire()));
  } else {
    entries.push((58, advertised_action_qos_wire()));
  }
  entries.push((9, CborValue::Unsigned(u64::from(endpoint.domain_id))));
  entries.push((8, text_value(row.id)));
  CborValue::Map(entries)
}

fn sorted_graph_nodes(view: &GraphView) -> Vec<CborValue<'static>> {
  let mut nodes = view.nodes.clone();
  nodes.sort_by_key(|a| pad_id16(&a.id));
  nodes.iter().map(graph_node_value).collect()
}

fn sorted_graph_endpoints(view: &GraphView, row: SupportRow) -> Vec<CborValue<'static>> {
  let mut endpoints = view.endpoints.clone();
  endpoints.sort_by_key(|a| pad_id16(&a.id));
  endpoints.iter().map(|e| graph_endpoint_value(e, row)).collect()
}

/// GraphSnapshot (kind 3) for the current backend view.
#[must_use]
pub fn graph_snapshot(
  config: &GatewayConfig,
  correlation: &[u8],
  generation: u64,
  view: &GraphView,
) -> CborValue<'static> {
  let row = config.support_row;
  CborValue::Map(vec![
    (1, CborValue::Unsigned(3)),
    (2, bytes_value(correlation)),
    (14, CborValue::Unsigned(generation)),
    (7, text_value(&config.gateway_instance_id)),
    (8, text_value(row.id)),
    (22, CborValue::Array(sorted_graph_nodes(view))),
    (23, CborValue::Array(sorted_graph_endpoints(view, row))),
  ])
}

/// GraphDelta (kind 4) with one or more ops (add_or_update_node / endpoint, …).
#[must_use]
pub fn graph_delta(
  config: &GatewayConfig,
  correlation: &[u8],
  base_generation: u64,
  generation: u64,
  ops: Vec<CborValue<'static>>,
) -> CborValue<'static> {
  CborValue::Map(vec![
    (1, CborValue::Unsigned(4)),
    (2, bytes_value(correlation)),
    (14, CborValue::Unsigned(generation)),
    (24, CborValue::Unsigned(base_generation)),
    (7, text_value(&config.gateway_instance_id)),
    (8, text_value(config.support_row.id)),
    (25, CborValue::Array(ops)),
  ])
}

/// `add_or_update_endpoint` delta op (graph_delta_ops = 2).
#[must_use]
pub fn graph_delta_add_endpoint(
  endpoint: &GraphEndpointInfo,
  row: SupportRow,
) -> CborValue<'static> {
  CborValue::Map(vec![(1, CborValue::Unsigned(2)), (3, graph_endpoint_value(endpoint, row))])
}

/// `add_or_update_node` delta op (graph_delta_ops = 0).
#[must_use]
pub fn graph_delta_add_node(node: &GraphNodeInfo) -> CborValue<'static> {
  CborValue::Map(vec![(1, CborValue::Unsigned(0)), (2, graph_node_value(node))])
}

/// Server Heartbeat (unsolicited; zero correlation).
#[must_use]
pub fn heartbeat(counter: u64) -> CborValue<'static> {
  CborValue::Map(vec![
    (1, CborValue::Unsigned(12)),
    (2, bytes_value(&ZERO_CORRELATION)),
    (40, CborValue::Unsigned(counter)),
  ])
}

/// Flat CONTROL Error, session scope (channel_id absent).
#[must_use]
pub fn session_error(code: u8, message: &str) -> CborValue<'static> {
  session_error_with_correlation(&ZERO_CORRELATION, code, message)
}

/// Session-scope Error with an explicit correlation (Authenticate failures).
#[must_use]
pub fn session_error_with_correlation(
  correlation: &[u8],
  code: u8,
  message: &str,
) -> CborValue<'static> {
  CborValue::Map(vec![
    (1, CborValue::Unsigned(15)),
    (2, bytes_value(correlation)),
    (48, CborValue::Unsigned(u64::from(code))),
    (49, CborValue::Unsigned(0)),
    (51, text_value(message)),
  ])
}

/// Flat CONTROL Error, channel scope.
#[must_use]
pub fn channel_error(channel_id: u32, code: u8, message: &str) -> CborValue<'static> {
  CborValue::Map(vec![
    (1, CborValue::Unsigned(15)),
    (2, bytes_value(&ZERO_CORRELATION)),
    (48, CborValue::Unsigned(u64::from(code))),
    (49, CborValue::Unsigned(1)),
    (29, CborValue::Unsigned(u64::from(channel_id))),
    (51, text_value(message)),
  ])
}

#[cfg(test)]
mod hello_tests {
  use super::*;
  use crate::config::ActiveTransport;
  use rclweb::{BufferCapabilities, ClientHello, RequestedLimits, TransportCapabilities};

  fn hello(wt: bool, wss: bool) -> ClientHello {
    ClientHello {
      wire_versions: vec![0],
      transport_capabilities: TransportCapabilities {
        webtransport_http3: wt,
        binary_wss: wss,
        max_datagram_size: None,
      },
      buffer_capabilities: BufferCapabilities {
        transferable_arraybuffer: true,
        shared_arraybuffer: false,
      },
      requested_limits: RequestedLimits::default(),
      extension_capabilities: Vec::new(),
    }
  }

  #[test]
  fn websocket_default_does_not_offer_webtransport() {
    let config = GatewayConfig::default();
    let sh = negotiate_server_hello(&hello(true, true), &config, ActiveTransport::BinaryWebSocket)
      .expect("negotiate");
    assert!(sh.transport_capabilities.binary_wss);
    assert!(!sh.transport_capabilities.webtransport_http3);
  }

  #[test]
  fn offer_webtransport_and_negotiates_on_ws_path() {
    let config = GatewayConfig { offer_webtransport: true, ..GatewayConfig::default() };
    let sh = negotiate_server_hello(&hello(true, true), &config, ActiveTransport::BinaryWebSocket)
      .expect("negotiate");
    assert!(sh.transport_capabilities.binary_wss);
    assert!(sh.transport_capabilities.webtransport_http3);
  }

  #[test]
  fn wt_active_requires_negotiated_webtransport() {
    let config = GatewayConfig { offer_webtransport: true, ..GatewayConfig::default() };
    let err =
      negotiate_server_hello(&hello(false, true), &config, ActiveTransport::WebTransportHttp3)
        .expect_err("must fail");
    assert_eq!(err, 25);

    let sh =
      negotiate_server_hello(&hello(true, false), &config, ActiveTransport::WebTransportHttp3)
        .expect("negotiate");
    assert!(sh.transport_capabilities.webtransport_http3);
    assert!(!sh.transport_capabilities.binary_wss);
  }
}
