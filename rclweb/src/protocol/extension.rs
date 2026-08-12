//! R2WP v0 extension area / TLV decoder (selected-frame steps 13–14).

use super::error::ProtocolError;

/// Fixed v0 contract: `absolute_limits.extension_area_max_bytes`.
pub const EXTENSION_AREA_MAX_BYTES: usize = 4096;
/// Fixed v0 contract: extensions.alignment.
pub const EXTENSION_ALIGNMENT: usize = 4;
/// Assigned extension type: TRACE_CONTEXT.
pub const TRACE_CONTEXT_EXTENSION_TYPE: u8 = 1;
/// Assigned extension type: OPERATION_ID.
pub const OPERATION_ID_EXTENSION_TYPE: u8 = 2;
/// Fixed value_len for TRACE_CONTEXT.
pub const TRACE_CONTEXT_VALUE_LENGTH: usize = 32;
/// Fixed value_len for OPERATION_ID.
pub const OPERATION_ID_VALUE_LENGTH: usize = 16;

const TLV_HEADER_LEN: usize = 4;
const FLAG_CRITICAL: u8 = 0x01;
const FLAG_RESERVED_MASK: u8 = 0xfe;
const TRACE_RESERVED_OFFSET: usize = 25;
const TRACE_RESERVED_SIZE: usize = 7;

/// Assigned extension record. Value borrows the extension area input.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct R2wpExtension<'a> {
  pub type_id: u8,
  pub critical: bool,
  pub value: &'a [u8],
}

/// Extension-area decode error (offsets relative to area start).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExtensionError {
  pub code: u32,
  pub name: &'static str,
  pub reason: &'static str,
  pub offset: usize,
}

impl ExtensionError {
  fn malformed(reason: &'static str, offset: usize) -> Self {
    Self { code: 3, name: "malformed_frame", reason, offset }
  }

  fn message_too_large(reason: &'static str, offset: usize) -> Self {
    Self { code: 24, name: "message_too_large", reason, offset }
  }

  fn unsupported(reason: &'static str, offset: usize) -> Self {
    Self { code: 22, name: "unsupported_extension", reason, offset }
  }
}

fn align4(n: usize) -> usize {
  (n + 3) & !3
}

fn read_u16_be(bytes: &[u8], offset: usize) -> u16 {
  u16::from_be_bytes([bytes[offset], bytes[offset + 1]])
}

fn is_assigned(type_id: u8) -> bool {
  type_id == TRACE_CONTEXT_EXTENSION_TYPE || type_id == OPERATION_ID_EXTENSION_TYPE
}

fn fixed_value_len(type_id: u8) -> Option<usize> {
  match type_id {
    TRACE_CONTEXT_EXTENSION_TYPE => Some(TRACE_CONTEXT_VALUE_LENGTH),
    OPERATION_ID_EXTENSION_TYPE => Some(OPERATION_ID_VALUE_LENGTH),
    _ => None,
  }
}

fn assert_trace_reserved_zero(value: &[u8], value_offset: usize) -> Result<(), ExtensionError> {
  for i in 0..TRACE_RESERVED_SIZE {
    if value[TRACE_RESERVED_OFFSET + i] != 0 {
      return Err(ExtensionError::malformed(
        "reserved_nonzero",
        value_offset + TRACE_RESERVED_OFFSET + i,
      ));
    }
  }
  Ok(())
}

struct ParsedTlv<'a> {
  type_id: u8,
  critical: bool,
  value: &'a [u8],
  assigned: bool,
}

/// Decode a complete extension area.
///
/// Structural step 13 runs to completion; unknown-critical step 14 runs only after
/// the full structural pass. Returns assigned types 1 and 2; unknown noncritical
/// TLVs pass structure and are skipped.
pub fn decode_extension_area(bytes: &[u8]) -> Result<Vec<R2wpExtension<'_>>, ExtensionError> {
  let len = bytes.len();
  if len > EXTENSION_AREA_MAX_BYTES {
    return Err(ExtensionError::message_too_large("area_too_large", 0));
  }
  if !len.is_multiple_of(EXTENSION_ALIGNMENT) {
    return Err(ExtensionError::malformed("area_alignment", 0));
  }

  let mut parsed = Vec::new();
  let mut offset = 0usize;
  let mut prev_type: Option<u8> = None;
  let mut first_unknown_critical: Option<usize> = None;

  while offset < len {
    let remaining = len - offset;
    if remaining < TLV_HEADER_LEN {
      return Err(ExtensionError::malformed("truncated_header", offset));
    }

    let type_id = bytes[offset];
    let flags = bytes[offset + 1];
    let value_len = read_u16_be(bytes, offset + 2) as usize;

    if flags & FLAG_RESERVED_MASK != 0 {
      return Err(ExtensionError::malformed("reserved_flag_bits", offset + 1));
    }
    let critical = flags & FLAG_CRITICAL != 0;
    let assigned = is_assigned(type_id);

    if let Some(expected) = fixed_value_len(type_id)
      && value_len != expected
    {
      return Err(ExtensionError::malformed("fixed_length_mismatch", offset + 2));
    }

    // Compare against `remaining` so oversized declared lengths stay total
    // under usize arithmetic.
    let content_len = TLV_HEADER_LEN.saturating_add(value_len);
    if remaining < content_len {
      return Err(ExtensionError::malformed(
        "truncated_value",
        offset.saturating_add(TLV_HEADER_LEN),
      ));
    }

    let padded = align4(content_len);
    if remaining < padded {
      return Err(ExtensionError::malformed(
        "truncated_padding",
        offset.saturating_add(content_len),
      ));
    }

    for p in content_len..padded {
      if bytes[offset + p] != 0 {
        return Err(ExtensionError::malformed("nonzero_padding", offset + p));
      }
    }

    let value_offset = offset + TLV_HEADER_LEN;
    let value = &bytes[value_offset..value_offset + value_len];

    if assigned && type_id == TRACE_CONTEXT_EXTENSION_TYPE {
      assert_trace_reserved_zero(value, value_offset)?;
    }

    if let Some(prev) = prev_type {
      if type_id == prev {
        return Err(ExtensionError::malformed("duplicate_type", offset));
      }
      if type_id < prev {
        return Err(ExtensionError::malformed("order_violation", offset));
      }
    }
    prev_type = Some(type_id);

    if !assigned && critical && first_unknown_critical.is_none() {
      first_unknown_critical = Some(offset);
    }

    parsed.push(ParsedTlv { type_id, critical, value, assigned });
    offset += padded;
  }

  if let Some(off) = first_unknown_critical {
    return Err(ExtensionError::unsupported("unknown_critical", off));
  }

  Ok(
    parsed
      .into_iter()
      .filter(|t| t.assigned)
      .map(|t| R2wpExtension { type_id: t.type_id, critical: t.critical, value: t.value })
      .collect(),
  )
}

/// Map an extension-area error onto the selected-frame surface (absolute offset).
pub(crate) fn map_extension_error(
  err: ExtensionError,
  area_base: usize,
  step: u8,
) -> ProtocolError {
  let offset = area_base.saturating_add(err.offset);
  match err.code {
    24 => ProtocolError::message_too_large_frame("extension_too_large", offset, step),
    22 => ProtocolError::unsupported_extension("unknown_critical", offset, step),
    _ => ProtocolError::malformed_frame("extension_structural", offset, step),
  }
}

#[cfg(test)]
mod unit_tests {
  use super::*;

  #[test]
  fn structural_order_before_unknown_critical() {
    // Descending types (structural) with later unknown critical: step-13 order wins.
    // type 2 then type 1 (descending) — order_violation at second TLV.
    let mut area = Vec::new();
    // type 2 OPERATION_ID, 16 zero value bytes (already 4-byte aligned)
    area.push(2);
    area.push(0);
    area.extend_from_slice(&16u16.to_be_bytes());
    area.extend_from_slice(&[0u8; 16]);
    // type 1 TRACE — order violation
    area.push(1);
    area.push(0x01); // critical
    area.extend_from_slice(&32u16.to_be_bytes());
    area.extend_from_slice(&[0u8; 32]);
    let err = decode_extension_area(&area).unwrap_err();
    assert_eq!(err.reason, "order_violation");
  }

  #[test]
  fn unknown_critical_after_full_structure() {
    // Single unknown critical type 128 with empty value (4-byte aligned).
    let area = [128u8, 0x01, 0x00, 0x00];
    let err = decode_extension_area(&area).unwrap_err();
    assert_eq!(err.reason, "unknown_critical");
    assert_eq!(err.offset, 0);
    assert_eq!(err.code, 22);
  }

  #[test]
  fn unknown_noncritical_skipped_after_structure() {
    let area = [128u8, 0x00, 0x00, 0x00];
    let out = decode_extension_area(&area).unwrap();
    assert!(out.is_empty());
  }

  #[test]
  fn assigned_value_borrows_input() {
    let mut area = Vec::new();
    area.push(2);
    area.push(0);
    area.extend_from_slice(&16u16.to_be_bytes());
    let payload = [1u8, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
    area.extend_from_slice(&payload);
    let out = decode_extension_area(&area).unwrap();
    assert_eq!(out.len(), 1);
    assert_eq!(out[0].type_id, 2);
    assert_eq!(out[0].value, &payload);
    assert_eq!(out[0].value.as_ptr(), area[4..20].as_ptr(), "value must borrow the area input");
  }

  #[test]
  fn truncated_value_returns_error() {
    // 8-byte area (aligned): value_len=5 needs 9 content bytes → truncated_value.
    let area = [128u8, 0x00, 0x00, 0x05, 0x00, 0x00, 0x00, 0x00];
    let err = decode_extension_area(&area).unwrap_err();
    assert_eq!(err.reason, "truncated_value");
    assert_eq!(err.offset, 4);
    assert_eq!(err.code, 3);
  }

  #[test]
  fn truncated_value_huge_declared_len_returns_error() {
    // Declared value_len = 0xffff far exceeds remaining; return error (total).
    let area = [128u8, 0x00, 0xff, 0xff, 0x00, 0x00, 0x00, 0x00];
    let err = decode_extension_area(&area).unwrap_err();
    assert_eq!(err.reason, "truncated_value");
    assert_eq!(err.code, 3);
  }

  #[test]
  fn truncated_value_second_tlv_remaining_compare() {
    // First empty TLV (4 bytes). Second header declares value_len=1 (content 5)
    // with remaining=4 → remaining < content_len → truncated_value.
    let mut area = vec![128u8, 0x00, 0x00, 0x00];
    area.extend_from_slice(&[129u8, 0x00, 0x00, 0x01]);
    let err = decode_extension_area(&area).unwrap_err();
    assert_eq!(err.reason, "truncated_value");
    assert_eq!(err.offset, 8);
  }
}
