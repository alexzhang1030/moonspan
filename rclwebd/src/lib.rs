//! Edge gateway crate for rclweb (`rclwebd`).
//!
//! The gateway links the shared [`rclweb`] core for R2WP parsing and, in R1,
//! adds the WebSocket endpoint and the serialized-only rcl attachment
//! (see `docs/proposals/architecture-restructure.md`).

#![forbid(unsafe_code)]

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
