///|
/// R2WP v0 CONTROL_CBOR decoder + static CDDL shape validation (selected-frame step 16).

///|
pub const CONTROL_PAYLOAD_MAX_BYTES : Int = 1048576

///|
pub const CONTROL_KIND_AUTHENTICATE : Int = 1

///|
pub const CONTROL_KIND_SESSION_READY : Int = 2

///|
pub const CONTROL_KIND_GRAPH_SNAPSHOT : Int = 3

///|
pub const CONTROL_KIND_GRAPH_DELTA : Int = 4

///|
pub const CONTROL_KIND_SCHEMA_REQUEST : Int = 5

///|
pub const CONTROL_KIND_SCHEMA_ADVERTISE : Int = 6

///|
pub const CONTROL_KIND_SCHEMA_RESPONSE : Int = 7

///|
pub const CONTROL_KIND_OPEN_CHANNEL : Int = 8

///|
pub const CONTROL_KIND_CHANNEL_READY : Int = 9

///|
pub const CONTROL_KIND_CLOSE_CHANNEL : Int = 10

///|
pub const CONTROL_KIND_CLOCK_SYNC : Int = 11

///|
pub const CONTROL_KIND_HEARTBEAT : Int = 12

///|
pub const CONTROL_KIND_SESSION_RESUME : Int = 13

///|
pub const CONTROL_KIND_SESSION_RESUME_RESULT : Int = 14

///|
pub const CONTROL_KIND_ERROR : Int = 15

///|
pub struct ControlMessage {
  kind : Int
  fields : Array[(UInt64, CborValue)]
}

///|
pub struct ControlError {
  reason : String
  /// Payload-relative byte offset.
  offset : Int
}

///|
fn ControlError::new(reason : String, offset : Int) -> ControlError {
  { reason, offset }
}

///|
fn fail(reason : String) -> ControlError {
  ControlError::new(reason, 0)
}

///|
const UINT32_MAX : UInt64 = 4294967295UL

///|
const UINT64_MAX : UInt64 = 0xffffffffffffffffUL

///|
const INT64_MAX_U : UInt64 = 0x7fffffffffffffffUL

///|
const UTF8_TEXT_MAX : Int = 4096

///|
const DOMAIN_ID_MAX : UInt64 = 232UL

///|
const DOMAIN_IDS_MAX : Int = 233

///|
const CAP_ID_MAX : UInt64 = 65535UL

///|
const CAP_IDS_MAX : Int = 64

///|
const GRAPH_NODES_MAX : Int = 65535

///|
const GRAPH_ENDPOINTS_MAX : Int = 65535

///|
const GRAPH_DELTA_OPS_MAX : Int = 1024

///|
const SOURCE_BUNDLE_MAX : Int = 4096

///|
const ALIVE_CHANNELS_MAX : Int = 65535

///|
const CHANNEL_ACKS_MAX : Int = 65535

///|
const CHANNEL_RESULTS_MAX : Int = 65535

///|
const CRED_MAX : Int = 65535

///|
const DESC_MAX : Int = 1048576

///|
const CONTENT_MAX : Int = 1048576

///|
priv enum ArrayRule {
  UniqueAscendingUint
  UniqueAscendingChannelId
  GraphNodesSorted
  GraphEndpointsSorted
}

///|
priv enum Schema {
  BoolS
  Uint(UInt64, UInt64)
  Int64S
  Text(Int, Int, Array[String]?)
  Bytes(Int, Int)
  ConstU64(UInt64)
  ConstBool(Bool)
  ArrayS(Int, Int, Schema, ArrayRule?)
  MapDyn(Array[(UInt64, Bool, Schema)])
  Union(Array[Schema])
  Identity
  Qos
  EffectiveQos
  EffectiveServiceQos
  ActionQos
  EffectiveActionQos
}

///|
fn as_uint(
  value : CborValue,
  min : UInt64,
  max : UInt64,
) -> Result[UInt64, ControlError] {
  match value {
    CborValue::Unsigned(v) => {
      if v < min || v > max {
        return Err(fail("range_violation"))
      }
      Ok(v)
    }
    CborValue::Negative(_) => Err(fail("range_violation"))
    _ => Err(fail("wrong_type"))
  }
}

///|
fn as_int64(value : CborValue) -> Result[Int64, ControlError] {
  match value {
    CborValue::Unsigned(v) => {
      if v > INT64_MAX_U {
        return Err(fail("range_violation"))
      }
      Ok(v.reinterpret_as_int64())
    }
    CborValue::Negative(a) => {
      // value = -1 - a; fits int64 when a <= 2^63-1
      if a > INT64_MAX_U {
        return Err(fail("range_violation"))
      }
      if a == INT64_MAX_U {
        Ok(-9223372036854775808L)
      } else {
        let ap1 = a + 1UL
        Ok(0L - ap1.reinterpret_as_int64())
      }
    }
    _ => Err(fail("wrong_type"))
  }
}

///|
fn text_utf8_len(s : String) -> Int {
  @utf8.encode(s[:]).length()
}

///|
fn map_from_value(
  value : CborValue,
) -> Result[Array[(UInt64, CborValue)], ControlError] {
  match value {
    CborValue::Map(entries) => {
      let out : Array[(UInt64, CborValue)] = []
      for e in entries {
        let (k, v) = e
        for existing in out {
          let (ek, _) = existing
          if ek == k {
            return Err(fail("unique_violation"))
          }
        }
        out.push((k, v))
      }
      Ok(out)
    }
    _ => Err(fail("wrong_type"))
  }
}

///|
fn ctrl_map_get(
  entries : Array[(UInt64, CborValue)],
  key : UInt64,
) -> CborValue? {
  for e in entries {
    let (k, v) = e
    if k == key {
      return Some(v)
    }
  }
  None
}

///|
fn bytes_view_cmp(a : BytesView, b : BytesView) -> Int {
  let na = a.length()
  let nb = b.length()
  let n = if na < nb { na } else { nb }
  let mut i = 0
  while i < n {
    let ai = a[i].to_int()
    let bi = b[i].to_int()
    if ai < bi {
      return -1
    }
    if ai > bi {
      return 1
    }
    i = i + 1
  }
  if na < nb {
    -1
  } else if na > nb {
    1
  } else {
    0
  }
}

///|
fn u(min : UInt64, max : UInt64) -> Schema {
  Schema::Uint(min, max)
}

///|
fn text_s(min_b : Int, max_b : Int) -> Schema {
  Schema::Text(min_b, max_b, None)
}

///|
fn text_one_of(opts : Array[String]) -> Schema {
  Schema::Text(1, UTF8_TEXT_MAX, Some(opts))
}

///|
fn bytes_s(min : Int, max : Int) -> Schema {
  Schema::Bytes(min, max)
}

///|
fn arr(min : Int, max : Int, items : Schema, rule : ArrayRule?) -> Schema {
  Schema::ArrayS(min, max, items, rule)
}

///|
fn fmap(entries : Array[(UInt64, Bool, Schema)]) -> Schema {
  Schema::MapDyn(entries)
}

///|
fn uint32() -> Schema {
  u(0UL, UINT32_MAX)
}

///|
fn uint64() -> Schema {
  u(0UL, UINT64_MAX)
}

///|
fn app_channel_id() -> Schema {
  u(1UL, UINT32_MAX)
}

///|
fn domain_id() -> Schema {
  u(0UL, DOMAIN_ID_MAX)
}

///|
fn capability_id() -> Schema {
  u(1UL, CAP_ID_MAX)
}

///|
fn text4k() -> Schema {
  text_s(0, UTF8_TEXT_MAX)
}

///|
fn text_nonempty() -> Schema {
  text_s(1, UTF8_TEXT_MAX)
}

///|
fn bytes16() -> Schema {
  bytes_s(16, 16)
}

///|
fn bytes32() -> Schema {
  bytes_s(32, 32)
}

///|
fn bytes_cred() -> Schema {
  bytes_s(1, CRED_MAX)
}

///|
fn bytes_desc() -> Schema {
  bytes_s(1, DESC_MAX)
}

///|
fn bytes_content() -> Schema {
  bytes_s(0, CONTENT_MAX)
}

///|
fn wire_error_code() -> Schema {
  u(1UL, 28UL)
}

///|
fn retry_class() -> Schema {
  u(0UL, 3UL)
}

///|
fn close_reason() -> Schema {
  u(1UL, 6UL)
}

///|
fn priority_id() -> Schema {
  u(0UL, 4UL)
}

///|
fn clock_id() -> Schema {
  u(0UL, 4UL)
}

///|
fn positive_depth() -> Schema {
  u(1UL, UINT32_MAX)
}

///|
fn support_row_id() -> Schema {
  text_one_of(["H-FT", "H-CY", "H-ZN", "J-FT", "J-CY", "J-ZN"])
}

///|
fn ros_distro() -> Schema {
  text_one_of(["humble", "jazzy"])
}

///|
fn rmw_identifier() -> Schema {
  text_one_of(["rmw_fastrtps_cpp", "rmw_cyclonedds_cpp", "rmw_zenoh_cpp"])
}

///|
fn payload_encoding_cdr() -> Schema {
  u(1UL, 2UL)
}

///|
fn source_entry_encoding() -> Schema {
  u(1UL, 5UL)
}

///|
fn reliability() -> Schema {
  u(0UL, 2UL)
}

///|
fn durability() -> Schema {
  u(0UL, 2UL)
}

///|
fn liveliness() -> Schema {
  u(0UL, 2UL)
}

///|
fn apply_array_rule(
  items : Array[CborValue],
  rule : ArrayRule?,
) -> Result[Unit, ControlError] {
  match rule {
    None => Ok(())
    Some(r) => {
      if items.length() == 0 {
        return Ok(())
      }
      match r {
        UniqueAscendingUint => {
          let mut has_prev = false
          let mut prev : UInt64 = 0UL
          for el in items {
            let n = match as_uint(el, 0UL, UINT64_MAX) {
              Ok(v) => v
              Err(e) => return Err(e)
            }
            if has_prev {
              if n == prev {
                return Err(fail("unique_violation"))
              }
              if n < prev {
                return Err(fail("order_violation"))
              }
            }
            has_prev = true
            prev = n
          }
          Ok(())
        }
        UniqueAscendingChannelId => {
          let mut has_prev = false
          let mut prev : UInt64 = 0UL
          for el in items {
            let m = match map_from_value(el) {
              Ok(v) => v
              Err(e) => return Err(e)
            }
            let id = match ctrl_map_get(m, 1UL) {
              Some(v) => v
              None => return Err(fail("wrong_type"))
            }
            let n = match as_uint(id, 1UL, UINT32_MAX) {
              Ok(v) => v
              Err(e) => return Err(e)
            }
            if has_prev {
              if n == prev {
                return Err(fail("unique_violation"))
              }
              if n < prev {
                return Err(fail("order_violation"))
              }
            }
            has_prev = true
            prev = n
          }
          Ok(())
        }
        GraphNodesSorted => {
          let mut has_prev = false
          let mut prev_bytes : BytesView = b""[:]
          for el in items {
            let m = match map_from_value(el) {
              Ok(v) => v
              Err(e) => return Err(e)
            }
            let id = match ctrl_map_get(m, 55UL) {
              Some(v) => v
              None => return Err(fail("wrong_type"))
            }
            match id {
              CborValue::Bytes(b) => {
                if has_prev {
                  let c = bytes_view_cmp(prev_bytes, b)
                  if c == 0 {
                    return Err(fail("unique_violation"))
                  }
                  if c > 0 {
                    return Err(fail("order_violation"))
                  }
                }
                has_prev = true
                prev_bytes = b
              }
              _ => return Err(fail("wrong_type"))
            }
          }
          Ok(())
        }
        GraphEndpointsSorted => {
          let mut has_prev = false
          let mut prev_bytes : BytesView = b""[:]
          for el in items {
            let m = match map_from_value(el) {
              Ok(v) => v
              Err(e) => return Err(e)
            }
            let id = match ctrl_map_get(m, 56UL) {
              Some(v) => v
              None => return Err(fail("wrong_type"))
            }
            match id {
              CborValue::Bytes(b) => {
                if has_prev {
                  let c = bytes_view_cmp(prev_bytes, b)
                  if c == 0 {
                    return Err(fail("unique_violation"))
                  }
                  if c > 0 {
                    return Err(fail("order_violation"))
                  }
                }
                has_prev = true
                prev_bytes = b
              }
              _ => return Err(fail("wrong_type"))
            }
          }
          Ok(())
        }
      }
    }
  }
}

///|
fn validate_schema_identity(
  value : CborValue,
) -> Result[CborValue, ControlError] {
  let m = match map_from_value(value) {
    Ok(v) => v
    Err(e) => return Err(e)
  }
  for e in m {
    let (k, _) = e
    if k != 1UL && k != 2UL {
      return Err(fail("unknown_key"))
    }
  }
  let scheme = match ctrl_map_get(m, 1UL) {
    Some(v) => v
    None => return Err(fail("missing_key"))
  }
  let val = match ctrl_map_get(m, 2UL) {
    Some(v) => v
    None => return Err(fail("missing_key"))
  }
  match (scheme, val) {
    (CborValue::Text(scheme_s), CborValue::Text(val_s)) => {
      if scheme_s == "rep2011-rihs" {
        let blen = text_utf8_len(val_s)
        if blen != 71 {
          return Err(fail("schema_identity"))
        }
        if !val_s.has_prefix("RIHS01_") {
          return Err(fail("schema_identity"))
        }
        let hex = val_s[7:]
        if hex.length() != 64 {
          return Err(fail("schema_identity"))
        }
        let mut i = 0
        while i < hex.length() {
          let c = hex[i].to_int()
          let ok = (c >= 48 && c <= 57) || (c >= 97 && c <= 102)
          if !ok {
            return Err(fail("schema_identity"))
          }
          i = i + 1
        }
      } else if scheme_s == "moonspan-schema-v1" {
        if text_utf8_len(val_s) != 64 || val_s.length() != 64 {
          return Err(fail("schema_identity"))
        }
        let mut i = 0
        while i < val_s.length() {
          let c = val_s[i].to_int()
          let ok = (c >= 48 && c <= 57) || (c >= 97 && c <= 102)
          if !ok {
            return Err(fail("schema_identity"))
          }
          i = i + 1
        }
      } else {
        return Err(fail("schema_identity"))
      }
      Ok(CborValue::Map([(1UL, scheme), (2UL, val)]))
    }
    _ => Err(fail("wrong_type"))
  }
}

///|
fn history_kind(value : CborValue) -> Result[UInt64, ControlError] {
  let raw = match map_from_value(value) {
    Ok(v) => v
    Err(e) => return Err(e)
  }
  let h = match ctrl_map_get(raw, 3UL) {
    Some(v) => v
    None => return Err(fail("missing_key"))
  }
  as_uint(h, 0UL, 2UL)
}

///|
fn validate_map(
  value : CborValue,
  fields : Array[(UInt64, Bool, Schema)],
) -> Result[CborValue, ControlError] {
  let raw = match map_from_value(value) {
    Ok(v) => v
    Err(e) => return Err(e)
  }
  for e in raw {
    let (k, _) = e
    let mut allowed = false
    for f in fields {
      let (fk, _, _) = f
      if fk == k {
        allowed = true
      }
    }
    if !allowed {
      return Err(fail("unknown_key"))
    }
  }
  let out_entries : Array[(UInt64, CborValue)] = []
  for f in fields {
    let (key, required, schema) = f
    match ctrl_map_get(raw, key) {
      None => if required { return Err(fail("missing_key")) }
      Some(v) => {
        let validated = match validate_schema(v, schema) {
          Ok(x) => x
          Err(e) => return Err(e)
        }
        out_entries.push((key, validated))
      }
    }
  }
  // Selection sort by key ascending (min-index swap preserves all entries).
  let mut i = 0
  while i < out_entries.length() {
    let mut min_i = i
    let mut j = i + 1
    while j < out_entries.length() {
      let (kj, _) = out_entries[j]
      let (kmin, _) = out_entries[min_i]
      if kj < kmin {
        min_i = j
      }
      j = j + 1
    }
    if min_i != i {
      let tmp = out_entries[i]
      out_entries[i] = out_entries[min_i]
      out_entries[min_i] = tmp
    }
    i = i + 1
  }
  Ok(CborValue::Map(out_entries))
}

///|
fn validate_schema(
  value : CborValue,
  schema : Schema,
) -> Result[CborValue, ControlError] {
  match schema {
    BoolS =>
      match value {
        CborValue::Bool(b) => Ok(CborValue::Bool(b))
        _ => Err(fail("wrong_type"))
      }
    ConstU64(c) => {
      let n = match as_uint(value, 0UL, UINT64_MAX) {
        Ok(v) => v
        Err(e) => return Err(e)
      }
      if n != c {
        return Err(fail("enum_violation"))
      }
      Ok(CborValue::Unsigned(n))
    }
    ConstBool(c) =>
      match value {
        CborValue::Bool(b) =>
          if b == c {
            Ok(CborValue::Bool(b))
          } else {
            Err(fail("enum_violation"))
          }
        _ => Err(fail("wrong_type"))
      }
    Uint(min, max) => {
      let n = match as_uint(value, min, max) {
        Ok(v) => v
        Err(e) => return Err(e)
      }
      // wire-error-code excludes 20
      if min == 1UL && max == 28UL && n == 20UL {
        return Err(fail("enum_violation"))
      }
      Ok(CborValue::Unsigned(n))
    }
    Int64S =>
      // Validate the raw CBOR integer domain for int64; keep the original
      // Unsigned or Negative representation unchanged (avoids INT64_MIN overflow).
      match as_int64(value) {
        Ok(_) => Ok(value)
        Err(e) => Err(e)
      }
    Text(min_bytes, max_bytes, one_of) =>
      match value {
        CborValue::Text(t) => {
          let len = text_utf8_len(t)
          if len < min_bytes || len > max_bytes {
            return Err(fail("text_length"))
          }
          match one_of {
            Some(set) => {
              let mut found = false
              for s in set {
                if s == t {
                  found = true
                }
              }
              if !found {
                return Err(fail("enum_violation"))
              }
            }
            None => ()
          }
          Ok(value)
        }
        _ => Err(fail("wrong_type"))
      }
    Bytes(min, max) =>
      match value {
        CborValue::Bytes(b) => {
          if b.length() < min || b.length() > max {
            return Err(fail("bytes_length"))
          }
          Ok(value)
        }
        _ => Err(fail("wrong_type"))
      }
    ArrayS(min, max, items, rule) =>
      match value {
        CborValue::Array(arr) => {
          if arr.length() < min || arr.length() > max {
            return Err(fail("array_bound"))
          }
          let out : Array[CborValue] = []
          for el in arr {
            let v = match validate_schema(el, items) {
              Ok(x) => x
              Err(e) => return Err(e)
            }
            out.push(v)
          }
          match apply_array_rule(out, rule) {
            Ok(_) => ()
            Err(e) => return Err(e)
          }
          Ok(CborValue::Array(out))
        }
        _ => Err(fail("wrong_type"))
      }
    MapDyn(fields) => validate_map(value, fields)
    Union(variants) => {
      let mut last : ControlError? = None
      for v in variants {
        match validate_schema(value, v) {
          Ok(ok) => return Ok(ok)
          Err(e) => last = Some(e)
        }
      }
      match last {
        Some(e) => Err(e)
        None => Err(fail("union_mismatch"))
      }
    }
    Identity => validate_schema_identity(value)
    Qos => validate_qos(value)
    EffectiveQos => validate_effective_qos(value)
    EffectiveServiceQos => validate_effective_service_qos(value)
    ActionQos =>
      validate_schema(
        value,
        fmap([
          (1UL, true, Schema::Qos),
          (2UL, true, Schema::Qos),
          (3UL, true, Schema::Qos),
          (4UL, true, Schema::Qos),
          (5UL, true, Schema::Qos),
        ]),
      )
    EffectiveActionQos =>
      validate_schema(
        value,
        fmap([
          (1UL, true, Schema::EffectiveServiceQos),
          (2UL, true, Schema::EffectiveServiceQos),
          (3UL, true, Schema::EffectiveServiceQos),
          (4UL, true, Schema::EffectiveQos),
          (5UL, true, Schema::EffectiveQos),
        ]),
      )
  }
}

///|
fn qos_keep_last() -> Schema {
  fmap([
    (1UL, true, reliability()),
    (2UL, true, durability()),
    (3UL, true, Schema::ConstU64(1UL)),
    (4UL, true, positive_depth()),
    (5UL, false, uint64()),
    (6UL, false, uint64()),
    (7UL, false, liveliness()),
    (8UL, false, uint64()),
  ])
}

///|
fn qos_no_depth() -> Schema {
  fmap([
    (1UL, true, reliability()),
    (2UL, true, durability()),
    (3UL, true, Schema::Union([Schema::ConstU64(0UL), Schema::ConstU64(2UL)])),
    (5UL, false, uint64()),
    (6UL, false, uint64()),
    (7UL, false, liveliness()),
    (8UL, false, uint64()),
  ])
}

///|
fn effective_qos_keep_last() -> Schema {
  fmap([
    (1UL, true, Schema::Union([Schema::ConstU64(1UL), Schema::ConstU64(2UL)])),
    (2UL, true, Schema::Union([Schema::ConstU64(1UL), Schema::ConstU64(2UL)])),
    (3UL, true, Schema::ConstU64(1UL)),
    (4UL, true, positive_depth()),
    (5UL, false, uint64()),
    (6UL, false, uint64()),
    (7UL, true, Schema::Union([Schema::ConstU64(1UL), Schema::ConstU64(2UL)])),
    (8UL, false, uint64()),
  ])
}

///|
fn effective_qos_keep_all() -> Schema {
  fmap([
    (1UL, true, Schema::Union([Schema::ConstU64(1UL), Schema::ConstU64(2UL)])),
    (2UL, true, Schema::Union([Schema::ConstU64(1UL), Schema::ConstU64(2UL)])),
    (3UL, true, Schema::ConstU64(2UL)),
    (5UL, false, uint64()),
    (6UL, false, uint64()),
    (7UL, true, Schema::Union([Schema::ConstU64(1UL), Schema::ConstU64(2UL)])),
    (8UL, false, uint64()),
  ])
}

///|
fn effective_service_qos_keep_last() -> Schema {
  fmap([
    (1UL, true, Schema::ConstU64(1UL)),
    (2UL, true, Schema::ConstU64(2UL)),
    (3UL, true, Schema::ConstU64(1UL)),
    (4UL, true, positive_depth()),
    (5UL, false, uint64()),
    (6UL, false, uint64()),
    (7UL, true, Schema::Union([Schema::ConstU64(1UL), Schema::ConstU64(2UL)])),
    (8UL, false, uint64()),
  ])
}

///|
fn effective_service_qos_keep_all() -> Schema {
  fmap([
    (1UL, true, Schema::ConstU64(1UL)),
    (2UL, true, Schema::ConstU64(2UL)),
    (3UL, true, Schema::ConstU64(2UL)),
    (5UL, false, uint64()),
    (6UL, false, uint64()),
    (7UL, true, Schema::Union([Schema::ConstU64(1UL), Schema::ConstU64(2UL)])),
    (8UL, false, uint64()),
  ])
}

///|
fn validate_qos(value : CborValue) -> Result[CborValue, ControlError] {
  let h = match history_kind(value) {
    Ok(v) => v
    Err(e) => return Err(e)
  }
  if h == 1UL {
    validate_schema(value, qos_keep_last())
  } else if h == 0UL || h == 2UL {
    validate_schema(value, qos_no_depth())
  } else {
    Err(fail("enum_violation"))
  }
}

///|
fn validate_effective_qos(value : CborValue) -> Result[CborValue, ControlError] {
  let h = match history_kind(value) {
    Ok(v) => v
    Err(e) => return Err(e)
  }
  if h == 1UL {
    validate_schema(value, effective_qos_keep_last())
  } else if h == 2UL {
    validate_schema(value, effective_qos_keep_all())
  } else {
    Err(fail("enum_violation"))
  }
}

///|
fn validate_effective_service_qos(
  value : CborValue,
) -> Result[CborValue, ControlError] {
  let h = match history_kind(value) {
    Ok(v) => v
    Err(e) => return Err(e)
  }
  if h == 1UL {
    validate_schema(value, effective_service_qos_keep_last())
  } else if h == 2UL {
    validate_schema(value, effective_service_qos_keep_all())
  } else {
    Err(fail("enum_violation"))
  }
}

///|
fn budgets() -> Schema {
  fmap([
    (1UL, false, uint32()),
    (2UL, false, uint64()),
    (3UL, false, uint32()),
    (4UL, false, uint64()),
    (5UL, false, uint32()),
    (6UL, false, uint64()),
  ])
}

///|
fn error_body_session() -> Schema {
  fmap([
    (48UL, true, wire_error_code()),
    (49UL, true, Schema::ConstU64(0UL)),
    (50UL, false, retry_class()),
    (51UL, false, text4k()),
    (52UL, false, text4k()),
  ])
}

///|
fn error_body_channel() -> Schema {
  fmap([
    (48UL, true, wire_error_code()),
    (49UL, true, Schema::ConstU64(1UL)),
    (50UL, false, retry_class()),
    (51UL, false, text4k()),
    (52UL, false, text4k()),
  ])
}

///|
fn transport_caps() -> Schema {
  fmap([
    (1UL, true, Schema::BoolS),
    (2UL, true, Schema::BoolS),
    (3UL, false, uint32()),
  ])
}

///|
fn buffer_caps() -> Schema {
  fmap([(1UL, true, Schema::BoolS), (2UL, true, Schema::BoolS)])
}

///|
fn capability_id_list() -> Schema {
  arr(0, CAP_IDS_MAX, capability_id(), Some(ArrayRule::UniqueAscendingUint))
}

///|
fn negotiated_caps() -> Schema {
  fmap([
    (1UL, true, transport_caps()),
    (2UL, true, buffer_caps()),
    (3UL, true, capability_id_list()),
  ])
}

///|
fn source_bundle_entry() -> Schema {
  fmap([
    (1UL, true, text_nonempty()),
    (2UL, true, source_entry_encoding()),
    (3UL, true, bytes_content()),
  ])
}

///|
fn graph_node() -> Schema {
  fmap([
    (55UL, true, bytes16()),
    (1UL, true, text_nonempty()),
    (2UL, false, text4k()),
    (9UL, true, domain_id()),
  ])
}

///|
fn graph_endpoint() -> Schema {
  Schema::Union([
    fmap([
      (56UL, true, bytes16()),
      (55UL, true, bytes16()),
      (1UL, true, text_nonempty()),
      (2UL, true, u(0UL, 3UL)),
      (3UL, true, text_nonempty()),
      (4UL, true, Schema::Identity),
      (5UL, true, payload_encoding_cdr()),
      (6UL, true, uint64()),
      (7UL, true, Schema::Qos),
      (9UL, true, domain_id()),
      (8UL, false, support_row_id()),
    ]),
    fmap([
      (56UL, true, bytes16()),
      (55UL, true, bytes16()),
      (1UL, true, text_nonempty()),
      (2UL, true, Schema::Union([Schema::ConstU64(4UL), Schema::ConstU64(5UL)])),
      (3UL, true, text_nonempty()),
      (4UL, true, Schema::Identity),
      (5UL, true, payload_encoding_cdr()),
      (6UL, true, uint64()),
      (58UL, true, Schema::ActionQos),
      (9UL, true, domain_id()),
      (8UL, false, support_row_id()),
    ]),
  ])
}

///|
fn graph_delta_op() -> Schema {
  Schema::Union([
    fmap([(1UL, true, Schema::ConstU64(0UL)), (2UL, true, graph_node())]),
    fmap([(1UL, true, Schema::ConstU64(1UL)), (55UL, true, bytes16())]),
    fmap([(1UL, true, Schema::ConstU64(2UL)), (3UL, true, graph_endpoint())]),
    fmap([(1UL, true, Schema::ConstU64(3UL)), (56UL, true, bytes16())]),
  ])
}

///|
fn channel_ack() -> Schema {
  fmap([(1UL, true, app_channel_id()), (2UL, true, uint64())])
}

///|
fn channel_resume_result() -> Schema {
  Schema::Union([
    fmap([
      (1UL, true, app_channel_id()),
      (2UL, true, Schema::ConstU64(0UL)),
      (3UL, true, uint64()),
    ]),
    fmap([
      (1UL, true, app_channel_id()),
      (2UL, true, Schema::ConstU64(1UL)),
      (3UL, true, Schema::ConstU64(0UL)),
    ]),
    fmap([(1UL, true, app_channel_id()), (2UL, true, Schema::ConstU64(1UL))]),
    fmap([(1UL, true, app_channel_id()), (2UL, true, Schema::ConstU64(2UL))]),
    fmap([
      (1UL, true, app_channel_id()),
      (2UL, true, Schema::ConstU64(3UL)),
      (15UL, true, error_body_channel()),
    ]),
  ])
}

///|
fn kind_schema(kind : Int) -> Schema? {
  if kind == CONTROL_KIND_AUTHENTICATE {
    Some(
      fmap([
        (1UL, true, Schema::ConstU64(1UL)),
        (2UL, true, bytes16()),
        (16UL, true, text_nonempty()),
        (17UL, true, bytes_cred()),
      ]),
    )
  } else if kind == CONTROL_KIND_SESSION_READY {
    Some(
      fmap([
        (1UL, true, Schema::ConstU64(2UL)),
        (2UL, true, bytes16()),
        (7UL, true, text_nonempty()),
        (8UL, true, support_row_id()),
        (
          10UL,
          true,
          arr(
            1,
            DOMAIN_IDS_MAX,
            domain_id(),
            Some(ArrayRule::UniqueAscendingUint),
          ),
        ),
        (13UL, true, text_nonempty()),
        (12UL, true, budgets()),
        (18UL, true, ros_distro()),
        (19UL, true, rmw_identifier()),
        (20UL, true, text_nonempty()),
        (21UL, true, text_nonempty()),
        (53UL, true, bytes32()),
        (54UL, true, negotiated_caps()),
      ]),
    )
  } else if kind == CONTROL_KIND_GRAPH_SNAPSHOT {
    Some(
      fmap([
        (1UL, true, Schema::ConstU64(3UL)),
        (2UL, true, bytes16()),
        (14UL, true, uint64()),
        (7UL, true, text_nonempty()),
        (8UL, true, support_row_id()),
        (
          22UL,
          true,
          arr(
            0,
            GRAPH_NODES_MAX,
            graph_node(),
            Some(ArrayRule::GraphNodesSorted),
          ),
        ),
        (
          23UL,
          true,
          arr(
            0,
            GRAPH_ENDPOINTS_MAX,
            graph_endpoint(),
            Some(ArrayRule::GraphEndpointsSorted),
          ),
        ),
      ]),
    )
  } else if kind == CONTROL_KIND_GRAPH_DELTA {
    Some(
      fmap([
        (1UL, true, Schema::ConstU64(4UL)),
        (2UL, true, bytes16()),
        (14UL, true, uint64()),
        (24UL, true, uint64()),
        (7UL, true, text_nonempty()),
        (8UL, true, support_row_id()),
        (25UL, true, arr(1, GRAPH_DELTA_OPS_MAX, graph_delta_op(), None)),
      ]),
    )
  } else if kind == CONTROL_KIND_SCHEMA_REQUEST {
    Some(
      fmap([
        (1UL, true, Schema::ConstU64(5UL)),
        (2UL, true, bytes16()),
        (4UL, true, text_nonempty()),
        (3UL, true, Schema::Identity),
      ]),
    )
  } else if kind == CONTROL_KIND_SCHEMA_ADVERTISE {
    Some(
      fmap([
        (1UL, true, Schema::ConstU64(6UL)),
        (2UL, true, bytes16()),
        (4UL, true, text_nonempty()),
        (3UL, true, Schema::Identity),
        (5UL, true, payload_encoding_cdr()),
        (6UL, true, uint64()),
        (26UL, true, bytes_desc()),
        (27UL, false, arr(0, SOURCE_BUNDLE_MAX, source_bundle_entry(), None)),
        (28UL, false, uint64()),
        (8UL, false, support_row_id()),
      ]),
    )
  } else if kind == CONTROL_KIND_SCHEMA_RESPONSE {
    Some(
      Schema::Union([
        fmap([
          (1UL, true, Schema::ConstU64(7UL)),
          (2UL, true, bytes16()),
          (4UL, true, text_nonempty()),
          (3UL, true, Schema::Identity),
          (5UL, true, payload_encoding_cdr()),
          (6UL, true, uint64()),
          (26UL, true, bytes_desc()),
          (27UL, false, arr(0, SOURCE_BUNDLE_MAX, source_bundle_entry(), None)),
          (28UL, false, uint64()),
          (8UL, false, support_row_id()),
        ]),
        fmap([
          (1UL, true, Schema::ConstU64(7UL)),
          (2UL, true, bytes16()),
          (4UL, true, text_nonempty()),
          (3UL, true, Schema::Identity),
          (15UL, true, error_body_session()),
        ]),
      ]),
    )
  } else if kind == CONTROL_KIND_OPEN_CHANNEL {
    Some(open_channel_union())
  } else if kind == CONTROL_KIND_CHANNEL_READY {
    Some(channel_ready_union())
  } else if kind == CONTROL_KIND_CLOSE_CHANNEL {
    Some(
      fmap([
        (1UL, true, Schema::ConstU64(10UL)),
        (2UL, true, bytes16()),
        (29UL, true, app_channel_id()),
        (34UL, true, close_reason()),
        (35UL, false, uint64()),
      ]),
    )
  } else if kind == CONTROL_KIND_CLOCK_SYNC {
    Some(
      fmap([
        (1UL, true, Schema::ConstU64(11UL)),
        (2UL, true, bytes16()),
        (36UL, true, clock_id()),
        (37UL, true, Schema::Int64S),
        (38UL, false, uint64()),
        (39UL, false, Schema::Int64S),
      ]),
    )
  } else if kind == CONTROL_KIND_HEARTBEAT {
    Some(
      fmap([
        (1UL, true, Schema::ConstU64(12UL)),
        (2UL, true, bytes16()),
        (40UL, true, uint64()),
        (
          41UL,
          false,
          arr(
            0,
            ALIVE_CHANNELS_MAX,
            app_channel_id(),
            Some(ArrayRule::UniqueAscendingUint),
          ),
        ),
      ]),
    )
  } else if kind == CONTROL_KIND_SESSION_RESUME {
    Some(
      fmap([
        (1UL, true, Schema::ConstU64(13UL)),
        (2UL, true, bytes16()),
        (42UL, true, bytes32()),
        (43UL, true, Schema::ConstU64(0UL)),
        (44UL, true, negotiated_caps()),
        (7UL, true, text_nonempty()),
        (8UL, true, support_row_id()),
        (14UL, true, uint64()),
        (6UL, true, uint64()),
        (13UL, true, text_nonempty()),
        (
          45UL,
          true,
          arr(
            0,
            CHANNEL_ACKS_MAX,
            channel_ack(),
            Some(ArrayRule::UniqueAscendingChannelId),
          ),
        ),
        (16UL, true, text_nonempty()),
        (17UL, true, bytes_cred()),
      ]),
    )
  } else if kind == CONTROL_KIND_SESSION_RESUME_RESULT {
    Some(
      Schema::Union([
        fmap([
          (1UL, true, Schema::ConstU64(14UL)),
          (2UL, true, bytes16()),
          (46UL, true, Schema::ConstBool(true)),
          (
            47UL,
            true,
            arr(
              0,
              CHANNEL_RESULTS_MAX,
              channel_resume_result(),
              Some(ArrayRule::UniqueAscendingChannelId),
            ),
          ),
        ]),
        fmap([
          (1UL, true, Schema::ConstU64(14UL)),
          (2UL, true, bytes16()),
          (46UL, true, Schema::ConstBool(false)),
          (15UL, true, error_body_session()),
        ]),
      ]),
    )
  } else if kind == CONTROL_KIND_ERROR {
    Some(
      Schema::Union([
        fmap([
          (1UL, true, Schema::ConstU64(15UL)),
          (2UL, true, bytes16()),
          (48UL, true, wire_error_code()),
          (49UL, true, Schema::ConstU64(0UL)),
          (50UL, false, retry_class()),
          (51UL, false, text4k()),
          (52UL, false, text4k()),
        ]),
        fmap([
          (1UL, true, Schema::ConstU64(15UL)),
          (2UL, true, bytes16()),
          (48UL, true, wire_error_code()),
          (49UL, true, Schema::ConstU64(1UL)),
          (29UL, true, app_channel_id()),
          (50UL, false, retry_class()),
          (51UL, false, text4k()),
          (52UL, false, text4k()),
        ]),
        fmap([
          (1UL, true, Schema::ConstU64(15UL)),
          (2UL, true, bytes16()),
          (48UL, true, wire_error_code()),
          (49UL, true, Schema::ConstU64(2UL)),
          (29UL, true, app_channel_id()),
          (50UL, false, retry_class()),
          (51UL, false, text4k()),
          (52UL, false, text4k()),
        ]),
        fmap([
          (1UL, true, Schema::ConstU64(15UL)),
          (2UL, true, bytes16()),
          (48UL, true, wire_error_code()),
          (49UL, true, Schema::ConstU64(3UL)),
          (50UL, false, retry_class()),
          (51UL, false, text4k()),
          (52UL, false, text4k()),
        ]),
      ]),
    )
  } else {
    None
  }
}

///|
fn open_channel_union() -> Schema {
  Schema::Union([
    // topic 0/1
    fmap([
      (1UL, true, Schema::ConstU64(8UL)),
      (2UL, true, bytes16()),
      (29UL, true, app_channel_id()),
      (
        30UL,
        true,
        Schema::Union([Schema::ConstU64(0UL), Schema::ConstU64(1UL)]),
      ),
      (31UL, true, text_nonempty()),
      (4UL, true, text_nonempty()),
      (3UL, true, Schema::Identity),
      (5UL, true, payload_encoding_cdr()),
      (6UL, true, uint64()),
      (11UL, true, Schema::Qos),
      (32UL, true, priority_id()),
      (12UL, true, budgets()),
      (9UL, true, domain_id()),
      (8UL, true, support_row_id()),
    ]),
    // service 2/3
    fmap([
      (1UL, true, Schema::ConstU64(8UL)),
      (2UL, true, bytes16()),
      (29UL, true, app_channel_id()),
      (
        30UL,
        true,
        Schema::Union([Schema::ConstU64(2UL), Schema::ConstU64(3UL)]),
      ),
      (31UL, true, text_nonempty()),
      (4UL, true, text_nonempty()),
      (3UL, true, Schema::Identity),
      (5UL, true, payload_encoding_cdr()),
      (6UL, true, uint64()),
      (11UL, true, Schema::Qos),
      (32UL, true, priority_id()),
      (12UL, true, budgets()),
      (9UL, true, domain_id()),
      (8UL, true, support_row_id()),
    ]),
    // action 4/5
    fmap([
      (1UL, true, Schema::ConstU64(8UL)),
      (2UL, true, bytes16()),
      (29UL, true, app_channel_id()),
      (
        30UL,
        true,
        Schema::Union([Schema::ConstU64(4UL), Schema::ConstU64(5UL)]),
      ),
      (31UL, true, text_nonempty()),
      (4UL, true, text_nonempty()),
      (3UL, true, Schema::Identity),
      (5UL, true, payload_encoding_cdr()),
      (6UL, true, uint64()),
      (58UL, true, Schema::ActionQos),
      (32UL, true, priority_id()),
      (12UL, true, budgets()),
      (9UL, true, domain_id()),
      (8UL, true, support_row_id()),
    ]),
    // media 6
    fmap([
      (1UL, true, Schema::ConstU64(8UL)),
      (2UL, true, bytes16()),
      (29UL, true, app_channel_id()),
      (30UL, true, Schema::ConstU64(6UL)),
      (31UL, true, text_nonempty()),
      (5UL, true, Schema::Union([Schema::ConstU64(3UL), Schema::ConstU64(4UL)])),
      (32UL, true, priority_id()),
      (12UL, true, budgets()),
      (9UL, false, domain_id()),
      (8UL, false, support_row_id()),
    ]),
    // recording 7
    fmap([
      (1UL, true, Schema::ConstU64(8UL)),
      (2UL, true, bytes16()),
      (29UL, true, app_channel_id()),
      (30UL, true, Schema::ConstU64(7UL)),
      (31UL, true, text_nonempty()),
      (5UL, true, Schema::Union([Schema::ConstU64(5UL), Schema::ConstU64(6UL)])),
      (32UL, true, priority_id()),
      (12UL, true, budgets()),
    ]),
    // asset 8
    fmap([
      (1UL, true, Schema::ConstU64(8UL)),
      (2UL, true, bytes16()),
      (29UL, true, app_channel_id()),
      (30UL, true, Schema::ConstU64(8UL)),
      (31UL, true, text_nonempty()),
      (5UL, true, Schema::ConstU64(6UL)),
      (32UL, true, priority_id()),
      (12UL, true, budgets()),
    ]),
  ])
}

///|
fn channel_ready_union() -> Schema {
  Schema::Union([
    fmap([
      (1UL, true, Schema::ConstU64(9UL)),
      (2UL, true, bytes16()),
      (29UL, true, app_channel_id()),
      (
        33UL,
        true,
        Schema::Union([Schema::ConstU64(0UL), Schema::ConstU64(2UL)]),
      ),
      (12UL, true, budgets()),
      (59UL, true, priority_id()),
      (57UL, true, Schema::EffectiveQos),
      (6UL, false, uint64()),
      (14UL, false, uint64()),
      (9UL, false, domain_id()),
      (8UL, false, support_row_id()),
    ]),
    fmap([
      (1UL, true, Schema::ConstU64(9UL)),
      (2UL, true, bytes16()),
      (29UL, true, app_channel_id()),
      (
        33UL,
        true,
        Schema::Union([Schema::ConstU64(0UL), Schema::ConstU64(2UL)]),
      ),
      (12UL, true, budgets()),
      (59UL, true, priority_id()),
      (60UL, true, Schema::EffectiveServiceQos),
      (6UL, false, uint64()),
      (14UL, false, uint64()),
      (9UL, false, domain_id()),
      (8UL, false, support_row_id()),
    ]),
    fmap([
      (1UL, true, Schema::ConstU64(9UL)),
      (2UL, true, bytes16()),
      (29UL, true, app_channel_id()),
      (
        33UL,
        true,
        Schema::Union([Schema::ConstU64(0UL), Schema::ConstU64(2UL)]),
      ),
      (12UL, true, budgets()),
      (59UL, true, priority_id()),
      (58UL, true, Schema::EffectiveActionQos),
      (6UL, false, uint64()),
      (14UL, false, uint64()),
      (9UL, false, domain_id()),
      (8UL, false, support_row_id()),
    ]),
    fmap([
      (1UL, true, Schema::ConstU64(9UL)),
      (2UL, true, bytes16()),
      (29UL, true, app_channel_id()),
      (
        33UL,
        true,
        Schema::Union([Schema::ConstU64(0UL), Schema::ConstU64(2UL)]),
      ),
      (12UL, true, budgets()),
      (59UL, true, priority_id()),
      (6UL, false, uint64()),
      (14UL, false, uint64()),
      (9UL, false, domain_id()),
      (8UL, false, support_row_id()),
    ]),
    fmap([
      (1UL, true, Schema::ConstU64(9UL)),
      (2UL, true, bytes16()),
      (29UL, true, app_channel_id()),
      (
        33UL,
        true,
        Schema::Union([Schema::ConstU64(1UL), Schema::ConstU64(3UL)]),
      ),
      (15UL, true, error_body_channel()),
    ]),
  ])
}

///|
fn assert_session_ready_triple(
  fields : Array[(UInt64, CborValue)],
) -> Result[Unit, ControlError] {
  let row = match ctrl_map_get(fields, 8UL) {
    Some(CborValue::Text(t)) => t
    _ => return Err(fail("wrong_type"))
  }
  let distro = match ctrl_map_get(fields, 18UL) {
    Some(CborValue::Text(t)) => t
    _ => return Err(fail("wrong_type"))
  }
  let rmw = match ctrl_map_get(fields, 19UL) {
    Some(CborValue::Text(t)) => t
    _ => return Err(fail("wrong_type"))
  }
  let (exp_distro, exp_rmw) = if row == "H-FT" {
    ("humble", "rmw_fastrtps_cpp")
  } else if row == "H-CY" {
    ("humble", "rmw_cyclonedds_cpp")
  } else if row == "H-ZN" {
    ("humble", "rmw_zenoh_cpp")
  } else if row == "J-FT" {
    ("jazzy", "rmw_fastrtps_cpp")
  } else if row == "J-CY" {
    ("jazzy", "rmw_cyclonedds_cpp")
  } else if row == "J-ZN" {
    ("jazzy", "rmw_zenoh_cpp")
  } else {
    return Err(fail("enum_violation"))
  }
  if distro != exp_distro || rmw != exp_rmw {
    return Err(fail("support_row_mismatch"))
  }
  Ok(())
}

///|
fn validate_open_channel(value : CborValue) -> Result[CborValue, ControlError] {
  let raw = match map_from_value(value) {
    Ok(v) => v
    Err(e) => return Err(e)
  }
  let cls_v = match ctrl_map_get(raw, 30UL) {
    Some(v) => v
    None => return Err(fail("missing_key"))
  }
  let cls = match as_uint(cls_v, 0UL, 8UL) {
    Ok(v) => v
    Err(e) => return Err(e)
  }
  match kind_schema(CONTROL_KIND_OPEN_CHANNEL) {
    None => Err(fail("unassigned_kind"))
    Some(Schema::Union(variants)) => {
      let idx = if cls == 0UL || cls == 1UL {
        0
      } else if cls == 2UL || cls == 3UL {
        1
      } else if cls == 4UL || cls == 5UL {
        2
      } else if cls == 6UL {
        3
      } else if cls == 7UL {
        4
      } else if cls == 8UL {
        5
      } else {
        return Err(fail("enum_violation"))
      }
      validate_schema(value, variants[idx])
    }
    Some(_) => Err(fail("wrong_type"))
  }
}

///|
/// Validate a decoded CBOR map as a control message.
pub fn validate_control_message(
  value : CborValue,
) -> Result[ControlMessage, ControlError] {
  let raw = match map_from_value(value) {
    Ok(v) => v
    Err(e) => return Err(e)
  }
  let kind_v = match ctrl_map_get(raw, 1UL) {
    Some(v) => v
    None => return Err(fail("missing_key"))
  }
  let kind_u = match as_uint(kind_v, 0UL, 255UL) {
    Ok(v) => v
    Err(e) => return Err(e)
  }
  let kind = kind_u.to_int()
  let schema = match kind_schema(kind) {
    Some(s) => s
    None => return Err(fail("unassigned_kind"))
  }
  let validated = if kind == CONTROL_KIND_OPEN_CHANNEL {
    match validate_open_channel(value) {
      Ok(v) => v
      Err(e) => return Err(e)
    }
  } else {
    match validate_schema(value, schema) {
      Ok(v) => v
      Err(e) => return Err(e)
    }
  }
  match validated {
    CborValue::Map(entries) => {
      if kind == CONTROL_KIND_SESSION_READY {
        match assert_session_ready_triple(entries) {
          Ok(_) => ()
          Err(e) => return Err(e)
        }
      }
      Ok({ kind, fields: entries })
    }
    _ => Err(fail("wrong_type"))
  }
}

///|
/// Decode and fully shape-validate a CONTROL_CBOR payload.
pub fn decode_control_message(
  bytes : BytesView,
) -> Result[ControlMessage, ControlError] {
  if bytes.length() > CONTROL_PAYLOAD_MAX_BYTES {
    return Err(ControlError::new("payload_too_large", 0))
  }
  let decoded = match decode_deterministic_cbor(bytes) {
    Ok(v) => v
    Err(e) => return Err(ControlError::new("cbor_profile", e.offset))
  }
  validate_control_message(decoded)
}

///|
/// Map control errors onto the selected-frame surface.
pub fn map_control_error(
  err : ControlError,
  payload_base : Int,
) -> ProtocolError {
  if err.reason == "payload_too_large" {
    ProtocolError::message_too_large_frame("control_payload_too_large", 24, 3)
  } else {
    ProtocolError::invalid_control(
      "invalid_control",
      payload_base + err.offset,
      16,
    )
  }
}
