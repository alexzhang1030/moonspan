///|
fn ctrl_from_hex(s : String) -> Bytes {
  let out : Array[Byte] = []
  let mut i = 0
  while i < s.length() {
    let hi = hex_nibble(s[i].to_int())
    let lo = hex_nibble(s[i + 1].to_int())
    out.push(((hi << 4) | lo).to_byte())
    i = i + 2
  }
  Bytes::from_array(out[:])
}

///|
fn expect_ctrl_err(hex_str : String, reason : String) -> ControlError raise {
  let bytes = ctrl_from_hex(hex_str)
  match decode_control_message(bytes[:]) {
    Ok(_) => abort("expected control rejection")
    Err(e) => {
      assert_eq(e.reason, reason)
      e
    }
  }
}

///|
fn valid_kind_hex(k : Int) -> String {
  // Minimal valid CONTROL_CBOR payloads for kinds 1–15 (Rust VALID_KIND_HEX).
  if k == 1 {
    "a401010250010101010101010101010101010101011065746f6b656e1142aabb"
  } else if k == 2 {
    "ad0102025001010101010101010101010101010101076267770864482d46540a81000ca101010d6761646170746572126668756d626c651370726d775f66617374727470735f6370701463312e301563312e301835582002020202020202020202020202020202020202020202020202020202020202021836a301a201f502f502a201f502f403820102"
  } else if k == 3 {
    "a70103025001010101010101010101010101010101076267770864482d46540e0016801780"
  } else if k == 4 {
    "a70104025001010101010101010101010101010101076267770864482d46540e01181800181981a2010002a301622f6e090018375003030303030303030303030303030303"
  } else if k == 5 {
    "a4010502500101010101010101010101010101010103a2016c726570323031312d726968730278475249485330315f6161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616104737374645f6d7367732f6d73672f537472696e67"
  } else if k == 6 {
    "a7010602500101010101010101010101010101010103a2016c726570323031312d726968730278475249485330315f6161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616104737374645f6d7367732f6d73672f537472696e6705010600181a4101"
  } else if k == 7 {
    "a7010702500101010101010101010101010101010103a2016c726570323031312d726968730278475249485330315f6161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616104737374645f6d7367732f6d73672f537472696e6705010600181a4101"
  } else if k == 8 {
    "ae010802500101010101010101010101010101010103a2016c726570323031312d726968730278475249485330315f6161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616104737374645f6d7367732f6d73672f537472696e67050106000864482d465409000ba401010201030104010ca10101181d01181e00181f682f63686174746572182002"
  } else if k == 9 {
    "a701090250010101010101010101010101010101010ca10101181d011821001839a501010201030104010701183b02"
  } else if k == 10 {
    "a4010a025001010101010101010101010101010101181d01182201"
  } else if k == 11 {
    "a4010b025001010101010101010101010101010101182401182500"
  } else if k == 12 {
    "a3010c025001010101010101010101010101010101182800"
  } else if k == 13 {
    "ad010d0250010101010101010101010101010101010600076267770864482d46540d67616461707465720e001065746f6b656e1142aabb182a58200202020202020202020202020202020202020202020202020202020202020202182b00182ca301a201f502f502a201f502f403820102182d80"
  } else if k == 14 {
    "a4010e025001010101010101010101010101010101182ef5182f80"
  } else if k == 15 {
    "a4010f025001010101010101010101010101010101183001183100"
  } else {
    abort("kind out of range")
  }
}

///|
test "control fifteen kinds decode valid payloads" {
  let mut k = 1
  while k <= 15 {
    let bytes = ctrl_from_hex(valid_kind_hex(k))
    match decode_control_message(bytes[:]) {
      Ok(msg) => {
        assert_eq(msg.kind, k)
        match ctrl_map_get(msg.fields, 1UL) {
          Some(CborValue::Unsigned(u)) => assert_eq(u.to_int(), k)
          _ => abort("kind field")
        }
      }
      Err(e) => abort(e.reason)
    }
    k = k + 1
  }
}

///|
test "control nested schema identity rejection" {
  let err = expect_ctrl_err(
    "a4010502500101010101010101010101010101010103a20163626164026178046174", "schema_identity",
  )
  assert_eq(err.offset, 0)
  let err2 = expect_ctrl_err(
    "a4010502500101010101010101010101010101010103a201726d6f6f6e7370616e2d736368656d612d763102626161046174",
    "schema_identity",
  )
  assert_eq(err2.offset, 0)
}

///|
test "control nested qos missing depth rejection" {
  let err = expect_ctrl_err(
    "ae010802500101010101010101010101010101010103a201726d6f6f6e7370616e2d736368656d612d763102784062626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262046174050106000864482d465409000ba30101020103010ca0181d01181e00181f622f63182002",
    "missing_key",
  )
  assert_eq(err.offset, 0)
}

///|
test "control nested array order and unique rejection" {
  let err = expect_ctrl_err(
    "ad0102025001010101010101010101010101010101076267770864482d46540a8202010ca00d6161126668756d626c651370726d775f66617374727470735f6370701461311561311835582000000000000000000000000000000000000000000000000000000000000000001836a301a201f502f502a201f502f40380",
    "order_violation",
  )
  ignore(err)
  let err2 = expect_ctrl_err(
    "ad0102025001010101010101010101010101010101076267770864482d46540a8201010ca00d6161126668756d626c651370726d775f66617374727470735f6370701461311561311835582000000000000000000000000000000000000000000000000000000000000000001836a301a201f502f502a201f502f40380",
    "unique_violation",
  )
  ignore(err2)
}

///|
test "control nested closed map unknown key rejection" {
  let err = expect_ctrl_err(
    "a501010250010101010101010101010101010101011061741141011863f5", "unknown_key",
  )
  assert_eq(err.offset, 0)
}

///|
test "control nested support row triple rejection" {
  let err = expect_ctrl_err(
    "ad0102025001010101010101010101010101010101076267770864482d46540a81000ca00d616112656a617a7a791370726d775f66617374727470735f6370701461311561311835582000000000000000000000000000000000000000000000000000000000000000001836a301a201f502f502a201f502f40380",
    "support_row_mismatch",
  )
  assert_eq(err.offset, 0)
}

///|
fn session_ready_triple_fields(
  row : String,
  distro : String,
  rmw : String,
) -> Array[(UInt64, CborValue)] {
  [
    (8UL, CborValue::Text(row)),
    (18UL, CborValue::Text(distro)),
    (19UL, CborValue::Text(rmw)),
  ]
}

///|
test "control session ready phase one triples accept all four rows" {
  match
    assert_session_ready_triple(
      session_ready_triple_fields("H-FT", "humble", "rmw_fastrtps_cpp"),
    ) {
    Ok(_) => ()
    Err(e) => abort(e.reason)
  }
  match
    assert_session_ready_triple(
      session_ready_triple_fields("H-CY", "humble", "rmw_cyclonedds_cpp"),
    ) {
    Ok(_) => ()
    Err(e) => abort(e.reason)
  }
  match
    assert_session_ready_triple(
      session_ready_triple_fields("J-FT", "jazzy", "rmw_fastrtps_cpp"),
    ) {
    Ok(_) => ()
    Err(e) => abort(e.reason)
  }
  match
    assert_session_ready_triple(
      session_ready_triple_fields("J-CY", "jazzy", "rmw_cyclonedds_cpp"),
    ) {
    Ok(_) => ()
    Err(e) => abort(e.reason)
  }
}

///|
test "control nested union discriminator rejection" {
  let err = expect_ctrl_err(
    "a3010e025001010101010101010101010101010101182ef4", "missing_key",
  )
  ignore(err)
  let err2 = expect_ctrl_err(
    "a4010f025001010101010101010101010101010101183001183102", "enum_violation",
  )
  assert_eq(err2.offset, 0)
}

///|
test "control nested effective qos rejection" {
  let err = expect_ctrl_err(
    "a701090250010101010101010101010101010101010ca10101181d011821001839a501000201030104010701183b02",
    "unknown_key",
  )
  assert_eq(err.offset, 0)
  let err2 = expect_ctrl_err(
    "a701090250010101010101010101010101010101010ca10101181d011821001839a40101020103010401183b02",
    "unknown_key",
  )
  assert_eq(err2.offset, 0)
}

///|
test "control nested wire error code 20 rejection" {
  let err = expect_ctrl_err(
    "a4010f025001010101010101010101010101010101183014183100", "enum_violation",
  )
  assert_eq(err.offset, 0)
}

///|
test "control nested missing kind rejection" {
  let err = expect_ctrl_err(
    "a1025001010101010101010101010101010101", "missing_key",
  )
  ignore(err)
}

///|
test "control map sort preserves all keys and values" {
  // Schema field order 5,3,1; values must survive ascending-key map output.
  let input = CborValue::Map([
    (5UL, CborValue::Unsigned(50UL)),
    (3UL, CborValue::Unsigned(30UL)),
    (1UL, CborValue::Unsigned(10UL)),
  ])
  let fields : Array[(UInt64, Bool, Schema)] = [
    (5UL, true, Schema::Uint(0UL, 100UL)),
    (3UL, true, Schema::Uint(0UL, 100UL)),
    (1UL, true, Schema::Uint(0UL, 100UL)),
  ]
  match validate_map(input, fields) {
    Ok(CborValue::Map(entries)) => {
      assert_eq(entries.length(), 3)
      let (k0, v0) = entries[0]
      let (k1, v1) = entries[1]
      let (k2, v2) = entries[2]
      assert_eq(k0, 1UL)
      assert_eq(k1, 3UL)
      assert_eq(k2, 5UL)
      match v0 {
        CborValue::Unsigned(10UL) => ()
        _ => abort("v0")
      }
      match v1 {
        CborValue::Unsigned(30UL) => ()
        _ => abort("v1")
      }
      match v2 {
        CborValue::Unsigned(50UL) => ()
        _ => abort("v2")
      }
    }
    _ => abort("validate_map failed")
  }
}

///|
test "control int64 boundaries accept and reject" {
  // Accepted: unsigned 0x7fffffffffffffff
  match
    validate_schema(CborValue::Unsigned(0x7fffffffffffffffUL), Schema::Int64S) {
    Ok(CborValue::Unsigned(0x7fffffffffffffffUL)) => ()
    _ => abort("max signed unsigned form")
  }
  // Accepted: Negative raw 0x7fffffffffffffff (value INT64_MIN)
  match
    validate_schema(CborValue::Negative(0x7fffffffffffffffUL), Schema::Int64S) {
    Ok(CborValue::Negative(0x7fffffffffffffffUL)) => ()
    _ => abort("int64 min raw negative")
  }
  // Rejected: unsigned one past signed max
  match
    validate_schema(CborValue::Unsigned(0x8000000000000000UL), Schema::Int64S) {
    Err(e) => assert_eq(e.reason, "range_violation")
    Ok(_) => abort("expected reject u64 half")
  }
  // Rejected: Negative raw one past INT64_MIN argument
  match
    validate_schema(CborValue::Negative(0x8000000000000000UL), Schema::Int64S) {
    Err(e) => assert_eq(e.reason, "range_violation")
    Ok(_) => abort("expected reject neg raw")
  }
}

///|
test "control 1 mib ceiling and cbor offset preservation" {
  // Exactly 1048576 bytes pass the size gate; true plus trailing zeros => trailing_data @ 1
  let exact : Array[Byte] = [b'\xf5']
  let mut i = 1
  while i < CONTROL_PAYLOAD_MAX_BYTES {
    exact.push(b'\x00')
    i = i + 1
  }
  assert_eq(exact.length(), CONTROL_PAYLOAD_MAX_BYTES)
  let exact_b = Bytes::from_array(exact[:])
  match decode_control_message(exact_b[:]) {
    Err(e) => {
      assert_eq(e.reason, "cbor_profile")
      assert_eq(e.offset, 1)
    }
    Ok(_) => abort("expected trailing-data cbor_profile")
  }
  // 1048577 bytes reject at the size gate
  let over : Array[Byte] = []
  i = 0
  while i < CONTROL_PAYLOAD_MAX_BYTES + 1 {
    over.push(b'\x00')
    i = i + 1
  }
  let over_b = Bytes::from_array(over[:])
  match decode_control_message(over_b[:]) {
    Err(e) => {
      assert_eq(e.reason, "payload_too_large")
      assert_eq(e.offset, 0)
    }
    Ok(_) => abort("expected too large")
  }
  // CBOR indefinite array: cbor_profile preserves relative offset 0
  match decode_control_message(b"\x9f"[:]) {
    Err(e) => {
      assert_eq(e.reason, "cbor_profile")
      assert_eq(e.offset, 0)
    }
    Ok(_) => abort("expected cbor_profile")
  }
  // map_control_error for later frame mapping
  let pe = map_control_error(ControlError::new("cbor_profile", 3), 32)
  assert_eq(pe.code, 23)
  assert_eq(pe.offset, 35)
  assert_eq(pe.step, 16)
  let pe2 = map_control_error(ControlError::new("payload_too_large", 0), 0)
  assert_eq(pe2.reason, "control_payload_too_large")
  assert_eq(pe2.step, 3)
}

///|
test "control utf8 text byte boundary 4096 accept and over-cap reject" {
  // 2048 × U+00A2 (UTF-8 C2 A2) = exactly 4096 UTF-8 bytes; Schema Text accepts.
  let arr4096 : Array[Byte] = []
  let mut i = 0
  while i < 2048 {
    arr4096.push(b'\xc2')
    arr4096.push(b'\xa2')
    i = i + 1
  }
  assert_eq(arr4096.length(), 4096)
  let raw4096 = Bytes::from_array(arr4096[:])
  let text4096 = @utf8.decode(raw4096[:], ignore_bom=false) catch {
    @utf8.Malformed(_) => abort("utf8 decode 4096")
  }
  assert_eq(text_utf8_len(text4096), 4096)
  match
    validate_schema(CborValue::Text(text4096), Schema::Text(0, 4096, None)) {
    Ok(CborValue::Text(_)) => ()
    _ => abort("expected 4096-byte text accept")
  }
  // One extra ASCII byte yields 4097 UTF-8 bytes; Schema Text rejects.
  arr4096.push(b'x')
  assert_eq(arr4096.length(), 4097)
  let raw4097 = Bytes::from_array(arr4096[:])
  let text4097 = @utf8.decode(raw4097[:], ignore_bom=false) catch {
    @utf8.Malformed(_) => abort("utf8 decode 4097")
  }
  assert_eq(text_utf8_len(text4097), 4097)
  match
    validate_schema(CborValue::Text(text4097), Schema::Text(0, 4096, None)) {
    Err(e) => assert_eq(e.reason, "text_length")
    Ok(_) => abort("expected text_length")
  }
  // Authenticate wire path: token of 4097 ASCII 'a' bytes also yields text_length.
  let wire : Array[Byte] = [b'\xa4', b'\x01', b'\x01', b'\x02', b'\x50']
  i = 0
  while i < 16 {
    wire.push(b'\x01')
    i = i + 1
  }
  wire.push(b'\x10')
  wire.push(b'\x79')
  wire.push(b'\x10')
  wire.push(b'\x01')
  i = 0
  while i < 4097 {
    wire.push(b'a')
    i = i + 1
  }
  wire.push(b'\x11')
  wire.push(b'\x41')
  wire.push(b'\xaa')
  let bytes = Bytes::from_array(wire[:])
  match decode_control_message(bytes[:]) {
    Err(e) => assert_eq(e.reason, "text_length")
    Ok(_) => abort("expected text_length")
  }
}
