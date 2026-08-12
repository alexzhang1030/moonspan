//! Production CDR1 codecs for the nine Phase 1 corpus roots plus shared deps.
//!
//! Models and codecs were promoted from the proven hand-written surface in
//! `rclweb/tests/common/mod.rs`, hardened to return [`CdrError`] (no panic) and
//! to complete top-level samples with `ensure_complete_with_zero_tail`.

pub mod collections;
pub mod echo_nested;
pub mod measure_sequence;
pub mod nested_sample;
pub mod point_cloud2;
pub mod primitive_scalars;
pub mod time;

pub use collections::{Collections, TYPE_NAME as COLLECTIONS_TYPE_NAME};
pub use echo_nested::{
  EchoNestedRequest, EchoNestedResponse, REQUEST_TYPE_NAME as ECHO_NESTED_REQUEST_TYPE_NAME,
  RESPONSE_TYPE_NAME as ECHO_NESTED_RESPONSE_TYPE_NAME,
};
pub use measure_sequence::{
  FEEDBACK_TYPE_NAME as MEASURE_SEQUENCE_FEEDBACK_TYPE_NAME,
  GOAL_TYPE_NAME as MEASURE_SEQUENCE_GOAL_TYPE_NAME, MeasureSequenceFeedback, MeasureSequenceGoal,
  MeasureSequenceResult, RESULT_TYPE_NAME as MEASURE_SEQUENCE_RESULT_TYPE_NAME,
};
pub use nested_sample::{NestedSample, TYPE_NAME as NESTED_SAMPLE_TYPE_NAME};
pub use point_cloud2::{PointCloud2, TYPE_NAME as POINT_CLOUD2_TYPE_NAME};
pub use primitive_scalars::{PrimitiveScalars, TYPE_NAME as PRIMITIVE_SCALARS_TYPE_NAME};
pub use time::Time;

/// The nine Phase 1 registry root type names (sorted).
pub const PHASE1_ROOT_TYPE_NAMES: &[&str] = &[
  "rclweb_cdr_interfaces/action/MeasureSequence_Feedback",
  "rclweb_cdr_interfaces/action/MeasureSequence_Goal",
  "rclweb_cdr_interfaces/action/MeasureSequence_Result",
  "rclweb_cdr_interfaces/msg/Collections",
  "rclweb_cdr_interfaces/msg/NestedSample",
  "rclweb_cdr_interfaces/msg/PrimitiveScalars",
  "rclweb_cdr_interfaces/srv/EchoNested_Request",
  "rclweb_cdr_interfaces/srv/EchoNested_Response",
  "sensor_msgs/msg/PointCloud2",
];
