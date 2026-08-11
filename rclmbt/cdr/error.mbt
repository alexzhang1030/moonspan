///|
/// Stable CDR codec fault codes (docs/runtime/cdr.md).
pub const CODE_INVALID_ENCAPSULATION : String = "invalid_encapsulation"

///|
pub const CODE_UNSUPPORTED_REPRESENTATION : String = "unsupported_representation"

///|
pub const CODE_INVALID_LIMITS : String = "invalid_limits"

///|
pub const CODE_TRUNCATED : String = "truncated"

///|
pub const CODE_INVALID_BOOLEAN : String = "invalid_boolean"

///|
pub const CODE_INVALID_UTF8 : String = "invalid_utf8"

///|
pub const CODE_INVALID_WSTRING_SCALAR : String = "invalid_wstring_scalar"

///|
pub const CODE_MISSING_STRING_TERMINATOR : String = "missing_string_terminator"

///|
pub const CODE_BOUNDS_EXCEEDED : String = "bounds_exceeded"

///|
pub const CODE_LENGTH_OVERFLOW : String = "length_overflow"

///|
pub const CODE_ALIGNMENT_OVERFLOW : String = "alignment_overflow"

///|
pub const CODE_TRAILING_DATA : String = "trailing_data"

///|
/// Structured CDR fault. All fields are public and readable across packages.
/// Callers match `code` and numeric fields only.
///
/// Numeric convention: `needed` = requested/required size;
/// `remaining` = available capacity.
/// - `offset`: absolute fault site (field-start on failed field reads; `0` for open/config).
/// - `needed`: requested input length, computed span/alloc size, header length, or
///   rejected limit value for `invalid_limits`.
/// - `remaining`: stream capacity, alloc capacity, or bytes remaining at the fault site.
pub struct CdrError {
  /// Stable fault code from the CDR taxonomy.
  code : String
  /// Absolute byte offset of the fault.
  offset : Int
  /// Requested or required size.
  needed : Int
  /// Available capacity at the fault site.
  remaining : Int
}

///|
pub fn CdrError::new(
  code : String,
  offset : Int,
  needed : Int,
  remaining : Int,
) -> CdrError {
  { code, offset, needed, remaining }
}

///|
pub fn CdrError::invalid_encapsulation(
  offset : Int,
  needed : Int,
  remaining : Int,
) -> CdrError {
  CdrError::new(CODE_INVALID_ENCAPSULATION, offset, needed, remaining)
}

///|
pub fn CdrError::unsupported_representation(
  offset : Int,
  remaining : Int,
) -> CdrError {
  CdrError::new(CODE_UNSUPPORTED_REPRESENTATION, offset, 0, remaining)
}

///|
/// `needed` is the rejected limit field value; `remaining` is the peer constraint.
pub fn CdrError::invalid_limits(needed : Int, remaining : Int) -> CdrError {
  CdrError::new(CODE_INVALID_LIMITS, 0, needed, remaining)
}

///|
pub fn CdrError::truncated(
  offset : Int,
  needed : Int,
  remaining : Int,
) -> CdrError {
  CdrError::new(CODE_TRUNCATED, offset, needed, remaining)
}

///|
pub fn CdrError::bounds_exceeded(
  offset : Int,
  needed : Int,
  remaining : Int,
) -> CdrError {
  CdrError::new(CODE_BOUNDS_EXCEEDED, offset, needed, remaining)
}

///|
pub fn CdrError::length_overflow(
  offset : Int,
  needed : Int,
  remaining : Int,
) -> CdrError {
  CdrError::new(CODE_LENGTH_OVERFLOW, offset, needed, remaining)
}

///|
pub fn CdrError::alignment_overflow(
  offset : Int,
  needed : Int,
  remaining : Int,
) -> CdrError {
  CdrError::new(CODE_ALIGNMENT_OVERFLOW, offset, needed, remaining)
}

///|
pub fn CdrError::trailing_data(offset : Int, remaining : Int) -> CdrError {
  CdrError::new(CODE_TRAILING_DATA, offset, 0, remaining)
}
