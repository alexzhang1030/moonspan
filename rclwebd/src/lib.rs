//! Edge gateway crate for rclweb (`rclwebd`).
//!
//! The gateway links the shared [`rclweb`] core for R2WP parsing/encoding and
//! adds the R1 walking-skeleton surface: the binary WebSocket endpoint
//! (tokio/axum) and the serialized-only rcl attachment
//! (see `docs/gateway/rclwebd.md`).
//!
//! Unsafe code is confined to the `ros::ffi` boundary (`feature = "ros"`);
//! everything else keeps the workspace `deny(unsafe_code)` discipline.

#![deny(unsafe_code)]

pub mod acl;
pub mod adapter;
pub mod auth;
pub mod backend;
pub mod budgets;
pub mod config;
pub mod connection;
pub mod control;
pub mod local_dev_tls;
pub mod ops;
pub mod qos;
#[cfg(feature = "ros")]
pub mod ros;
pub mod telemetry;
pub mod ws;
pub mod wt;

pub use acl::{AclMode, AclOperation, AclPolicy, AclRule, PERMISSION_DENIED};
pub use auth::{AUTHENTICATION_FAILED, AuthMode, AuthResult, OidcSettings, mint_hs256_token};
pub use backend::{
  ActionInbound, BackendError, ChannelSpec, EntityId, GraphEndpointInfo, GraphNodeInfo, GraphView,
  RosBackend, ServiceRequest, SubscriptionSample,
};
pub use budgets::{Disposition, DispositionCounters, SampleWriteQueue};
pub use config::{
  ActiveTransport, GatewayConfig, SUPPORT_ROW_H_CY, SUPPORT_ROW_H_FT, SUPPORT_ROW_H_ZN,
  SUPPORT_ROW_J_CY, SUPPORT_ROW_J_FT, SUPPORT_ROW_J_ZN, SupportRow, detect_support_row,
  parse_support_row, support_row_from_env,
};
pub use connection::{Transport, TransportError, run_connection};
pub use local_dev_tls::{LocalDevTls, TlsAdvertisement};
pub use ops::OpsState;
pub use telemetry::{GatewayTelemetry, GatewayTelemetrySnapshot, PROCESS_TELEMETRY};
pub use ws::{router, serve, serve_with_os_signals};

#[cfg(test)]
mod tests {
  #[test]
  fn crate_identity() {
    assert_eq!(env!("CARGO_PKG_NAME"), "rclwebd");
    assert_eq!(env!("CARGO_PKG_VERSION"), "0.0.5");
  }

  #[test]
  fn core_reachable() {
    assert_eq!(rclweb::DEFAULT_SELECTED_VERSION, 0);
  }
}
