//! rclweb core: the browser client library for ROS 2 over R2WP.
//!
//! One codebase serves both sides of the wire: the gateway (`rclwebd`) links
//! this crate natively, and the browser runtime is this crate compiled to
//! `wasm32`. R2WP v0 framing, deterministic CBOR, and control parsing live
//! here today; the CDR codecs and session/channel state machines land in R1
//! (see `docs/proposals/architecture-restructure.md`).

#![forbid(unsafe_code)]

pub mod protocol;

pub use protocol::{
    BOOTSTRAP_PAYLOAD_MAX_BYTES, BOOTSTRAP_PREFIX_LENGTH, BootstrapErrorRecord, BootstrapRecord,
    BufferCapabilities, CONTROL_KIND_NAMES, CONTROL_PAYLOAD_MAX_BYTES, CborError, CborValue,
    ClientHello, ControlMessage, DEFAULT_SELECTED_VERSION, DecodedFrame, EXTENSION_AREA_MAX_BYTES,
    EffectiveLimits, FRAME_HEADER_LENGTH, FRAME_PAYLOAD_MAX_BYTES, FrameOptions, FramePayload,
    MAX_MAP_ENTRIES, MAX_NESTING_DEPTH, OPCODE_CONTROL_CBOR, OPCODE_MEDIA_CHUNK, OPCODE_ROS_SAMPLE,
    OPERATION_ID_EXTENSION_TYPE, ProtocolError, R2wpExtension, RequestedLimits, ServerHello,
    TRACE_CONTEXT_EXTENSION_TYPE, TransportCapabilities, decode_control_message,
    decode_deterministic_cbor, decode_extension_area, parse_bootstrap, parse_frame,
    validate_control_message,
};

#[cfg(test)]
mod tests {
    #[test]
    fn crate_identity() {
        assert_eq!(env!("CARGO_PKG_NAME"), "rclweb");
        assert_eq!(env!("CARGO_PKG_VERSION"), "0.0.0");
    }
}
