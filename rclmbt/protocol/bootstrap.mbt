///|
/// R2WP v0 bootstrap record parser (receiver validation order steps 1–9).

///|
pub const BOOTSTRAP_PREFIX_LENGTH : Int = 12

///|
pub const BOOTSTRAP_PAYLOAD_MAX_BYTES : UInt = 65535U

///|
const BOOTSTRAP_VERSION : Int = 0

///|
const KIND_CLIENT_HELLO : Int = 1

///|
const KIND_SERVER_HELLO : Int = 2

///|
const KIND_BOOTSTRAP_ERROR : Int = 3

///|
const UTF8_TEXT_MAX_BYTES : Int = 4096

///|
const WIRE_VERSIONS_MAX : Int = 16

///|
const CAPABILITY_IDS_MAX : Int = 64

///|
const CAPABILITY_ID_MIN : UInt64 = 1UL

///|
const CAPABILITY_ID_MAX : UInt64 = 65535UL

///|
const EFFECTIVE_MAX_CHANNELS : UInt64 = 65535UL

///|
const EFFECTIVE_MAX_SESSION_BYTES : UInt64 = 4294967296UL

///|
const EFFECTIVE_MAX_MESSAGE_BYTES : UInt64 = 67108864UL

///|
const EFFECTIVE_MAX_CONTROL_PAYLOAD_BYTES : UInt64 = 1048576UL

///|
pub struct TransportCapabilities {
  webtransport_http3 : Bool
  binary_wss : Bool
  max_datagram_size : UInt?
}

///|
pub struct BufferCapabilities {
  transferable_arraybuffer : Bool
  shared_arraybuffer : Bool
}

///|
/// ClientHello requested_limits: required map; four members each optional.
pub struct RequestedLimits {
  max_channels : UInt?
  max_session_bytes : UInt64?
  max_message_bytes : UInt?
  max_control_payload_bytes : UInt?
}

///|
/// ServerHello effective_limits: four required members with registry ceilings.
pub struct EffectiveLimits {
  max_channels : UInt
  max_session_bytes : UInt64
  max_message_bytes : UInt
  max_control_payload_bytes : UInt
}

///|
pub struct ClientHello {
  wire_versions : Array[Int]
  transport_capabilities : TransportCapabilities
  buffer_capabilities : BufferCapabilities
  requested_limits : RequestedLimits
  extension_capabilities : Array[Int]
}

///|
pub struct ServerHello {
  selected_wire_version : Int
  transport_capabilities : TransportCapabilities
  buffer_capabilities : BufferCapabilities
  effective_limits : EffectiveLimits
  extension_capabilities : Array[Int]
}

///|
pub struct BootstrapErrorRecord {
  code : Int
  message : String?
  detail : String?
}

///|
pub enum BootstrapRecord {
  ClientHello(ClientHello)
  ServerHello(ServerHello)
  BootstrapError(BootstrapErrorRecord)
}

///|
fn magic_ok(bytes : BytesView) -> Bool {
  bytes.length() >= 4 &&
  bytes[0] == b'\x52' &&
  bytes[1] == b'\x32' &&
  bytes[2] == b'\x57' &&
  bytes[3] == b'\x50'
}

///|
fn read_u16_be(bytes : BytesView, offset : Int) -> Int {
  let hi = bytes[offset].to_int()
  let lo = bytes[offset + 1].to_int()
  (hi << 8) | lo
}

///|
fn read_u32_be(bytes : BytesView, offset : Int) -> UInt {
  let b0 = bytes[offset].to_int().reinterpret_as_uint()
  let b1 = bytes[offset + 1].to_int().reinterpret_as_uint()
  let b2 = bytes[offset + 2].to_int().reinterpret_as_uint()
  let b3 = bytes[offset + 3].to_int().reinterpret_as_uint()
  (b0 << 24) | (b1 << 16) | (b2 << 8) | b3
}

///|
fn map_cbor_error(err : CborError, payload_base : Int) -> ProtocolError {
  ProtocolError::malformed_bootstrap(
    "cbor_profile",
    payload_base + err.offset,
    8,
  )
}

///|
fn as_map(
  value : CborValue,
  offset : Int,
) -> Result[Array[(UInt64, CborValue)], ProtocolError] {
  match value {
    CborValue::Map(m) => Ok(m)
    _ => Err(ProtocolError::malformed_bootstrap("wrong_type", offset, 9))
  }
}

///|
fn key_in(keys : Array[UInt64], key : UInt64) -> Bool {
  for k in keys {
    if k == key {
      return true
    }
  }
  false
}

///|
fn require_exact_keys(
  map : Array[(UInt64, CborValue)],
  required : Array[UInt64],
  optional : Array[UInt64],
  offset : Int,
) -> Result[Unit, ProtocolError] {
  for entry in map {
    let (key, _) = entry
    if !(key_in(required, key) || key_in(optional, key)) {
      return Err(ProtocolError::malformed_bootstrap("unknown_key", offset, 9))
    }
  }
  for req in required {
    let mut found = false
    for entry in map {
      let (key, _) = entry
      if key == req {
        found = true
      }
    }
    if !found {
      return Err(ProtocolError::malformed_bootstrap("missing_key", offset, 9))
    }
  }
  Ok(())
}

///|
fn map_get(map : Array[(UInt64, CborValue)], key : UInt64) -> CborValue? {
  for entry in map {
    let (k, v) = entry
    if k == key {
      return Some(v)
    }
  }
  None
}

///|
fn as_bool(value : CborValue, offset : Int) -> Result[Bool, ProtocolError] {
  match value {
    CborValue::Bool(b) => Ok(b)
    _ => Err(ProtocolError::malformed_bootstrap("wrong_type", offset, 9))
  }
}

///|
/// Accept integer CBOR shapes, then enforce [min, max].
/// Unsigned and Negative enter the range check; other types map to wrong_type.
fn as_uint_range(
  value : CborValue,
  offset : Int,
  min : UInt64,
  max : UInt64,
) -> Result[UInt64, ProtocolError] {
  match value {
    CborValue::Unsigned(v) => {
      if v < min || v > max {
        return Err(
          ProtocolError::malformed_bootstrap("range_violation", offset, 9),
        )
      }
      Ok(v)
    }
    CborValue::Negative(_) =>
      // Negative values are always below any non-negative min.
      Err(ProtocolError::malformed_bootstrap("range_violation", offset, 9))
    _ => Err(ProtocolError::malformed_bootstrap("wrong_type", offset, 9))
  }
}

///|
fn as_uint32(value : CborValue, offset : Int) -> Result[UInt, ProtocolError] {
  let n = match as_uint_range(value, offset, 0UL, 4294967295UL) {
    Ok(v) => v
    Err(e) => return Err(e)
  }
  Ok(n.to_uint())
}

///|
fn as_uint8(value : CborValue, offset : Int) -> Result[Int, ProtocolError] {
  let n = match as_uint_range(value, offset, 0UL, 255UL) {
    Ok(v) => v
    Err(e) => return Err(e)
  }
  Ok(n.to_int())
}

///|
fn as_text(value : CborValue, offset : Int) -> Result[String, ProtocolError] {
  match value {
    CborValue::Text(t) => {
      // UTF-8 byte length: MoonBit String length is UTF-16 code units.
      // Agreement corpus uses ASCII-only 4096-byte text; measure via encode.
      let encoded = @utf8.encode(t[:])
      if encoded.length() > UTF8_TEXT_MAX_BYTES {
        return Err(
          ProtocolError::malformed_bootstrap("text_too_long", offset, 9),
        )
      }
      Ok(t)
    }
    _ => Err(ProtocolError::malformed_bootstrap("wrong_type", offset, 9))
  }
}

///|
fn as_array(
  value : CborValue,
  offset : Int,
) -> Result[Array[CborValue], ProtocolError] {
  match value {
    CborValue::Array(a) => Ok(a)
    _ => Err(ProtocolError::malformed_bootstrap("wrong_type", offset, 9))
  }
}

///|
fn decode_transport(
  value : CborValue,
  offset : Int,
) -> Result[TransportCapabilities, ProtocolError] {
  let map = match as_map(value, offset) {
    Ok(m) => m
    Err(e) => return Err(e)
  }
  match require_exact_keys(map, [1UL, 2UL], [3UL], offset) {
    Ok(_) => ()
    Err(e) => return Err(e)
  }
  let wt = match map_get(map, 1UL) {
    Some(v) =>
      match as_bool(v, offset) {
        Ok(b) => b
        Err(e) => return Err(e)
      }
    None =>
      return Err(ProtocolError::malformed_bootstrap("missing_key", offset, 9))
  }
  let wss = match map_get(map, 2UL) {
    Some(v) =>
      match as_bool(v, offset) {
        Ok(b) => b
        Err(e) => return Err(e)
      }
    None =>
      return Err(ProtocolError::malformed_bootstrap("missing_key", offset, 9))
  }
  let mut max_d : UInt? = None
  match map_get(map, 3UL) {
    Some(v) =>
      match as_uint32(v, offset) {
        Ok(n) => max_d = Some(n)
        Err(e) => return Err(e)
      }
    None => ()
  }
  Ok({ webtransport_http3: wt, binary_wss: wss, max_datagram_size: max_d })
}

///|
fn decode_buffer(
  value : CborValue,
  offset : Int,
) -> Result[BufferCapabilities, ProtocolError] {
  let map = match as_map(value, offset) {
    Ok(m) => m
    Err(e) => return Err(e)
  }
  match require_exact_keys(map, [1UL, 2UL], [], offset) {
    Ok(_) => ()
    Err(e) => return Err(e)
  }
  let t = match map_get(map, 1UL) {
    Some(v) =>
      match as_bool(v, offset) {
        Ok(b) => b
        Err(e) => return Err(e)
      }
    None =>
      return Err(ProtocolError::malformed_bootstrap("missing_key", offset, 9))
  }
  let s = match map_get(map, 2UL) {
    Some(v) =>
      match as_bool(v, offset) {
        Ok(b) => b
        Err(e) => return Err(e)
      }
    None =>
      return Err(ProtocolError::malformed_bootstrap("missing_key", offset, 9))
  }
  Ok({ transferable_arraybuffer: t, shared_arraybuffer: s })
}

///|
fn decode_wire_versions(
  value : CborValue,
  offset : Int,
) -> Result[Array[Int], ProtocolError] {
  let arr = match as_array(value, offset) {
    Ok(a) => a
    Err(e) => return Err(e)
  }
  if arr.length() == 0 || arr.length() > WIRE_VERSIONS_MAX {
    return Err(ProtocolError::malformed_bootstrap("range_violation", offset, 9))
  }
  let out : Array[Int] = []
  let seen : Array[Int] = []
  for el in arr {
    let v = match as_uint8(el, offset) {
      Ok(n) => n
      Err(e) => return Err(e)
    }
    for s in seen {
      if s == v {
        return Err(
          ProtocolError::malformed_bootstrap("unique_violation", offset, 9),
        )
      }
    }
    seen.push(v)
    out.push(v)
  }
  Ok(out)
}

///|
fn decode_extension_capabilities(
  value : CborValue,
  offset : Int,
) -> Result[Array[Int], ProtocolError] {
  let arr = match as_array(value, offset) {
    Ok(a) => a
    Err(e) => return Err(e)
  }
  if arr.length() > CAPABILITY_IDS_MAX {
    return Err(ProtocolError::malformed_bootstrap("range_violation", offset, 9))
  }
  let out : Array[Int] = []
  let mut has_prev = false
  let mut prev : Int = 0
  for el in arr {
    let id_u = match
      as_uint_range(el, offset, CAPABILITY_ID_MIN, CAPABILITY_ID_MAX) {
      Ok(n) => n
      Err(e) => return Err(e)
    }
    let id = id_u.to_int()
    if has_prev {
      if id == prev {
        return Err(
          ProtocolError::malformed_bootstrap("unique_violation", offset, 9),
        )
      }
      if id < prev {
        return Err(
          ProtocolError::malformed_bootstrap("order_violation", offset, 9),
        )
      }
    }
    has_prev = true
    prev = id
    out.push(id)
  }
  Ok(out)
}

///|
fn decode_requested_limits(
  value : CborValue,
  offset : Int,
) -> Result[RequestedLimits, ProtocolError] {
  let map = match as_map(value, offset) {
    Ok(m) => m
    Err(e) => return Err(e)
  }
  match require_exact_keys(map, [], [1UL, 2UL, 3UL, 4UL], offset) {
    Ok(_) => ()
    Err(e) => return Err(e)
  }
  let mut max_channels : UInt? = None
  let mut max_session_bytes : UInt64? = None
  let mut max_message_bytes : UInt? = None
  let mut max_control_payload_bytes : UInt? = None
  match map_get(map, 1UL) {
    Some(v) =>
      match as_uint32(v, offset) {
        Ok(n) => max_channels = Some(n)
        Err(e) => return Err(e)
      }
    None => ()
  }
  match map_get(map, 2UL) {
    Some(v) =>
      match as_uint_range(v, offset, 0UL, 0xffffffffffffffffUL) {
        Ok(n) => max_session_bytes = Some(n)
        Err(e) => return Err(e)
      }
    None => ()
  }
  match map_get(map, 3UL) {
    Some(v) =>
      match as_uint32(v, offset) {
        Ok(n) => max_message_bytes = Some(n)
        Err(e) => return Err(e)
      }
    None => ()
  }
  match map_get(map, 4UL) {
    Some(v) =>
      match as_uint32(v, offset) {
        Ok(n) => max_control_payload_bytes = Some(n)
        Err(e) => return Err(e)
      }
    None => ()
  }
  Ok({
    max_channels,
    max_session_bytes,
    max_message_bytes,
    max_control_payload_bytes,
  })
}

///|
fn decode_effective_limits(
  value : CborValue,
  offset : Int,
) -> Result[EffectiveLimits, ProtocolError] {
  let map = match as_map(value, offset) {
    Ok(m) => m
    Err(e) => return Err(e)
  }
  match require_exact_keys(map, [1UL, 2UL, 3UL, 4UL], [], offset) {
    Ok(_) => ()
    Err(e) => return Err(e)
  }
  let ch = match map_get(map, 1UL) {
    Some(v) =>
      match as_uint_range(v, offset, 0UL, EFFECTIVE_MAX_CHANNELS) {
        Ok(n) => n.to_uint()
        Err(e) => return Err(e)
      }
    None =>
      return Err(ProtocolError::malformed_bootstrap("missing_key", offset, 9))
  }
  let sess = match map_get(map, 2UL) {
    Some(v) =>
      match as_uint_range(v, offset, 0UL, EFFECTIVE_MAX_SESSION_BYTES) {
        Ok(n) => n
        Err(e) => return Err(e)
      }
    None =>
      return Err(ProtocolError::malformed_bootstrap("missing_key", offset, 9))
  }
  let msg = match map_get(map, 3UL) {
    Some(v) =>
      match as_uint_range(v, offset, 0UL, EFFECTIVE_MAX_MESSAGE_BYTES) {
        Ok(n) => n.to_uint()
        Err(e) => return Err(e)
      }
    None =>
      return Err(ProtocolError::malformed_bootstrap("missing_key", offset, 9))
  }
  let ctrl = match map_get(map, 4UL) {
    Some(v) =>
      match as_uint_range(v, offset, 0UL, EFFECTIVE_MAX_CONTROL_PAYLOAD_BYTES) {
        Ok(n) => n.to_uint()
        Err(e) => return Err(e)
      }
    None =>
      return Err(ProtocolError::malformed_bootstrap("missing_key", offset, 9))
  }
  Ok({
    max_channels: ch,
    max_session_bytes: sess,
    max_message_bytes: msg,
    max_control_payload_bytes: ctrl,
  })
}

///|
fn decode_client_hello(
  value : CborValue,
  offset : Int,
) -> Result[ClientHello, ProtocolError] {
  let map = match as_map(value, offset) {
    Ok(m) => m
    Err(e) => return Err(e)
  }
  match require_exact_keys(map, [1UL, 2UL, 3UL, 4UL, 6UL], [], offset) {
    Ok(_) => ()
    Err(e) => return Err(e)
  }
  let mut wire : Array[Int] = []
  let mut transport : TransportCapabilities = {
    webtransport_http3: false,
    binary_wss: false,
    max_datagram_size: None,
  }
  let mut buffer : BufferCapabilities = {
    transferable_arraybuffer: false,
    shared_arraybuffer: false,
  }
  let mut requested : RequestedLimits = {
    max_channels: None,
    max_session_bytes: None,
    max_message_bytes: None,
    max_control_payload_bytes: None,
  }
  let mut caps : Array[Int] = []
  for entry in map {
    let (k, v) = entry
    if k == 1UL {
      wire = match decode_wire_versions(v, offset) {
        Ok(a) => a
        Err(e) => return Err(e)
      }
    } else if k == 2UL {
      transport = match decode_transport(v, offset) {
        Ok(t) => t
        Err(e) => return Err(e)
      }
    } else if k == 3UL {
      buffer = match decode_buffer(v, offset) {
        Ok(b) => b
        Err(e) => return Err(e)
      }
    } else if k == 4UL {
      requested = match decode_requested_limits(v, offset) {
        Ok(r) => r
        Err(e) => return Err(e)
      }
    } else if k == 6UL {
      caps = match decode_extension_capabilities(v, offset) {
        Ok(c) => c
        Err(e) => return Err(e)
      }
    }
  }
  Ok({
    wire_versions: wire,
    transport_capabilities: transport,
    buffer_capabilities: buffer,
    requested_limits: requested,
    extension_capabilities: caps,
  })
}

///|
fn decode_server_hello(
  value : CborValue,
  offset : Int,
) -> Result[ServerHello, ProtocolError] {
  let map = match as_map(value, offset) {
    Ok(m) => m
    Err(e) => return Err(e)
  }
  match require_exact_keys(map, [1UL, 2UL, 3UL, 4UL, 6UL], [], offset) {
    Ok(_) => ()
    Err(e) => return Err(e)
  }
  let mut selected = 0
  let mut transport : TransportCapabilities = {
    webtransport_http3: false,
    binary_wss: false,
    max_datagram_size: None,
  }
  let mut buffer : BufferCapabilities = {
    transferable_arraybuffer: false,
    shared_arraybuffer: false,
  }
  let mut effective : EffectiveLimits = {
    max_channels: 0U,
    max_session_bytes: 0UL,
    max_message_bytes: 0U,
    max_control_payload_bytes: 0U,
  }
  let mut caps : Array[Int] = []
  for entry in map {
    let (k, v) = entry
    if k == 1UL {
      let s = match as_uint8(v, offset) {
        Ok(n) => n
        Err(e) => return Err(e)
      }
      if s != 0 {
        return Err(
          ProtocolError::malformed_bootstrap("range_violation", offset, 9),
        )
      }
      selected = s
    } else if k == 2UL {
      transport = match decode_transport(v, offset) {
        Ok(t) => t
        Err(e) => return Err(e)
      }
    } else if k == 3UL {
      buffer = match decode_buffer(v, offset) {
        Ok(b) => b
        Err(e) => return Err(e)
      }
    } else if k == 4UL {
      effective = match decode_effective_limits(v, offset) {
        Ok(e) => e
        Err(e) => return Err(e)
      }
    } else if k == 6UL {
      caps = match decode_extension_capabilities(v, offset) {
        Ok(c) => c
        Err(e) => return Err(e)
      }
    }
  }
  Ok({
    selected_wire_version: selected,
    transport_capabilities: transport,
    buffer_capabilities: buffer,
    effective_limits: effective,
    extension_capabilities: caps,
  })
}

///|
fn bootstrap_error_code_allowed(code : Int) -> Bool {
  code == 1 || code == 2 || code == 4 || code == 16 || code == 24 || code == 25
}

///|
fn decode_bootstrap_error(
  value : CborValue,
  offset : Int,
) -> Result[BootstrapErrorRecord, ProtocolError] {
  let map = match as_map(value, offset) {
    Ok(m) => m
    Err(e) => return Err(e)
  }
  match require_exact_keys(map, [1UL], [2UL, 3UL], offset) {
    Ok(_) => ()
    Err(e) => return Err(e)
  }
  let code_num = match map_get(map, 1UL) {
    Some(v) =>
      match as_uint_range(v, offset, 0UL, 255UL) {
        Ok(n) => n.to_int()
        Err(e) => return Err(e)
      }
    None =>
      return Err(ProtocolError::malformed_bootstrap("missing_key", offset, 9))
  }
  if !bootstrap_error_code_allowed(code_num) {
    return Err(ProtocolError::malformed_bootstrap("range_violation", offset, 9))
  }
  let mut message : String? = None
  let mut detail : String? = None
  match map_get(map, 2UL) {
    Some(v) =>
      match as_text(v, offset) {
        Ok(t) => message = Some(t)
        Err(e) => return Err(e)
      }
    None => ()
  }
  match map_get(map, 3UL) {
    Some(v) =>
      match as_text(v, offset) {
        Ok(t) => detail = Some(t)
        Err(e) => return Err(e)
      }
    None => ()
  }
  Ok({ code: code_num, message, detail })
}

///|
fn decode_payload_by_kind(
  kind : Int,
  value : CborValue,
  offset : Int,
) -> Result[BootstrapRecord, ProtocolError] {
  if kind == KIND_CLIENT_HELLO {
    match decode_client_hello(value, offset) {
      Ok(ch) => Ok(BootstrapRecord::ClientHello(ch))
      Err(e) => Err(e)
    }
  } else if kind == KIND_SERVER_HELLO {
    match decode_server_hello(value, offset) {
      Ok(sh) => Ok(BootstrapRecord::ServerHello(sh))
      Err(e) => Err(e)
    }
  } else if kind == KIND_BOOTSTRAP_ERROR {
    match decode_bootstrap_error(value, offset) {
      Ok(be) => Ok(BootstrapRecord::BootstrapError(be))
      Err(e) => Err(e)
    }
  } else {
    Err(ProtocolError::malformed_bootstrap("unassigned_kind", 5, 5))
  }
}

///|
/// Parse a complete bootstrap record. Atomic whole-value return.
/// Validation order matches validation_order.bootstrap steps 1–9.
pub fn parse_bootstrap(
  bytes : BytesView,
) -> Result[BootstrapRecord, ProtocolError] {
  // 1. minimum length 12
  if bytes.length() < BOOTSTRAP_PREFIX_LENGTH {
    return Err(ProtocolError::malformed_bootstrap("truncated_prefix", 0, 1))
  }

  // 2. magic R2WP
  if !magic_ok(bytes) {
    return Err(ProtocolError::malformed_bootstrap("bad_magic", 0, 2))
  }

  // 3. bootstrap_version 0
  if bytes[4].to_int() != BOOTSTRAP_VERSION {
    return Err(
      ProtocolError::unsupported_version("unsupported_bootstrap_version", 4, 3),
    )
  }

  // 4. flags zero
  let flags = read_u16_be(bytes, 6)
  if flags != 0 {
    return Err(ProtocolError::malformed_bootstrap("nonzero_flags", 6, 4))
  }

  // 5. kind assigned
  let kind = bytes[5].to_int()
  if kind != KIND_CLIENT_HELLO &&
    kind != KIND_SERVER_HELLO &&
    kind != KIND_BOOTSTRAP_ERROR {
    return Err(ProtocolError::malformed_bootstrap("unassigned_kind", 5, 5))
  }

  // 6. payload_len absolute limit
  let payload_len = read_u32_be(bytes, 8)
  if payload_len > BOOTSTRAP_PAYLOAD_MAX_BYTES {
    return Err(ProtocolError::message_too_large("payload_too_large", 8, 6))
  }

  // 7. exact total length 12 + payload_len
  // payload_len fits Int after the absolute ceiling check (max 65535).
  let payload_len_i = payload_len.reinterpret_as_int()
  let expected_total = BOOTSTRAP_PREFIX_LENGTH + payload_len_i
  if bytes.length() != expected_total {
    return Err(ProtocolError::malformed_bootstrap("exact_total_mismatch", 0, 7))
  }

  let payload = bytes[BOOTSTRAP_PREFIX_LENGTH:expected_total]

  // 8. deterministic CBOR profile
  let cbor_value = match decode_deterministic_cbor(payload) {
    Ok(v) => v
    Err(e) => return Err(map_cbor_error(e, BOOTSTRAP_PREFIX_LENGTH))
  }

  // 9. CDDL / kind shape match
  decode_payload_by_kind(kind, cbor_value, BOOTSTRAP_PREFIX_LENGTH)
}
