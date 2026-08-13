//! rclweb core: the browser client library for ROS 2 over R2WP.
//!
//! One codebase serves both sides of the wire: the gateway (`rclwebd`) links
//! this crate natively, and the browser runtime is this crate compiled to
//! `wasm32`. R2WP v0 framing, deterministic CBOR, control parsing, the CDR
//! codecs (R1-01), the session/channel state machine (R1-02), the client
//! connection engine, and the host poll ABI (R1-04) live here.

#![deny(unsafe_code)]

pub mod cdr;
pub mod engine;
pub mod host;
pub mod protocol;
pub mod session;
pub mod types;

pub use cdr::{
  BODY_ORIGIN, CdrEndian, CdrError, CdrErrorCode, CdrHeader, CdrLimits, CdrNesting, CdrReader,
  CdrWriter, DEFAULT_MAX_NESTING_DEPTH, DEFAULT_MAX_STREAM_BYTES, DEFAULT_MAX_TEMPORARY_ALLOCATION,
  HEADER_LENGTH, MIN_MAX_NESTING_DEPTH, MIN_MAX_STREAM_BYTES, PointCloud2Header, PointCloud2View,
  PointField, REPRESENTATION_CDR_BE, REPRESENTATION_CDR_LE, SENSOR_MSGS_POINT_CLOUD2,
  WRITER_INITIAL_SIZE_HINT, build_synthetic_xyz_cdr, decode_point_cloud2, decode_point_cloud2_le,
  encode_point_cloud2, encode_point_cloud2_from_sdk_meta, encode_point_cloud2_le,
  point_cloud2_host_meta_len, write_point_cloud2_host_meta,
};
pub use engine::{
  AppCommand, AppEvent, ClientEngine, DEFAULT_QOS_DEPTH, DEMO_BUNDLE_HASH, DEMO_SCHEMA_HASH,
  EngineTelemetry, HostEvent, MAX_HOST_EVENTS_PER_POLL, MAX_OUTBOUND_PER_POLL, OutboundMessage,
  PollOutcome, ReleasedBuffer, STD_MSGS_STRING, ZERO_CORRELATION, authenticate, close_channel,
  heartbeat, open_action, open_service, open_topic, resolve_open_schema_identity,
  schema_scheme_for_support_row,
};
pub use host::{
  BATCH_MAGIC, BatchError, LAYOUT_VERSION, RESULT_MAGIC, decode_host_batch,
  encode_host_batch_inline, encode_poll_result,
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
  EXTENSION_AREA_MAX_BYTES, EffectiveLimits, EncodeError, FLAG_ROS_RELIABLE, FRAME_HEADER_LENGTH,
  FRAME_PAYLOAD_MAX_BYTES, FrameHeader, FrameOptions, FramePayload, MAX_MAP_ENTRIES,
  MAX_NESTING_DEPTH, OPCODE_ACTION_CANCEL, OPCODE_ACTION_FEEDBACK, OPCODE_ACTION_GOAL,
  OPCODE_ACTION_RESULT, OPCODE_ACTION_STATUS, OPCODE_CONTROL_CBOR, OPCODE_MEDIA_CHUNK,
  OPCODE_ROS_SAMPLE, OPCODE_SERVICE_REQUEST, OPCODE_SERVICE_RESPONSE, OPERATION_ID_EXTENSION_TYPE,
  ProtocolError, R2wpExtension, RequestedLimits, ServerHello, TRACE_CONTEXT_EXTENSION_TYPE,
  TransportCapabilities, decode_control_message, decode_deterministic_cbor, decode_extension_area,
  encode_bootstrap_error, encode_client_hello, encode_control_frame, encode_deterministic_cbor,
  encode_extension_area, encode_frame, encode_server_hello, parse_bootstrap, parse_frame,
  validate_control_message, write_frame_header,
};
pub use session::{
  ChannelEntry, ChannelResult, ChannelState, ChannelTable, OperationKind, Role, Session,
  SessionEffects, SessionPhase,
};
pub use types::{
  CdrRepresentation, Collections, ENCODING_CDR1, EchoNestedRequest, EchoNestedResponse,
  LookupResult, MeasureSequenceFeedback, MeasureSequenceGoal, MeasureSequenceResult, NestedSample,
  PHASE1_ROOT_TYPE_NAMES, PHASE1_SCHEMA_GENERATION, PointCloud2, PrimitiveScalars,
  SCHEME_RCLWEB_SCHEMA_V1, SCHEME_REP2011_RIHS, SchemaError, SchemaErrorCode, SchemaKey,
  SchemaRegistry, SchemaRegistryBuilder, Time, WIRE_ERROR_SCHEMA_UNAVAILABLE,
  lookup_phase1_root_for_open, schema_identity_for_type,
};

#[cfg(test)]
mod tests {
  #[test]
  fn crate_identity() {
    assert_eq!(env!("CARGO_PKG_NAME"), "rclweb");
    assert_eq!(env!("CARGO_PKG_VERSION"), "0.0.1");
  }
}
