///|
fn expect_bootstrap_err(
  bytes : BytesView,
  code : Int,
  name : String,
  reason : String,
  offset : Int,
  plane : String,
  step : Int,
) -> Unit raise {
  match parse_bootstrap(bytes) {
    Ok(_) => abort("expected bootstrap error")
    Err(e) => {
      assert_eq(e.code, code)
      assert_eq(e.name, name)
      assert_eq(e.reason, reason)
      assert_eq(e.offset, offset)
      assert_eq(e.plane, plane)
      assert_eq(e.step, step)
    }
  }
}

///|
fn all_ascii_char(s : String, ch : Char) -> Bool {
  let encoded = @utf8.encode(s[:])
  for b in encoded {
    if b.to_int() != ch.to_int() {
      return false
    }
  }
  true
}

///|
test "bootstrap corpus counts and valid key fields" {
  let mut valid_bootstrap = 0
  let mut malformed_bootstrap = 0
  for f in bridge_fixtures {
    if f.kind == "bootstrap" && f.corpus == "valid" {
      match f.body {
        Binary(chunks) => {
          let arr = expand_chunks(chunks)
          let bytes = Bytes::from_array(arr[:])
          assert_eq(bytes.length(), f.byte_length)
          match parse_bootstrap(bytes[:]) {
            Ok(BootstrapRecord::ClientHello(ch)) => {
              assert_eq(ch.wire_versions.length(), 16)
              assert_eq(ch.wire_versions[0], 0)
              assert_eq(ch.wire_versions[15], 15)
              assert_eq(ch.transport_capabilities.webtransport_http3, true)
              assert_eq(ch.transport_capabilities.binary_wss, true)
              match ch.transport_capabilities.max_datagram_size {
                Some(n) => assert_eq(n, 4294967295U)
                None => abort("max_datagram")
              }
              assert_eq(ch.buffer_capabilities.transferable_arraybuffer, true)
              assert_eq(ch.buffer_capabilities.shared_arraybuffer, true)
              match ch.requested_limits.max_channels {
                Some(n) => assert_eq(n, 4294967295U)
                None => abort("max_channels")
              }
              match ch.requested_limits.max_session_bytes {
                Some(n) => assert_eq(n, 0xffffffffffffffffUL)
                None => abort("max_session")
              }
              match ch.requested_limits.max_message_bytes {
                Some(n) => assert_eq(n, 4294967295U)
                None => abort("max_message")
              }
              match ch.requested_limits.max_control_payload_bytes {
                Some(n) => assert_eq(n, 4294967295U)
                None => abort("max_control")
              }
              assert_eq(ch.extension_capabilities.length(), 64)
              assert_eq(ch.extension_capabilities[0], 1)
              assert_eq(ch.extension_capabilities[63], 64)
              valid_bootstrap = valid_bootstrap + 1
            }
            Ok(BootstrapRecord::ServerHello(sh)) => {
              assert_eq(sh.selected_wire_version, 0)
              assert_eq(sh.transport_capabilities.webtransport_http3, true)
              assert_eq(sh.transport_capabilities.binary_wss, true)
              match sh.transport_capabilities.max_datagram_size {
                Some(n) => assert_eq(n, 65535U)
                None => abort("server max_datagram")
              }
              assert_eq(sh.buffer_capabilities.transferable_arraybuffer, true)
              assert_eq(sh.buffer_capabilities.shared_arraybuffer, false)
              assert_eq(sh.effective_limits.max_channels, 65535U)
              assert_eq(sh.effective_limits.max_session_bytes, 4294967296UL)
              assert_eq(sh.effective_limits.max_message_bytes, 67108864U)
              assert_eq(sh.effective_limits.max_control_payload_bytes, 1048576U)
              assert_eq(sh.extension_capabilities.length(), 3)
              assert_eq(sh.extension_capabilities[0], 1)
              assert_eq(sh.extension_capabilities[1], 2)
              assert_eq(sh.extension_capabilities[2], 3)
              valid_bootstrap = valid_bootstrap + 1
            }
            Ok(BootstrapRecord::BootstrapError(be)) => {
              assert_eq(be.code, 1)
              match be.message {
                Some(msg) => {
                  let enc = @utf8.encode(msg[:])
                  assert_eq(enc.length(), 4096)
                  assert_eq(all_ascii_char(msg, 'a'), true)
                }
                None => abort("message")
              }
              match be.detail {
                Some(detail) => {
                  let enc = @utf8.encode(detail[:])
                  assert_eq(enc.length(), 4096)
                  assert_eq(all_ascii_char(detail, 'b'), true)
                }
                None => abort("detail")
              }
              valid_bootstrap = valid_bootstrap + 1
            }
            Err(e) => abort(e.reason)
          }
        }
        SegmentRecipe(_) => abort("bootstrap segment recipe")
      }
    }
    if f.kind == "bootstrap" && f.corpus == "malformed" {
      malformed_bootstrap = malformed_bootstrap + 1
    }
  }
  assert_eq(valid_bootstrap, 3)
  assert_eq(malformed_bootstrap, 14)
}

///|
test "bootstrap malformed six-field oracle agreement" {
  let mut seen = 0
  for f in bridge_fixtures {
    if f.kind == "bootstrap" && f.corpus == "malformed" {
      match f.body {
        Binary(chunks) => {
          let arr = expand_chunks(chunks)
          let bytes = Bytes::from_array(arr[:])
          assert_eq(bytes.length(), f.byte_length)
          match f.oracle {
            Some(o) => {
              expect_bootstrap_err(
                bytes[:],
                o.code,
                o.name,
                o.reason,
                o.offset,
                o.plane,
                o.step,
              )
              seen = seen + 1
            }
            None => abort("missing oracle")
          }
        }
        SegmentRecipe(_) => abort("malformed segment")
      }
    }
  }
  assert_eq(seen, 14)
}

///|
test "bootstrap adversarial prefix lengths 0 through 11" {
  let mut len = 0
  while len < 12 {
    let arr : Array[Byte] = []
    let mut i = 0
    while i < len {
      arr.push(b'\x00')
      i = i + 1
    }
    let bytes = Bytes::from_array(arr[:])
    expect_bootstrap_err(
      bytes[:],
      1,
      "malformed_bootstrap",
      "truncated_prefix",
      0,
      "bootstrap",
      1,
    )
    len = len + 1
  }
}

///|
test "bootstrap step precedence magic version flags kind overflow total" {
  // step 2 bad magic on full-length prefix
  let bad_magic = b"\x00\x00\x00\x00\x00\x01\x00\x00\x00\x00\x00\x00"
  expect_bootstrap_err(
    bad_magic[:],
    1,
    "malformed_bootstrap",
    "bad_magic",
    0,
    "bootstrap",
    2,
  )
  // step 3 unsupported version
  let bad_ver = b"\x52\x32\x57\x50\x01\x01\x00\x00\x00\x00\x00\x00"
  expect_bootstrap_err(
    bad_ver[:],
    4,
    "unsupported_version",
    "unsupported_bootstrap_version",
    4,
    "bootstrap",
    3,
  )
  // step 4 nonzero flags
  let bad_flags = b"\x52\x32\x57\x50\x00\x01\x00\x01\x00\x00\x00\x00"
  expect_bootstrap_err(
    bad_flags[:],
    1,
    "malformed_bootstrap",
    "nonzero_flags",
    6,
    "bootstrap",
    4,
  )
  // step 5 unassigned kind
  let bad_kind = b"\x52\x32\x57\x50\x00\x04\x00\x00\x00\x00\x00\x00"
  expect_bootstrap_err(
    bad_kind[:],
    1,
    "malformed_bootstrap",
    "unassigned_kind",
    5,
    "bootstrap",
    5,
  )
  // step 6 before 7: payload_len 65536
  let overflow = b"\x52\x32\x57\x50\x00\x01\x00\x00\x00\x01\x00\x00"
  expect_bootstrap_err(
    overflow[:],
    24,
    "message_too_large",
    "payload_too_large",
    8,
    "bootstrap",
    6,
  )
  // step 7 exact total mismatch: payload_len=1 but two body bytes
  let trailing = b"\x52\x32\x57\x50\x00\x01\x00\x00\x00\x00\x00\x01\xf5\x00"
  expect_bootstrap_err(
    trailing[:],
    1,
    "malformed_bootstrap",
    "exact_total_mismatch",
    0,
    "bootstrap",
    7,
  )
}

///|
test "bootstrap empty input step 1" {
  expect_bootstrap_err(
    b""[:],
    1,
    "malformed_bootstrap",
    "truncated_prefix",
    0,
    "bootstrap",
    1,
  )
}

///|
/// Build a 12-byte bootstrap prefix + payload with exact total length.
fn with_bootstrap_prefix(kind : Int, payload : Bytes) -> Bytes {
  let plen = payload.length()
  let out : Array[Byte] = [
    b'\x52',
    b'\x32',
    b'\x57',
    b'\x50',
    b'\x00',
    kind.to_byte(),
    b'\x00',
    b'\x00',
    b'\x00',
    b'\x00',
    ((plen >> 8) & 0xff).to_byte(),
    (plen & 0xff).to_byte(),
  ]
  for b in payload {
    out.push(b)
  }
  Bytes::from_array(out[:])
}

///|
/// Minimal legal ClientHello CBOR map with a replaceable wire_versions value head.
/// Template: {1:<wire>, 2:{1:t,2:t}, 3:{1:t,2:t}, 4:{}, 6:[]}
fn client_hello_with_wire_tail(wire_tail : Bytes) -> Bytes {
  let head = b"\xa5\x01"
  let tail = b"\x02\xa2\x01\xf5\x02\xf5\x03\xa2\x01\xf5\x02\xf5\x04\xa0\x06\x80"
  let arr : Array[Byte] = []
  for b in head {
    arr.push(b)
  }
  for b in wire_tail {
    arr.push(b)
  }
  for b in tail {
    arr.push(b)
  }
  Bytes::from_array(arr[:])
}

///|
/// Minimal legal ClientHello with a replaceable extension_capabilities value.
fn client_hello_with_caps_tail(caps_tail : Bytes) -> Bytes {
  let head = b"\xa5\x01\x81\x00\x02\xa2\x01\xf5\x02\xf5\x03\xa2\x01\xf5\x02\xf5\x04\xa0\x06"
  let arr : Array[Byte] = []
  for b in head {
    arr.push(b)
  }
  for b in caps_tail {
    arr.push(b)
  }
  Bytes::from_array(arr[:])
}

///|
fn expect_step9(bytes : BytesView, reason : String) -> Unit raise {
  expect_bootstrap_err(
    bytes, 1, "malformed_bootstrap", reason, 12, "bootstrap", 9,
  )
}

///|
test "bootstrap step9 negative integer versus non-integer reason precedence" {
  // wire_versions = [-1] (CBOR negative element) => range_violation via as_uint_range
  let neg = with_bootstrap_prefix(1, client_hello_with_wire_tail(b"\x81\x20"))
  expect_step9(neg[:], "range_violation")
  // wire_versions = [true] (array ok; non-integer element) => wrong_type via as_uint_range
  let bad_type = with_bootstrap_prefix(
    1,
    client_hello_with_wire_tail(b"\x81\xf5"),
  )
  expect_step9(bad_type[:], "wrong_type")
}

///|
test "bootstrap step9 extension capability duplicate versus descending order" {
  // caps [1, 1] => unique_violation
  let dup = with_bootstrap_prefix(
    1,
    client_hello_with_caps_tail(b"\x82\x01\x01"),
  )
  expect_step9(dup[:], "unique_violation")
  // caps [2, 1] descending order => order_violation
  let desc = with_bootstrap_prefix(
    1,
    client_hello_with_caps_tail(b"\x82\x02\x01"),
  )
  expect_step9(desc[:], "order_violation")
}

///|
test "bootstrap step9 effective limit ceiling rejection" {
  // ServerHello: selected 0, transport/buffer ok, effective max_channels=65536 (over ceiling)
  // {1:0, 2:{1:t,2:t}, 3:{1:t,2:f}, 4:{1:65536,2:0,3:0,4:0}, 6:[]}
  let payload = b"\xa5\x01\x00\x02\xa2\x01\xf5\x02\xf5\x03\xa2\x01\xf5\x02\xf4\x04\xa4\x01\x1a\x00\x01\x00\x00\x02\x00\x03\x00\x04\x00\x06\x80"
  let bytes = with_bootstrap_prefix(2, payload)
  expect_step9(bytes[:], "range_violation")
}

///|
test "bootstrap step9 unsupported BootstrapError code" {
  // BootstrapError {1: 3} — allowed codes are {1,2,4,16,24,25}; fixture uses 3
  let payload = b"\xa1\x01\x03"
  let bytes = with_bootstrap_prefix(3, payload)
  expect_step9(bytes[:], "range_violation")
}

///|
test "bootstrap step9 utf8 text byte length 4097 rejection" {
  // BootstrapError {1:1, 2: text of 4097 ASCII 'a' bytes}
  // text head: 0x79 0x10 0x01 (ai=25, length 4097)
  let arr : Array[Byte] = [
    b'\xa2', b'\x01', b'\x01', b'\x02', b'\x79', b'\x10', b'\x01',
  ]
  let mut i = 0
  while i < 4097 {
    arr.push(b'a')
    i = i + 1
  }
  let payload = Bytes::from_array(arr[:])
  let bytes = with_bootstrap_prefix(3, payload)
  expect_step9(bytes[:], "text_too_long")
}

///|
test "protocol error frame constructors available" {
  let e = ProtocolError::malformed_frame("truncated_header", 0, 1)
  assert_eq(e.code, 3)
  assert_eq(e.name, "malformed_frame")
  assert_eq(e.plane, "selected_frame")
  assert_eq(e.step, 1)
  let c = ProtocolError::clock_unavailable("clock", 0, 12)
  assert_eq(c.code, 28)
}
