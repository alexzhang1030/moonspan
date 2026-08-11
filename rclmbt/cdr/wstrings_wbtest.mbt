///|
/// ROS 2 legacy wstring and corpus-completion tests (M1-01c2b).

///|
fn ww(endian : CdrEndian) -> CdrWriter {
  match CdrWriter::new(endian, CdrLimits::defaults()) {
    Ok(w) => w
    Err(e) => abort(e.code)
  }
}

///|
fn ww_limits(endian : CdrEndian, limits : CdrLimits) -> CdrWriter {
  match CdrWriter::new(endian, limits) {
    Ok(w) => w
    Err(e) => abort(e.code)
  }
}

///|
fn wr(bytes : BytesView) -> CdrReader {
  match CdrReader::open_default(bytes) {
    Ok(r) => r
    Err(e) => abort(e.code)
  }
}

///|
fn wr_limits(bytes : BytesView, limits : CdrLimits) -> CdrReader {
  match CdrReader::open(bytes, limits) {
    Ok(r) => r
    Err(e) => abort(e.code)
  }
}

///|
fn expect_writer_frozen(w : CdrWriter, before : Bytes, pos : Int) -> Unit raise {
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
fn expect_full_wire(got : Bytes, expect : Array[Byte]) -> Unit raise {
  assert_eq(got.length(), expect.length())
  let mut i = 0
  while i < expect.length() {
    assert_eq(got[i], expect[i])
    i = i + 1
  }
}

///|
fn yuemian() -> String {
  "月面CDR"
}

///|
test "wstring empty exact LE and BE" {
  let wle = ww(CdrEndian::Little)
  match wle.write_wstring(""[:]) {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  let le = wle.to_bytes()
  // header + count 0 LE
  assert_eq(le.length(), 8)
  assert_eq(le[4], b'\x00')
  assert_eq(le[5], b'\x00')
  assert_eq(le[6], b'\x00')
  assert_eq(le[7], b'\x00')
  let wbe = ww(CdrEndian::Big)
  match wbe.write_wstring(""[:]) {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  let be = wbe.to_bytes()
  assert_eq(be[4], b'\x00')
  assert_eq(be[5], b'\x00')
  assert_eq(be[6], b'\x00')
  assert_eq(be[7], b'\x00')
  match wr(le[:]).read_wstring() {
    Ok(s) => assert_eq(s, "")
    Err(e) => abort(e.code)
  }
  match wr(be[:]).read_wstring() {
    Ok(s) => assert_eq(s, "")
    Err(e) => abort(e.code)
  }
}

///|
test "wstring yuemian CDR exact LE and BE round trip" {
  // Full wire: header + count 5 + five UInt32 slots for 月 面 C D R.
  let le_expect : Array[Byte] = [
    b'\x00', b'\x01', b'\x00', b'\x00', // header LE
     b'\x05', b'\x00', b'\x00', b'\x00', // N=5 LE
     b'\x08', b'\x67', b'\x00', b'\x00', // U+6708 月
     b'\x62', b'\x97', b'\x00', b'\x00', // U+9762 面
     b'\x43', b'\x00', b'\x00', b'\x00', // C
     b'\x44', b'\x00', b'\x00', b'\x00', // D
     b'\x52', b'\x00', b'\x00', b'\x00', // R
  ]
  let be_expect : Array[Byte] = [
    b'\x00', b'\x00', b'\x00', b'\x00', // header BE
     b'\x00', b'\x00', b'\x00', b'\x05', // N=5 BE
     b'\x00', b'\x00', b'\x67', b'\x08', // U+6708 月
     b'\x00', b'\x00', b'\x97', b'\x62', // U+9762 面
     b'\x00', b'\x00', b'\x00', b'\x43', // C
     b'\x00', b'\x00', b'\x00', b'\x44', // D
     b'\x00', b'\x00', b'\x00', b'\x52', // R
  ]
  let wle = ww(CdrEndian::Little)
  match wle.write_wstring(yuemian()[:]) {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  expect_full_wire(wle.to_bytes(), le_expect)
  let wbe = ww(CdrEndian::Big)
  match wbe.write_wstring(yuemian()[:]) {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  expect_full_wire(wbe.to_bytes(), be_expect)
  match wr(wle.to_bytes()[:]).read_wstring() {
    Ok(s) => assert_eq(s, yuemian())
    Err(e) => abort(e.code)
  }
  match wr(wbe.to_bytes()[:]).read_wstring() {
    Ok(s) => assert_eq(s, yuemian())
    Err(e) => abort(e.code)
  }
}

///|
test "wstring non-BMP scalar both endians" {
  // U+1F600 😀 → one slot 0x0001F600; full LE/BE wire including count.
  let grin = "😀"
  let le_expect : Array[Byte] = [
    b'\x00', b'\x01', b'\x00', b'\x00', // header LE
     b'\x01', b'\x00', b'\x00', b'\x00', // N=1 LE
     b'\x00', b'\xf6', b'\x01', b'\x00', // 0x0001F600 LE
  ]
  let be_expect : Array[Byte] = [
    b'\x00', b'\x00', b'\x00', b'\x00', // header BE
     b'\x00', b'\x00', b'\x00', b'\x01', // N=1 BE
     b'\x00', b'\x01', b'\xf6', b'\x00', // 0x0001F600 BE
  ]
  let wle = ww(CdrEndian::Little)
  match wle.write_wstring(grin[:]) {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  expect_full_wire(wle.to_bytes(), le_expect)
  let wbe = ww(CdrEndian::Big)
  match wbe.write_wstring(grin[:]) {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  expect_full_wire(wbe.to_bytes(), be_expect)
  match wr(wle.to_bytes()[:]).read_wstring() {
    Ok(s) => assert_eq(s, grin)
    Err(e) => abort(e.code)
  }
  match wr(wbe.to_bytes()[:]).read_wstring() {
    Ok(s) => assert_eq(s, grin)
    Err(e) => abort(e.code)
  }
}

///|
test "wstring accepted scalar boundaries" {
  // Build via String chars that map to the boundary scalars.
  let d7ff = String::from_array([(0xD7FF).unsafe_to_char()])
  let e000 = String::from_array([(0xE000).unsafe_to_char()])
  let maxcp = String::from_array([(0x10FFFF).unsafe_to_char()])
  for s in [d7ff, e000, maxcp] {
    for endian in [CdrEndian::Little, CdrEndian::Big] {
      let w = ww(endian)
      match w.write_wstring(s[:]) {
        Ok(_) => ()
        Err(e) => abort(e.code)
      }
      match wr(w.to_bytes()[:]).read_wstring() {
        Ok(got) => assert_eq(got, s)
        Err(e) => abort(e.code)
      }
    }
  }
  // Wire-level accepted slots D7FF / E000 / 10FFFF (LE count 1 + slot).
  let wire_d7ff = b"\x00\x01\x00\x00\x01\x00\x00\x00\xff\xd7\x00\x00"
  match wr(wire_d7ff[:]).read_wstring() {
    Ok(s) => assert_eq(s, d7ff)
    Err(e) => abort(e.code)
  }
  let wire_e000 = b"\x00\x01\x00\x00\x01\x00\x00\x00\x00\xe0\x00\x00"
  match wr(wire_e000[:]).read_wstring() {
    Ok(s) => assert_eq(s, e000)
    Err(e) => abort(e.code)
  }
  let wire_max = b"\x00\x01\x00\x00\x01\x00\x00\x00\xff\xff\x10\x00"
  match wr(wire_max[:]).read_wstring() {
    Ok(s) => assert_eq(s, maxcp)
    Err(e) => abort(e.code)
  }
}

///|
test "wstring rejected scalar slots restore cursor" {
  // count 1 LE + slot D800
  let d800 = b"\x00\x01\x00\x00\x01\x00\x00\x00\x00\xd8\x00\x00"
  let r1 = wr(d800[:])
  assert_eq(r1.position(), 4)
  match r1.read_wstring() {
    Ok(_) => abort("expected invalid D800")
    Err(e) => {
      assert_eq(e.code, CODE_INVALID_WSTRING_SCALAR)
      assert_eq(e.offset, 4)
      assert_eq(e.needed, 4)
      assert_eq(e.remaining, 8)
    }
  }
  assert_eq(r1.position(), 4)
  // DFFF
  let dfff = b"\x00\x01\x00\x00\x01\x00\x00\x00\xff\xdf\x00\x00"
  let r2 = wr(dfff[:])
  match r2.read_wstring() {
    Ok(_) => abort("expected invalid DFFF")
    Err(e) => assert_eq(e.code, CODE_INVALID_WSTRING_SCALAR)
  }
  assert_eq(r2.position(), 4)
  // 0x110000
  let over = b"\x00\x01\x00\x00\x01\x00\x00\x00\x00\x00\x11\x00"
  let r3 = wr(over[:])
  match r3.read_wstring() {
    Ok(_) => abort("expected invalid 110000")
    Err(e) => assert_eq(e.code, CODE_INVALID_WSTRING_SCALAR)
  }
  assert_eq(r3.position(), 4)
  // 0xffffffff
  let allf = b"\x00\x01\x00\x00\x01\x00\x00\x00\xff\xff\xff\xff"
  let r4 = wr(allf[:])
  match r4.read_wstring() {
    Ok(_) => abort("expected invalid ffffffff")
    Err(e) => assert_eq(e.code, CODE_INVALID_WSTRING_SCALAR)
  }
  assert_eq(r4.position(), 4)
}

///|
test "wstring count high-bit and host overflow" {
  let input = b"\x00\x01\x00\x00\xff\xff\xff\xff"
  let r = wr(input[:])
  match r.read_wstring() {
    Ok(_) => abort("expected length_overflow")
    Err(e) => {
      assert_eq(e.code, CODE_LENGTH_OVERFLOW)
      assert_eq(e.needed, 0)
      assert_eq(e.offset, 4)
    }
  }
  assert_eq(r.position(), 4)
  // 0x40000000 * 4 overflows host Int product path (0x100000000)
  let big = b"\x00\x01\x00\x00\x00\x00\x00\x40"
  let r2 = wr(big[:])
  match r2.read_wstring() {
    Ok(_) => abort("expected length_overflow mul")
    Err(e) => {
      assert_eq(e.code, CODE_LENGTH_OVERFLOW)
      assert_eq(e.needed, 0)
    }
  }
  assert_eq(r2.position(), 4)
}

///|
test "wstring absolute stream ceiling before truncation" {
  let limits = match CdrLimits::new(64, 4, 64) {
    Ok(l) => l
    Err(e) => abort(e.code)
  }
  // count 20 → payload 80 > max_stream 64
  let input = b"\x00\x01\x00\x00\x14\x00\x00\x00"
  let r = wr_limits(input[:], limits)
  match r.read_wstring() {
    Ok(_) => abort("expected length_overflow ceiling")
    Err(e) => {
      assert_eq(e.code, CODE_LENGTH_OVERFLOW)
      assert_eq(e.needed, 80)
      assert_eq(e.remaining, 64)
    }
  }
  assert_eq(r.position(), 4)
}

///|
test "wstring truncation restores cursor" {
  // count 2, only one slot present
  let input = b"\x00\x01\x00\x00\x02\x00\x00\x00\x41\x00\x00\x00"
  let r = wr(input[:])
  match r.read_wstring() {
    Ok(_) => abort("expected truncated")
    Err(e) => {
      assert_eq(e.code, CODE_TRUNCATED)
      assert_eq(e.offset, 4)
      // pad0 + 4 + 8 = 12
      assert_eq(e.needed, 12)
      assert_eq(e.remaining, 8)
    }
  }
  assert_eq(r.position(), 4)
}

///|
test "wstring max_scalars exact over and large open bound" {
  let w = ww(CdrEndian::Little)
  match w.write_wstring("AB"[:], max_scalars=2U) {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  let bytes = w.to_bytes()
  match wr(bytes[:]).read_wstring(max_scalars=2U) {
    Ok(s) => assert_eq(s, "AB")
    Err(e) => abort(e.code)
  }
  let r = wr(bytes[:])
  match r.read_wstring(max_scalars=1U) {
    Ok(_) => abort("expected bounds")
    Err(e) => {
      assert_eq(e.code, CODE_BOUNDS_EXCEEDED)
      assert_eq(e.needed, 2)
      assert_eq(e.remaining, 1)
    }
  }
  assert_eq(r.position(), 4)
  // 0xffffffffU stays open
  match wr(bytes[:]).read_wstring(max_scalars=0xffffffffU) {
    Ok(s) => assert_eq(s, "AB")
    Err(e) => abort(e.code)
  }
  let w2 = ww(CdrEndian::Little)
  let before = w2.to_bytes()
  let pos = w2.position()
  match w2.write_wstring("AB"[:], max_scalars=1U) {
    Ok(_) => abort("expected write bounds")
    Err(e) => {
      assert_eq(e.code, CODE_BOUNDS_EXCEEDED)
      assert_eq(e.needed, 2)
      assert_eq(e.remaining, 1)
    }
  }
  expect_writer_frozen(w2, before, pos)
  match w2.write_wstring("A"[:], max_scalars=0xffffffffU) {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
}

///|
test "wstring temporary allocation cap" {
  // count 3 → worst-case storage 12; temp 11 rejects
  let limits = match CdrLimits::new(64, 4, 11) {
    Ok(l) => l
    Err(e) => abort(e.code)
  }
  let input = b"\x00\x01\x00\x00\x03\x00\x00\x00A\x00\x00\x00B\x00\x00\x00C\x00\x00\x00"
  let r = wr_limits(input[:], limits)
  match r.read_wstring() {
    Ok(_) => abort("expected temp bounds")
    Err(e) => {
      assert_eq(e.code, CODE_BOUNDS_EXCEEDED)
      assert_eq(e.needed, 12)
      assert_eq(e.remaining, 11)
    }
  }
  assert_eq(r.position(), 4)
  let limits_ok = match CdrLimits::new(64, 4, 12) {
    Ok(l) => l
    Err(e) => abort(e.code)
  }
  match wr_limits(input[:], limits_ok).read_wstring() {
    Ok(s) => assert_eq(s, "ABC")
    Err(e) => abort(e.code)
  }
}

///|
test "wstring writer capacity and invalid surrogate atomic" {
  // capacity 12: header 4, rem 8 → max scalars (8-4)/4 = 1
  let limits = match CdrLimits::new(12, 4, 12) {
    Ok(l) => l
    Err(e) => abort(e.code)
  }
  let w = ww_limits(CdrEndian::Little, limits)
  match w.write_wstring("A"[:]) {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  assert_eq(w.position(), 12)
  let w2 = ww_limits(CdrEndian::Little, limits)
  let before = w2.to_bytes()
  let pos = w2.position()
  match w2.write_wstring("AB"[:]) {
    Ok(_) => abort("expected capacity")
    Err(e) => {
      assert_eq(e.code, CODE_BOUNDS_EXCEEDED)
      assert_eq(e.offset, pos)
      // pad0 + 4 + 8 = 12 needed for 2 scalars, rem 8
      assert_eq(e.needed, 12)
      assert_eq(e.remaining, 8)
    }
  }
  expect_writer_frozen(w2, before, pos)
  let invalid = String::from_array([(0xD800).unsafe_to_char(), 'a'])
  match w2.write_wstring(invalid[:]) {
    Ok(_) => abort("expected invalid surrogate")
    Err(e) => {
      assert_eq(e.code, CODE_INVALID_WSTRING_SCALAR)
      assert_eq(e.needed, 4)
    }
  }
  expect_writer_frozen(w2, before, pos)
}

///|
test "wstring strict versus corpus completion" {
  // Core empty wstring at end of stream
  let exact = b"\x00\x01\x00\x00\x00\x00\x00\x00"
  let r0 = wr(exact[:])
  match r0.read_wstring() {
    Ok(s) => assert_eq(s, "")
    Err(e) => abort(e.code)
  }
  match r0.ensure_complete() {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  match wr(exact[:]).read_wstring() {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  let r0b = wr(exact[:])
  match r0b.read_wstring() {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  match r0b.ensure_corpus_complete_terminal_wstring() {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  // Four zero tail slack
  let slack = b"\x00\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00"
  let rs = wr(slack[:])
  match rs.read_wstring() {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  assert_eq(rs.position(), 8)
  match rs.ensure_complete() {
    Ok(_) => abort("strict rejects four-zero tail")
    Err(e) => {
      assert_eq(e.code, CODE_TRAILING_DATA)
      assert_eq(e.offset, 8)
      assert_eq(e.remaining, 4)
    }
  }
  assert_eq(rs.position(), 8)
  match rs.ensure_corpus_complete_terminal_wstring() {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  assert_eq(rs.position(), 12)
  // Nonzero four-byte tail
  let bad4 = b"\x00\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x01"
  let rb = wr(bad4[:])
  match rb.read_wstring() {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  let pos = rb.position()
  match rb.ensure_corpus_complete_terminal_wstring() {
    Ok(_) => abort("nonzero four bytes")
    Err(e) => {
      assert_eq(e.code, CODE_TRAILING_DATA)
      assert_eq(e.remaining, 4)
    }
  }
  assert_eq(rb.position(), pos)
  // Short zero suffix (2 bytes)
  let shortz = b"\x00\x01\x00\x00\x00\x00\x00\x00\x00\x00"
  let rsh = wr(shortz[:])
  match rsh.read_wstring() {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  let psh = rsh.position()
  match rsh.ensure_corpus_complete_terminal_wstring() {
    Ok(_) => abort("short zero suffix")
    Err(e) => {
      assert_eq(e.code, CODE_TRAILING_DATA)
      assert_eq(e.remaining, 2)
    }
  }
  assert_eq(rsh.position(), psh)
  // Long zero suffix (8 bytes)
  let longz = b"\x00\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00"
  let rl = wr(longz[:])
  match rl.read_wstring() {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  let pl = rl.position()
  match rl.ensure_corpus_complete_terminal_wstring() {
    Ok(_) => abort("long zero suffix")
    Err(e) => {
      assert_eq(e.code, CODE_TRAILING_DATA)
      assert_eq(e.remaining, 8)
    }
  }
  assert_eq(rl.position(), pl)
}
