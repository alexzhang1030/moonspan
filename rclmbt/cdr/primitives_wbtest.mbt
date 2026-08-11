///|
/// Semantic primitive codec tests (M1-01c1).

///|
fn pwriter(endian : CdrEndian) -> CdrWriter {
  match CdrWriter::new(endian, CdrLimits::defaults()) {
    Ok(w) => w
    Err(e) => abort(e.code)
  }
}

///|
fn preader(bytes : BytesView) -> CdrReader {
  match CdrReader::open_default(bytes) {
    Ok(r) => r
    Err(e) => abort(e.code)
  }
}

///|
fn roundtrip_bool(endian : CdrEndian, value : Bool) -> Unit raise {
  let w = pwriter(endian)
  match w.write_bool(value) {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  let r = preader(w.to_bytes()[:])
  match r.read_bool() {
    Ok(v) => assert_eq(v, value)
    Err(e) => abort(e.code)
  }
}

///|
test "bool both endians" {
  roundtrip_bool(CdrEndian::Little, false)
  roundtrip_bool(CdrEndian::Little, true)
  roundtrip_bool(CdrEndian::Big, false)
  roundtrip_bool(CdrEndian::Big, true)
}

///|
test "invalid boolean atomic cursor and error fields" {
  let input = b"\x00\x01\x00\x00\x02"
  let r = preader(input[:])
  assert_eq(r.position(), 4)
  match r.read_bool() {
    Ok(_) => abort("expected invalid_boolean")
    Err(e) => {
      assert_eq(e.code, CODE_INVALID_BOOLEAN)
      assert_eq(e.offset, 4)
      assert_eq(e.needed, 1)
      assert_eq(e.remaining, 1)
    }
  }
  assert_eq(r.position(), 4)
}

///|
test "signed i8 i16 boundaries both endians" {
  let cases_i8 : Array[Int] = [-128, -1, 0, 1, 127]
  for endian in [CdrEndian::Little, CdrEndian::Big] {
    for v in cases_i8 {
      let w = pwriter(endian)
      match w.write_i8(v) {
        Ok(_) => ()
        Err(e) => abort(e.code)
      }
      let r = preader(w.to_bytes()[:])
      match r.read_i8() {
        Ok(got) => assert_eq(got, v)
        Err(e) => abort(e.code)
      }
    }
    let cases_i16 : Array[Int] = [-32768, -1, 0, 1, 32767]
    for v in cases_i16 {
      let w = pwriter(endian)
      match w.write_i16(v) {
        Ok(_) => ()
        Err(e) => abort(e.code)
      }
      let r = preader(w.to_bytes()[:])
      match r.read_i16() {
        Ok(got) => assert_eq(got, v)
        Err(e) => abort(e.code)
      }
    }
  }
}

///|
test "signed i8 i16 out of range bounds before mutation" {
  let w = pwriter(CdrEndian::Little)
  let before = w.to_bytes()
  let pos = w.position()
  match w.write_i8(128) {
    Ok(_) => abort("expected bounds i8")
    Err(e) => {
      assert_eq(e.code, CODE_BOUNDS_EXCEEDED)
      assert_eq(e.offset, pos)
      assert_eq(e.needed, 1)
    }
  }
  assert_eq(w.position(), pos)
  assert_eq(w.to_bytes().length(), before.length())
  match w.write_i8(-129) {
    Ok(_) => abort("expected bounds i8 low")
    Err(e) => assert_eq(e.code, CODE_BOUNDS_EXCEEDED)
  }
  assert_eq(w.position(), pos)
  match w.write_i16(32768) {
    Ok(_) => abort("expected bounds i16")
    Err(e) => {
      assert_eq(e.code, CODE_BOUNDS_EXCEEDED)
      assert_eq(e.needed, 2)
    }
  }
  assert_eq(w.position(), pos)
  match w.write_i16(-32769) {
    Ok(_) => abort("expected bounds i16 low")
    Err(e) => assert_eq(e.code, CODE_BOUNDS_EXCEEDED)
  }
  assert_eq(w.position(), pos)
  let after = w.to_bytes()
  assert_eq(after.length(), before.length())
  let mut i = 0
  while i < after.length() {
    assert_eq(after[i], before[i])
    i = i + 1
  }
}

///|
test "signed i32 i64 both endians" {
  let i32s : Array[Int] = [-2147483648, -1, 0, 1, 2147483647]
  for endian in [CdrEndian::Little, CdrEndian::Big] {
    for v in i32s {
      let w = pwriter(endian)
      match w.write_i32(v) {
        Ok(_) => ()
        Err(e) => abort(e.code)
      }
      let r = preader(w.to_bytes()[:])
      match r.read_i32() {
        Ok(got) => assert_eq(got, v)
        Err(e) => abort(e.code)
      }
    }
    let i64s : Array[Int64] = [
      -9223372036854775807L - 1L,
      -1L,
      0L,
      1L,
      9223372036854775807L,
    ]
    for v in i64s {
      let w = pwriter(endian)
      match w.write_i64(v) {
        Ok(_) => ()
        Err(e) => abort(e.code)
      }
      let r = preader(w.to_bytes()[:])
      match r.read_i64() {
        Ok(got) => assert_eq(got, v)
        Err(e) => abort(e.code)
      }
    }
  }
}

///|
test "float32 float64 bit identity signed zero and nan" {
  // Known bit patterns: +0, -0, 1.0, -12.5, quiet NaN payload.
  let f32_bits : Array[UInt] = [
    0x00000000U, 0x80000000U, 0x3f800000U, 0xc1480000U, 0x7fc00001U,
  ]
  let f64_bits : Array[UInt64] = [
    0x0000000000000000UL, 0x8000000000000000UL, 0x3ff0000000000000UL, 0x40c81c9000000000UL,
    0x7ff8000000000001UL,
  ]
  for endian in [CdrEndian::Little, CdrEndian::Big] {
    for bits in f32_bits {
      let w = pwriter(endian)
      let f = Float::reinterpret_from_uint(bits)
      match w.write_f32(f) {
        Ok(_) => ()
        Err(e) => abort(e.code)
      }
      let r = preader(w.to_bytes()[:])
      match r.read_f32() {
        Ok(got) => assert_eq(Float::reinterpret_as_uint(got), bits)
        Err(e) => abort(e.code)
      }
    }
    for bits in f64_bits {
      let w = pwriter(endian)
      let d = UInt64::reinterpret_as_double(bits)
      match w.write_f64(d) {
        Ok(_) => ()
        Err(e) => abort(e.code)
      }
      let r = preader(w.to_bytes()[:])
      match r.read_f64() {
        Ok(got) => assert_eq(got.reinterpret_as_uint64(), bits)
        Err(e) => abort(e.code)
      }
    }
  }
}

///|
test "char8 char16 both endians" {
  for endian in [CdrEndian::Little, CdrEndian::Big] {
    let w = pwriter(endian)
    match w.write_char8(b'Z') {
      Ok(_) => ()
      Err(e) => abort(e.code)
    }
    match w.write_char16((0x6708).to_uint16()) {
      Ok(_) => ()
      Err(e) => abort(e.code)
    }
    let r = preader(w.to_bytes()[:])
    match r.read_char8() {
      Ok(c) => assert_eq(c, b'Z')
      Err(e) => abort(e.code)
    }
    match r.read_char16() {
      Ok(c) => assert_eq(c, (0x6708).to_uint16())
      Err(e) => abort(e.code)
    }
  }
}

///|
test "primitive capacity fault preserves writer bytes" {
  let limits = match CdrLimits::new(5, 8, 5) {
    Ok(l) => l
    Err(e) => abort(e.code)
  }
  // Header 4 + 1 body byte capacity.
  let w = match CdrWriter::new(CdrEndian::Little, limits) {
    Ok(w) => w
    Err(e) => abort(e.code)
  }
  match w.write_bool(true) {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  let snap = w.to_bytes()
  let pos = w.position()
  match w.write_i16(1) {
    Ok(_) => abort("expected capacity bounds")
    Err(e) => assert_eq(e.code, CODE_BOUNDS_EXCEEDED)
  }
  assert_eq(w.position(), pos)
  let after = w.to_bytes()
  assert_eq(after.length(), snap.length())
  let mut i = 0
  while i < after.length() {
    assert_eq(after[i], snap[i])
    i = i + 1
  }
}

///|
test "primitive_scalars corpus prefix semantic path" {
  // bool, byte-as-u8, char8, f32(-12.5), f64(12345.125) matching H-FT prefix.
  let w = pwriter(CdrEndian::Little)
  match w.write_bool(true) {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  match w.write_u8(b'\xa5') {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  match w.write_char8(b'\x5a') {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  match w.write_f32(Float::reinterpret_from_uint(0xc1480000U)) {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  match w.write_f64(UInt64::reinterpret_as_double(0x40c81c9000000000UL)) {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  assert_eq(w.position(), 20)
  let bytes = w.to_bytes()
  assert_eq(bytes[0], b'\x00')
  assert_eq(bytes[1], b'\x01')
  assert_eq(bytes[4], b'\x01')
  assert_eq(bytes[5], b'\xa5')
  assert_eq(bytes[6], b'\x5a')
  assert_eq(bytes[7], b'\x00')
  let r = preader(bytes[:])
  match r.read_bool() {
    Ok(v) => assert_eq(v, true)
    Err(e) => abort(e.code)
  }
  match r.read_u8() {
    Ok(v) => assert_eq(v, b'\xa5')
    Err(e) => abort(e.code)
  }
  match r.read_char8() {
    Ok(v) => assert_eq(v, b'\x5a')
    Err(e) => abort(e.code)
  }
  match r.read_f32() {
    Ok(v) => assert_eq(Float::reinterpret_as_uint(v), 0xc1480000U)
    Err(e) => abort(e.code)
  }
  match r.read_f64() {
    Ok(v) => assert_eq(v.reinterpret_as_uint64(), 0x40c81c9000000000UL)
    Err(e) => abort(e.code)
  }
}
