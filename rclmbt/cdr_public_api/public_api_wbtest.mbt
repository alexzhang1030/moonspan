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

///|
test "public semantic primitive codecs across package boundary" {
  let limits = match @cdr.CdrLimits::new(128, 8, 128) {
    Ok(l) => l
    Err(e) => abort(e.code)
  }
  match @cdr.CdrWriter::new(@cdr.CdrEndian::little(), limits) {
    Ok(w) => {
      match require_write_bool(w, true) {
        Ok(_) => ()
        Err(e) => abort(e.code)
      }
      match require_write_i8(w, -128) {
        Ok(_) => ()
        Err(e) => abort(e.code)
      }
      match require_write_i16(w, -32768) {
        Ok(_) => ()
        Err(e) => abort(e.code)
      }
      match require_write_i32(w, -2147483648) {
        Ok(_) => ()
        Err(e) => abort(e.code)
      }
      match require_write_i64(w, -9223372036854775807L - 1L) {
        Ok(_) => ()
        Err(e) => abort(e.code)
      }
      let f32_bits = 0xc1480000U
      let f64_bits = 0x40c81c9000000000UL
      match require_write_f32(w, Float::reinterpret_from_uint(f32_bits)) {
        Ok(_) => ()
        Err(e) => abort(e.code)
      }
      match require_write_f64(w, UInt64::reinterpret_as_double(f64_bits)) {
        Ok(_) => ()
        Err(e) => abort(e.code)
      }
      match require_write_char8(w, b'A') {
        Ok(_) => ()
        Err(e) => abort(e.code)
      }
      match require_write_char16(w, (0x6708).to_uint16()) {
        Ok(_) => ()
        Err(e) => abort(e.code)
      }
      match @cdr.CdrReader::open_default(w.to_bytes()[:]) {
        Ok(r) => {
          match require_read_bool(r) {
            Ok(v) => assert_eq(v, true)
            Err(e) => abort(e.code)
          }
          match require_read_i8(r) {
            Ok(v) => assert_eq(v, -128)
            Err(e) => abort(e.code)
          }
          match require_read_i16(r) {
            Ok(v) => assert_eq(v, -32768)
            Err(e) => abort(e.code)
          }
          match require_read_i32(r) {
            Ok(v) => assert_eq(v, -2147483648)
            Err(e) => abort(e.code)
          }
          match require_read_i64(r) {
            Ok(v) => assert_eq(v, -9223372036854775807L - 1L)
            Err(e) => abort(e.code)
          }
          match require_read_f32(r) {
            Ok(v) => assert_eq(Float::reinterpret_as_uint(v), f32_bits)
            Err(e) => abort(e.code)
          }
          match require_read_f64(r) {
            Ok(v) => assert_eq(v.reinterpret_as_uint64(), f64_bits)
            Err(e) => abort(e.code)
          }
          match require_read_char8(r) {
            Ok(v) => assert_eq(v, b'A')
            Err(e) => abort(e.code)
          }
          match require_read_char16(r) {
            Ok(v) => assert_eq(v, (0x6708).to_uint16())
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
test "public invalid_boolean error fields across package boundary" {
  let input = b"\x00\x01\x00\x00\x02"
  match @cdr.CdrReader::open_default(input[:]) {
    Ok(r) => {
      assert_eq(r.position(), 4)
      match require_read_bool(r) {
        Ok(_) => abort("expected invalid_boolean")
        Err(e) => {
          assert_eq(e.code, @cdr.CODE_INVALID_BOOLEAN)
          assert_eq(e.offset, 4)
          assert_eq(e.needed, 1)
          assert_eq(e.remaining, 1)
        }
      }
      assert_eq(r.position(), 4)
    }
    Err(e) => abort(e.code)
  }
}

///|
test "public UTF-8 string codec across package boundary" {
  let limits = match @cdr.CdrLimits::new(128, 8, 128) {
    Ok(l) => l
    Err(e) => abort(e.code)
  }
  match @cdr.CdrWriter::new(@cdr.CdrEndian::little(), limits) {
    Ok(w) => {
      match require_write_string(w, "Moonspan CDR ✓"[:]) {
        Ok(_) => ()
        Err(e) => abort(e.code)
      }
      match require_write_string(w, ""[:], max_bytes=0U) {
        Ok(_) => ()
        Err(e) => abort(e.code)
      }
      match require_write_string(w, "AB"[:], max_bytes=2U) {
        Ok(_) => ()
        Err(e) => abort(e.code)
      }
      // Large legal UInt bound stays permissive across the package boundary.
      match require_write_string(w, "Z"[:], max_bytes=0xffffffffU) {
        Ok(_) => ()
        Err(e) => abort(e.code)
      }
      match @cdr.CdrReader::open_default(w.to_bytes()[:]) {
        Ok(r) => {
          match require_read_string(r) {
            Ok(s) => assert_eq(s, "Moonspan CDR ✓")
            Err(e) => abort(e.code)
          }
          match require_read_string(r) {
            Ok(s) => assert_eq(s, "")
            Err(e) => abort(e.code)
          }
          match require_read_string(r, max_bytes=2U) {
            Ok(s) => assert_eq(s, "AB")
            Err(e) => abort(e.code)
          }
          match require_read_string(r, max_bytes=0xffffffffU) {
            Ok(s) => assert_eq(s, "Z")
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
test "public ROS wstring codec and corpus completion across packages" {
  let limits = match @cdr.CdrLimits::new(128, 8, 128) {
    Ok(l) => l
    Err(e) => abort(e.code)
  }
  match @cdr.CdrWriter::new(@cdr.CdrEndian::little(), limits) {
    Ok(w) => {
      match require_write_wstring(w, "月面CDR"[:]) {
        Ok(_) => ()
        Err(e) => abort(e.code)
      }
      match require_write_wstring(w, ""[:], max_scalars=0U) {
        Ok(_) => ()
        Err(e) => abort(e.code)
      }
      match require_write_wstring(w, "AB"[:], max_scalars=2U) {
        Ok(_) => ()
        Err(e) => abort(e.code)
      }
      let core = w.to_bytes()
      match @cdr.CdrReader::open_default(core[:]) {
        Ok(r) => {
          match require_read_wstring(r) {
            Ok(s) => assert_eq(s, "月面CDR")
            Err(e) => abort(e.code)
          }
          match require_read_wstring(r) {
            Ok(s) => assert_eq(s, "")
            Err(e) => abort(e.code)
          }
          match require_read_wstring(r, max_scalars=2U) {
            Ok(s) => assert_eq(s, "AB")
            Err(e) => abort(e.code)
          }
          match require_ensure_corpus_complete_terminal_wstring(r) {
            Ok(_) => ()
            Err(e) => abort(e.code)
          }
        }
        Err(e) => abort(e.code)
      }
    }
    Err(e) => abort(e.code)
  }
  // Invalid scalar public error fields.
  let bad = b"\x00\x01\x00\x00\x01\x00\x00\x00\x00\xd8\x00\x00"
  match @cdr.CdrReader::open_default(bad[:]) {
    Ok(r) => {
      match require_read_wstring(r) {
        Ok(_) => abort("expected invalid_wstring_scalar")
        Err(e) => {
          assert_eq(e.code, @cdr.CODE_INVALID_WSTRING_SCALAR)
          assert_eq(e.offset, 4)
          assert_eq(e.needed, 4)
        }
      }
      assert_eq(r.position(), 4)
    }
    Err(e) => abort(e.code)
  }
  // Corpus completion consumes exactly four zero tail bytes.
  let slack = b"\x00\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00"
  match @cdr.CdrReader::open_default(slack[:]) {
    Ok(r) => {
      match require_read_wstring(r) {
        Ok(_) => ()
        Err(e) => abort(e.code)
      }
      match require_ensure_corpus_complete_terminal_wstring(r) {
        Ok(_) => assert_eq(r.position(), 12)
        Err(e) => abort(e.code)
      }
    }
    Err(e) => abort(e.code)
  }
}

///|
test "public sequence nesting and byte sequence across packages" {
  let limits = match @cdr.CdrLimits::new(128, 8, 128) {
    Ok(l) => l
    Err(e) => abort(e.code)
  }
  match @cdr.CdrWriter::new(@cdr.CdrEndian::little(), limits) {
    Ok(w) => {
      let root = require_root_nesting_writer(w)
      assert_eq(root.depth(), 0)
      match require_enter_nested_writer(w, root) {
        Ok(n) => assert_eq(n.depth(), 1)
        Err(e) => abort(e.code)
      }
      match require_write_sequence_length(w, 2, max_elements=2U) {
        Ok(_) => ()
        Err(e) => abort(e.code)
      }
      match require_write_byte_sequence(w, b"\x01\x02"[:], max_elements=2U) {
        Ok(_) => ()
        Err(e) => abort(e.code)
      }
      match @cdr.CdrReader::open_default(w.to_bytes()[:]) {
        Ok(r) => {
          let rr = require_root_nesting_reader(r)
          match require_enter_nested_reader(r, rr) {
            Ok(n) => assert_eq(n.depth(), 1)
            Err(e) => abort(e.code)
          }
          match require_read_sequence_length(r, max_elements=2U) {
            Ok(n) => assert_eq(n, 2)
            Err(e) => abort(e.code)
          }
          match require_read_byte_sequence(r, max_elements=2U) {
            Ok(bv) => {
              assert_eq(bv.length(), 2)
              assert_eq(bv[0], b'\x01')
            }
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
test "public string invalid_utf8 and missing terminator across packages" {
  let bad_utf8 = b"\x00\x01\x00\x00\x03\x00\x00\x00\xc3\x28\x00"
  match @cdr.CdrReader::open_default(bad_utf8[:]) {
    Ok(r) => {
      match require_read_string(r) {
        Ok(_) => abort("expected invalid_utf8")
        Err(e) => {
          assert_eq(e.code, @cdr.CODE_INVALID_UTF8)
          assert_eq(e.offset, 4)
          assert_eq(e.needed, 3)
        }
      }
      assert_eq(r.position(), 4)
    }
    Err(e) => abort(e.code)
  }
  let no_term = b"\x00\x01\x00\x00\x00\x00\x00\x00"
  match @cdr.CdrReader::open_default(no_term[:]) {
    Ok(r) => {
      match require_read_string(r) {
        Ok(_) => abort("expected missing_string_terminator")
        Err(e) => {
          assert_eq(e.code, @cdr.CODE_MISSING_STRING_TERMINATOR)
          assert_eq(e.offset, 4)
          assert_eq(e.needed, 1)
        }
      }
      assert_eq(r.position(), 4)
    }
    Err(e) => abort(e.code)
  }
}
