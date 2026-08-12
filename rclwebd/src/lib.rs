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

pub mod backend;
pub mod config;
pub mod connection;
pub mod control;
pub mod qos;
#[cfg(feature = "ros")]
pub mod ros;
pub mod ws;

pub use backend::{BackendError, ChannelSpec, EntityId, RosBackend, SubscriptionSample};
pub use config::GatewayConfig;
pub use connection::{Transport, TransportError, run_connection};
pub use ws::{router, serve};

#[cfg(test)]
mod tests {
    #[test]
    fn crate_identity() {
        assert_eq!(env!("CARGO_PKG_NAME"), "rclwebd");
        assert_eq!(env!("CARGO_PKG_VERSION"), "0.0.0");
    }

    #[test]
    fn core_reachable() {
        assert_eq!(rclweb::DEFAULT_SELECTED_VERSION, 0);
    }
}
