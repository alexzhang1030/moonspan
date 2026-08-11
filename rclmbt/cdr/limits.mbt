///|
/// Default maximum stream bytes: R2WP absolute frame payload ceiling (64 MiB).
pub const DEFAULT_MAX_STREAM_BYTES : Int = 67108864

///|
/// Default maximum nesting depth for generated ROS schemas under a finite bound.
pub const DEFAULT_MAX_NESTING_DEPTH : Int = 64

///|
/// Default maximum temporary allocation per codec operation (matches stream ceiling).
pub const DEFAULT_MAX_TEMPORARY_ALLOCATION : Int = 67108864

///|
/// Absolute body origin after the 4-byte encapsulation header.
pub const BODY_ORIGIN : Int = 4

///|
/// Encapsulation header length in bytes.
pub const HEADER_LENGTH : Int = 4

///|
/// CDR1 little-endian representation identifier (network-order UInt16 value).
pub const REPRESENTATION_CDR_LE : Int = 0x0001

///|
/// CDR1 big-endian representation identifier (network-order UInt16 value).
pub const REPRESENTATION_CDR_BE : Int = 0x0000

///|
/// Codec resource ceilings for one encode or decode.
pub struct CdrLimits {
  /// Maximum accepted input/output stream length in bytes.
  max_stream_bytes : Int
  /// Maximum nesting depth for nested structures and containers.
  max_nesting_depth : Int
  /// Maximum temporary allocation for a single codec operation.
  max_temporary_allocation : Int
}

///|
/// Frozen M1-01b defaults: stream and temporary ceilings match R2WP
/// `frame_payload_max_bytes` (64 MiB); depth 64 bounds recursion with
/// headroom for generated ROS schemas. Per-field type bounds remain M1-02 inputs.
pub fn CdrLimits::defaults() -> CdrLimits {
  {
    max_stream_bytes: DEFAULT_MAX_STREAM_BYTES,
    max_nesting_depth: DEFAULT_MAX_NESTING_DEPTH,
    max_temporary_allocation: DEFAULT_MAX_TEMPORARY_ALLOCATION,
  }
}

///|
pub fn CdrLimits::new(
  max_stream_bytes : Int,
  max_nesting_depth : Int,
  max_temporary_allocation : Int,
) -> CdrLimits {
  { max_stream_bytes, max_nesting_depth, max_temporary_allocation }
}
