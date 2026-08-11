///|
/// Black-box compile-and-run check: public CdrError fields, CdrLimits fields,
/// and header accessors are visible outside `moonspan/rclmbt/cdr`.

///|
test "public CdrError fields readable across packages" {
  match @cdr.CdrReader::open_default(b"\x00"[:]) {
    Ok(_) => abort("expected invalid_encapsulation")
    Err(e) => {
      assert_eq(e.code, @cdr.CODE_INVALID_ENCAPSULATION)
      assert_eq(e.offset, 0)
      assert_eq(e.needed, 4)
      assert_eq(e.remaining, 1)
    }
  }
}

///|
test "public limits and header accessors across packages" {
  let limits = match @cdr.CdrLimits::new(32, 8, 16) {
    Ok(l) => l
    Err(e) => abort(e.code)
  }
  assert_eq(limits.max_stream_bytes, 32)
  assert_eq(limits.max_nesting_depth, 8)
  assert_eq(limits.max_temporary_allocation, 16)
  let input = b"\x00\x01\xab\xcd"
  match @cdr.CdrReader::open(input[:], limits) {
    Ok(r) => {
      assert_eq(r.representation(), @cdr.REPRESENTATION_CDR_LE)
      assert_eq(r.options(), 0xabcd)
      assert_eq(r.little_endian(), true)
      match r.endian() {
        @cdr.CdrEndian::Little => ()
        @cdr.CdrEndian::Big => abort("expected little")
      }
      let h = r.header()
      assert_eq(h.representation, @cdr.REPRESENTATION_CDR_LE)
      assert_eq(h.options, 0xabcd)
      assert_eq(r.limits().max_stream_bytes, 32)
    }
    Err(e) => abort(e.code)
  }
}

///|
test "public oversized open needed remaining convention across packages" {
  let limits = match @cdr.CdrLimits::new(4, 4, 4) {
    Ok(l) => l
    Err(e) => abort(e.code)
  }
  let input = b"\x00\x01\x00\x00\xff"
  match @cdr.CdrReader::open(input[:], limits) {
    Ok(_) => abort("expected bounds")
    Err(e) => {
      assert_eq(e.code, @cdr.CODE_BOUNDS_EXCEEDED)
      assert_eq(e.needed, 5)
      assert_eq(e.remaining, 4)
    }
  }
}

///|
test "public writer API and width-exact types across packages" {
  let limits = match @cdr.CdrLimits::new(32, 8, 32) {
    Ok(l) => l
    Err(e) => abort(e.code)
  }
  // External packages construct only via factory methods (fields are private).
  match @cdr.CdrWriter::new(@cdr.CdrEndian::little(), limits) {
    Ok(w) => {
      assert_eq(w.representation(), @cdr.REPRESENTATION_CDR_LE)
      assert_eq(w.options(), 0)
      assert_eq(w.little_endian(), true)
      assert_eq(w.position(), 4)
      assert_eq(w.capacity(), 32)
      assert_eq(w.remaining_capacity(), 28)
      // Snapshot length equals logical stream length (header only at start).
      assert_eq(w.to_bytes().length(), @cdr.HEADER_LENGTH)
      assert_eq(@cdr.WRITER_INITIAL_SIZE_HINT, @cdr.HEADER_LENGTH)
      match w.write_u16((0xffff).to_uint16()) {
        Ok(_) => ()
        Err(e) => abort(e.code)
      }
      match w.write_u32(0xffffffffU) {
        Ok(_) => ()
        Err(e) => abort(e.code)
      }
      match w.write_u64(0xffffffffffffffffUL) {
        Ok(_) => ()
        Err(e) => abort(e.code)
      }
      let snap = w.to_bytes()
      match @cdr.CdrReader::open_default(snap[:]) {
        Ok(r) => {
          // Typed helpers force UInt16 / UInt / UInt64 return bindings.
          match require_read_u16(r) {
            Ok(v) => assert_eq(v, (0xffff).to_uint16())
            Err(e) => abort(e.code)
          }
          match require_read_u32(r) {
            Ok(v) => assert_eq(v, 0xffffffffU)
            Err(e) => abort(e.code)
          }
          match require_read_u64(r) {
            Ok(v) => assert_eq(v, 0xffffffffffffffffUL)
            Err(e) => abort(e.code)
          }
        }
        Err(e) => abort(e.code)
      }
    }
    Err(e) => abort(e.code)
  }
}

///|
test "unsigned assembly preserves high-bit u32 patterns" {
  // LE bytes for 0x80000000 and 0xffffffff through width-exact unsigned shifts.
  let input = b"\x00\x01\x00\x00\x00\x00\x00\x80\xff\xff\xff\xff"
  match @cdr.CdrReader::open_default(input[:]) {
    Ok(r) => {
      match require_read_u32(r) {
        Ok(v) => assert_eq(v, 0x80000000U)
        Err(e) => abort(e.code)
      }
      match require_read_u32(r) {
        Ok(v) => assert_eq(v, 0xffffffffU)
        Err(e) => abort(e.code)
      }
    }
    Err(e) => abort(e.code)
  }
}
