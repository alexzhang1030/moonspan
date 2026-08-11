///|
/// Default / absolute Phase 1 maximum stream bytes (R2WP frame payload ceiling, 64 MiB).
pub const DEFAULT_MAX_STREAM_BYTES : Int = 67108864

///|
/// Default / absolute Phase 1 maximum nesting depth.
pub const DEFAULT_MAX_NESTING_DEPTH : Int = 64

///|
/// Default maximum temporary allocation per codec operation (matches stream ceiling).
pub const DEFAULT_MAX_TEMPORARY_ALLOCATION : Int = 67108864

///|
/// Minimum accepted `max_stream_bytes` (encapsulation header length).
pub const MIN_MAX_STREAM_BYTES : Int = 4

///|
/// Minimum accepted `max_nesting_depth`.
pub const MIN_MAX_NESTING_DEPTH : Int = 1

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
/// Stream byte order from the encapsulation representation identifier.
pub enum CdrEndian {
  Big
  Little
}

///|
/// Codec resource ceilings for one encode or decode.
/// Defaults are absolute Phase 1 ceilings; construction validates ranges.
pub struct CdrLimits {
  /// Maximum accepted input/output stream length in bytes (`4..=67108864`).
  max_stream_bytes : Int
  /// Maximum nesting depth for nested structures and containers (`1..=64`).
  max_nesting_depth : Int
  /// Maximum owned temporary allocation for a single codec operation
  /// (`0..=max_stream_bytes`). Borrowed `BytesView` spans use stream bounds.
  max_temporary_allocation : Int
}

///|
/// Frozen M1-01b defaults at the absolute Phase 1 ceilings: stream and temporary
/// match R2WP `frame_payload_max_bytes` (64 MiB); depth 64 bounds recursion with
/// headroom for generated ROS schemas. Per-field type bounds remain M1-02 inputs.
pub fn CdrLimits::defaults() -> CdrLimits {
  {
    max_stream_bytes: DEFAULT_MAX_STREAM_BYTES,
    max_nesting_depth: DEFAULT_MAX_NESTING_DEPTH,
    max_temporary_allocation: DEFAULT_MAX_TEMPORARY_ALLOCATION,
  }
}

///|
/// Construct validated limits. Returns `invalid_limits` when a value is outside
/// the absolute Phase 1 ranges.
pub fn CdrLimits::new(
  max_stream_bytes : Int,
  max_nesting_depth : Int,
  max_temporary_allocation : Int,
) -> Result[CdrLimits, CdrError] {
  if max_stream_bytes < MIN_MAX_STREAM_BYTES ||
    max_stream_bytes > DEFAULT_MAX_STREAM_BYTES {
    return Err(
      CdrError::invalid_limits(max_stream_bytes, DEFAULT_MAX_STREAM_BYTES),
    )
  }
  if max_nesting_depth < MIN_MAX_NESTING_DEPTH ||
    max_nesting_depth > DEFAULT_MAX_NESTING_DEPTH {
    return Err(
      CdrError::invalid_limits(max_nesting_depth, DEFAULT_MAX_NESTING_DEPTH),
    )
  }
  if max_temporary_allocation < 0 || max_temporary_allocation > max_stream_bytes {
    return Err(
      CdrError::invalid_limits(max_temporary_allocation, max_stream_bytes),
    )
  }
  Ok({ max_stream_bytes, max_nesting_depth, max_temporary_allocation })
}
