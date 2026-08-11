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
