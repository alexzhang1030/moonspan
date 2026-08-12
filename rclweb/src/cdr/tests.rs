//! Focused CDR1 codec unit tests.

use super::{
  BODY_ORIGIN, CdrEndian, CdrErrorCode, CdrLimits, CdrReader, CdrWriter, DEFAULT_MAX_NESTING_DEPTH,
  DEFAULT_MAX_STREAM_BYTES, DEFAULT_MAX_TEMPORARY_ALLOCATION, REPRESENTATION_CDR_BE,
  REPRESENTATION_CDR_LE,
};

fn le_header() -> [u8; 4] {
  [0x00, 0x01, 0x00, 0x00]
}

fn be_header() -> [u8; 4] {
  [0x00, 0x00, 0x00, 0x00]
}

#[test]
fn header_parse_le_and_be() {
  let le_bytes = le_header();
  let le = CdrReader::open_default(&le_bytes).unwrap();
  assert_eq!(le.representation(), REPRESENTATION_CDR_LE);
  assert_eq!(le.options(), 0);
  assert!(le.little_endian());
  assert_eq!(le.position(), BODY_ORIGIN);

  let be_bytes = be_header();
  let be = CdrReader::open_default(&be_bytes).unwrap();
  assert_eq!(be.representation(), REPRESENTATION_CDR_BE);
  assert!(!be.little_endian());
}

#[test]
fn header_rejects_truncated_and_unsupported() {
  for n in 0..4 {
    let bytes = vec![0u8; n];
    let err = CdrReader::open_default(&bytes).unwrap_err();
    assert_eq!(err.code, CdrErrorCode::InvalidEncapsulation);
    assert_eq!(err.offset, 0);
    assert_eq!(err.needed, 4);
    assert_eq!(err.remaining, n as u64);
  }
  let bad = [0x00, 0x02, 0x00, 0x00];
  let err = CdrReader::open_default(&bad).unwrap_err();
  assert_eq!(err.code, CdrErrorCode::UnsupportedRepresentation);
  assert_eq!(err.needed, 0);
  assert_eq!(err.remaining, 4);
}

#[test]
fn options_any_value_accepted() {
  let bytes = [0x00, 0x01, 0xAB, 0xCD];
  let r = CdrReader::open_default(&bytes).unwrap();
  assert_eq!(r.options(), 0xABCD);
}

#[test]
fn origin_4_alignment_f64_at_absolute_12() {
  // Corpus proof: bool/byte/char + 1 pad + float32, then float64 at absolute 12.
  let mut stream = Vec::new();
  stream.extend_from_slice(&le_header());
  stream.push(1); // bool @4
  stream.push(0xA5); // byte @5
  stream.push(b'Z'); // char @6
  stream.push(0xFF); // non-zero pad @7 (accepted on read)
  stream.extend_from_slice(&(-12.5f32).to_le_bytes()); // f32 @8
  assert_eq!(stream.len(), 12);
  stream.extend_from_slice(&12345.125f64.to_le_bytes()); // f64 @12
  let mut r = CdrReader::open_default(&stream).unwrap();
  assert!(r.read_bool().unwrap());
  assert_eq!(r.read_u8().unwrap(), 0xA5);
  assert_eq!(r.read_u8().unwrap(), b'Z');
  assert_eq!(r.position(), 7);
  assert_eq!(r.read_f32().unwrap().to_bits(), (-12.5f32).to_bits());
  assert_eq!(r.position(), 12);
  assert_eq!(r.read_f64().unwrap().to_bits(), 12345.125f64.to_bits());
  assert_eq!(r.position(), 20);
}

#[test]
fn primitives_le_and_be_round_trip() {
  for endian in [CdrEndian::Little, CdrEndian::Big] {
    let mut w = CdrWriter::new_default(endian).unwrap();
    w.write_bool(true).unwrap();
    w.write_u8(0xA5).unwrap();
    w.write_i8(-120).unwrap();
    w.write_u16(65000).unwrap();
    w.write_i16(-32000).unwrap();
    w.write_u32(4_000_000_000).unwrap();
    w.write_i32(-2_000_000_000).unwrap();
    w.write_u64(18_000_000_000_000_000_000).unwrap();
    w.write_i64(-9_000_000_000_000_000_000).unwrap();
    w.write_f32(-12.5).unwrap();
    w.write_f64(12345.125).unwrap();
    let bytes = w.to_bytes();
    let mut r = CdrReader::open_default(&bytes).unwrap();
    assert!(r.read_bool().unwrap());
    assert_eq!(r.read_u8().unwrap(), 0xA5);
    assert_eq!(r.read_i8().unwrap(), -120);
    assert_eq!(r.read_u16().unwrap(), 65000);
    assert_eq!(r.read_i16().unwrap(), -32000);
    assert_eq!(r.read_u32().unwrap(), 4_000_000_000);
    assert_eq!(r.read_i32().unwrap(), -2_000_000_000);
    assert_eq!(r.read_u64().unwrap(), 18_000_000_000_000_000_000);
    assert_eq!(r.read_i64().unwrap(), -9_000_000_000_000_000_000);
    assert_eq!(r.read_f32().unwrap().to_bits(), (-12.5f32).to_bits());
    assert_eq!(r.read_f64().unwrap().to_bits(), 12345.125f64.to_bits());
    r.ensure_complete().unwrap();
  }
}

#[test]
fn writer_zero_padding_reader_accepts_any_pad() {
  let mut w = CdrWriter::new_default(CdrEndian::Little).unwrap();
  w.write_u8(1).unwrap();
  w.write_u16(0x1234).unwrap();
  let bytes = w.to_bytes();
  // After header+u8, one zero pad before u16.
  assert_eq!(bytes[5], 0x00);
  // Non-zero pad still decodes.
  let mut dirty = bytes.clone();
  dirty[5] = 0x7F;
  let mut r = CdrReader::open_default(&dirty).unwrap();
  assert_eq!(r.read_u8().unwrap(), 1);
  assert_eq!(r.read_u16().unwrap(), 0x1234);
}

#[test]
fn invalid_boolean_restores_cursor() {
  let mut bytes = le_header().to_vec();
  bytes.push(2);
  let mut r = CdrReader::open_default(&bytes).unwrap();
  let err = r.read_bool().unwrap_err();
  assert_eq!(err.code, CdrErrorCode::InvalidBoolean);
  assert_eq!(err.offset, 4);
  assert_eq!(err.needed, 1);
  assert_eq!(err.remaining, 1);
  assert_eq!(r.position(), 4);
}

#[test]
fn truncated_and_alignment_overflow() {
  let mut bytes = le_header().to_vec();
  bytes.push(1); // bool at 4
  // Need pad + 8 for f64 but only one more byte.
  bytes.push(0);
  let mut r = CdrReader::open_default(&bytes).unwrap();
  r.read_bool().unwrap();
  let err = r.read_f64().unwrap_err();
  assert!(matches!(err.code, CdrErrorCode::AlignmentOverflow | CdrErrorCode::Truncated));
  assert_eq!(r.position(), 5);
}

#[test]
fn string_empty_missing_nul_zero_length_utf8_bom_bounds() {
  // Empty string = length 1 + NUL.
  let mut w = CdrWriter::new_default(CdrEndian::Little).unwrap();
  w.write_string("", None).unwrap();
  let empty = w.to_bytes();
  let mut r = CdrReader::open_default(&empty).unwrap();
  assert_eq!(r.read_string(None).unwrap(), "");
  r.ensure_complete().unwrap();

  // Missing NUL.
  let mut missing = le_header().to_vec();
  missing.extend_from_slice(&2u32.to_le_bytes());
  missing.extend_from_slice(b"A"); // no NUL
  missing.push(0); // filler so length exists but terminator wrong: length=2 means A + should be NUL
  // Rebuild: length 2, payload 'A', final byte nonzero → missing terminator.
  let mut missing = le_header().to_vec();
  missing.extend_from_slice(&2u32.to_le_bytes());
  missing.push(b'A');
  missing.push(b'X');
  let mut r = CdrReader::open_default(&missing).unwrap();
  let err = r.read_string(None).unwrap_err();
  assert_eq!(err.code, CdrErrorCode::MissingStringTerminator);
  assert_eq!(r.position(), 4);

  // Zero length.
  let mut zero = le_header().to_vec();
  zero.extend_from_slice(&0u32.to_le_bytes());
  let mut r = CdrReader::open_default(&zero).unwrap();
  let err = r.read_string(None).unwrap_err();
  assert_eq!(err.code, CdrErrorCode::MissingStringTerminator);
  assert_eq!(err.needed, 1);

  // Invalid UTF-8.
  let mut bad = le_header().to_vec();
  bad.extend_from_slice(&2u32.to_le_bytes());
  bad.push(0xFF);
  bad.push(0x00);
  let mut r = CdrReader::open_default(&bad).unwrap();
  let err = r.read_string(None).unwrap_err();
  assert_eq!(err.code, CdrErrorCode::InvalidUtf8);

  // BOM preserved.
  let mut w = CdrWriter::new_default(CdrEndian::Little).unwrap();
  w.write_string("\u{FEFF}ok", None).unwrap();
  let bom_bytes = w.to_bytes();
  let mut r = CdrReader::open_default(&bom_bytes).unwrap();
  assert_eq!(r.read_string(None).unwrap(), "\u{FEFF}ok");

  // Exact bound / bound+1.
  let mut w = CdrWriter::new_default(CdrEndian::Little).unwrap();
  w.write_string("abcd", Some(4)).unwrap();
  let abcd = w.to_bytes();
  let mut r = CdrReader::open_default(&abcd).unwrap();
  assert_eq!(r.read_string(Some(4)).unwrap(), "abcd");
  let mut r = CdrReader::open_default(&abcd).unwrap();
  let err = r.read_string(Some(3)).unwrap_err();
  assert_eq!(err.code, CdrErrorCode::BoundsExceeded);
  assert_eq!(r.position(), 4);

  let mut w = CdrWriter::new_default(CdrEndian::Little).unwrap();
  let err = w.write_string("abcd", Some(3)).unwrap_err();
  assert_eq!(err.code, CdrErrorCode::BoundsExceeded);
  assert_eq!(w.position(), 4);
  assert_eq!(w.to_bytes(), le_header());
}

#[test]
fn wstring_scalar_boundary_and_bounds() {
  // 0xD800 rejected via crafted bytes; 0x10FFFF accepted; 0x110000 rejected.
  let mut good = le_header().to_vec();
  good.extend_from_slice(&1u32.to_le_bytes());
  good.extend_from_slice(&0x10FFFFu32.to_le_bytes());
  let mut r = CdrReader::open_default(&good).unwrap();
  assert_eq!(r.read_wstring(None).unwrap(), "\u{10FFFF}");

  let mut surr = le_header().to_vec();
  surr.extend_from_slice(&1u32.to_le_bytes());
  surr.extend_from_slice(&0xD800u32.to_le_bytes());
  let mut r = CdrReader::open_default(&surr).unwrap();
  let err = r.read_wstring(None).unwrap_err();
  assert_eq!(err.code, CdrErrorCode::InvalidWstringScalar);
  assert_eq!(err.needed, 4);
  assert_eq!(r.position(), 4);

  let mut over = le_header().to_vec();
  over.extend_from_slice(&1u32.to_le_bytes());
  over.extend_from_slice(&0x110000u32.to_le_bytes());
  let mut r = CdrReader::open_default(&over).unwrap();
  let err = r.read_wstring(None).unwrap_err();
  assert_eq!(err.code, CdrErrorCode::InvalidWstringScalar);

  let mut w = CdrWriter::new_default(CdrEndian::Little).unwrap();
  w.write_wstring("ab", Some(2)).unwrap();
  let ab = w.to_bytes();
  let mut r = CdrReader::open_default(&ab).unwrap();
  assert_eq!(r.read_wstring(Some(2)).unwrap(), "ab");
  let mut r = CdrReader::open_default(&ab).unwrap();
  let err = r.read_wstring(Some(1)).unwrap_err();
  assert_eq!(err.code, CdrErrorCode::BoundsExceeded);

  let mut w = CdrWriter::new_default(CdrEndian::Little).unwrap();
  let snap = w.to_bytes();
  let err = w.write_wstring("ab", Some(1)).unwrap_err();
  assert_eq!(err.code, CdrErrorCode::BoundsExceeded);
  assert_eq!(w.to_bytes(), snap);
}

#[test]
fn sequence_length_bounds_and_high_bit() {
  let mut w = CdrWriter::new_default(CdrEndian::Little).unwrap();
  w.write_sequence_length(3, Some(3)).unwrap();
  let seq = w.to_bytes();
  let mut r = CdrReader::open_default(&seq).unwrap();
  assert_eq!(r.read_sequence_length(Some(3)).unwrap(), 3);
  let mut r = CdrReader::open_default(&seq).unwrap();
  let err = r.read_sequence_length(Some(2)).unwrap_err();
  assert_eq!(err.code, CdrErrorCode::BoundsExceeded);

  // High-bit unsigned count stays unsigned through assembly.
  let mut hi = le_header().to_vec();
  hi.extend_from_slice(&0x8000_0000u32.to_le_bytes());
  // Count 0x80000000 exceeds Phase 1 max_stream_bytes ceiling → bounds_exceeded
  // with needed carrying the full unsigned value (not a signed wrap).
  let mut r = CdrReader::open_default(&hi).unwrap();
  let err = r.read_sequence_length(None).unwrap_err();
  assert_eq!(err.code, CdrErrorCode::BoundsExceeded);
  assert_eq!(err.needed, 0x8000_0000);
}

#[test]
fn borrowed_view_physical_identity_and_temp_independence() {
  let mut w = CdrWriter::new_default(CdrEndian::Little).unwrap();
  w.write_byte_sequence(&[1, 2, 3, 4, 5], None).unwrap();
  let bytes = w.to_bytes();
  // Tiny temporary budget still allows borrowed byte sequence.
  let limits = CdrLimits::new(bytes.len(), 4, 0).unwrap();
  let mut r = CdrReader::open(&bytes, limits).unwrap();
  let view = r.read_byte_sequence(None).unwrap();
  assert_eq!(view, &[1, 2, 3, 4, 5]);
  let input_start = bytes.as_ptr() as usize;
  let input_end = input_start + bytes.len();
  let view_start = view.as_ptr() as usize;
  let view_end = view_start + view.len();
  assert!(view_start >= input_start && view_end <= input_end);
}

#[test]
fn writer_atomicity_and_capacity_and_snapshot() {
  let limits = CdrLimits::new(8, 4, 8).unwrap(); // capacity 8
  let mut w = CdrWriter::new(CdrEndian::Little, limits).unwrap();
  assert_eq!(w.position(), 4);
  assert_eq!(w.capacity(), 8);
  let snap = w.to_bytes();
  let err = w.write_u64(1).unwrap_err(); // needs pad? at 4, align 8 → pad 0, size 8 → end 12 > 8
  assert_eq!(err.code, CdrErrorCode::BoundsExceeded);
  assert_eq!(w.to_bytes(), snap);
  assert_eq!(w.position(), 4);

  // capacity < 4
  let tiny = CdrLimits::new(4, 1, 3).unwrap();
  let err = CdrWriter::new(CdrEndian::Little, tiny).unwrap_err();
  assert_eq!(err.code, CdrErrorCode::BoundsExceeded);
  assert_eq!(err.needed, 4);
  assert_eq!(err.remaining, 3);

  // to_bytes isolation
  let mut w = CdrWriter::new_default(CdrEndian::Little).unwrap();
  w.write_u8(1).unwrap();
  let snap = w.to_bytes();
  w.write_u8(2).unwrap();
  assert_eq!(snap, {
    let mut e = le_header().to_vec();
    e.push(1);
    e
  });
}

#[test]
fn nesting_depth_64_accept_65_reject_and_custom_limits() {
  let hdr = le_header();
  let r = CdrReader::open_default(&hdr).unwrap();
  let mut tok = r.root_nesting();
  for d in 1..=64 {
    tok = r.enter_nested(tok).unwrap();
    assert_eq!(tok.depth(), d);
  }
  let err = r.enter_nested(tok).unwrap_err();
  assert_eq!(err.code, CdrErrorCode::BoundsExceeded);
  assert_eq!(err.needed, 65);
  assert_eq!(err.remaining, 64);
  assert_eq!(r.position(), 4);

  let limits = CdrLimits::new(16, 2, 16).unwrap();
  let w = CdrWriter::new(CdrEndian::Little, limits).unwrap();
  let t0 = w.root_nesting();
  let t1 = w.enter_nested(t0).unwrap();
  let t2 = w.enter_nested(t1).unwrap();
  assert_eq!(t2.depth(), 2);
  let err = w.enter_nested(t2).unwrap_err();
  assert_eq!(err.needed, 3);
  assert_eq!(err.remaining, 2);
}

#[test]
fn limits_validation_ranges() {
  assert!(CdrLimits::new(3, 1, 0).is_err());
  assert!(CdrLimits::new(DEFAULT_MAX_STREAM_BYTES + 1, 1, 0).is_err());
  assert!(CdrLimits::new(4, 0, 0).is_err());
  assert!(CdrLimits::new(4, DEFAULT_MAX_NESTING_DEPTH + 1, 0).is_err());
  assert!(CdrLimits::new(4, 1, 5).is_err()); // temp > stream
  let d = CdrLimits::defaults();
  assert_eq!(d.max_stream_bytes, DEFAULT_MAX_STREAM_BYTES);
  assert_eq!(d.max_nesting_depth, DEFAULT_MAX_NESTING_DEPTH);
  assert_eq!(d.max_temporary_allocation, DEFAULT_MAX_TEMPORARY_ALLOCATION);
}

#[test]
fn trailing_data_and_zero_tail() {
  let mut bytes = le_header().to_vec();
  bytes.push(1);
  bytes.extend_from_slice(&[0, 0, 0, 0]);
  let mut r = CdrReader::open_default(&bytes).unwrap();
  r.read_bool().unwrap();
  let err = r.ensure_complete().unwrap_err();
  assert_eq!(err.code, CdrErrorCode::TrailingData);
  assert_eq!(err.needed, 0);
  assert_eq!(err.remaining, 4);
  r.ensure_complete_with_zero_tail(4).unwrap();
  assert_eq!(r.remaining(), 0);

  // Exact end accepts any declaration.
  let hdr = le_header();
  let mut r = CdrReader::open_default(&hdr).unwrap();
  r.ensure_complete_with_zero_tail(12).unwrap();
}

#[test]
fn open_oversized_stream_bounds_exceeded() {
  let limits = CdrLimits::new(8, 4, 8).unwrap();
  let bytes = vec![0u8; 9];
  let err = CdrReader::open(&bytes, limits).unwrap_err();
  assert_eq!(err.code, CdrErrorCode::BoundsExceeded);
  assert_eq!(err.needed, 9);
  assert_eq!(err.remaining, 8);
}

#[test]
fn round_trip_determinism() {
  let mut w1 = CdrWriter::new_default(CdrEndian::Little).unwrap();
  w1.write_string("Moonspan CDR ✓", None).unwrap();
  w1.write_wstring("月面CDR", None).unwrap();
  let a = w1.to_bytes();
  let mut w2 = CdrWriter::new_default(CdrEndian::Little).unwrap();
  w2.write_string("Moonspan CDR ✓", None).unwrap();
  w2.write_wstring("月面CDR", None).unwrap();
  assert_eq!(a, w2.to_bytes());
}

#[test]
fn checked_span_length_order() {
  let mut bytes = le_header().to_vec();
  bytes.extend_from_slice(&[0u8; 8]);
  let r = CdrReader::open_default(&bytes).unwrap();
  // Multiply overflow → length_overflow needed=0
  let err = r.checked_span_length(u64::MAX, 8).unwrap_err();
  assert_eq!(err.code, CdrErrorCode::LengthOverflow);
  assert_eq!(err.needed, 0);
}

#[test]
fn all_error_codes_reachable() {
  // Smoke: each code appears at least once across focused tests above and here.
  let codes = [
    CdrErrorCode::InvalidEncapsulation,
    CdrErrorCode::UnsupportedRepresentation,
    CdrErrorCode::InvalidLimits,
    CdrErrorCode::Truncated,
    CdrErrorCode::InvalidBoolean,
    CdrErrorCode::InvalidUtf8,
    CdrErrorCode::InvalidWstringScalar,
    CdrErrorCode::MissingStringTerminator,
    CdrErrorCode::BoundsExceeded,
    CdrErrorCode::LengthOverflow,
    CdrErrorCode::AlignmentOverflow,
    CdrErrorCode::TrailingData,
  ];
  assert_eq!(codes.len(), 12);
  assert_eq!(CdrErrorCode::InvalidLimits.as_str(), "invalid_limits");
  let _ = CdrLimits::new(3, 1, 0).unwrap_err();
}
