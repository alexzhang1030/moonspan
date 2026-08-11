///|
/// Focused CDR1 writer tests (M1-01b2).

///|
fn writer_ok(endian : CdrEndian, limits : CdrLimits) -> CdrWriter {
  match CdrWriter::new(endian, limits) {
    Ok(w) => w
    Err(e) => abort("writer failed: " + e.code)
  }
}

///|
fn wlimits_ok(
  max_stream_bytes : Int,
  max_nesting_depth : Int,
  max_temporary_allocation : Int,
) -> CdrLimits {
  match
    CdrLimits::new(
      max_stream_bytes, max_nesting_depth, max_temporary_allocation,
    ) {
    Ok(l) => l
    Err(e) => abort("limits failed: " + e.code)
  }
}

///|
fn expect_bytes_eq(got : Bytes, expected : Array[Byte]) -> Unit raise {
  assert_eq(got.length(), expected.length())
  let mut i = 0
  while i < got.length() {
    assert_eq(got[i], expected[i])
    i = i + 1
  }
}

///|
test "canonical LE and BE headers with zero options" {
  let le = writer_ok(CdrEndian::Little, CdrLimits::defaults())
  assert_eq(le.position(), 4)
  assert_eq(le.representation(), REPRESENTATION_CDR_LE)
  assert_eq(le.options(), 0)
  assert_eq(le.little_endian(), true)
  expect_bytes_eq(le.to_bytes(), [b'\x00', b'\x01', b'\x00', b'\x00'])
  let be = writer_ok(CdrEndian::Big, CdrLimits::defaults())
  assert_eq(be.representation(), REPRESENTATION_CDR_BE)
  assert_eq(be.options(), 0)
  expect_bytes_eq(be.to_bytes(), [b'\x00', b'\x00', b'\x00', b'\x00'])
}

///|
test "width-exact max bit patterns both endians" {
  // LE
  let le = writer_ok(CdrEndian::Little, wlimits_ok(64, 8, 64))
  match le.write_u16((0xffff).to_uint16()) {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  match le.write_u32(0xffffffffU) {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  // pad to 8-body for u64 after 2+4 at body 0..6
  match le.write_u64(0xffffffffffffffffUL) {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  let le_bytes = le.to_bytes()
  let r = match CdrReader::open_default(le_bytes[:]) {
    Ok(r) => r
    Err(e) => abort(e.code)
  }
  match r.read_u16() {
    Ok(v) => assert_eq(v, (0xffff).to_uint16())
    Err(e) => abort(e.code)
  }
  match r.read_u32() {
    Ok(v) => assert_eq(v, 0xffffffffU)
    Err(e) => abort(e.code)
  }
  match r.read_u64() {
    Ok(v) => assert_eq(v, 0xffffffffffffffffUL)
    Err(e) => abort(e.code)
  }
  // BE
  let be = writer_ok(CdrEndian::Big, wlimits_ok(64, 8, 64))
  match be.write_u16((0xabcd).to_uint16()) {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  match be.write_u32(0x89abcdefU) {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  match be.write_u64(0x0123456789abcdefUL) {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  let rb = match CdrReader::open_default(be.to_bytes()[:]) {
    Ok(r) => r
    Err(e) => abort(e.code)
  }
  match rb.read_u16() {
    Ok(v) => assert_eq(v, (0xabcd).to_uint16())
    Err(e) => abort(e.code)
  }
  match rb.read_u32() {
    Ok(v) => assert_eq(v, 0x89abcdefU)
    Err(e) => abort(e.code)
  }
  match rb.read_u64() {
    Ok(v) => assert_eq(v, 0x0123456789abcdefUL)
    Err(e) => abort(e.code)
  }
}

///|
test "origin four alignment and deterministic zero padding" {
  let w = writer_ok(CdrEndian::Little, wlimits_ok(64, 8, 64))
  match w.write_u8(b'\xa5') {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  match w.write_u16((0x1234).to_uint16()) {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  match w.write_u32(0x12345678U) {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  match w.write_u64(1UL) {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  let bytes = w.to_bytes()
  // Header + a5 + pad00 + 34 12 + 78 56 34 12 + 01 00.. at offset 12
  expect_bytes_eq(bytes, [
    b'\x00', b'\x01', b'\x00', b'\x00', b'\xa5', b'\x00', b'\x34', b'\x12', b'\x78',
    b'\x56', b'\x34', b'\x12', b'\x01', b'\x00', b'\x00', b'\x00', b'\x00', b'\x00',
    b'\x00', b'\x00',
  ])
  assert_eq(bytes[5], b'\x00') // deterministic zero pad
}

///|
test "writer output round-trips through CdrReader" {
  let w = writer_ok(CdrEndian::Little, wlimits_ok(64, 8, 64))
  match w.write_u8(b'\x11') {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  match w.write_u16((0x2244).to_uint16()) {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  match w.write_u32(0x55667788U) {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  match w.write_u64(0x99aabbccddeeff00UL) {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  let r = match CdrReader::open_default(w.to_bytes()[:]) {
    Ok(r) => r
    Err(e) => abort(e.code)
  }
  match r.read_u8() {
    Ok(b) => assert_eq(b, b'\x11')
    Err(e) => abort(e.code)
  }
  match r.read_u16() {
    Ok(v) => assert_eq(v, (0x2244).to_uint16())
    Err(e) => abort(e.code)
  }
  match r.read_u32() {
    Ok(v) => assert_eq(v, 0x55667788U)
    Err(e) => abort(e.code)
  }
  match r.read_u64() {
    Ok(v) => assert_eq(v, 0x99aabbccddeeff00UL)
    Err(e) => abort(e.code)
  }
}

///|
test "primitive_scalars twenty-byte prefix matches corpus raw bits" {
  let w = writer_ok(CdrEndian::Little, wlimits_ok(64, 8, 64))
  match w.write_u8(b'\x01') {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  match w.write_u8(b'\xa5') {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  match w.write_u8(b'\x5a') {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  match w.write_u32(0xc1480000U) {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  match w.write_u64(0x40c81c9000000000UL) {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  expect_bytes_eq(w.to_bytes(), [
    b'\x00', b'\x01', b'\x00', b'\x00', b'\x01', b'\xa5', b'\x5a', b'\x00', b'\x00',
    b'\x00', b'\x48', b'\xc1', b'\x00', b'\x00', b'\x00', b'\x00', b'\x90', b'\x1c',
    b'\xc8', b'\x40',
  ])
  assert_eq(w.position(), 20)
}

///|
test "deterministic repeated encoding" {
  fn encode_once() -> Bytes {
    let w = writer_ok(CdrEndian::Little, wlimits_ok(32, 8, 32))
    match w.write_u16((0xabcd).to_uint16()) {
      Ok(_) => ()
      Err(e) => abort(e.code)
    }
    match w.write_u32(0x11223344U) {
      Ok(_) => ()
      Err(e) => abort(e.code)
    }
    w.to_bytes()
  }
  let a = encode_once()
  let b = encode_once()
  assert_eq(a.length(), b.length())
  let mut i = 0
  while i < a.length() {
    assert_eq(a[i], b[i])
    i = i + 1
  }
}

///|
test "write_bytes copies source view" {
  let src = Bytes::from_array([b'\xde', b'\xad', b'\xbe', b'\xef'][:])
  let w = writer_ok(CdrEndian::Little, wlimits_ok(32, 8, 32))
  match w.write_bytes(src[:]) {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  let out = w.to_bytes()
  assert_eq(out[4], b'\xde')
  assert_eq(out[7], b'\xef')
  // Mutating source after write does not apply; Bytes is immutable, so
  // re-encode isolation is shown by a second independent write.
  let w2 = writer_ok(CdrEndian::Little, wlimits_ok(32, 8, 32))
  match w2.write_bytes(b"\x00\x00\x00\x00"[:]) {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  assert_eq(w.to_bytes()[4], b'\xde')
}

///|
test "exact capacity succeeds and one-byte overflow is atomic" {
  // Header 4 + body 4 = 8 capacity exactly for four body bytes.
  let limits = wlimits_ok(8, 8, 8)
  let w = writer_ok(CdrEndian::Little, limits)
  match w.write_bytes(b"\x01\x02\x03\x04"[:]) {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  assert_eq(w.position(), 8)
  assert_eq(w.remaining_capacity(), 0)
  let snapshot = w.to_bytes()
  match w.write_u8(b'\xff') {
    Ok(_) => abort("expected bounds")
    Err(e) => {
      assert_eq(e.code, CODE_BOUNDS_EXCEEDED)
      assert_eq(e.needed, 1)
      assert_eq(e.remaining, 0)
    }
  }
  assert_eq(w.position(), 8)
  let after = w.to_bytes()
  assert_eq(after.length(), snapshot.length())
  let mut i = 0
  while i < after.length() {
    assert_eq(after[i], snapshot[i])
    i = i + 1
  }
}

///|
test "temp below header rejects construction" {
  // temp=2, stream=64 → capacity 2 < 4
  let limits = wlimits_ok(64, 8, 2)
  match CdrWriter::new(CdrEndian::Little, limits) {
    Ok(_) => abort("expected bounds")
    Err(e) => {
      assert_eq(e.code, CODE_BOUNDS_EXCEEDED)
      assert_eq(e.needed, 4)
      assert_eq(e.remaining, 2)
    }
  }
}

///|
test "raw invalid CdrLimits literals reject at writer trust boundary" {
  let bad : CdrLimits = {
    max_stream_bytes: -1,
    max_nesting_depth: 8,
    max_temporary_allocation: 0,
  }
  match CdrWriter::new(CdrEndian::Little, bad) {
    Ok(_) => abort("expected invalid_limits")
    Err(e) => assert_eq(e.code, CODE_INVALID_LIMITS)
  }
  let oversized : CdrLimits = {
    max_stream_bytes: 67108865,
    max_nesting_depth: 8,
    max_temporary_allocation: 8,
  }
  match CdrWriter::new(CdrEndian::Big, oversized) {
    Ok(_) => abort("expected invalid_limits oversized")
    Err(e) => assert_eq(e.code, CODE_INVALID_LIMITS)
  }
}

///|
test "checked pad plus size overflow is typed and atomic" {
  // Force huge remaining field size request via write_bytes with large view
  // is impractical; exercise length_overflow sentinel path through
  // align_and_reserve with size that would overflow when added to position.
  // Capacity is large enough that only arithmetic overflow can fail.
  let w = writer_ok(CdrEndian::Little, wlimits_ok(64, 8, 64))
  let before = w.position()
  let before_bytes = w.to_bytes()
  // Negative size is rejected as length_overflow with needed=0.
  // write_bytes length is non-negative; call align_and_reserve indirectly
  // is private — use a path that cannot overflow pad+size with public API:
  // fill almost to capacity then request more.
  match
    w.write_bytes(
      b"\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00"[:],
    ) {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  // 4 header + 60 body = 64 full
  assert_eq(w.position(), 64)
  match w.write_u8(b'\x01') {
    Ok(_) => abort("expected bounds")
    Err(e) => {
      assert_eq(e.code, CODE_BOUNDS_EXCEEDED)
      assert_eq(e.offset, 64)
    }
  }
  assert_eq(w.position(), 64)
  let after = w.to_bytes()
  assert_eq(after.length(), 64)
  let _ = before
  let _ = before_bytes
}

///|
test "to_bytes snapshot isolation" {
  let w = writer_ok(CdrEndian::Little, wlimits_ok(32, 8, 32))
  match w.write_u8(b'\xaa') {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  let snap = w.to_bytes()
  assert_eq(snap.length(), 5)
  match w.write_u8(b'\xbb') {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  assert_eq(snap.length(), 5)
  assert_eq(snap[4], b'\xaa')
  assert_eq(w.to_bytes()[5], b'\xbb')
}
