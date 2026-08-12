//! Gateway configuration for the R1 walking skeleton.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

/// Protocol absolute ceilings (registry `absolute_limits`).
pub const MAX_CHANNELS_CEILING: u32 = 65_535;
pub const MAX_SESSION_BYTES_CEILING: u64 = 4_294_967_296;
pub const MAX_MESSAGE_BYTES_CEILING: u32 = 67_108_864;
pub const MAX_CONTROL_PAYLOAD_BYTES_CEILING: u32 = 1_048_576;

/// One adapter support row identity for this gateway process ([ADR 0008](../../docs/adr/0008-one-adapter-row-per-gateway-process.md)).
///
/// Immutable for the running process: SessionReady, ChannelReady, graph, and
/// OpenChannel validation all carry `id`. Humble rows (`H-*`) use
/// `moonspan-schema-v1` OpenChannel identity; Jazzy rows (`J-*`) use
/// `rep2011-rihs`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SupportRow {
  pub id: &'static str,
  pub ros_distro: &'static str,
  pub rmw_identifier: &'static str,
}

impl SupportRow {
  /// Schema identity scheme for OpenChannel / graph placeholders on this row.
  #[must_use]
  pub fn schema_scheme(self) -> &'static str {
    if self.id.starts_with('H') { "moonspan-schema-v1" } else { "rep2011-rihs" }
  }
}

/// Jazzy + Fast DDS (Phase 1 default gated row).
pub const SUPPORT_ROW_J_FT: SupportRow =
  SupportRow { id: "J-FT", ros_distro: "jazzy", rmw_identifier: "rmw_fastrtps_cpp" };

/// Humble + Fast DDS (R3-03 delivery-gated row).
pub const SUPPORT_ROW_H_FT: SupportRow =
  SupportRow { id: "H-FT", ros_distro: "humble", rmw_identifier: "rmw_fastrtps_cpp" };

/// Deprecated alias for [`SUPPORT_ROW_J_FT`].id — prefer `config.support_row.id`.
#[deprecated(note = "use GatewayConfig::support_row.id or SUPPORT_ROW_J_FT.id")]
pub const SUPPORT_ROW_ID: &str = SUPPORT_ROW_J_FT.id;

/// Deprecated alias for [`SUPPORT_ROW_J_FT`].ros_distro.
#[deprecated(note = "use GatewayConfig::support_row.ros_distro")]
pub const ROS_DISTRO: &str = SUPPORT_ROW_J_FT.ros_distro;

/// Deprecated alias for [`SUPPORT_ROW_J_FT`].rmw_identifier.
#[deprecated(note = "use GatewayConfig::support_row.rmw_identifier")]
pub const RMW_IDENTIFIER: &str = SUPPORT_ROW_J_FT.rmw_identifier;

/// Parse `RCLWEBD_SUPPORT_ROW` (`J-FT` default; `H-FT` accepted).
#[must_use]
pub fn parse_support_row(id: &str) -> Option<SupportRow> {
  match id.trim() {
    "J-FT" => Some(SUPPORT_ROW_J_FT),
    "H-FT" => Some(SUPPORT_ROW_H_FT),
    _ => None,
  }
}

/// Which transport is carrying the current R2WP session.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActiveTransport {
  BinaryWebSocket,
  WebTransportHttp3,
}

/// Gateway configuration. Authenticate is off by default (R1–R3 accept-all).
/// `oidc` is opt-in; the production tenant and SROS2 keystore remain D-04.
/// Operations endpoints and drain timeout are R4-02.
#[derive(Debug, Clone)]
pub struct GatewayConfig {
  pub gateway_instance_id: String,
  /// Bound support row for this process (ADR 0008: one row per process).
  pub support_row: SupportRow,
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
  /// Opt-in ADR 0011 local-dev TLS (auto-mint ECDSA P-256, advertise SPKI).
  /// Default false — production PKI unchanged.
  pub local_dev_tls_enabled: bool,
  /// When true, ServerHello AND-negotiates `webtransport_http3` if the client
  /// offers it. Together with local-dev TLS (and `--features webtransport`)
  /// starts the WT accept loop.
  pub offer_webtransport: bool,
  /// UDP bind for the WebTransport listener (default `127.0.0.1:4433`).
  pub webtransport_bind: String,
  /// Authenticate evaluation. Default [`crate::auth::AuthMode::Off`] leaves
  /// the R1–R3 accept-all path unchanged. `oidc` is opt-in.
  pub auth_mode: crate::auth::AuthMode,
  /// Required when [`Self::auth_mode`] is `Oidc`.
  pub oidc: Option<crate::auth::OidcSettings>,
  /// Seconds to wait for live sessions after drain (SIGTERM / ctrl_c).
  pub drain_timeout_secs: u64,
  /// When true, HTTP responses include COOP/COEP/CORP (browser isolation).
  pub isolation_headers: bool,
  /// Allowed CORS origins for HTTP ops and `/local-dev/tls`. Empty = none.
  pub cors_origins: Vec<String>,
}

impl Default for GatewayConfig {
  fn default() -> Self {
    Self {
      gateway_instance_id: format!("rclwebd-{:016x}", entropy64()),
      support_row: SUPPORT_ROW_J_FT,
      domain_id: 0,
      policy_revision: "r1-dev".to_owned(),
      adapter_abi_version: crate::adapter::ABI_VERSION_STRING.to_owned(),
      max_channels: MAX_CHANNELS_CEILING,
      max_session_bytes: MAX_SESSION_BYTES_CEILING,
      max_message_bytes: MAX_MESSAGE_BYTES_CEILING,
      max_control_payload_bytes: MAX_CONTROL_PAYLOAD_BYTES_CEILING,
      sample_queue_depth: 256,
      sample_queue_max_bytes: 4 * 1024 * 1024,
      local_dev_tls_enabled: false,
      offer_webtransport: false,
      webtransport_bind: "127.0.0.1:4433".to_owned(),
      auth_mode: crate::auth::AuthMode::Off,
      oidc: None,
      drain_timeout_secs: 15,
      isolation_headers: false,
      cors_origins: Vec::new(),
    }
  }
}

static SESSION_COUNTER: AtomicU64 = AtomicU64::new(0);

fn entropy64() -> u64 {
  let nanos =
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(0);
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
