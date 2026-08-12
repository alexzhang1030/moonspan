//! R2WP v0 deterministic CBOR decoder (RFC 8949 core deterministic profile).
//!
//! Bounds: nesting depth 16, map entries 4096. Bytes and text borrow the input
//! buffer; text is validated UTF-8.

use std::borrow::Cow;
use std::collections::BTreeSet;

/// Fixed v0 contract: `absolute_limits.cbor_nesting_depth_max`.
pub const MAX_NESTING_DEPTH: usize = 16;
/// Fixed v0 contract: `absolute_limits.cbor_map_entries_max`.
pub const MAX_MAP_ENTRIES: usize = 4096;
/// JavaScript `Number.MAX_SAFE_INTEGER` — TypeScript agreement allocation bound.
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

const MT_UINT: u8 = 0;
const MT_NINT: u8 = 1;
const MT_BYTES: u8 = 2;
const MT_TEXT: u8 = 3;
const MT_ARRAY: u8 = 4;
const MT_MAP: u8 = 5;
const MT_TAG: u8 = 6;
const MT_SIMPLE: u8 = 7;

const SIMPLE_FALSE: u8 = 20;
const SIMPLE_TRUE: u8 = 21;
const SIMPLE_NULL: u8 = 22;

/// Deterministic CBOR decode failure (control-plane semantic: `invalid_control`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CborError {
  pub reason: &'static str,
  pub offset: usize,
}

impl CborError {
  #[must_use]
  pub const fn new(reason: &'static str, offset: usize) -> Self {
    Self { reason, offset }
  }
}

impl std::fmt::Display for CborError {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    write!(f, "cbor {}: offset {}", self.reason, self.offset)
  }
}

impl std::error::Error for CborError {}

/// Decoded CBOR value. Bytes/text borrow the input when possible.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CborValue<'a> {
  Null,
  Bool(bool),
  /// Major type 0 unsigned integer (0..2^64-1).
  Unsigned(u64),
  /// Major type 1 negative integer value in range [-2^64, -1].
  Negative(i128),
  Bytes(Cow<'a, [u8]>),
  Text(Cow<'a, str>),
  Array(Vec<CborValue<'a>>),
  /// Strictly ascending unsigned integer keys.
  Map(Vec<(u64, CborValue<'a>)>),
}

struct Reader<'a> {
  bytes: &'a [u8],
  offset: usize,
}

impl<'a> Reader<'a> {
  fn new(bytes: &'a [u8]) -> Self {
    Self { bytes, offset: 0 }
  }

  fn remaining(&self) -> usize {
    self.bytes.len().saturating_sub(self.offset)
  }

  fn fail(&self, reason: &'static str, at: Option<usize>) -> CborError {
    CborError::new(reason, at.unwrap_or(self.offset))
  }

  fn read_byte(&mut self) -> Result<u8, CborError> {
    if self.offset >= self.bytes.len() {
      return Err(self.fail("truncated", None));
    }
    let b = self.bytes[self.offset];
    self.offset += 1;
    Ok(b)
  }

  fn read_slice(&mut self, n: usize) -> Result<&'a [u8], CborError> {
    if self.remaining() < n {
      return Err(self.fail("truncated", None));
    }
    let start = self.offset;
    self.offset += n;
    Ok(&self.bytes[start..self.offset])
  }
}

struct Head {
  major: u8,
  additional: u8,
  argument: u64,
  head_offset: usize,
}

fn read_head(r: &mut Reader<'_>) -> Result<Head, CborError> {
  let head_offset = r.offset;
  if r.remaining() == 0 {
    return Err(r.fail("truncated", Some(head_offset)));
  }
  let initial = r.read_byte()?;
  let major = initial >> 5;
  let additional = initial & 0x1f;
  let integer_argument = !(major == MT_SIMPLE && (25..=27).contains(&additional));

  if additional <= 23 {
    return Ok(Head { major, additional, argument: u64::from(additional), head_offset });
  }
  if additional == 24 {
    if r.remaining() < 1 {
      return Err(r.fail("truncated", Some(head_offset)));
    }
    let arg = u64::from(r.read_byte()?);
    if arg < 24 {
      return Err(r.fail("non_shortest_form", Some(head_offset)));
    }
    return Ok(Head { major, additional, argument: arg, head_offset });
  }
  if additional == 25 {
    if r.remaining() < 2 {
      return Err(r.fail("truncated", Some(head_offset)));
    }
    let arg = (u64::from(r.read_byte()?) << 8) | u64::from(r.read_byte()?);
    if integer_argument && arg < 0x100 {
      return Err(r.fail("non_shortest_form", Some(head_offset)));
    }
    return Ok(Head { major, additional, argument: arg, head_offset });
  }
  if additional == 26 {
    if r.remaining() < 4 {
      return Err(r.fail("truncated", Some(head_offset)));
    }
    let mut arg = 0u64;
    for _ in 0..4 {
      arg = (arg << 8) | u64::from(r.read_byte()?);
    }
    if integer_argument && arg < 0x1_0000 {
      return Err(r.fail("non_shortest_form", Some(head_offset)));
    }
    return Ok(Head { major, additional, argument: arg, head_offset });
  }
  if additional == 27 {
    if r.remaining() < 8 {
      return Err(r.fail("truncated", Some(head_offset)));
    }
    let mut arg = 0u64;
    for _ in 0..8 {
      arg = (arg << 8) | u64::from(r.read_byte()?);
    }
    if integer_argument && arg < 0x1_0000_0000 {
      return Err(r.fail("non_shortest_form", Some(head_offset)));
    }
    return Ok(Head { major, additional, argument: arg, head_offset });
  }
  if additional == 31 {
    return Err(r.fail("indefinite_length", Some(head_offset)));
  }
  Err(r.fail("reserved_additional_info", Some(head_offset)))
}

fn length_to_usize(arg: u64, head_offset: usize) -> Result<usize, CborError> {
  // Match TypeScript lengthToNumber: declared lengths above MAX_SAFE_INTEGER
  // yield length_out_of_range at head_offset (reason/offset agreement).
  if arg > MAX_SAFE_INTEGER {
    return Err(CborError::new("length_out_of_range", head_offset));
  }
  usize::try_from(arg).map_err(|_| CborError::new("length_out_of_range", head_offset))
}

fn decode_value<'a>(r: &mut Reader<'a>, depth: usize) -> Result<CborValue<'a>, CborError> {
  let head = read_head(r)?;
  let Head { major, additional, argument, head_offset } = head;

  match major {
    MT_UINT => Ok(CborValue::Unsigned(argument)),
    MT_NINT => {
      // value = -1 - argument
      let v = -1i128 - i128::from(argument);
      Ok(CborValue::Negative(v))
    }
    MT_BYTES => {
      let len = length_to_usize(argument, head_offset)?;
      let slice = r.read_slice(len)?;
      Ok(CborValue::Bytes(Cow::Borrowed(slice)))
    }
    MT_TEXT => {
      let len = length_to_usize(argument, head_offset)?;
      let slice = r.read_slice(len)?;
      match std::str::from_utf8(slice) {
        Ok(s) => Ok(CborValue::Text(Cow::Borrowed(s))),
        Err(_) => Err(CborError::new("invalid_utf8", head_offset)),
      }
    }
    MT_ARRAY => {
      let next = depth + 1;
      if next > MAX_NESTING_DEPTH {
        return Err(CborError::new("nesting_depth_exceeded", head_offset));
      }
      let len = length_to_usize(argument, head_offset)?;
      if len > r.remaining() {
        return Err(CborError::new("truncated", head_offset));
      }
      let mut out = Vec::with_capacity(len);
      for _ in 0..len {
        out.push(decode_value(r, next)?);
      }
      Ok(CborValue::Array(out))
    }
    MT_MAP => {
      let next = depth + 1;
      if next > MAX_NESTING_DEPTH {
        return Err(CborError::new("nesting_depth_exceeded", head_offset));
      }
      if argument > MAX_MAP_ENTRIES as u64 {
        return Err(CborError::new("map_entries_exceeded", head_offset));
      }
      let len = length_to_usize(argument, head_offset)?;
      if len > 0 && len.saturating_mul(2) > r.remaining() {
        return Err(CborError::new("truncated", head_offset));
      }
      let mut out = Vec::with_capacity(len);
      let mut seen_keys = BTreeSet::new();
      let mut prev_key: Option<u64> = None;
      for _ in 0..len {
        let key_head = read_head(r)?;
        if key_head.major != MT_UINT {
          return Err(CborError::new("map_key_not_unsigned", key_head.head_offset));
        }
        let key = key_head.argument;
        // Full-set duplicate detection before order checks (TS cbor.ts precedence).
        if !seen_keys.insert(key) {
          return Err(CborError::new("duplicate_map_key", key_head.head_offset));
        }
        if let Some(prev) = prev_key
          && key < prev
        {
          return Err(CborError::new("map_key_order", key_head.head_offset));
        }
        prev_key = Some(key);
        let val = decode_value(r, next)?;
        out.push((key, val));
      }
      Ok(CborValue::Map(out))
    }
    MT_TAG => Err(CborError::new("tag_not_allowed", head_offset)),
    MT_SIMPLE => {
      if additional == 25 || additional == 26 || additional == 27 {
        return Err(CborError::new("float_not_allowed", head_offset));
      }
      if additional == 24 {
        let simple = argument as u8;
        return match simple {
          SIMPLE_FALSE => Ok(CborValue::Bool(false)),
          SIMPLE_TRUE => Ok(CborValue::Bool(true)),
          SIMPLE_NULL => Ok(CborValue::Null),
          _ => Err(CborError::new("simple_not_allowed", head_offset)),
        };
      }
      match additional {
        SIMPLE_FALSE => Ok(CborValue::Bool(false)),
        SIMPLE_TRUE => Ok(CborValue::Bool(true)),
        SIMPLE_NULL => Ok(CborValue::Null),
        _ => Err(CborError::new("simple_not_allowed", head_offset)),
      }
    }
    _ => Err(CborError::new("unsupported_major_type", head_offset)),
  }
}

/// Decode exactly one complete R2WP v0 deterministic CBOR item.
///
/// Empty input, truncation, and trailing bytes map to stable `CborError` reasons.
pub fn decode_deterministic_cbor(bytes: &[u8]) -> Result<CborValue<'_>, CborError> {
  if bytes.is_empty() {
    return Err(CborError::new("empty_input", 0));
  }
  let mut r = Reader::new(bytes);
  let value = decode_value(&mut r, 0)?;
  if r.offset != bytes.len() {
    return Err(CborError::new("trailing_data", r.offset));
  }
  Ok(value)
}

#[cfg(test)]
mod unit_tests {
  use super::*;

  #[test]
  fn empty_input_rejected() {
    let err = decode_deterministic_cbor(&[]).unwrap_err();
    assert_eq!(err.reason, "empty_input");
    assert_eq!(err.offset, 0);
  }

  #[test]
  fn bools_and_null() {
    assert_eq!(decode_deterministic_cbor(&[0xf4]).unwrap(), CborValue::Bool(false));
    assert_eq!(decode_deterministic_cbor(&[0xf5]).unwrap(), CborValue::Bool(true));
    assert_eq!(decode_deterministic_cbor(&[0xf6]).unwrap(), CborValue::Null);
  }

  #[test]
  fn non_shortest_uint_rejected() {
    // ai=24 for value 0
    let err = decode_deterministic_cbor(&[0x18, 0x00]).unwrap_err();
    assert_eq!(err.reason, "non_shortest_form");
  }

  #[test]
  fn indefinite_rejected() {
    let err = decode_deterministic_cbor(&[0x9f]).unwrap_err();
    assert_eq!(err.reason, "indefinite_length");
  }

  #[test]
  fn tag_rejected() {
    let err = decode_deterministic_cbor(&[0xc0, 0x00]).unwrap_err();
    assert_eq!(err.reason, "tag_not_allowed");
  }

  #[test]
  fn float_rejected() {
    // half-precision float 0.0
    let err = decode_deterministic_cbor(&[0xf9, 0x00, 0x00]).unwrap_err();
    assert_eq!(err.reason, "float_not_allowed");
  }

  #[test]
  fn map_key_order_unique_descending() {
    // map {1: true, 0: false} — unique keys, descending order
    let err = decode_deterministic_cbor(&[0xa2, 0x01, 0xf5, 0x00, 0xf4]).unwrap_err();
    assert_eq!(err.reason, "map_key_order");
  }

  #[test]
  fn map_duplicate_before_order_precedence() {
    // map {1: true, 2: true, 1: false}: third key=1 is a full-set duplicate at offset 5.
    // Duplicate check must win even though 1 < 2 would also be an order violation.
    let bytes = [0xa3, 0x01, 0xf5, 0x02, 0xf5, 0x01, 0xf4];
    let err = decode_deterministic_cbor(&bytes).unwrap_err();
    assert_eq!(err.reason, "duplicate_map_key");
    assert_eq!(err.offset, 5);
    // Adjacent equal keys remain duplicate_map_key
    let err = decode_deterministic_cbor(&[0xa2, 0x01, 0xf5, 0x01, 0xf4]).unwrap_err();
    assert_eq!(err.reason, "duplicate_map_key");
  }

  #[test]
  fn text_borrows_valid_utf8() {
    let bytes = [0x63, b'a', b'b', b'c'];
    match decode_deterministic_cbor(&bytes).unwrap() {
      CborValue::Text(t) => {
        assert_eq!(&*t, "abc");
        assert!(matches!(t, Cow::Borrowed(_)));
      }
      other => panic!("expected text, got {other:?}"),
    }
  }

  #[test]
  fn bytes_borrow_input_slice() {
    let bytes = [0x43, 0xde, 0xad, 0xbe];
    match decode_deterministic_cbor(&bytes).unwrap() {
      CborValue::Bytes(b) => {
        assert_eq!(&*b, &[0xde, 0xad, 0xbe]);
        assert!(matches!(b, Cow::Borrowed(_)));
      }
      other => panic!("expected bytes, got {other:?}"),
    }
  }

  #[test]
  fn invalid_utf8_rejected() {
    let err = decode_deterministic_cbor(&[0x62, 0xc3, 0x28]).unwrap_err();
    assert_eq!(err.reason, "invalid_utf8");
  }

  #[test]
  fn map_entries_ceiling() {
    // Declare 4097 entries using head bytes only.
    let mut buf = vec![0xb9, 0x10, 0x01]; // map ai=25, length 4097
    let err = decode_deterministic_cbor(&buf).unwrap_err();
    assert_eq!(err.reason, "map_entries_exceeded");
    buf.clear();
  }

  #[test]
  fn nesting_depth_ceiling() {
    // Depth check uses next = depth + 1 on container entry (root starts at 0).
    // 15 single-element arrays + empty array: innermost enters at next=16 → ok.
    let mut ok = vec![0x81; 15];
    ok.push(0x80);
    assert!(decode_deterministic_cbor(&ok).is_ok());
    // 16 single-element arrays + empty array: innermost enters at next=17 → nesting_depth_exceeded.
    let mut deep = vec![0x81; 16];
    deep.push(0x80);
    let err = decode_deterministic_cbor(&deep).unwrap_err();
    assert_eq!(err.reason, "nesting_depth_exceeded");
  }

  #[test]
  fn trailing_data_rejected() {
    let err = decode_deterministic_cbor(&[0xf5, 0x00]).unwrap_err();
    assert_eq!(err.reason, "trailing_data");
    assert_eq!(err.offset, 1);
  }

  #[test]
  fn byte_string_length_above_max_safe_integer() {
    // bstr ai=27, length = 9007199254740992 (MAX_SAFE_INTEGER + 1)
    let bytes = [0x5b, 0x00, 0x20, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
    let err = decode_deterministic_cbor(&bytes).unwrap_err();
    assert_eq!(err.reason, "length_out_of_range");
    assert_eq!(err.offset, 0);
  }

  #[test]
  fn array_length_above_max_safe_integer() {
    // array ai=27, length = 9007199254740992 (MAX_SAFE_INTEGER + 1)
    let bytes = [0x9b, 0x00, 0x20, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
    let err = decode_deterministic_cbor(&bytes).unwrap_err();
    assert_eq!(err.reason, "length_out_of_range");
    assert_eq!(err.offset, 0);
  }
}
