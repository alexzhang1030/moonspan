//! R2WP v0 protocol parsers: bootstrap, deterministic CBOR, extension TLVs,
//! CONTROL_CBOR shape, and selected-frame validation steps 1–16.

pub mod bootstrap;
pub mod cbor;
pub mod control;
pub mod error;
pub mod extension;
pub mod frame;

pub use bootstrap::{
    BOOTSTRAP_PAYLOAD_MAX_BYTES, BOOTSTRAP_PREFIX_LENGTH, BootstrapErrorRecord, BootstrapRecord,
    BufferCapabilities, ClientHello, EffectiveLimits, RequestedLimits, ServerHello,
    TransportCapabilities, parse_bootstrap,
};
pub use cbor::{
    CborError, CborValue, MAX_MAP_ENTRIES, MAX_NESTING_DEPTH, decode_deterministic_cbor,
};
pub use control::{
    CONTROL_KIND_AUTHENTICATE, CONTROL_KIND_CHANNEL_READY, CONTROL_KIND_CLOCK_SYNC,
    CONTROL_KIND_CLOSE_CHANNEL, CONTROL_KIND_ERROR, CONTROL_KIND_GRAPH_DELTA,
    CONTROL_KIND_GRAPH_SNAPSHOT, CONTROL_KIND_HEARTBEAT, CONTROL_KIND_NAMES,
    CONTROL_KIND_OPEN_CHANNEL, CONTROL_KIND_SCHEMA_ADVERTISE, CONTROL_KIND_SCHEMA_REQUEST,
    CONTROL_KIND_SCHEMA_RESPONSE, CONTROL_KIND_SESSION_READY, CONTROL_KIND_SESSION_RESUME,
    CONTROL_KIND_SESSION_RESUME_RESULT, CONTROL_PAYLOAD_MAX_BYTES, ControlMessage,
    decode_control_message, validate_control_message,
};
pub use error::ProtocolError;
pub use extension::{
    EXTENSION_AREA_MAX_BYTES, OPERATION_ID_EXTENSION_TYPE, R2wpExtension,
    TRACE_CONTEXT_EXTENSION_TYPE, decode_extension_area,
};
pub use frame::{
    DEFAULT_SELECTED_VERSION, DecodedFrame, FRAME_HEADER_LENGTH, FRAME_PAYLOAD_MAX_BYTES,
    FrameOptions, FramePayload, OPCODE_CONTROL_CBOR, OPCODE_MEDIA_CHUNK, OPCODE_ROS_SAMPLE,
    parse_frame,
};

#[cfg(test)]
mod tests;
