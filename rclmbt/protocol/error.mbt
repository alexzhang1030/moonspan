///|
/// Stable R2WP protocol error surface for multi-language agreement.
/// Fields support direct agreement comparison across parsers.
pub struct ProtocolError {
  /// Registry numeric error code.
  code : Int
  /// Stable registry error name.
  name : String
  /// Stable implementation reason token.
  reason : String
  /// Absolute byte offset into the inspected input.
  offset : Int
  /// Validation plane (`bootstrap` or `selected_frame`).
  plane : String
  /// Receiver validation-order step that failed.
  step : Int
}

///|
pub fn ProtocolError::new(
  code : Int,
  name : String,
  reason : String,
  offset : Int,
  plane : String,
  step : Int,
) -> ProtocolError {
  { code, name, reason, offset, plane, step }
}

///|
pub fn ProtocolError::bootstrap(
  code : Int,
  name : String,
  reason : String,
  offset : Int,
  step : Int,
) -> ProtocolError {
  ProtocolError::new(code, name, reason, offset, "bootstrap", step)
}

///|
pub fn ProtocolError::selected_frame(
  code : Int,
  name : String,
  reason : String,
  offset : Int,
  step : Int,
) -> ProtocolError {
  ProtocolError::new(code, name, reason, offset, "selected_frame", step)
}

///|
pub fn ProtocolError::malformed_bootstrap(
  reason : String,
  offset : Int,
  step : Int,
) -> ProtocolError {
  ProtocolError::bootstrap(1, "malformed_bootstrap", reason, offset, step)
}

///|
pub fn ProtocolError::unsupported_version_bootstrap(
  reason : String,
  offset : Int,
  step : Int,
) -> ProtocolError {
  ProtocolError::bootstrap(4, "unsupported_version", reason, offset, step)
}

///|
pub fn ProtocolError::message_too_large_bootstrap(
  reason : String,
  offset : Int,
  step : Int,
) -> ProtocolError {
  ProtocolError::bootstrap(24, "message_too_large", reason, offset, step)
}

///|
/// Alias used by bootstrap step 3.
pub fn ProtocolError::unsupported_version(
  reason : String,
  offset : Int,
  step : Int,
) -> ProtocolError {
  ProtocolError::unsupported_version_bootstrap(reason, offset, step)
}

///|
/// Alias used by bootstrap step 6.
pub fn ProtocolError::message_too_large(
  reason : String,
  offset : Int,
  step : Int,
) -> ProtocolError {
  ProtocolError::message_too_large_bootstrap(reason, offset, step)
}

// --- selected_frame constructors for later frame work ---

///|
pub fn ProtocolError::malformed_frame(
  reason : String,
  offset : Int,
  step : Int,
) -> ProtocolError {
  ProtocolError::selected_frame(3, "malformed_frame", reason, offset, step)
}

///|
pub fn ProtocolError::unsupported_version_frame(
  reason : String,
  offset : Int,
  step : Int,
) -> ProtocolError {
  ProtocolError::selected_frame(4, "unsupported_version", reason, offset, step)
}

///|
pub fn ProtocolError::unsupported_opcode(
  reason : String,
  offset : Int,
  step : Int,
) -> ProtocolError {
  ProtocolError::selected_frame(5, "unsupported_opcode", reason, offset, step)
}

///|
pub fn ProtocolError::unsupported_flags(
  reason : String,
  offset : Int,
  step : Int,
) -> ProtocolError {
  ProtocolError::selected_frame(6, "unsupported_flags", reason, offset, step)
}

///|
pub fn ProtocolError::unsupported_extension(
  reason : String,
  offset : Int,
  step : Int,
) -> ProtocolError {
  ProtocolError::selected_frame(
    22, "unsupported_extension", reason, offset, step,
  )
}

///|
pub fn ProtocolError::invalid_control(
  reason : String,
  offset : Int,
  step : Int,
) -> ProtocolError {
  ProtocolError::selected_frame(23, "invalid_control", reason, offset, step)
}

///|
pub fn ProtocolError::message_too_large_frame(
  reason : String,
  offset : Int,
  step : Int,
) -> ProtocolError {
  ProtocolError::selected_frame(24, "message_too_large", reason, offset, step)
}

///|
pub fn ProtocolError::protocol_violation(
  reason : String,
  offset : Int,
  step : Int,
) -> ProtocolError {
  ProtocolError::selected_frame(25, "protocol_violation", reason, offset, step)
}

///|
pub fn ProtocolError::clock_unavailable(
  reason : String,
  offset : Int,
  step : Int,
) -> ProtocolError {
  ProtocolError::selected_frame(28, "clock_unavailable", reason, offset, step)
}

///|
/// Deterministic CBOR decode failure (control-plane semantic: `invalid_control`).
pub struct CborError {
  reason : String
  offset : Int
}

///|
pub fn CborError::new(reason : String, offset : Int) -> CborError {
  { reason, offset }
}
