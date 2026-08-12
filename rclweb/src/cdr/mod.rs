//! CDR1 codec: encapsulation, endianness, alignment, primitives, strings,
//! ROS legacy wstrings, sequences, nesting, and typed faults.
//!
//! Authoritative contract: [`docs/runtime/cdr.md`](../../../docs/runtime/cdr.md).
//! Corpus gate: `rclweb/tests/cdr_corpus.rs` and `cdr_adversarial.rs`.

mod error;
mod limits;
mod reader;
mod writer;

pub use error::{CdrError, CdrErrorCode};
pub use limits::{
    BODY_ORIGIN, CdrEndian, CdrLimits, DEFAULT_MAX_NESTING_DEPTH, DEFAULT_MAX_STREAM_BYTES,
    DEFAULT_MAX_TEMPORARY_ALLOCATION, HEADER_LENGTH, MIN_MAX_NESTING_DEPTH, MIN_MAX_STREAM_BYTES,
    REPRESENTATION_CDR_BE, REPRESENTATION_CDR_LE, WRITER_INITIAL_SIZE_HINT,
};
pub use reader::{CdrHeader, CdrNesting, CdrReader};
pub use writer::CdrWriter;

#[cfg(test)]
mod tests;
