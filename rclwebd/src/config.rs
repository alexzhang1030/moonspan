//! Gateway configuration for the R1 walking skeleton.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

/// Protocol absolute ceilings (registry `absolute_limits`).
pub const MAX_CHANNELS_CEILING: u32 = 65_535;
pub const MAX_SESSION_BYTES_CEILING: u64 = 4_294_967_296;
pub const MAX_MESSAGE_BYTES_CEILING: u32 = 67_108_864;
pub const MAX_CONTROL_PAYLOAD_BYTES_CEILING: u32 = 1_048_576;

/// Fixed identity of the built artifact's support row (Phase 1 gates J-FT).
pub const SUPPORT_ROW_ID: &str = "J-FT";
pub const ROS_DISTRO: &str = "jazzy";
pub const RMW_IDENTIFIER: &str = "rmw_fastrtps_cpp";

/// Gateway configuration. Identity/policy fields become real in R4; the R1
/// values exist so every SessionReady carries complete provenance.
#[derive(Debug, Clone)]
pub struct GatewayConfig {
    pub gateway_instance_id: String,
    /// Single ROS domain served in R1 (multi-domain rows return later).
    pub domain_id: u8,
    pub policy_revision: String,
    pub adapter_abi_version: String,
    /// Server hard limits (each capped by the protocol ceiling).
    pub max_channels: u32,
    pub max_session_bytes: u64,
    pub max_message_bytes: u32,
    pub max_control_payload_bytes: u32,
    /// Per-connection sample write-queue depth (max framed samples waiting
    /// for WebSocket write). Best-effort uses latest-wins when full.
    pub sample_queue_depth: usize,
    /// Per-connection byte budget for the sample write queue.
    pub sample_queue_max_bytes: usize,
}

impl Default for GatewayConfig {
    fn default() -> Self {
        Self {
            gateway_instance_id: format!("rclwebd-{:016x}", entropy64()),
            domain_id: 0,
            policy_revision: "r1-dev".to_owned(),
            adapter_abi_version: "serialized-rcl-static-r1".to_owned(),
            max_channels: MAX_CHANNELS_CEILING,
            max_session_bytes: MAX_SESSION_BYTES_CEILING,
            max_message_bytes: MAX_MESSAGE_BYTES_CEILING,
            max_control_payload_bytes: MAX_CONTROL_PAYLOAD_BYTES_CEILING,
            sample_queue_depth: 256,
            sample_queue_max_bytes: 4 * 1024 * 1024,
        }
    }
}

static SESSION_COUNTER: AtomicU64 = AtomicU64::new(0);

fn entropy64() -> u64 {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0);
    let count = SESSION_COUNTER.fetch_add(1, Ordering::Relaxed);
    // SplitMix64 finalizer over time + counter: unique, not security material
    // (session identity/resume trust is R4 scope).
    let mut z = nanos
        .wrapping_add(count.wrapping_mul(0x9e37_79b9_7f4a_7c15))
        .wrapping_add(std::process::id() as u64);
    z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    z ^ (z >> 31)
}

/// Fresh opaque 32-byte session id.
#[must_use]
pub fn new_session_id() -> [u8; 32] {
    let mut out = [0u8; 32];
    for chunk in 0..4 {
        out[chunk * 8..(chunk + 1) * 8].copy_from_slice(&entropy64().to_be_bytes());
    }
    out
}
