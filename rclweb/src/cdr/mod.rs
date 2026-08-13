//! CDR1 codec: encapsulation, endianness, alignment, primitives, strings,
//! ROS legacy wstrings, sequences, nesting, and typed faults.
//!
//! Authoritative contract: [`docs/runtime/cdr.md`](../../../docs/runtime/cdr.md).
//! Corpus gate: `rclweb/tests/cdr_corpus.rs` and `cdr_adversarial.rs`.
//! PointCloud2 borrowed views: [`point_cloud2`] (R2-02).

mod error;
mod limits;
pub mod point_cloud2;
mod reader;
mod writer;

pub use error::{CdrError, CdrErrorCode};
pub use limits::{
  BODY_ORIGIN, CdrEndian, CdrLimits, DEFAULT_MAX_NESTING_DEPTH, DEFAULT_MAX_STREAM_BYTES,
  DEFAULT_MAX_TEMPORARY_ALLOCATION, HEADER_LENGTH, MIN_MAX_NESTING_DEPTH, MIN_MAX_STREAM_BYTES,
  REPRESENTATION_CDR_BE, REPRESENTATION_CDR_LE, WRITER_INITIAL_SIZE_HINT,
};
pub use point_cloud2::{
  Header as PointCloud2Header, PointCloud2View, PointField, SENSOR_MSGS_POINT_CLOUD2,
  build_synthetic_xyz_cdr, decode_point_cloud2, decode_point_cloud2_le, encode_point_cloud2,
  encode_point_cloud2_from_sdk_meta, encode_point_cloud2_le,
};
pub use reader::{CdrHeader, CdrNesting, CdrReader};
pub use writer::CdrWriter;

#[cfg(test)]
mod tests;
