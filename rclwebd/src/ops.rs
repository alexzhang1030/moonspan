//! Process operations: readiness, drain, and scrapeable metrics (R4-02).
//!
//! `/healthz` stays liveness (`ok`) for the R1-05 e2e harness. Load balancers
//! and deploy hooks use `/readyz` and `POST /drain`.

use crate::config::GatewayConfig;
use crate::telemetry::PROCESS_TELEMETRY;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// Shared drain / session counters for one gateway process.
#[derive(Debug)]
pub struct OpsState {
  draining: AtomicBool,
  sessions: AtomicU64,
  started_unix_secs: u64,
}

impl OpsState {
  #[must_use]
  pub fn new() -> Self {
    Self {
      draining: AtomicBool::new(false),
      sessions: AtomicU64::new(0),
      started_unix_secs: now_secs(),
    }
  }

  #[must_use]
  pub fn is_draining(&self) -> bool {
    self.draining.load(Ordering::Relaxed)
  }

  pub fn begin_drain(&self) {
    self.draining.store(true, Ordering::Relaxed);
  }

  #[must_use]
  pub fn session_count(&self) -> u64 {
    self.sessions.load(Ordering::Relaxed)
  }

  #[must_use]
  pub fn started_unix_secs(&self) -> u64 {
    self.started_unix_secs
  }

  /// Increment the live-session gauge until the guard drops.
  #[must_use = "session count decrements when the guard is dropped"]
  pub fn session_guard(self: &Arc<Self>) -> SessionGuard {
    self.sessions.fetch_add(1, Ordering::Relaxed);
    SessionGuard { ops: Arc::clone(self) }
  }

  /// Wait until no sessions remain or `timeout` elapses.
  pub async fn wait_idle(&self, timeout: Duration) {
    let deadline = Instant::now() + timeout;
    while self.session_count() > 0 && Instant::now() < deadline {
      tokio::time::sleep(Duration::from_millis(50)).await;
    }
  }
}

impl Default for OpsState {
  fn default() -> Self {
    Self::new()
  }
}

/// Decrements [`OpsState::session_count`] on drop.
#[derive(Debug)]
pub struct SessionGuard {
  ops: Arc<OpsState>,
}

impl Drop for SessionGuard {
  fn drop(&mut self) {
    self.ops.sessions.fetch_sub(1, Ordering::Relaxed);
  }
}

fn now_secs() -> u64 {
  SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn auth_mode_name(config: &GatewayConfig) -> &'static str {
  match config.auth_mode {
    crate::auth::AuthMode::Off => "off",
    crate::auth::AuthMode::Oidc => "oidc",
  }
}

fn acl_mode_name(config: &GatewayConfig) -> &'static str {
  match config.acl_mode {
    crate::acl::AclMode::Off => "off",
    crate::acl::AclMode::Enforce => "enforce",
  }
}

/// JSON for `GET /readyz`. HTTP status is chosen by the caller.
#[must_use]
pub fn readyz_json(config: &GatewayConfig, ops: &OpsState) -> String {
  let draining = ops.is_draining();
  let status = if draining { "not_ready" } else { "ready" };
  let reason = if draining { "draining" } else { "ok" };
  serde_json::json!({
      "status": status,
      "reason": reason,
      "draining": draining,
      "sessions": ops.session_count(),
      "started_unix_secs": ops.started_unix_secs(),
      "gateway_instance_id": config.gateway_instance_id,
      "support_row_id": config.support_row.id,
      "domain_id": config.domain_id,
      "auth_mode": auth_mode_name(config),
      "adapter_abi_version": config.adapter_abi_version,
      "local_dev_tls": config.local_dev_tls_enabled,
  })
  .to_string()
}

/// JSON for `GET /livez` (always alive while the HTTP server serves).
#[must_use]
pub fn livez_json() -> String {
  "{\"status\":\"ok\"}".to_owned()
}

/// Non-secret process config for `GET /configz`.
#[must_use]
pub fn configz_json(config: &GatewayConfig, ops: &OpsState) -> String {
  let oidc = config.oidc.as_ref().map(|settings| {
    serde_json::json!({
        "issuer": settings.issuer,
        "audience": settings.audience,
        "has_hs_secret": settings.hs_secret.is_some(),
        "has_jwks": settings.jwks.is_some(),
    })
  });
  let audit = config.audit.snapshot();
  serde_json::json!({
      "gateway_instance_id": config.gateway_instance_id,
      "support_row_id": config.support_row.id,
      "ros_distro": config.support_row.ros_distro,
      "rmw_identifier": config.support_row.rmw_identifier,
      "domain_id": config.domain_id,
      "policy_revision": config.policy_revision,
      "adapter_abi_version": config.adapter_abi_version,
      "auth_mode": auth_mode_name(config),
      "oidc": oidc,
      "acl_mode": acl_mode_name(config),
      "acl_rules": config.acl.as_ref().map(|policy| policy.rules.len()),
      "audit_sink": audit.mode.as_str(),
      "audit_path": audit.path.as_ref().map(|p| p.display().to_string()),
      "audit_max_bytes": audit.max_bytes,
      "audit_retain": audit.retain,
      "audit_on_corrupt": audit.on_corrupt.as_str(),
      "audit_events": audit.events,
      "audit_write_errors": audit.write_errors,
      "audit_last_seq": audit.last_seq,
      "audit_last_sha256": audit.last_sha256,
      "audit_bytes": audit.bytes,
      "audit_integrity": audit.integrity.as_str(),
      "local_dev_tls": config.local_dev_tls_enabled,
      "offer_webtransport": config.offer_webtransport,
      "webtransport_bind": config.webtransport_bind,
      "isolation_headers": config.isolation_headers,
      "cors_origins": config.cors_origins,
      "drain_timeout_secs": config.drain_timeout_secs,
      "draining": ops.is_draining(),
      "sessions": ops.session_count(),
      "max_channels": config.max_channels,
      "max_session_bytes": config.max_session_bytes,
      "max_message_bytes": config.max_message_bytes,
      "sample_queue_depth": config.sample_queue_depth,
      "sample_queue_max_bytes": config.sample_queue_max_bytes,
  })
  .to_string()
}

/// JSON for `POST /drain`.
#[must_use]
pub fn drain_json(ops: &OpsState) -> String {
  serde_json::json!({
      "status": "draining",
      "sessions": ops.session_count(),
  })
  .to_string()
}

/// Prometheus text exposition (0.0.4) of gateway counters plus session gauges.
///
/// Open scrape format, not a vendor. Identity lives on `/configz` / `/readyz`
/// so these series stay low-cardinality.
#[must_use]
pub fn metrics_text(config: &GatewayConfig, ops: &OpsState) -> String {
  let snap = PROCESS_TELEMETRY.snapshot();
  let audit = config.audit.snapshot();
  let draining = u64::from(ops.is_draining());
  format!(
    "# HELP rclwebd_payload_copies_total Serialized payloads copied into framed sample buffers.\n\
         # TYPE rclwebd_payload_copies_total counter\n\
         rclwebd_payload_copies_total {}\n\
         # HELP rclwebd_bytes_copied_total Bytes copied with payload_copies.\n\
         # TYPE rclwebd_bytes_copied_total counter\n\
         rclwebd_bytes_copied_total {}\n\
         # HELP rclwebd_samples_framed_total Samples framed for outbound send.\n\
         # TYPE rclwebd_samples_framed_total counter\n\
         rclwebd_samples_framed_total {}\n\
         # HELP rclwebd_delivered_total Samples admitted as delivered.\n\
         # TYPE rclwebd_delivered_total counter\n\
         rclwebd_delivered_total {}\n\
         # HELP rclwebd_sequence_gap_total Sequence-gap dispositions.\n\
         # TYPE rclwebd_sequence_gap_total counter\n\
         rclwebd_sequence_gap_total {}\n\
         # HELP rclwebd_stale_sequence_total Stale-sequence dispositions.\n\
         # TYPE rclwebd_stale_sequence_total counter\n\
         rclwebd_stale_sequence_total {}\n\
         # HELP rclwebd_reliable_queue_drop_total Reliable write-queue drops.\n\
         # TYPE rclwebd_reliable_queue_drop_total counter\n\
         rclwebd_reliable_queue_drop_total {}\n\
         # HELP rclwebd_sessions Live R2WP sessions (WebSocket and WebTransport).\n\
         # TYPE rclwebd_sessions gauge\n\
         rclwebd_sessions {}\n\
         # HELP rclwebd_draining 1 when POST /drain or SIGTERM drain is active.\n\
         # TYPE rclwebd_draining gauge\n\
         rclwebd_draining {}\n\
         # HELP rclwebd_audit_events_total Audit events emitted to stderr and the optional file.\n\
         # TYPE rclwebd_audit_events_total counter\n\
         rclwebd_audit_events_total {}\n\
         # HELP rclwebd_audit_write_errors_total File-sink write or rotate failures.\n\
         # TYPE rclwebd_audit_write_errors_total counter\n\
         rclwebd_audit_write_errors_total {}\n",
    snap.payload_copies,
    snap.bytes_copied,
    snap.samples_framed,
    snap.delivered,
    snap.sequence_gap,
    snap.stale_sequence,
    snap.reliable_queue_drop,
    ops.session_count(),
    draining,
    audit.events,
    audit.write_errors,
  )
}

/// Allowed `Access-Control-Allow-Origin` value, if any.
#[must_use]
pub fn cors_allow_origin(allowed: &[String], request_origin: Option<&str>) -> Option<String> {
  if allowed.is_empty() {
    return None;
  }
  if allowed.iter().any(|o| o == "*") {
    return Some("*".to_owned());
  }
  let origin = request_origin?;
  allowed.iter().find(|o| o.as_str() == origin).cloned()
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::config::GatewayConfig;

  #[test]
  fn drain_flips_readyz_reason() {
    let ops = OpsState::new();
    let config = GatewayConfig::default();
    let ready = readyz_json(&config, &ops);
    assert!(ready.contains("\"status\":\"ready\""));
    assert!(ready.contains("\"draining\":false"));
    ops.begin_drain();
    let not_ready = readyz_json(&config, &ops);
    assert!(not_ready.contains("\"status\":\"not_ready\""));
    assert!(not_ready.contains("\"reason\":\"draining\""));
  }

  #[test]
  fn configz_omits_oidc_secrets() {
    let ops = OpsState::new();
    let config = GatewayConfig {
      oidc: Some(crate::auth::OidcSettings {
        issuer: "https://issuer.test".to_owned(),
        audience: "rclwebd".to_owned(),
        hs_secret: Some(b"super-secret-value".to_vec()),
        jwks: None,
      }),
      auth_mode: crate::auth::AuthMode::Oidc,
      ..GatewayConfig::default()
    };
    let json = configz_json(&config, &ops);
    assert!(json.contains("https://issuer.test"));
    assert!(json.contains("\"has_hs_secret\":true"));
    assert!(!json.contains("super-secret-value"));
    assert!(json.contains("\"audit_sink\":\"stderr\""));
    assert!(json.contains("\"audit_integrity\":\"n/a\""));
    assert!(!json.contains("\"event\":\"authenticate\""));
  }

  #[test]
  fn metrics_exposes_session_gauges() {
    let ops = Arc::new(OpsState::new());
    let config = GatewayConfig::default();
    let text = metrics_text(&config, &ops);
    assert!(text.contains("rclwebd_payload_copies_total"));
    assert!(text.contains("rclwebd_sessions 0"));
    assert!(text.contains("rclwebd_draining 0"));
    let _guard = ops.session_guard();
    ops.begin_drain();
    let text = metrics_text(&config, &ops);
    assert!(text.contains("rclwebd_sessions 1"));
    assert!(text.contains("rclwebd_draining 1"));
    assert!(text.contains("rclwebd_audit_events_total 0"));
    assert!(text.contains("rclwebd_audit_write_errors_total 0"));
  }

  #[test]
  fn cors_allow_star_or_exact() {
    assert_eq!(cors_allow_origin(&[], Some("https://a.example")), None);
    assert_eq!(
      cors_allow_origin(&["*".to_owned()], Some("https://a.example")),
      Some("*".to_owned())
    );
    assert_eq!(
      cors_allow_origin(&["https://a.example".to_owned()], Some("https://a.example")),
      Some("https://a.example".to_owned())
    );
    assert_eq!(
      cors_allow_origin(&["https://a.example".to_owned()], Some("https://b.example")),
      None
    );
  }
}
