//! rclweb core: the browser client library for ROS 2 over R2WP.
//!
//! One codebase serves both sides of the wire: the gateway (`rclwebd`) links
//! this crate natively, and the browser runtime is this crate compiled to
//! `wasm32`. R2WP v0 framing, deterministic CBOR, control parsing, the CDR
//! codecs (R1-01), and the session/channel state machine (R1-02) live here.
//! Host poll ABI and gateway transport land in later R1 tasks
//! (see `docs/proposals/architecture-restructure.md`).

#![forbid(unsafe_code)]

pub mod cdr;
pub mod protocol;
pub mod session;

pub use cdr::{
    BODY_ORIGIN, CdrEndian, CdrError, CdrErrorCode, CdrHeader, CdrLimits, CdrNesting, CdrReader,
    CdrWriter, DEFAULT_MAX_NESTING_DEPTH, DEFAULT_MAX_STREAM_BYTES,
    DEFAULT_MAX_TEMPORARY_ALLOCATION, HEADER_LENGTH, MIN_MAX_NESTING_DEPTH, MIN_MAX_STREAM_BYTES,
    REPRESENTATION_CDR_BE, REPRESENTATION_CDR_LE, WRITER_INITIAL_SIZE_HINT,
};
pub use protocol::{
    BOOTSTRAP_PAYLOAD_MAX_BYTES, BOOTSTRAP_PREFIX_LENGTH, BootstrapErrorRecord, BootstrapRecord,
    BufferCapabilities, CONTROL_KIND_AUTHENTICATE, CONTROL_KIND_CHANNEL_READY,
    CONTROL_KIND_CLOCK_SYNC, CONTROL_KIND_CLOSE_CHANNEL, CONTROL_KIND_ERROR,
    CONTROL_KIND_GRAPH_DELTA, CONTROL_KIND_GRAPH_SNAPSHOT, CONTROL_KIND_HEARTBEAT,
    CONTROL_KIND_NAMES, CONTROL_KIND_OPEN_CHANNEL, CONTROL_KIND_SCHEMA_ADVERTISE,
    CONTROL_KIND_SCHEMA_REQUEST, CONTROL_KIND_SCHEMA_RESPONSE, CONTROL_KIND_SESSION_READY,
    CONTROL_KIND_SESSION_RESUME, CONTROL_KIND_SESSION_RESUME_RESULT, CONTROL_PAYLOAD_MAX_BYTES,
    CborError, CborValue, ClientHello, ControlMessage, DEFAULT_SELECTED_VERSION, DecodedFrame,
    EXTENSION_AREA_MAX_BYTES, EffectiveLimits, FRAME_HEADER_LENGTH, FRAME_PAYLOAD_MAX_BYTES,
    FrameOptions, FramePayload, MAX_MAP_ENTRIES, MAX_NESTING_DEPTH, OPCODE_CONTROL_CBOR,
    OPCODE_MEDIA_CHUNK, OPCODE_ROS_SAMPLE, OPERATION_ID_EXTENSION_TYPE, ProtocolError,
    R2wpExtension, RequestedLimits, ServerHello, TRACE_CONTEXT_EXTENSION_TYPE,
    TransportCapabilities, decode_control_message, decode_deterministic_cbor,
    decode_extension_area, parse_bootstrap, parse_frame, validate_control_message,
};
pub use session::{
    ChannelEntry, ChannelResult, ChannelState, ChannelTable, OperationKind, Role, Session,
    SessionEffects, SessionPhase,
};

#[cfg(test)]
mod tests {
    #[test]
    fn crate_identity() {
        assert_eq!(env!("CARGO_PKG_NAME"), "rclweb");
        assert_eq!(env!("CARGO_PKG_VERSION"), "0.0.0");
    }
}
