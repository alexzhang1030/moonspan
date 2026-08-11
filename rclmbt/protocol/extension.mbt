///|
/// R2WP v0 extension area / TLV decoder (selected-frame steps 13–14).

///|
pub const EXTENSION_AREA_MAX_BYTES : Int = 4096

///|
pub const EXTENSION_ALIGNMENT : Int = 4

///|
pub const TRACE_CONTEXT_EXTENSION_TYPE : Int = 1

///|
pub const OPERATION_ID_EXTENSION_TYPE : Int = 2

///|
pub const TRACE_CONTEXT_VALUE_LENGTH : Int = 32

///|
pub const OPERATION_ID_VALUE_LENGTH : Int = 16

///|
const TLV_HEADER_LEN : Int = 4

///|
const FLAG_CRITICAL : Int = 0x01

///|
const FLAG_RESERVED_MASK : Int = 0xfe

///|
const TRACE_RESERVED_OFFSET : Int = 25

///|
const TRACE_RESERVED_SIZE : Int = 7

///|
/// Assigned extension record. Value borrows the extension area input.
pub struct R2wpExtension {
  type_id : Int
  critical : Bool
  value : BytesView
}

///|
/// Extension-area decode error (offsets relative to area start).
pub struct ExtensionError {
  code : Int
  name : String
  reason : String
  offset : Int
}

///|
fn ExtensionError::malformed(reason : String, offset : Int) -> ExtensionError {
  { code: 3, name: "malformed_frame", reason, offset }
}

///|
fn ExtensionError::message_too_large(
  reason : String,
  offset : Int,
) -> ExtensionError {
  { code: 24, name: "message_too_large", reason, offset }
}

///|
fn ExtensionError::unsupported(reason : String, offset : Int) -> ExtensionError {
  { code: 22, name: "unsupported_extension", reason, offset }
}

///|
fn align4(n : Int) -> Int {
  (n + 3) & 0xfffffffc
}

///|
fn ext_read_u16_be(bytes : BytesView, offset : Int) -> Int {
  let hi = bytes[offset].to_int()
  let lo = bytes[offset + 1].to_int()
  (hi << 8) | lo
}

///|
fn is_assigned(type_id : Int) -> Bool {
  type_id == TRACE_CONTEXT_EXTENSION_TYPE ||
  type_id == OPERATION_ID_EXTENSION_TYPE
}

///|
fn fixed_value_len(type_id : Int) -> Int? {
  if type_id == TRACE_CONTEXT_EXTENSION_TYPE {
    Some(TRACE_CONTEXT_VALUE_LENGTH)
  } else if type_id == OPERATION_ID_EXTENSION_TYPE {
    Some(OPERATION_ID_VALUE_LENGTH)
  } else {
    None
  }
}

///|
fn assert_trace_reserved_zero(
  value : BytesView,
  value_offset : Int,
) -> Result[Unit, ExtensionError] {
  let mut i = 0
  while i < TRACE_RESERVED_SIZE {
    if value[TRACE_RESERVED_OFFSET + i].to_int() != 0 {
      return Err(
        ExtensionError::malformed(
          "reserved_nonzero",
          value_offset + TRACE_RESERVED_OFFSET + i,
        ),
      )
    }
    i = i + 1
  }
  Ok(())
}

///|
priv struct ParsedTlv {
  type_id : Int
  critical : Bool
  value : BytesView
  assigned : Bool
}

///|
/// Decode a complete extension area.
/// Structural step 13 runs to completion; unknown-critical step 14 runs only
/// after the full structural pass. Returns assigned types 1 and 2; unknown
/// noncritical TLVs pass structure and are skipped.
pub fn decode_extension_area(
  bytes : BytesView,
) -> Result[Array[R2wpExtension], ExtensionError] {
  let len = bytes.length()
  if len > EXTENSION_AREA_MAX_BYTES {
    return Err(ExtensionError::message_too_large("area_too_large", 0))
  }
  if len % EXTENSION_ALIGNMENT != 0 {
    return Err(ExtensionError::malformed("area_alignment", 0))
  }

  let parsed : Array[ParsedTlv] = []
  let mut offset = 0
  let mut has_prev = false
  let mut prev_type = 0
  let mut has_unknown_critical = false
  let mut first_unknown_critical = 0

  while offset < len {
    let remaining = len - offset
    if remaining < TLV_HEADER_LEN {
      return Err(ExtensionError::malformed("truncated_header", offset))
    }

    let type_id = bytes[offset].to_int()
    let flags = bytes[offset + 1].to_int()
    let value_len = ext_read_u16_be(bytes, offset + 2)

    if (flags & FLAG_RESERVED_MASK) != 0 {
      return Err(ExtensionError::malformed("reserved_flag_bits", offset + 1))
    }
    let critical = (flags & FLAG_CRITICAL) != 0
    let assigned = is_assigned(type_id)

    match fixed_value_len(type_id) {
      Some(expected) =>
        if value_len != expected {
          return Err(
            ExtensionError::malformed("fixed_length_mismatch", offset + 2),
          )
        }
      None => ()
    }

    // Compare against remaining so oversized declared lengths stay total.
    let content_len = TLV_HEADER_LEN + value_len
    if remaining < content_len {
      return Err(
        ExtensionError::malformed("truncated_value", offset + TLV_HEADER_LEN),
      )
    }

    let padded = align4(content_len)
    if remaining < padded {
      return Err(
        ExtensionError::malformed("truncated_padding", offset + content_len),
      )
    }

    let mut p = content_len
    while p < padded {
      if bytes[offset + p].to_int() != 0 {
        return Err(ExtensionError::malformed("nonzero_padding", offset + p))
      }
      p = p + 1
    }

    let value_offset = offset + TLV_HEADER_LEN
    let value = bytes[value_offset:value_offset + value_len]

    if assigned && type_id == TRACE_CONTEXT_EXTENSION_TYPE {
      match assert_trace_reserved_zero(value, value_offset) {
        Ok(_) => ()
        Err(e) => return Err(e)
      }
    }

    if has_prev {
      if type_id == prev_type {
        return Err(ExtensionError::malformed("duplicate_type", offset))
      }
      if type_id < prev_type {
        return Err(ExtensionError::malformed("order_violation", offset))
      }
    }
    has_prev = true
    prev_type = type_id

    if !assigned && critical && !has_unknown_critical {
      has_unknown_critical = true
      first_unknown_critical = offset
    }

    parsed.push({ type_id, critical, value, assigned })
    offset = offset + padded
  }

  if has_unknown_critical {
    return Err(
      ExtensionError::unsupported("unknown_critical", first_unknown_critical),
    )
  }

  let out : Array[R2wpExtension] = []
  for t in parsed {
    if t.assigned {
      out.push({ type_id: t.type_id, critical: t.critical, value: t.value })
    }
  }
  Ok(out)
}

///|
/// Map an extension-area error onto the selected-frame surface (absolute offset).
pub fn map_extension_error(
  err : ExtensionError,
  area_base : Int,
  step : Int,
) -> ProtocolError {
  let offset = area_base + err.offset
  if err.code == 24 {
    ProtocolError::message_too_large_frame("extension_too_large", offset, step)
  } else if err.code == 22 {
    ProtocolError::unsupported_extension("unknown_critical", offset, step)
  } else {
    ProtocolError::malformed_frame("extension_structural", offset, step)
  }
}
