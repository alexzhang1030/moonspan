//! Edge gateway crate for Moonspan (`rclwebd`).
//!
//! The public API stays empty until M1 gateway work lands. Workspace smoke
//! coverage uses crate-identity unit tests only.

#![forbid(unsafe_code)]

#[cfg(test)]
mod tests {
    #[test]
    fn crate_identity() {
        assert_eq!(env!("CARGO_PKG_NAME"), "rclwebd");
        assert_eq!(env!("CARGO_PKG_VERSION"), "0.0.0");
    }
}
