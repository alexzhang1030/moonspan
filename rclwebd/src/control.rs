//! Server-side control-message builders and hello negotiation.
//!
//! Builders produce `CborValue` maps that the core encoders serialize; the
//! connection re-parses every outbound control frame with the core parser
//! before sending, so a builder that drifts from the contract fails loudly.

use crate::config::{
    GatewayConfig, MAX_CHANNELS_CEILING, MAX_CONTROL_PAYLOAD_BYTES_CEILING,
    MAX_MESSAGE_BYTES_CEILING, MAX_SESSION_BYTES_CEILING, RMW_IDENTIFIER, ROS_DISTRO,
    SUPPORT_ROW_ID,
};
use crate::qos::EffectiveQos;
use rclweb::{
    BufferCapabilities, CborValue, ClientHello, EffectiveLimits, ServerHello, TransportCapabilities,
};
use std::borrow::Cow;

pub const ZERO_CORRELATION: [u8; 16] = [0u8; 16];

/// Negotiate a ServerHello for a binary-WebSocket connection.
///
/// Returns the bootstrap error code on failure (2 no_common_version,
/// 25 protocol_violation when the current transport would negotiate false).
pub fn negotiate_server_hello(
    hello: &ClientHello,
    config: &GatewayConfig,
) -> Result<ServerHello, u8> {
    if !hello.wire_versions.contains(&0) {
        return Err(2);
    }
    if !hello.transport_capabilities.binary_wss {
        // The transport in use must stay true after AND-negotiation.
        return Err(25);
    }

    let effective = |requested: Option<u64>, hard: u64, ceiling: u64| -> u64 {
        requested.unwrap_or(hard).min(hard).min(ceiling)
    };
    let limits = &hello.requested_limits;
    Ok(ServerHello {
        selected_wire_version: 0,
        transport_capabilities: TransportCapabilities {
            webtransport_http3: false,
            binary_wss: true,
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
        (
            1,
            CborValue::Bool(hello.transport_capabilities.webtransport_http3),
        ),
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
                (
                    1,
                    CborValue::Bool(hello.buffer_capabilities.transferable_arraybuffer),
                ),
                (
                    2,
                    CborValue::Bool(hello.buffer_capabilities.shared_arraybuffer),
                ),
            ]),
        ),
        (
            3,
            CborValue::Array(
                hello
                    .extension_capabilities
                    .iter()
                    .map(|id| CborValue::Unsigned(u64::from(*id)))
                    .collect(),
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
    CborValue::Map(vec![
        (1, CborValue::Unsigned(2)),
        (2, bytes_value(correlation)),
        (7, text_value(&config.gateway_instance_id)),
        (8, text_value(SUPPORT_ROW_ID)),
        (
            10,
            CborValue::Array(vec![CborValue::Unsigned(u64::from(config.domain_id))]),
        ),
        (12, CborValue::Map(Vec::new())),
        (13, text_value(&config.policy_revision)),
        (18, text_value(ROS_DISTRO)),
        (19, text_value(RMW_IDENTIFIER)),
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
        (12, CborValue::Map(Vec::new())),
        (59, CborValue::Unsigned(u64::from(effective_priority))),
        (57, effective_qos.to_wire()),
        (9, CborValue::Unsigned(u64::from(config.domain_id))),
        (8, text_value(SUPPORT_ROW_ID)),
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
    CborValue::Map(vec![
        (1, CborValue::Unsigned(15)),
        (2, bytes_value(&ZERO_CORRELATION)),
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
