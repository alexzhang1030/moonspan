//! Edge gateway crate for Moonspan (`rclwebd`).
//!
//! M0-03f1 exports the R2WP v0 bootstrap parser and deterministic CBOR decoder
//! under [`protocol`]. Frame/TLV/control parsers arrive in later f-batches.

#![forbid(unsafe_code)]

pub mod protocol;

pub use protocol::{
    BOOTSTRAP_PAYLOAD_MAX_BYTES, BOOTSTRAP_PREFIX_LENGTH, BootstrapErrorRecord, BootstrapRecord,
    BufferCapabilities, CborError, CborValue, ClientHello, EffectiveLimits, MAX_MAP_ENTRIES,
    MAX_NESTING_DEPTH, ProtocolError, RequestedLimits, ServerHello, TransportCapabilities,
    decode_deterministic_cbor, parse_bootstrap,
};

#[cfg(test)]
mod tests {
    #[test]
    fn crate_identity() {
        assert_eq!(env!("CARGO_PKG_NAME"), "rclwebd");
        assert_eq!(env!("CARGO_PKG_VERSION"), "0.0.0");
    }
}
