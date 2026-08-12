//! Generated types and dual-scheme Phase 1 schema registry.
//!
//! Contract: [docs/runtime/generated-types.md](../../docs/runtime/generated-types.md).
//!
//! Metadata under `rclweb/generated/metadata/` is compile-time embedded. Schema
//! *exchange* (SchemaRequest/Response/Advertise) remains lightly parked in the
//! session SM; this module owns local lookup used before channel activation.

pub mod error;
pub mod generated;
pub mod key;
pub mod limits;
pub mod registry;

#[cfg(test)]
mod tests;

pub use error::{SchemaError, SchemaErrorCode};
pub use generated::{
  COLLECTIONS_TYPE_NAME, Collections, ECHO_NESTED_REQUEST_TYPE_NAME,
  ECHO_NESTED_RESPONSE_TYPE_NAME, EchoNestedRequest, EchoNestedResponse,
  MEASURE_SEQUENCE_FEEDBACK_TYPE_NAME, MEASURE_SEQUENCE_GOAL_TYPE_NAME,
  MEASURE_SEQUENCE_RESULT_TYPE_NAME, MeasureSequenceFeedback, MeasureSequenceGoal,
  MeasureSequenceResult, NESTED_SAMPLE_TYPE_NAME, NestedSample, PHASE1_ROOT_TYPE_NAMES,
  POINT_CLOUD2_TYPE_NAME, PRIMITIVE_SCALARS_TYPE_NAME, PointCloud2, PrimitiveScalars, Time,
};
pub use key::{SCHEME_MOONSPAN_SCHEMA_V1, SCHEME_REP2011_RIHS, SchemaKey};
pub use limits::{ENCODING_CDR1, PHASE1_SCHEMA_GENERATION};
pub use registry::{
  CdrRepresentation, LookupResult, SchemaRegistry, SchemaRegistryBuilder,
  WIRE_ERROR_SCHEMA_UNAVAILABLE, lookup_phase1_root_for_open, schema_identity_for_type,
};
