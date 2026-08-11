///|
/// Focused CDR1 reader tests (M1-01b1).

///|
fn bytes_of(arr : Array[Byte]) -> Bytes {
  Bytes::from_array(arr[:])
}

///|
fn expect_code(bytes : BytesView, code : String) -> CdrError raise {
  match CdrReader::open_default(bytes) {
    Ok(_) => abort("expected open error " + code)
    Err(e) => {
      assert_eq(e.code, code)
      e
    }
  }
}

///|
fn open_ok(bytes : BytesView) -> CdrReader {
  match CdrReader::open_default(bytes) {
    Ok(r) => r
    Err(e) => abort("open failed: " + e.code)
  }
}

///|
fn limits_ok(
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
test "default limit constants" {
  assert_eq(DEFAULT_MAX_STREAM_BYTES, 67108864)
  assert_eq(DEFAULT_MAX_NESTING_DEPTH, 64)
  assert_eq(DEFAULT_MAX_TEMPORARY_ALLOCATION, 67108864)
  assert_eq(BODY_ORIGIN, 4)
  assert_eq(HEADER_LENGTH, 4)
  assert_eq(REPRESENTATION_CDR_LE, 0x0001)
  assert_eq(REPRESENTATION_CDR_BE, 0x0000)
  let d = CdrLimits::defaults()
  assert_eq(d.max_stream_bytes, 67108864)
  assert_eq(d.max_nesting_depth, 64)
  assert_eq(d.max_temporary_allocation, 67108864)
}

///|
test "truncated headers lengths 0 through 3" {
  let mut n = 0
  while n < 4 {
    let arr : Array[Byte] = []
    let mut i = 0
    while i < n {
      arr.push(b'\x00')
      i = i + 1
    }
    let e = expect_code(bytes_of(arr)[:], CODE_INVALID_ENCAPSULATION)
    assert_eq(e.offset, 0)
    assert_eq(e.needed, 4)
    assert_eq(e.remaining, n)
    n = n + 1
  }
}

///|
test "little and big endian representation and accessors" {
  let le = open_ok(b"\x00\x01\x00\x00"[:])
  assert_eq(le.representation(), REPRESENTATION_CDR_LE)
  assert_eq(le.options(), 0)
  assert_eq(le.little_endian(), true)
  match le.endian() {
    CdrEndian::Little => ()
    CdrEndian::Big => abort("expected little")
  }
  assert_eq(le.position(), 4)
  let be = open_ok(b"\x00\x00\x00\x00"[:])
  assert_eq(be.representation(), REPRESENTATION_CDR_BE)
  assert_eq(be.little_endian(), false)
  match be.endian() {
    CdrEndian::Big => ()
    CdrEndian::Little => abort("expected big")
  }
}

///|
test "options metadata including 0xffff network byte order" {
  let r = open_ok(b"\x00\x01\x12\x34"[:])
  assert_eq(r.options(), 0x1234)
  assert_eq(r.position(), 4)
  let r2 = open_ok(b"\x00\x00\xff\xfe"[:])
  assert_eq(r2.options(), 0xfffe)
  let r3 = open_ok(b"\x00\x01\xff\xff"[:])
  assert_eq(r3.options(), 0xffff)
}

///|
test "unsupported representation identifiers" {
  let e = expect_code(b"\x00\x02\x00\x00"[:], CODE_UNSUPPORTED_REPRESENTATION)
  assert_eq(e.offset, 0)
  let e2 = expect_code(b"\x00\x10\x00\x00"[:], CODE_UNSUPPORTED_REPRESENTATION)
  assert_eq(e2.code, CODE_UNSUPPORTED_REPRESENTATION)
}

///|
test "origin four alignment for 1 2 4 8" {
  let input = bytes_of([
    b'\x00', b'\x01', b'\x00', b'\x00', b'\xa5', b'\x00', b'\x34', b'\x12', b'\x78',
    b'\x56', b'\x34', b'\x12', b'\x01', b'\x00', b'\x00', b'\x00', b'\x00', b'\x00',
    b'\x00', b'\x00',
  ])
  let r = open_ok(input[:])
  match r.read_u8() {
    Ok(b) => assert_eq(b, b'\xa5')
    Err(e) => abort(e.code)
  }
  assert_eq(r.position(), 5)
  match r.read_u16() {
    Ok(v) => assert_eq(v, 0x1234UL)
    Err(e) => abort(e.code)
  }
  assert_eq(r.position(), 8)
  match r.read_u32() {
    Ok(v) => assert_eq(v, 0x12345678UL)
    Err(e) => abort(e.code)
  }
  assert_eq(r.position(), 12)
  match r.read_u64() {
    Ok(v) => assert_eq(v, 1UL)
    Err(e) => abort(e.code)
  }
  assert_eq(r.position(), 20)
}

///|
test "big and little raw bit equality including max u32 and u64" {
  // LE: u16, pad, u32=0xffffffff, u64=0xffffffffffffffff
  let le2 = bytes_of([
    b'\x00', b'\x01', b'\x00', b'\x00', b'\xcd', b'\xab', b'\x00', b'\x00', b'\xff',
    b'\xff', b'\xff', b'\xff', b'\xff', b'\xff', b'\xff', b'\xff', b'\xff', b'\xff',
    b'\xff', b'\xff',
  ])
  let r = open_ok(le2[:])
  match r.read_u16() {
    Ok(v) => assert_eq(v, 0xabcdUL)
    Err(e) => abort(e.code)
  }
  match r.read_u32() {
    Ok(v) => assert_eq(v, 0xffffffffUL)
    Err(e) => abort(e.code)
  }
  match r.read_u64() {
    Ok(v) => assert_eq(v, 0xffffffffffffffffUL)
    Err(e) => abort(e.code)
  }
  // BE counterparts
  let be = bytes_of([
    b'\x00', b'\x00', b'\x00', b'\x00', b'\xab', b'\xcd', b'\x00', b'\x00', b'\xff',
    b'\xff', b'\xff', b'\xff', b'\xff', b'\xff', b'\xff', b'\xff', b'\xff', b'\xff',
    b'\xff', b'\xff',
  ])
  let rb = open_ok(be[:])
  match rb.read_u16() {
    Ok(v) => assert_eq(v, 0xabcdUL)
    Err(e) => abort(e.code)
  }
  match rb.read_u32() {
    Ok(v) => assert_eq(v, 0xffffffffUL)
    Err(e) => abort(e.code)
  }
  match rb.read_u64() {
    Ok(v) => assert_eq(v, 0xffffffffffffffffUL)
    Err(e) => abort(e.code)
  }
}

///|
test "borrowed view physical identity" {
  let input = bytes_of([
    b'\x00', b'\x01', b'\x00', b'\x00', b'\xde', b'\xad', b'\xbe', b'\xef',
  ])
  let view = input[:]
  let r = open_ok(view)
  match r.read_bytes(4) {
    Ok(bv) => {
      assert_eq(bv.length(), 4)
      assert_eq(bv[0], b'\xde')
      assert_eq(bv[3], b'\xef')
      assert_eq(bv.start_offset(), 4)
      assert_eq(bv.data().length(), input.length())
      assert_eq(physical_equal(bv.data(), input), true)
    }
    Err(e) => abort(e.code)
  }
}

///|
test "borrowed view larger than temp allocation succeeds" {
  // temp alloc ceiling 1; borrowed span of 4 still allowed.
  let input = bytes_of([
    b'\x00', b'\x01', b'\x00', b'\x00', b'\x01', b'\x02', b'\x03', b'\x04',
  ])
  let limits = limits_ok(8, 8, 1)
  match CdrReader::open(input[:], limits) {
    Ok(r) =>
      match r.read_bytes(4) {
        Ok(bv) => {
          assert_eq(bv.length(), 4)
          assert_eq(r.position(), 8)
        }
        Err(e) => abort(e.code)
      }
    Err(e) => abort(e.code)
  }
}

///|
test "field failure cursor atomicity" {
  let input = b"\x00\x01\x00\x00\xa5"
  let r = open_ok(input[:])
  assert_eq(r.position(), 4)
  match r.read_u8() {
    Ok(b) => assert_eq(b, b'\xa5')
    Err(e) => abort(e.code)
  }
  assert_eq(r.position(), 5)
  match r.read_u32() {
    Ok(_) => abort("expected alignment_overflow")
    Err(e) => {
      assert_eq(e.code, CODE_ALIGNMENT_OVERFLOW)
      assert_eq(e.offset, 5)
    }
  }
  assert_eq(r.position(), 5)
}

///|
test "exact cursor preservation after each failure kind" {
  // Header + two body bytes.
  let input = b"\x00\x01\x00\x00\x11\x22"
  let r = open_ok(input[:])
  // truncated read_bytes
  match r.read_bytes(8) {
    Ok(_) => abort("expected truncated")
    Err(e) => {
      assert_eq(e.code, CODE_TRUNCATED)
      assert_eq(e.offset, 4)
    }
  }
  assert_eq(r.position(), 4)
  match r.read_u8() {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  // alignment_overflow for u64 at offset 5
  match r.read_u64() {
    Ok(_) => abort("expected alignment_overflow")
    Err(e) => {
      assert_eq(e.code, CODE_ALIGNMENT_OVERFLOW)
      assert_eq(e.offset, 5)
    }
  }
  assert_eq(r.position(), 5)
  // trailing_data leaves cursor unmoved (one body byte remains)
  match r.ensure_complete() {
    Ok(_) => abort("expected trailing")
    Err(e) => {
      assert_eq(e.code, CODE_TRAILING_DATA)
      assert_eq(e.offset, 5)
      assert_eq(e.remaining, 1)
    }
  }
  assert_eq(r.position(), 5)
}

///|
test "custom small stream limit bounds_exceeded without max plus one" {
  let input = b"\x00\x01\x00\x00\x01\x02\x03\x04"
  let limits = limits_ok(4, 64, 4)
  match CdrReader::open(input[:], limits) {
    Ok(_) => abort("expected bounds")
    Err(e) => {
      assert_eq(e.code, CODE_BOUNDS_EXCEEDED)
      assert_eq(e.offset, 0)
      assert_eq(e.needed, 4)
      assert_eq(e.remaining, 8)
    }
  }
}

///|
test "invalid limits construction" {
  match CdrLimits::new(3, 64, 3) {
    Ok(_) => abort("stream too small")
    Err(e) => {
      assert_eq(e.code, CODE_INVALID_LIMITS)
      assert_eq(e.offset, 0)
      assert_eq(e.needed, 3)
    }
  }
  match CdrLimits::new(67108865, 64, 64) {
    Ok(_) => abort("stream too large")
    Err(e) => assert_eq(e.code, CODE_INVALID_LIMITS)
  }
  match CdrLimits::new(64, 0, 64) {
    Ok(_) => abort("depth too small")
    Err(e) => assert_eq(e.code, CODE_INVALID_LIMITS)
  }
  match CdrLimits::new(64, 65, 64) {
    Ok(_) => abort("depth too large")
    Err(e) => assert_eq(e.code, CODE_INVALID_LIMITS)
  }
  match CdrLimits::new(64, 8, 65) {
    Ok(_) => abort("temp above stream")
    Err(e) => {
      assert_eq(e.code, CODE_INVALID_LIMITS)
      assert_eq(e.needed, 65)
      assert_eq(e.remaining, 64)
    }
  }
  match CdrLimits::new(64, 8, -1) {
    Ok(_) => abort("negative temp")
    Err(e) => assert_eq(e.code, CODE_INVALID_LIMITS)
  }
  // Boundary values accepted
  match CdrLimits::new(4, 1, 0) {
    Ok(l) => {
      assert_eq(l.max_stream_bytes, 4)
      assert_eq(l.max_nesting_depth, 1)
      assert_eq(l.max_temporary_allocation, 0)
    }
    Err(e) => abort(e.code)
  }
}

///|
test "checked span versus alloc length" {
  let r = open_ok(b"\x00\x01\x00\x00"[:])
  match r.checked_span_length(0xffffffffffffffffUL, 2) {
    Ok(_) => abort("expected length_overflow")
    Err(e) => assert_eq(e.code, CODE_LENGTH_OVERFLOW)
  }
  match r.checked_span_length(100UL, 4) {
    Ok(_) => abort("expected truncated vs remaining 0")
    Err(e) => assert_eq(e.code, CODE_TRUNCATED)
  }
  // 4-byte header + 20 body bytes; temp alloc ceiling 16.
  let limits = limits_ok(64, 8, 16)
  let body = bytes_of([
    b'\x00', b'\x01', b'\x00', b'\x00', b'\x00', b'\x00', b'\x00', b'\x00', b'\x00',
    b'\x00', b'\x00', b'\x00', b'\x00', b'\x00', b'\x00', b'\x00', b'\x00', b'\x00',
    b'\x00', b'\x00', b'\x00', b'\x00', b'\x00', b'\x00',
  ])
  match CdrReader::open(body[:], limits) {
    Ok(r2) => {
      match r2.checked_alloc_length(8UL, 4) {
        Ok(_) => abort("expected alloc bounds 32 > 16")
        Err(e) => {
          assert_eq(e.code, CODE_BOUNDS_EXCEEDED)
          assert_eq(e.needed, 32)
          assert_eq(e.remaining, 16)
        }
      }
      // Borrowed span of 20 is allowed even though temp is 16.
      match r2.checked_span_length(5UL, 4) {
        Ok(n) => assert_eq(n, 20)
        Err(e) => abort(e.code)
      }
      match r2.read_bytes(20) {
        Ok(bv) => assert_eq(bv.length(), 20)
        Err(e) => abort(e.code)
      }
    }
    Err(e) => abort(e.code)
  }
}

///|
test "alignment overflow when pad exceeds remaining" {
  let input = b"\x00\x01\x00\x00\x11"
  let r = open_ok(input[:])
  match r.read_u8() {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
  match r.read_u64() {
    Ok(_) => abort("expected fault")
    Err(e) => {
      assert_eq(e.code, CODE_ALIGNMENT_OVERFLOW)
      assert_eq(e.offset, 5)
      assert_eq(r.position(), 5)
    }
  }
}

///|
test "strict completion trailing_data" {
  let input = b"\x00\x01\x00\x00\xff"
  let r = open_ok(input[:])
  match r.ensure_complete() {
    Ok(_) => abort("expected trailing")
    Err(e) => {
      assert_eq(e.code, CODE_TRAILING_DATA)
      assert_eq(e.offset, 4)
      assert_eq(e.remaining, 1)
    }
  }
  match r.read_u8() {
    Ok(b) => assert_eq(b, b'\xff')
    Err(e) => abort(e.code)
  }
  match r.ensure_complete() {
    Ok(_) => ()
    Err(e) => abort(e.code)
  }
}

///|
test "corpus primitive_scalars prefix float64 at absolute offset 12" {
  let prefix = bytes_of([
    b'\x00', b'\x01', b'\x00', b'\x00', b'\x01', b'\xa5', b'\x5a', b'\x00', b'\x00',
    b'\x00', b'\x48', b'\xc1', b'\x00', b'\x00', b'\x00', b'\x00', b'\x90', b'\x1c',
    b'\xc8', b'\x40',
  ])
  let r = open_ok(prefix[:])
  match r.read_u8() {
    Ok(b) => assert_eq(b, b'\x01')
    Err(e) => abort(e.code)
  }
  match r.read_u8() {
    Ok(b) => assert_eq(b, b'\xa5')
    Err(e) => abort(e.code)
  }
  match r.read_u8() {
    Ok(b) => assert_eq(b, b'\x5a')
    Err(e) => abort(e.code)
  }
  match r.read_u32() {
    Ok(bits) => assert_eq(bits, 0xc1480000UL)
    Err(e) => abort(e.code)
  }
  assert_eq(r.position(), 12)
  match r.read_u64() {
    Ok(bits) => assert_eq(bits, 0x40c81c9000000000UL)
    Err(e) => abort(e.code)
  }
  assert_eq(r.position(), 20)
}

///|
test "read_bytes truncated restores cursor" {
  let input = b"\x00\x01\x00\x00\x01\x02"
  let r = open_ok(input[:])
  match r.read_bytes(8) {
    Ok(_) => abort("expected truncated")
    Err(e) => {
      assert_eq(e.code, CODE_TRUNCATED)
      assert_eq(e.offset, 4)
    }
  }
  assert_eq(r.position(), 4)
}
