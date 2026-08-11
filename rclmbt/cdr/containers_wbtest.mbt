///|
/// Sequence, fixed-array composition, and nesting tests (M1-01c3b).

///|
fn cw(endian : CdrEndian) -> CdrWriter {
  match CdrWriter::new(endian, CdrLimits::defaults()) {
    Ok(w) => w
    Err(e) => abort(e.code)
  }
}

///|
fn cw_limits(endian : CdrEndian, limits : CdrLimits) -> CdrWriter {
  match CdrWriter::new(endian, limits) {
    Ok(w) => w
    Err(e) => abort(e.code)
  }
}

///|
fn cr(bytes : BytesView) -> CdrReader {
  match CdrReader::open_default(bytes) {
    Ok(r) => r
    Err(e) => abort(e.code)
  }
}

///|
fn cr_limits(bytes : BytesView, limits : CdrLimits) -> CdrReader {
  match CdrReader::open(bytes, limits) {
    Ok(r) => r
    Err(e) => abort(e.code)
  }
}

///|
fn cexpect_writer_frozen(
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
fn cexpect_wire(got : Bytes, expect : Array[Byte]) -> Unit raise {
  assert_eq(got.length(), expect.length())
  let mut i = 0
  while i < expect.length() {
    assert_eq(got[i], expect[i])
    i = i + 1
  }
}

///|
test "sequence length LE BE exact and round trip" {
  let le_expect : Array[Byte] = [
    b'\x00', b'\x01', b'\x00', b'\x00', b'\x03', b'\x00', b'\x00', b'\x00',
  ]
  let be_expect : Array[Byte] = [
    b'\x00', b'\x00', b'\x00', b'\x00', b'\x00', b'\x00', b'\x00', b'\x03',
  ]
  let wle = cw(CdrEndian::Little)
  match wle.write_sequence_length(3) {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  cexpect_wire(wle.to_bytes(), le_expect)
  let wbe = cw(CdrEndian::Big)
  match wbe.write_sequence_length(3) {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  cexpect_wire(wbe.to_bytes(), be_expect)
  match cr(wle.to_bytes()[:]).read_sequence_length() {
    Ok(n) => assert_eq(n, 3)
    Err(e) => abort(e.code)
  }
  match cr(wbe.to_bytes()[:]).read_sequence_length() {
    Ok(n) => assert_eq(n, 3)
    Err(e) => abort(e.code)
  }
}

///|
test "sequence length optional bound exact over and large open" {
  let w = cw(CdrEndian::Little)
  match w.write_sequence_length(2, max_elements=2U) {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  match cr(w.to_bytes()[:]).read_sequence_length(max_elements=2U) {
    Ok(n) => assert_eq(n, 2)
    Err(e) => abort(e.code)
  }
  let r = cr(w.to_bytes()[:])
  match r.read_sequence_length(max_elements=1U) {
    Ok(_) => abort("expected bounds")
    Err(e) => {
      assert_eq(e.code, CODE_BOUNDS_EXCEEDED)
      assert_eq(e.needed, 2)
      assert_eq(e.remaining, 1)
      assert_eq(e.offset, 4)
    }
  }
  assert_eq(r.position(), 4)
  match cr(w.to_bytes()[:]).read_sequence_length(max_elements=0xffffffffU) {
    Ok(n) => assert_eq(n, 2)
    Err(e) => abort(e.code)
  }
  let w2 = cw(CdrEndian::Little)
  let before = w2.to_bytes()
  let pos = w2.position()
  match w2.write_sequence_length(2, max_elements=1U) {
    Ok(_) => abort("expected write bounds")
    Err(e) => {
      assert_eq(e.code, CODE_BOUNDS_EXCEEDED)
      assert_eq(e.needed, 2)
      assert_eq(e.remaining, 1)
    }
  }
  cexpect_writer_frozen(w2, before, pos)
  match w2.write_sequence_length(1, max_elements=0xffffffffU) {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
}

///|
test "sequence length high-bit and absolute work ceiling" {
  // 0xffffffff LE → above max_stream; needed sentinel 0
  let hi = b"\x00\x01\x00\x00\xff\xff\xff\xff"
  let r = cr(hi[:])
  match r.read_sequence_length() {
    Ok(_) => abort("expected bounds high-bit")
    Err(e) => {
      assert_eq(e.code, CODE_BOUNDS_EXCEEDED)
      assert_eq(e.needed, 0)
      assert_eq(e.remaining, DEFAULT_MAX_STREAM_BYTES)
      assert_eq(e.offset, 4)
    }
  }
  assert_eq(r.position(), 4)
  // Custom stream ceiling 32; count 40
  let limits = match CdrLimits::new(32, 4, 32) {
    Ok(l) => l
    Err(e) => abort(e.code)
  }
  let input = b"\x00\x01\x00\x00\x28\x00\x00\x00"
  let r2 = cr_limits(input[:], limits)
  match r2.read_sequence_length() {
    Ok(_) => abort("expected work ceiling")
    Err(e) => {
      assert_eq(e.code, CODE_BOUNDS_EXCEEDED)
      assert_eq(e.needed, 40)
      assert_eq(e.remaining, 32)
    }
  }
  assert_eq(r2.position(), 4)
}

///|
test "sequence length truncation and writer negative capacity atomic" {
  let short = b"\x00\x01\x00\x00\x01\x00"
  let r = cr(short[:])
  match r.read_sequence_length() {
    Ok(_) => abort("expected truncated")
    Err(e) => {
      assert_eq(e.code, CODE_TRUNCATED)
      assert_eq(e.offset, 4)
    }
  }
  assert_eq(r.position(), 4)
  let w = cw(CdrEndian::Little)
  let before = w.to_bytes()
  let pos = w.position()
  match w.write_sequence_length(-1) {
    Ok(_) => abort("expected length_overflow")
    Err(e) => {
      assert_eq(e.code, CODE_LENGTH_OVERFLOW)
      assert_eq(e.needed, 0)
    }
  }
  cexpect_writer_frozen(w, before, pos)
  let limits = match CdrLimits::new(6, 4, 6) {
    Ok(l) => l
    Err(e) => abort(e.code)
  }
  // capacity 6: header 4, rem 2 — cannot fit aligned u32 count
  let w2 = cw_limits(CdrEndian::Little, limits)
  let b2 = w2.to_bytes()
  let p2 = w2.position()
  match w2.write_sequence_length(0) {
    Ok(_) => abort("expected capacity")
    Err(e) => assert_eq(e.code, CODE_BOUNDS_EXCEEDED)
  }
  cexpect_writer_frozen(w2, b2, p2)
}

///|
test "byte sequence exact wire physical identity and temp independence" {
  let payload = b"\xde\xad\xbe\xef"
  let w = cw(CdrEndian::Little)
  match w.write_byte_sequence(payload[:]) {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  let le_expect : Array[Byte] = [
    b'\x00', b'\x01', b'\x00', b'\x00', b'\x04', b'\x00', b'\x00', b'\x00', b'\xde',
    b'\xad', b'\xbe', b'\xef',
  ]
  cexpect_wire(w.to_bytes(), le_expect)
  let input = w.to_bytes()
  // temp cap 0 still allows borrowed byte sequence
  let limits = match CdrLimits::new(64, 4, 0) {
    Ok(l) => l
    Err(e) => abort(e.code)
  }
  let r = cr_limits(input[:], limits)
  match r.read_byte_sequence() {
    Ok(bv) => {
      assert_eq(bv.length(), 4)
      assert_eq(bv.start_offset(), 8)
      assert_eq(physical_equal(bv.data(), input), true)
      assert_eq(bv[0], b'\xde')
      assert_eq(bv[3], b'\xef')
    }
    Err(e) => abort(e.code)
  }
  let wbe = cw(CdrEndian::Big)
  match wbe.write_byte_sequence(payload[:]) {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  let be = wbe.to_bytes()
  assert_eq(be[4], b'\x00')
  assert_eq(be[5], b'\x00')
  assert_eq(be[6], b'\x00')
  assert_eq(be[7], b'\x04')
  match cr(be[:]).read_byte_sequence() {
    Ok(bv) => assert_eq(bv.length(), 4)
    Err(e) => abort(e.code)
  }
}

///|
test "byte sequence max bound truncation writer atomic" {
  let w = cw(CdrEndian::Little)
  match w.write_byte_sequence(b"AB"[:], max_elements=2U) {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  match cr(w.to_bytes()[:]).read_byte_sequence(max_elements=2U) {
    Ok(bv) => assert_eq(bv.length(), 2)
    Err(e) => abort(e.code)
  }
  let r = cr(w.to_bytes()[:])
  match r.read_byte_sequence(max_elements=1U) {
    Ok(_) => abort("expected bounds")
    Err(e) => {
      assert_eq(e.code, CODE_BOUNDS_EXCEEDED)
      assert_eq(e.needed, 2)
      assert_eq(e.remaining, 1)
    }
  }
  assert_eq(r.position(), 4)
  // truncation: count 4, only 1 payload byte
  let trunc = b"\x00\x01\x00\x00\x04\x00\x00\x00\xff"
  let rt = cr(trunc[:])
  match rt.read_byte_sequence() {
    Ok(_) => abort("expected truncated")
    Err(e) => {
      assert_eq(e.code, CODE_TRUNCATED)
      assert_eq(e.offset, 4)
      assert_eq(e.needed, 8)
    }
  }
  assert_eq(rt.position(), 4)
  let w2 = cw(CdrEndian::Little)
  let before = w2.to_bytes()
  let pos = w2.position()
  match w2.write_byte_sequence(b"ABC"[:], max_elements=2U) {
    Ok(_) => abort("expected write bounds")
    Err(e) => {
      assert_eq(e.code, CODE_BOUNDS_EXCEEDED)
      assert_eq(e.needed, 3)
      assert_eq(e.remaining, 2)
    }
  }
  cexpect_writer_frozen(w2, before, pos)
}

///|
test "fixed int32 array composition LE BE with leading u8 alignment" {
  // u8 then i32[3]: pad 3 after u8, then three LE/BE int32 values.
  let vals : Array[Int] = [-1, 0, 2147483647]
  for endian in [CdrEndian::Little, CdrEndian::Big] {
    let w = cw(endian)
    match w.write_u8(b'\xaa') {
      Ok(_) => ()
      Err(e) => abort(e.code)
    }
    // Fixed-width preflight: 3 * 4 against remaining capacity via checked path.
    match w.remaining_capacity() {
      rem => {
        // span for three i32 from current position after pad
        let field = w.position()
        let pad = padding_for(field, 4)
        assert_eq(pad, 3)
        ignore(rem)
      }
    }
    let mut i = 0
    while i < 3 {
      match w.write_i32(vals[i]) {
        Ok(_) => ()
        Err(e) => abort(e.code)
      }
      i = i + 1
    }
    let bytes = w.to_bytes()
    assert_eq(bytes[4], b'\xaa')
    assert_eq(bytes[5], b'\x00')
    assert_eq(bytes[6], b'\x00')
    assert_eq(bytes[7], b'\x00')
    let r = cr(bytes[:])
    match r.read_u8() {
      Ok(b) => assert_eq(b, b'\xaa')
      Err(e) => abort(e.code)
    }
    // Preflight span before loop (stream bounds path).
    match r.checked_span_length(3UL, 4) {
      Ok(n) => assert_eq(n, 12)
      Err(e) => abort(e.code)
    }
    i = 0
    while i < 3 {
      match r.read_i32() {
        Ok(v) => assert_eq(v, vals[i])
        Err(e) => abort(e.code)
      }
      i = i + 1
    }
  }
}

///|
test "nested aggregate composition with tokens" {
  // Nested: outer enter → u8, string, sequence length + two i16, inner enter → bool
  let w = cw(CdrEndian::Little)
  let root = w.root_nesting()
  assert_eq(root.depth(), 0)
  let outer = match w.enter_nested(root) {
    Ok(n) => n
    Err(e) => abort(e.code)
  }
  assert_eq(outer.depth(), 1)
  match w.write_u8(b'\x01') {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  match w.write_string("x"[:]) {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  match w.write_sequence_length(2) {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  match w.write_i16(10) {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  match w.write_i16(20) {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  let inner = match w.enter_nested(outer) {
    Ok(n) => n
    Err(e) => abort(e.code)
  }
  assert_eq(inner.depth(), 2)
  match w.write_bool(true) {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  let r = cr(w.to_bytes()[:])
  let r_root = r.root_nesting()
  let r_outer = match r.enter_nested(r_root) {
    Ok(n) => n
    Err(e) => abort(e.code)
  }
  match r.read_u8() {
    Ok(b) => assert_eq(b, b'\x01')
    Err(e) => abort(e.code)
  }
  match r.read_string() {
    Ok(s) => assert_eq(s, "x")
    Err(e) => abort(e.code)
  }
  match r.read_sequence_length() {
    Ok(n) => assert_eq(n, 2)
    Err(e) => abort(e.code)
  }
  match r.read_i16() {
    Ok(v) => assert_eq(v, 10)
    Err(e) => abort(e.code)
  }
  match r.read_i16() {
    Ok(v) => assert_eq(v, 20)
    Err(e) => abort(e.code)
  }
  let r_inner = match r.enter_nested(r_outer) {
    Ok(n) => n
    Err(e) => abort(e.code)
  }
  assert_eq(r_inner.depth(), 2)
  match r.read_bool() {
    Ok(v) => assert_eq(v, true)
    Err(e) => abort(e.code)
  }
  // Sibling independence: two enters from same parent share depth, not identity.
  let s1 = match w.enter_nested(outer) {
    Ok(n) => n
    Err(e) => abort(e.code)
  }
  let s2 = match w.enter_nested(outer) {
    Ok(n) => n
    Err(e) => abort(e.code)
  }
  assert_eq(s1.depth(), 2)
  assert_eq(s2.depth(), 2)
}

///|
test "nesting depth 64 accept 65 reject and custom max" {
  let w = cw(CdrEndian::Little)
  let mut tok = w.root_nesting()
  let mut d = 0
  while d < 64 {
    tok = match w.enter_nested(tok) {
      Ok(n) => n
      Err(e) => abort(e.code)
    }
    d = d + 1
  }
  assert_eq(tok.depth(), 64)
  let pos = w.position()
  let before = w.to_bytes()
  match w.enter_nested(tok) {
    Ok(_) => abort("expected depth 65 reject writer")
    Err(e) => {
      assert_eq(e.code, CODE_BOUNDS_EXCEEDED)
      assert_eq(e.needed, 65)
      assert_eq(e.remaining, 64)
      assert_eq(e.offset, pos)
    }
  }
  cexpect_writer_frozen(w, before, pos)
  let r = cr(b"\x00\x01\x00\x00"[:])
  let mut rtok = r.root_nesting()
  d = 0
  while d < 64 {
    rtok = match r.enter_nested(rtok) {
      Ok(n) => n
      Err(e) => abort(e.code)
    }
    d = d + 1
  }
  assert_eq(rtok.depth(), 64)
  assert_eq(r.position(), 4)
  match r.enter_nested(rtok) {
    Ok(_) => abort("expected depth 65 reject reader")
    Err(e) => {
      assert_eq(e.code, CODE_BOUNDS_EXCEEDED)
      assert_eq(e.needed, 65)
      assert_eq(e.remaining, 64)
      assert_eq(e.offset, 4)
    }
  }
  assert_eq(r.position(), 4)
  // Custom max depth 2
  let limits = match CdrLimits::new(64, 2, 64) {
    Ok(l) => l
    Err(e) => abort(e.code)
  }
  let w2 = cw_limits(CdrEndian::Little, limits)
  let t0 = w2.root_nesting()
  let t1 = match w2.enter_nested(t0) {
    Ok(n) => n
    Err(e) => abort(e.code)
  }
  let t2 = match w2.enter_nested(t1) {
    Ok(n) => n
    Err(e) => abort(e.code)
  }
  assert_eq(t2.depth(), 2)
  match w2.enter_nested(t2) {
    Ok(_) => abort("expected custom depth reject")
    Err(e) => {
      assert_eq(e.needed, 3)
      assert_eq(e.remaining, 2)
    }
  }
}
