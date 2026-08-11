//! R2WP v0 protocol parsers for `rclwebd`.
//!
//! M0-03f1 ships bootstrap + deterministic CBOR. Frame/TLV/control parsers land
//! in later f-batches.

pub mod bootstrap;
pub mod cbor;
pub mod error;

pub use bootstrap::{
    BOOTSTRAP_PAYLOAD_MAX_BYTES, BOOTSTRAP_PREFIX_LENGTH, BootstrapErrorRecord, BootstrapRecord,
    BufferCapabilities, ClientHello, EffectiveLimits, RequestedLimits, ServerHello,
    TransportCapabilities, parse_bootstrap,
};
pub use cbor::{
    CborError, CborValue, MAX_MAP_ENTRIES, MAX_NESTING_DEPTH, decode_deterministic_cbor,
};
pub use error::ProtocolError;

#[cfg(test)]
mod tests;
