///|
fn bytes_of(arr : Array[Byte]) -> Bytes {
  Bytes::from_array(arr[:])
}

///|
fn expect_cbor_err(bytes : BytesView, reason : String) -> Int raise {
  match decode_deterministic_cbor(bytes) {
    Ok(_) => abort("expected cbor error")
    Err(e) => {
      assert_eq(e.reason, reason)
      e.offset
    }
  }
}

///|
test "cbor bools and null" {
  match decode_deterministic_cbor(b"\xf4"[:]) {
    Ok(CborValue::Bool(false)) => ()
    _ => abort("false")
  }
  match decode_deterministic_cbor(b"\xf5"[:]) {
    Ok(CborValue::Bool(true)) => ()
    _ => abort("true")
  }
  match decode_deterministic_cbor(b"\xf6"[:]) {
    Ok(CborValue::Null) => ()
    _ => abort("null")
  }
}

///|
test "cbor integer widths including uint64 max" {
  // 0
  match decode_deterministic_cbor(b"\x00"[:]) {
    Ok(CborValue::Unsigned(0UL)) => ()
    _ => abort("0")
  }
  // 23
  match decode_deterministic_cbor(b"\x17"[:]) {
    Ok(CborValue::Unsigned(23UL)) => ()
    _ => abort("23")
  }
  // 24 via ai=24
  match decode_deterministic_cbor(b"\x18\x18"[:]) {
    Ok(CborValue::Unsigned(24UL)) => ()
    _ => abort("24")
  }
  // 255
  match decode_deterministic_cbor(b"\x18\xff"[:]) {
    Ok(CborValue::Unsigned(255UL)) => ()
    _ => abort("255")
  }
  // 256 via ai=25
  match decode_deterministic_cbor(b"\x19\x01\x00"[:]) {
    Ok(CborValue::Unsigned(256UL)) => ()
    _ => abort("256")
  }
  // 65536 via ai=26
  match decode_deterministic_cbor(b"\x1a\x00\x01\x00\x00"[:]) {
    Ok(CborValue::Unsigned(65536UL)) => ()
    _ => abort("65536")
  }
  // UInt64 max via ai=27
  match decode_deterministic_cbor(b"\x1b\xff\xff\xff\xff\xff\xff\xff\xff"[:]) {
    Ok(CborValue::Unsigned(0xffffffffffffffffUL)) => ()
    _ => abort("u64 max")
  }
}

///|
test "cbor negative domain stores raw argument" {
  // major type 1, arg 0 => value -1
  match decode_deterministic_cbor(b"\x20"[:]) {
    Ok(CborValue::Negative(0UL)) => ()
    _ => abort("neg 0")
  }
  // arg 1 => -2
  match decode_deterministic_cbor(b"\x21"[:]) {
    Ok(CborValue::Negative(1UL)) => ()
    _ => abort("neg 1")
  }
  // full domain: arg = UInt64 max
  match decode_deterministic_cbor(b"\x3b\xff\xff\xff\xff\xff\xff\xff\xff"[:]) {
    Ok(CborValue::Negative(0xffffffffffffffffUL)) => ()
    _ => abort("neg max")
  }
}

///|
test "cbor non-shortest forms rejected" {
  assert_eq(expect_cbor_err(b"\x18\x00"[:], "non_shortest_form"), 0)
  assert_eq(expect_cbor_err(b"\x19\x00\x17"[:], "non_shortest_form"), 0)
  assert_eq(expect_cbor_err(b"\x1a\x00\x00\x00\xff"[:], "non_shortest_form"), 0)
  assert_eq(
    expect_cbor_err(
      b"\x1b\x00\x00\x00\x00\x00\x00\x00\xff"[:],
      "non_shortest_form",
    ),
    0,
  )
}

///|
test "cbor invalid utf8" {
  assert_eq(expect_cbor_err(b"\x62\xc3\x28"[:], "invalid_utf8"), 0)
}

///|
test "cbor borrowed byte view start and data identity" {
  let input = b"\x43\xde\xad\xbe"
  let view = input[:]
  match decode_deterministic_cbor(view) {
    Ok(CborValue::Bytes(bv)) => {
      assert_eq(bv.length(), 3)
      assert_eq(bv[0], b'\xde')
      assert_eq(bv[1], b'\xad')
      assert_eq(bv[2], b'\xbe')
      assert_eq(bv.start_offset(), 1)
      assert_eq(bv.data().length(), input.length())
      // Physical identity proves shared backing storage with the input Bytes.
      assert_eq(physical_equal(bv.data(), input), true)
    }
    _ => abort("bytes")
  }
}

///|
test "cbor text valid utf8" {
  match decode_deterministic_cbor(b"\x63abc"[:]) {
    Ok(CborValue::Text(t)) => assert_eq(t, "abc")
    _ => abort("text")
  }
}

///|
test "cbor text utf8 bom octets preserve leading feff" {
  // Text string of three bytes EF BB BF: CBOR head 0x63 + BOM octets.
  // Agreement with TS TextDecoder(ignoreBOM=true) and Rust from_utf8: U+FEFF.
  match decode_deterministic_cbor(b"\x63\xef\xbb\xbf"[:]) {
    Ok(CborValue::Text(t)) => {
      assert_eq(t.length(), 1)
      assert_eq(t[0].to_int(), 0xfeff)
    }
    _ => abort("bom text")
  }
}

///|
test "cbor duplicate before order precedence" {
  // map {1: true, 2: true, 1: false}: third key duplicate at offset 5.
  let bytes = b"\xa3\x01\xf5\x02\xf5\x01\xf4"
  let off = expect_cbor_err(bytes[:], "duplicate_map_key")
  assert_eq(off, 5)
  // Adjacent equal keys remain duplicate_map_key.
  assert_eq(expect_cbor_err(b"\xa2\x01\xf5\x01\xf4"[:], "duplicate_map_key"), 3)
}

///|
test "cbor map key order unique descending" {
  // map {1: true, 0: false}
  assert_eq(expect_cbor_err(b"\xa2\x01\xf5\x00\xf4"[:], "map_key_order"), 3)
}

///|
test "cbor nesting depth 16 ok and 17 rejected" {
  // 15 single-element arrays + empty array: ok
  let ok_arr : Array[Byte] = []
  let mut i = 0
  while i < 15 {
    ok_arr.push(b'\x81')
    i = i + 1
  }
  ok_arr.push(b'\x80')
  let ok_bytes = bytes_of(ok_arr)
  match decode_deterministic_cbor(ok_bytes[:]) {
    Ok(_) => ()
    Err(e) => abort(e.reason)
  }
  // 16 single-element arrays + empty array: nesting_depth_exceeded
  let deep_arr : Array[Byte] = []
  i = 0
  while i < 16 {
    deep_arr.push(b'\x81')
    i = i + 1
  }
  deep_arr.push(b'\x80')
  let deep = bytes_of(deep_arr)
  assert_eq(expect_cbor_err(deep[:], "nesting_depth_exceeded") >= 0, true)
}

///|
test "cbor map entries 4096 ceiling and 4097 rejected" {
  // Canonical map of 4096 entries: keys 0..4095 ascending, value null (0xf6).
  let arr : Array[Byte] = [b'\xb9', b'\x10', b'\x00'] // map ai=25, length 4096
  let mut k = 0
  while k < 4096 {
    if k <= 23 {
      arr.push(k.to_byte())
    } else if k <= 255 {
      arr.push(b'\x18')
      arr.push(k.to_byte())
    } else {
      arr.push(b'\x19')
      arr.push(((k >> 8) & 0xff).to_byte())
      arr.push((k & 0xff).to_byte())
    }
    arr.push(b'\xf6')
    k = k + 1
  }
  let bytes = bytes_of(arr)
  match decode_deterministic_cbor(bytes[:]) {
    Ok(CborValue::Map(m)) => {
      assert_eq(m.length(), 4096)
      let (first_key, _) = m[0]
      let (last_key, _) = m[4095]
      assert_eq(first_key, 0UL)
      assert_eq(last_key, 4095UL)
    }
    _ => abort("map 4096")
  }
  // Declare 4097 entries: map ai=25, length 0x1001
  assert_eq(expect_cbor_err(b"\xb9\x10\x01"[:], "map_entries_exceeded"), 0)
}

///|
test "cbor MAX_SAFE boundary and large declared lengths" {
  // array ai=27 length = MAX_SAFE + 1 = 0x0020000000000000 => length_out_of_range @ 0
  let above_safe = b"\x9b\x00\x20\x00\x00\x00\x00\x00\x00"
  assert_eq(expect_cbor_err(above_safe[:], "length_out_of_range"), 0)
  // bytes ai=27 length = MAX_SAFE + 1 => length_out_of_range @ 0
  let above_safe_bytes = b"\x5b\x00\x20\x00\x00\x00\x00\x00\x00"
  assert_eq(expect_cbor_err(above_safe_bytes[:], "length_out_of_range"), 0)
  // bytes/text length 2^31 (ai=26, head 5 bytes): truncated at post-head offset 5
  assert_eq(expect_cbor_err(b"\x5a\x80\x00\x00\x00"[:], "truncated"), 5)
  assert_eq(expect_cbor_err(b"\x7a\x80\x00\x00\x00"[:], "truncated"), 5)
  // bytes/text length MAX_SAFE (ai=27, head 9 bytes): truncated at post-head offset 9
  assert_eq(
    expect_cbor_err(b"\x5b\x00\x1f\xff\xff\xff\xff\xff\xff"[:], "truncated"),
    9,
  )
  assert_eq(
    expect_cbor_err(b"\x7b\x00\x1f\xff\xff\xff\xff\xff\xff"[:], "truncated"),
    9,
  )
  // array length 2^32 (ai=27): truncated at head_offset 0
  assert_eq(
    expect_cbor_err(b"\x9b\x00\x00\x00\x01\x00\x00\x00\x00"[:], "truncated"),
    0,
  )
  // array length MAX_SAFE on short input: truncated at head_offset 0
  assert_eq(
    expect_cbor_err(b"\x9b\x00\x1f\xff\xff\xff\xff\xff\xff"[:], "truncated"),
    0,
  )
  // exact short array length that fits remaining still parses
  match decode_deterministic_cbor(b"\x80"[:]) {
    Ok(CborValue::Array(a)) => assert_eq(a.length(), 0)
    _ => abort("empty array")
  }
}

///|
test "cbor tags floats indefinite reserved simple" {
  assert_eq(expect_cbor_err(b"\xc0\x00"[:], "tag_not_allowed"), 0)
  assert_eq(expect_cbor_err(b"\xf9\x00\x00"[:], "float_not_allowed"), 0)
  assert_eq(expect_cbor_err(b"\x9f"[:], "indefinite_length"), 0)
  // reserved additional info 28
  assert_eq(expect_cbor_err(b"\x1c"[:], "reserved_additional_info"), 0)
  // simple_not_allowed: additional 23 (undefined simple)
  assert_eq(expect_cbor_err(b"\xf7"[:], "simple_not_allowed"), 0)
  // simple_not_allowed: one-byte simple 24
  assert_eq(expect_cbor_err(b"\xf8\x18"[:], "simple_not_allowed"), 0)
}

///|
test "cbor trailing data and empty input and short input" {
  assert_eq(expect_cbor_err(b""[:], "empty_input"), 0)
  // true + extra 0x00
  assert_eq(expect_cbor_err(b"\xf5\x00"[:], "trailing_data"), 1)
  // truncated text: head claims 3 bytes, only 1 follow
  assert_eq(expect_cbor_err(b"\x63\x61"[:], "truncated") >= 0, true)
  // truncated array head only
  assert_eq(expect_cbor_err(b"\x81"[:], "truncated") >= 0, true)
}
