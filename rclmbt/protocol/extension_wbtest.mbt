///|
fn expect_ext_err(
  bytes : BytesView,
  reason : String,
  offset : Int,
  code : Int,
) -> Unit raise {
  match decode_extension_area(bytes) {
    Ok(_) => abort("expected extension error")
    Err(e) => {
      assert_eq(e.reason, reason)
      assert_eq(e.offset, offset)
      assert_eq(e.code, code)
    }
  }
}

///|
fn push_u16_be(arr : Array[Byte], n : Int) -> Unit {
  arr.push(((n >> 8) & 0xff).to_byte())
  arr.push((n & 0xff).to_byte())
}

///|
fn push_zeros(arr : Array[Byte], n : Int) -> Unit {
  let mut i = 0
  while i < n {
    arr.push(b'\x00')
    i = i + 1
  }
}

///|
test "extension descending assigned types" {
  // OPERATION_ID (type 2) followed by TRACE_CONTEXT (type 1).
  let arr : Array[Byte] = [b'\x02', b'\x00']
  push_u16_be(arr, 16)
  push_zeros(arr, 16)
  arr.push(b'\x01')
  arr.push(b'\x00')
  push_u16_be(arr, 32)
  push_zeros(arr, 32)
  let bytes = Bytes::from_array(arr[:])
  expect_ext_err(bytes[:], "order_violation", 20, 3)
}

///|
test "extension structural defect wins over deferred unknown critical" {
  // Unknown critical type 128 at offset 0, then TRACE_CONTEXT at offset 4.
  // Structural order_violation is the step-13 result at offset 4.
  let arr : Array[Byte] = [b'\x80', b'\x01', b'\x00', b'\x00']
  arr.push(b'\x01')
  arr.push(b'\x00')
  push_u16_be(arr, 32)
  push_zeros(arr, 32)
  let bytes = Bytes::from_array(arr[:])
  expect_ext_err(bytes[:], "order_violation", 4, 3)
}

///|
test "extension unknown critical after full structure" {
  let area = b"\x80\x01\x00\x00"
  expect_ext_err(area[:], "unknown_critical", 0, 22)
}

///|
test "extension unknown noncritical skipped after structure" {
  let area = b"\x80\x00\x00\x00"
  match decode_extension_area(area[:]) {
    Ok(out) => assert_eq(out.length(), 0)
    Err(_) => abort("unexpected error")
  }
}

///|
test "extension assigned value borrows input with physical identity" {
  let arr : Array[Byte] = [b'\x02', b'\x00']
  push_u16_be(arr, 16)
  let mut i = 1
  while i <= 16 {
    arr.push(i.to_byte())
    i = i + 1
  }
  let area = Bytes::from_array(arr[:])
  match decode_extension_area(area[:]) {
    Ok(out) => {
      assert_eq(out.length(), 1)
      assert_eq(out[0].type_id, 2)
      assert_eq(out[0].value.length(), 16)
      assert_eq(out[0].value[0], b'\x01')
      assert_eq(out[0].value[15], b'\x10')
      assert_eq(out[0].value.start_offset(), 4)
      // Physical identity proves shared backing storage with the input Bytes.
      assert_eq(physical_equal(out[0].value.data(), area), true)
    }
    Err(_) => abort("decode failed")
  }
}

///|
test "extension truncated value exact offsets" {
  let area = b"\x80\x00\x00\x05\x00\x00\x00\x00"
  expect_ext_err(area[:], "truncated_value", 4, 3)
  let huge = b"\x80\x00\xff\xff\x00\x00\x00\x00"
  expect_ext_err(huge[:], "truncated_value", 4, 3)
  let second = b"\x80\x00\x00\x00\x81\x00\x00\x01"
  expect_ext_err(second[:], "truncated_value", 8, 3)
}

///|
test "extension reserved flag bits" {
  // flags 0x02 is reserved
  let area = b"\x80\x02\x00\x00"
  expect_ext_err(area[:], "reserved_flag_bits", 1, 3)
}

///|
test "extension fixed length mismatch" {
  // OPERATION_ID type 2 with value_len 15 (required fixed length is 16)
  let arr : Array[Byte] = [b'\x02', b'\x00']
  push_u16_be(arr, 15)
  push_zeros(arr, 15)
  // pad to 4-byte alignment: content 4+15=19, padded 20
  arr.push(b'\x00')
  let bytes = Bytes::from_array(arr[:])
  expect_ext_err(bytes[:], "fixed_length_mismatch", 2, 3)
}

///|
test "extension trace reserved nonzero exact offset" {
  // TRACE_CONTEXT type 1, 32-byte value with byte index 25 nonzero.
  let arr : Array[Byte] = [b'\x01', b'\x00']
  push_u16_be(arr, 32)
  push_zeros(arr, 25)
  arr.push(b'\x01') // reserved byte at value offset 25
  push_zeros(arr, 6)
  let bytes = Bytes::from_array(arr[:])
  // value starts at 4; reserved absolute offset = 4 + 25 = 29
  expect_ext_err(bytes[:], "reserved_nonzero", 29, 3)
}

///|
test "extension nonzero padding exact offset" {
  // value_len 1 yields content length 5; pad to 8 with a nonzero pad at offset 5.
  let area = b"\x80\x00\x00\x01\x00\x01\x00\x00"
  expect_ext_err(area[:], "nonzero_padding", 5, 3)
}

///|
test "extension duplicate type" {
  // two OPERATION_ID TLVs
  let arr : Array[Byte] = [b'\x02', b'\x00']
  push_u16_be(arr, 16)
  push_zeros(arr, 16)
  arr.push(b'\x02')
  arr.push(b'\x00')
  push_u16_be(arr, 16)
  push_zeros(arr, 16)
  let bytes = Bytes::from_array(arr[:])
  expect_ext_err(bytes[:], "duplicate_type", 20, 3)
}

///|
test "extension area ceiling and alignment" {
  let over : Array[Byte] = []
  let mut i = 0
  while i < 4097 {
    over.push(b'\x00')
    i = i + 1
  }
  let over_b = Bytes::from_array(over[:])
  expect_ext_err(over_b[:], "area_too_large", 0, 24)
  expect_ext_err(b"\x00\x00"[:], "area_alignment", 0, 3)
}

///|
test "extension exactly 4096 byte structurally valid unknown noncritical area" {
  // One unknown noncritical TLV with a 4092-byte value fills the 4096-byte area.
  let arr : Array[Byte] = [b'\x80', b'\x00']
  push_u16_be(arr, 4092)
  push_zeros(arr, 4092)
  assert_eq(arr.length(), 4096)
  let bytes = Bytes::from_array(arr[:])
  match decode_extension_area(bytes[:]) {
    Ok(out) => assert_eq(out.length(), 0)
    Err(e) => abort(e.reason)
  }
}

///|
test "extension map to ProtocolError for later frame use" {
  let e : ExtensionError = {
    code: 22,
    name: "unsupported_extension",
    reason: "unknown_critical",
    offset: 4,
  }
  let pe = map_extension_error(e, 32, 14)
  assert_eq(pe.code, 22)
  assert_eq(pe.offset, 36)
  assert_eq(pe.plane, "selected_frame")
  assert_eq(pe.step, 14)
}
