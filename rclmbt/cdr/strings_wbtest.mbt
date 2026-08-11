///|
/// CDR1 UTF-8 Char8 string tests (M1-01c2a).

///|
fn swriter(endian : CdrEndian) -> CdrWriter {
  match CdrWriter::new(endian, CdrLimits::defaults()) {
    Ok(w) => w
    Err(e) => abort(e.code)
  }
}

///|
fn swriter_limits(endian : CdrEndian, limits : CdrLimits) -> CdrWriter {
  match CdrWriter::new(endian, limits) {
    Ok(w) => w
    Err(e) => abort(e.code)
  }
}

///|
fn sreader(bytes : BytesView) -> CdrReader {
  match CdrReader::open_default(bytes) {
    Ok(r) => r
    Err(e) => abort(e.code)
  }
}

///|
fn sreader_limits(bytes : BytesView, limits : CdrLimits) -> CdrReader {
  match CdrReader::open(bytes, limits) {
    Ok(r) => r
    Err(e) => abort(e.code)
  }
}

///|
fn expect_wire_eq(got : Bytes, expect : Array[Byte]) -> Unit raise {
  assert_eq(got.length(), expect.length())
  let mut i = 0
  while i < expect.length() {
    assert_eq(got[i], expect[i])
    i = i + 1
  }
}

///|
fn expect_writer_unchanged(
  w : CdrWriter,
  before : Bytes,
  pos : Int,
) -> Unit raise {
  assert_eq(w.position(), pos)
  let after = w.to_bytes()
  assert_eq(after.length(), before.length())
  let mut i = 0
  while i < before.length() {
    assert_eq(after[i], before[i])
    i = i + 1
  }
}

///|
fn moonspan_string() -> String {
  "Moonspan CDR ✓"
}

///|
test "string empty exact LE and BE" {
  // Empty string: length 1 + 0x00.
  let le_expect : Array[Byte] = [
    b'\x00', b'\x01', b'\x00', b'\x00', // header LE
     b'\x01', b'\x00', b'\x00', b'\x00', // length 1 LE
     b'\x00',
  ]
  let be_expect : Array[Byte] = [
    b'\x00', b'\x00', b'\x00', b'\x00', // header BE
     b'\x00', b'\x00', b'\x00', b'\x01', // length 1 BE
     b'\x00',
  ]
  let wle = swriter(CdrEndian::Little)
  match wle.write_string(""[:]) {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  expect_wire_eq(wle.to_bytes(), le_expect)
  let wbe = swriter(CdrEndian::Big)
  match wbe.write_string(""[:]) {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  expect_wire_eq(wbe.to_bytes(), be_expect)
  match sreader(wle.to_bytes()[:]).read_string() {
    Ok(s) => assert_eq(s, "")
    Err(e) => abort(e.code)
  }
  match sreader(wbe.to_bytes()[:]).read_string() {
    Ok(s) => assert_eq(s, "")
    Err(e) => abort(e.code)
  }
}

///|
test "string ASCII exact LE and BE" {
  // "Hi" → length 3, H i NUL
  let le_expect : Array[Byte] = [
    b'\x00', b'\x01', b'\x00', b'\x00', b'\x03', b'\x00', b'\x00', b'\x00', b'H',
    b'i', b'\x00',
  ]
  let be_expect : Array[Byte] = [
    b'\x00', b'\x00', b'\x00', b'\x00', b'\x00', b'\x00', b'\x00', b'\x03', b'H',
    b'i', b'\x00',
  ]
  let wle = swriter(CdrEndian::Little)
  match wle.write_string("Hi"[:]) {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  expect_wire_eq(wle.to_bytes(), le_expect)
  let wbe = swriter(CdrEndian::Big)
  match wbe.write_string("Hi"[:]) {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  expect_wire_eq(wbe.to_bytes(), be_expect)
  match sreader(wle.to_bytes()[:]).read_string() {
    Ok(s) => assert_eq(s, "Hi")
    Err(e) => abort(e.code)
  }
  match sreader(wbe.to_bytes()[:]).read_string() {
    Ok(s) => assert_eq(s, "Hi")
    Err(e) => abort(e.code)
  }
}

///|
test "string Moonspan CDR checkmark exact LE and BE" {
  // Corpus-compatible: length 17 LE/BE + UTF-8 "Moonspan CDR ✓" + NUL
  // 4d6f6f6e7370616e2043445220e29c93 00
  let payload : Array[Byte] = [
    b'\x4d', b'\x6f', b'\x6f', b'\x6e', b'\x73', b'\x70', b'\x61', b'\x6e', b'\x20',
    b'\x43', b'\x44', b'\x52', b'\x20', b'\xe2', b'\x9c', b'\x93', b'\x00',
  ]
  let wle = swriter(CdrEndian::Little)
  match wle.write_string(moonspan_string()[:]) {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  let le = wle.to_bytes()
  assert_eq(le.length(), 4 + 4 + 17)
  assert_eq(le[4], b'\x11')
  assert_eq(le[5], b'\x00')
  assert_eq(le[6], b'\x00')
  assert_eq(le[7], b'\x00')
  let mut i = 0
  while i < 17 {
    assert_eq(le[8 + i], payload[i])
    i = i + 1
  }
  let wbe = swriter(CdrEndian::Big)
  match wbe.write_string(moonspan_string()[:]) {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  let be = wbe.to_bytes()
  assert_eq(be[4], b'\x00')
  assert_eq(be[5], b'\x00')
  assert_eq(be[6], b'\x00')
  assert_eq(be[7], b'\x11')
  i = 0
  while i < 17 {
    assert_eq(be[8 + i], payload[i])
    i = i + 1
  }
  match sreader(le[:]).read_string() {
    Ok(s) => assert_eq(s, moonspan_string())
    Err(e) => abort(e.code)
  }
  match sreader(be[:]).read_string() {
    Ok(s) => assert_eq(s, moonspan_string())
    Err(e) => abort(e.code)
  }
}

///|
test "string UTF-8 BOM preserved as U+FEFF both endians" {
  // Payload EF BB BF → U+FEFF; length 4
  let bom = "\u{FEFF}"
  for endian in [CdrEndian::Little, CdrEndian::Big] {
    let w = swriter(endian)
    match w.write_string(bom[:]) {
      Ok(_) => ()
      Err(e) => abort(e.code)
    }
    let bytes = w.to_bytes()
    // After header + length: EF BB BF 00
    assert_eq(bytes[8], b'\xef')
    assert_eq(bytes[9], b'\xbb')
    assert_eq(bytes[10], b'\xbf')
    assert_eq(bytes[11], b'\x00')
    match sreader(bytes[:]).read_string() {
      Ok(s) => assert_eq(s, bom)
      Err(e) => abort(e.code)
    }
  }
}

///|
test "string non-BMP scalar both endians" {
  // U+1F600 😀 → F0 9F 98 80; length 5
  let grin = "😀"
  for endian in [CdrEndian::Little, CdrEndian::Big] {
    let w = swriter(endian)
    match w.write_string(grin[:]) {
      Ok(_) => ()
      Err(e) => abort(e.code)
    }
    let bytes = w.to_bytes()
    assert_eq(bytes[8], b'\xf0')
    assert_eq(bytes[9], b'\x9f')
    assert_eq(bytes[10], b'\x98')
    assert_eq(bytes[11], b'\x80')
    assert_eq(bytes[12], b'\x00')
    match sreader(bytes[:]).read_string() {
      Ok(s) => assert_eq(s, grin)
      Err(e) => abort(e.code)
    }
  }
}

///|
test "string round trip and body-origin alignment after u8" {
  // One u8 at offset 4, then string aligns to body-origin-4 → pad 3 zeros.
  let w = swriter(CdrEndian::Little)
  match w.write_u8(b'\xaa') {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  match w.write_string("A"[:]) {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  let bytes = w.to_bytes()
  // header(4) + aa + pad 00 00 00 + length 2 LE + 41 00
  assert_eq(bytes[4], b'\xaa')
  assert_eq(bytes[5], b'\x00')
  assert_eq(bytes[6], b'\x00')
  assert_eq(bytes[7], b'\x00')
  assert_eq(bytes[8], b'\x02')
  assert_eq(bytes[9], b'\x00')
  assert_eq(bytes[10], b'\x00')
  assert_eq(bytes[11], b'\x00')
  assert_eq(bytes[12], b'A')
  assert_eq(bytes[13], b'\x00')
  let r = sreader(bytes[:])
  match r.read_u8() {
    Ok(b) => assert_eq(b, b'\xaa')
    Err(e) => abort(e.code)
  }
  match r.read_string() {
    Ok(s) => assert_eq(s, "A")
    Err(e) => abort(e.code)
  }
}

///|
test "string malformed utf8 families restore cursor" {
  // length 3 LE, payload C3 28 (invalid), NUL — overlong/invalid continuation family
  let bad1 = b"\x00\x01\x00\x00\x03\x00\x00\x00\xc3\x28\x00"
  let r1 = sreader(bad1[:])
  assert_eq(r1.position(), 4)
  match r1.read_string() {
    Ok(_) => abort("expected invalid_utf8")
    Err(e) => {
      assert_eq(e.code, CODE_INVALID_UTF8)
      assert_eq(e.offset, 4)
      assert_eq(e.needed, 3)
      assert_eq(e.remaining, 7)
    }
  }
  assert_eq(r1.position(), 4)
  // Truncated multi-byte: E2 9C alone before NUL — length 3
  let bad2 = b"\x00\x01\x00\x00\x03\x00\x00\x00\xe2\x9c\x00"
  let r2 = sreader(bad2[:])
  match r2.read_string() {
    Ok(_) => abort("expected invalid_utf8 truncated mb")
    Err(e) => {
      assert_eq(e.code, CODE_INVALID_UTF8)
      assert_eq(e.offset, 4)
    }
  }
  assert_eq(r2.position(), 4)
  // Surrogate half as UTF-8: ED A0 80 (U+D800) + NUL; length 4
  let bad3 = b"\x00\x01\x00\x00\x04\x00\x00\x00\xed\xa0\x80\x00"
  let r3 = sreader(bad3[:])
  match r3.read_string() {
    Ok(_) => abort("expected invalid_utf8 surrogate")
    Err(e) => assert_eq(e.code, CODE_INVALID_UTF8)
  }
  assert_eq(r3.position(), 4)
  // Overlong slash: C0 AF + NUL; length 3
  let bad4 = b"\x00\x01\x00\x00\x03\x00\x00\x00\xc0\xaf\x00"
  let r4 = sreader(bad4[:])
  match r4.read_string() {
    Ok(_) => abort("expected invalid_utf8 overlong")
    Err(e) => assert_eq(e.code, CODE_INVALID_UTF8)
  }
  assert_eq(r4.position(), 4)
}

///|
test "string length zero missing terminator" {
  let input = b"\x00\x01\x00\x00\x00\x00\x00\x00"
  let r = sreader(input[:])
  assert_eq(r.position(), 4)
  match r.read_string() {
    Ok(_) => abort("expected missing_string_terminator")
    Err(e) => {
      assert_eq(e.code, CODE_MISSING_STRING_TERMINATOR)
      assert_eq(e.offset, 4)
      assert_eq(e.needed, 1)
      assert_eq(e.remaining, 4)
    }
  }
  assert_eq(r.position(), 4)
}

///|
test "string missing terminator nonzero final byte" {
  // length 2, payload ends on 0x41 (nonzero final byte)
  let input = b"\x00\x01\x00\x00\x02\x00\x00\x00\x41\x41"
  let r = sreader(input[:])
  match r.read_string() {
    Ok(_) => abort("expected missing_string_terminator")
    Err(e) => {
      assert_eq(e.code, CODE_MISSING_STRING_TERMINATOR)
      assert_eq(e.offset, 4)
      assert_eq(e.needed, 2)
      assert_eq(e.remaining, 6)
    }
  }
  assert_eq(r.position(), 4)
}

///|
test "string high-bit length overflow" {
  // length 0xffffffff LE
  let input = b"\x00\x01\x00\x00\xff\xff\xff\xff"
  let r = sreader(input[:])
  match r.read_string() {
    Ok(_) => abort("expected length_overflow")
    Err(e) => {
      assert_eq(e.code, CODE_LENGTH_OVERFLOW)
      assert_eq(e.offset, 4)
      assert_eq(e.needed, 0)
    }
  }
  assert_eq(r.position(), 4)
  // length 0x80000000 also above host Int domain
  let input2 = b"\x00\x01\x00\x00\x00\x00\x00\x80"
  let r2 = sreader(input2[:])
  match r2.read_string() {
    Ok(_) => abort("expected length_overflow high bit")
    Err(e) => {
      assert_eq(e.code, CODE_LENGTH_OVERFLOW)
      assert_eq(e.needed, 0)
    }
  }
  assert_eq(r2.position(), 4)
}

///|
test "string truncation restores cursor" {
  // length 5 but only 2 payload bytes present
  let input = b"\x00\x01\x00\x00\x05\x00\x00\x00\x41\x42"
  let r = sreader(input[:])
  match r.read_string() {
    Ok(_) => abort("expected truncated")
    Err(e) => {
      assert_eq(e.code, CODE_TRUNCATED)
      assert_eq(e.offset, 4)
      // pad0 + 4 + 5 = 9
      assert_eq(e.needed, 9)
      assert_eq(e.remaining, 6)
    }
  }
  assert_eq(r.position(), 4)
}

///|
test "string type bound exact succeeds bound plus one fails" {
  // payload 2 bytes "AB"
  let w = swriter(CdrEndian::Little)
  match w.write_string("AB"[:], max_bytes=2U) {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  let bytes = w.to_bytes()
  match sreader(bytes[:]).read_string(max_bytes=2U) {
    Ok(s) => assert_eq(s, "AB")
    Err(e) => abort(e.code)
  }
  // bound+1 fails on read
  let r = sreader(bytes[:])
  match r.read_string(max_bytes=1U) {
    Ok(_) => abort("expected bounds on read")
    Err(e) => {
      assert_eq(e.code, CODE_BOUNDS_EXCEEDED)
      assert_eq(e.offset, 4)
      assert_eq(e.needed, 2)
      assert_eq(e.remaining, 1)
    }
  }
  assert_eq(r.position(), 4)
  // bound+1 fails on write before mutation
  let w2 = swriter(CdrEndian::Little)
  let before = w2.to_bytes()
  let pos = w2.position()
  match w2.write_string("AB"[:], max_bytes=1U) {
    Ok(_) => abort("expected bounds on write")
    Err(e) => {
      assert_eq(e.code, CODE_BOUNDS_EXCEEDED)
      assert_eq(e.offset, pos)
      assert_eq(e.needed, 2)
      assert_eq(e.remaining, 1)
    }
  }
  expect_writer_unchanged(w2, before, pos)
}

///|
test "string temporary allocation bound before decode" {
  // payload 4 → worst-case UTF-16 storage 8 bytes; temp cap 7 rejects.
  let limits = match CdrLimits::new(64, 4, 7) {
    Ok(l) => l
    Err(e) => abort(e.code)
  }
  // length 5 LE: "ABCD" + NUL
  let input = b"\x00\x01\x00\x00\x05\x00\x00\x00ABCD\x00"
  let r = sreader_limits(input[:], limits)
  match r.read_string() {
    Ok(_) => abort("expected bounds temp")
    Err(e) => {
      assert_eq(e.code, CODE_BOUNDS_EXCEEDED)
      assert_eq(e.offset, 4)
      assert_eq(e.needed, 8)
      assert_eq(e.remaining, 7)
    }
  }
  assert_eq(r.position(), 4)
  // temp cap 8 accepts
  let limits_ok = match CdrLimits::new(64, 4, 8) {
    Ok(l) => l
    Err(e) => abort(e.code)
  }
  let r2 = sreader_limits(input[:], limits_ok)
  match r2.read_string() {
    Ok(s) => assert_eq(s, "ABCD")
    Err(e) => abort(e.code)
  }
}

///|
test "string writer capacity preflight atomic" {
  // capacity 10: header 4 + string field needs pad0+4+2 = 6 → total 10 exact for "A"
  let limits = match CdrLimits::new(10, 4, 10) {
    Ok(l) => l
    Err(e) => abort(e.code)
  }
  let w = swriter_limits(CdrEndian::Little, limits)
  match w.write_string("A"[:]) {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  assert_eq(w.position(), 10)
  // "AB" needs 4+4+3=11 > 10
  let w2 = swriter_limits(CdrEndian::Little, limits)
  let before = w2.to_bytes()
  let pos = w2.position()
  match w2.write_string("AB"[:]) {
    Ok(_) => abort("expected capacity bounds")
    Err(e) => {
      assert_eq(e.code, CODE_BOUNDS_EXCEEDED)
      assert_eq(e.offset, pos)
    }
  }
  expect_writer_unchanged(w2, before, pos)
}

///|
test "string writer invalid unpaired surrogate atomic" {
  let invalid = String::from_array([(0xD800).unsafe_to_char(), 'a'])
  let w = swriter(CdrEndian::Little)
  let before = w.to_bytes()
  let pos = w.position()
  match w.write_string(invalid[:]) {
    Ok(_) => abort("expected invalid_utf8 surrogate")
    Err(e) => {
      assert_eq(e.code, CODE_INVALID_UTF8)
      assert_eq(e.offset, pos)
      assert_eq(e.needed, 0)
    }
  }
  expect_writer_unchanged(w, before, pos)
  // Trailing unpaired
  let invalid2 = String::from_array(['a', (0xDC00).unsafe_to_char()])
  match w.write_string(invalid2[:]) {
    Ok(_) => abort("expected invalid_utf8 trailing")
    Err(e) => assert_eq(e.code, CODE_INVALID_UTF8)
  }
  expect_writer_unchanged(w, before, pos)
  // Lone leading at end
  let invalid3 = String::from_array([(0xD800).unsafe_to_char()])
  match w.write_string(invalid3[:]) {
    Ok(_) => abort("expected invalid_utf8 lone lead")
    Err(e) => assert_eq(e.code, CODE_INVALID_UTF8)
  }
  expect_writer_unchanged(w, before, pos)
}

///|
test "string error precedence type bound before truncation" {
  // length 100 but stream short; bound 5 → bounds_exceeded ahead of truncated
  let input = b"\x00\x01\x00\x00\x64\x00\x00\x00\x41"
  let r = sreader(input[:])
  match r.read_string(max_bytes=5U) {
    Ok(_) => abort("expected bounds")
    Err(e) => {
      assert_eq(e.code, CODE_BOUNDS_EXCEEDED)
      assert_eq(e.needed, 99)
      assert_eq(e.remaining, 5)
    }
  }
  assert_eq(r.position(), 4)
}

///|
test "string error precedence length zero before other faults" {
  let input = b"\x00\x01\x00\x00\x00\x00\x00\x00"
  let r = sreader(input[:])
  match r.read_string(max_bytes=0U) {
    Ok(_) => abort("expected missing terminator")
    Err(e) => assert_eq(e.code, CODE_MISSING_STRING_TERMINATOR)
  }
  assert_eq(r.position(), 4)
}

///|
test "string large UInt max_bytes stays permissive on write and read" {
  // Bounds above HOST_INT_MAX_U remain non-binding for every stream-admitted
  // payload. Regression: max_bytes=0xffffffffU must accept a small string.
  let large = 0xffffffffU
  let w = swriter(CdrEndian::Little)
  match w.write_string("A"[:], max_bytes=large) {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  let bytes = w.to_bytes()
  match sreader(bytes[:]).read_string(max_bytes=large) {
    Ok(s) => assert_eq(s, "A")
    Err(e) => abort(e.code)
  }
  // Finite bound still binds; large bound leaves capacity as the active ceiling.
  let limits = match CdrLimits::new(20, 4, 20) {
    Ok(l) => l
    Err(e) => abort(e.code)
  }
  let w2 = swriter_limits(CdrEndian::Little, limits)
  let before = w2.to_bytes()
  let pos = w2.position()
  let big = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
  match w2.write_string(big[:], max_bytes=large) {
    Ok(_) => abort("expected capacity bounds with large type bound")
    Err(e) => {
      assert_eq(e.code, CODE_BOUNDS_EXCEEDED)
      assert_eq(e.offset, pos)
      // pad0 + 4 + (11+1) + 1 = 17 against rem 16
      assert_eq(e.needed, 17)
      assert_eq(e.remaining, 16)
    }
  }
  expect_writer_unchanged(w2, before, pos)
}

///|
test "string declared span above max_stream length_overflow before truncated" {
  // max_stream=64; declared length 65 fits host Int and exceeds the ceiling.
  let limits = match CdrLimits::new(64, 4, 64) {
    Ok(l) => l
    Err(e) => abort(e.code)
  }
  // length 65 LE; input only has the length field (remaining short).
  let input = b"\x00\x01\x00\x00\x41\x00\x00\x00"
  let r = sreader_limits(input[:], limits)
  assert_eq(r.position(), 4)
  match r.read_string() {
    Ok(_) => abort("expected length_overflow stream ceiling")
    Err(e) => {
      assert_eq(e.code, CODE_LENGTH_OVERFLOW)
      assert_eq(e.offset, 4)
      assert_eq(e.needed, 65)
      assert_eq(e.remaining, 64)
    }
  }
  assert_eq(r.position(), 4)
}

///|
test "string default max_stream plus one length_overflow metrics" {
  // DEFAULT_MAX_STREAM_BYTES + 1 = 67108865 still fits host Int.
  let len = DEFAULT_MAX_STREAM_BYTES + 1
  // LE u32 for 67108865 = 0x04000001 → 01 00 00 04
  let input = b"\x00\x01\x00\x00\x01\x00\x00\x04"
  let r = sreader(input[:])
  match r.read_string() {
    Ok(_) => abort("expected length_overflow default max+1")
    Err(e) => {
      assert_eq(e.code, CODE_LENGTH_OVERFLOW)
      assert_eq(e.offset, 4)
      assert_eq(e.needed, len)
      assert_eq(e.remaining, DEFAULT_MAX_STREAM_BYTES)
    }
  }
  assert_eq(r.position(), 4)
}

///|
test "string exact max_stream boundary then remaining truncation" {
  // Declared span == max_stream passes the absolute ceiling; short remaining
  // yields truncated with full-field needed.
  let limits = match CdrLimits::new(64, 4, 64) {
    Ok(l) => l
    Err(e) => abort(e.code)
  }
  // length 64 LE
  let input = b"\x00\x01\x00\x00\x40\x00\x00\x00"
  let r = sreader_limits(input[:], limits)
  match r.read_string() {
    Ok(_) => abort("expected truncated after ceiling pass")
    Err(e) => {
      assert_eq(e.code, CODE_TRUNCATED)
      assert_eq(e.offset, 4)
      // pad0 + 4 + 64 = 68
      assert_eq(e.needed, 68)
      assert_eq(e.remaining, 4)
    }
  }
  assert_eq(r.position(), 4)
}

///|
test "string high-bit length still length_overflow needed zero" {
  // 0xffffffff remains host-domain overflow (needed = 0 sentinel).
  let input = b"\x00\x01\x00\x00\xff\xff\xff\xff"
  let r = sreader(input[:])
  match r.read_string() {
    Ok(_) => abort("expected length_overflow")
    Err(e) => {
      assert_eq(e.code, CODE_LENGTH_OVERFLOW)
      assert_eq(e.needed, 0)
    }
  }
  assert_eq(r.position(), 4)
}

///|
test "string writer early capacity ceiling on large input" {
  // capacity 20: header 4, rem 16, pad 0 → max payload 11.
  // Large ASCII input trips the UTF-16 lower-bound capacity path early.
  let limits = match CdrLimits::new(20, 4, 20) {
    Ok(l) => l
    Err(e) => abort(e.code)
  }
  let w = swriter_limits(CdrEndian::Little, limits)
  let before = w.to_bytes()
  let pos = w.position()
  // 64 ASCII bytes >> max payload 11.
  let large = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
  match w.write_string(large[:]) {
    Ok(_) => abort("expected capacity bounds early")
    Err(e) => {
      assert_eq(e.code, CODE_BOUNDS_EXCEEDED)
      assert_eq(e.offset, pos)
      // pad0 + 4 + (11+1) + 1 = 17
      assert_eq(e.needed, 17)
      assert_eq(e.remaining, 16)
    }
  }
  expect_writer_unchanged(w, before, pos)
  // Exact max payload of 11 still succeeds.
  let w2 = swriter_limits(CdrEndian::Little, limits)
  match w2.write_string("ABCDEFGHIJK"[:]) {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  assert_eq(w2.position(), 20)
  // Type bound still wins when tighter than capacity.
  let w3 = swriter_limits(CdrEndian::Little, limits)
  let before3 = w3.to_bytes()
  let pos3 = w3.position()
  match w3.write_string(large[:], max_bytes=5U) {
    Ok(_) => abort("expected type bounds")
    Err(e) => {
      assert_eq(e.code, CODE_BOUNDS_EXCEEDED)
      assert_eq(e.offset, pos3)
      assert_eq(e.needed, 64)
      assert_eq(e.remaining, 5)
    }
  }
  expect_writer_unchanged(w3, before3, pos3)
}
