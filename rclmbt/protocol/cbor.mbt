///|
/// R2WP v0 deterministic CBOR decoder (RFC 8949 core deterministic profile).
/// Bounds: nesting depth 16, map entries 4096. Bytes borrow the input view;
/// text is strict UTF-8 via core encoding utf8.

///|
pub const MAX_NESTING_DEPTH : Int = 16

///|
pub const MAX_MAP_ENTRIES : Int = 4096

///|
/// JavaScript Number.MAX_SAFE_INTEGER — TypeScript agreement allocation bound.
const MAX_SAFE_INTEGER : UInt64 = 9007199254740991UL

///|
const MT_UINT : Int = 0

///|
const MT_NINT : Int = 1

///|
const MT_BYTES : Int = 2

///|
const MT_TEXT : Int = 3

///|
const MT_ARRAY : Int = 4

///|
const MT_MAP : Int = 5

///|
const MT_TAG : Int = 6

///|
const MT_SIMPLE : Int = 7

///|
const SIMPLE_FALSE : Int = 20

///|
const SIMPLE_TRUE : Int = 21

///|
const SIMPLE_NULL : Int = 22

///|
/// Decoded CBOR value. Bytes borrow the input view; text is owned String.
/// Negative stores the raw major-type-1 argument (value = -1 - argument).
pub enum CborValue {
  Null
  Bool(Bool)
  Unsigned(UInt64)
  Negative(UInt64)
  Bytes(BytesView)
  Text(String)
  Array(Array[CborValue])
  Map(Array[(UInt64, CborValue)])
}

///|
priv struct Reader {
  bytes : BytesView
  mut offset : Int
}

///|
fn Reader::remaining(self : Reader) -> Int {
  self.bytes.length() - self.offset
}

///|
fn Reader::fail(self : Reader, reason : String, at : Int?) -> CborError {
  match at {
    Some(o) => CborError::new(reason, o)
    None => CborError::new(reason, self.offset)
  }
}

///|
fn Reader::read_byte(self : Reader) -> Result[Byte, CborError] {
  if self.offset >= self.bytes.length() {
    return Err(self.fail("truncated", None))
  }
  let b = self.bytes[self.offset]
  self.offset = self.offset + 1
  Ok(b)
}

///|
fn Reader::read_slice(self : Reader, n : Int) -> Result[BytesView, CborError] {
  if self.remaining() < n {
    return Err(self.fail("truncated", None))
  }
  let start = self.offset
  self.offset = self.offset + n
  Ok(self.bytes[start:self.offset])
}

///|
priv struct Head {
  major : Int
  additional : Int
  argument : UInt64
  head_offset : Int
}

///|
fn byte_to_uint64(b : Byte) -> UInt64 {
  b.to_int().to_uint64()
}

///|
fn read_head(r : Reader) -> Result[Head, CborError] {
  let head_offset = r.offset
  if r.remaining() == 0 {
    return Err(r.fail("truncated", Some(head_offset)))
  }
  let initial = match r.read_byte() {
    Ok(b) => b.to_int()
    Err(e) => return Err(e)
  }
  let major = initial >> 5
  let additional = initial & 0x1f
  let integer_argument = !(major == MT_SIMPLE &&
    additional >= 25 &&
    additional <= 27)

  if additional <= 23 {
    return Ok({
      major,
      additional,
      argument: additional.to_uint64(),
      head_offset,
    })
  }
  if additional == 24 {
    if r.remaining() < 1 {
      return Err(r.fail("truncated", Some(head_offset)))
    }
    let arg = match r.read_byte() {
      Ok(b) => byte_to_uint64(b)
      Err(e) => return Err(e)
    }
    if arg < 24UL {
      return Err(r.fail("non_shortest_form", Some(head_offset)))
    }
    return Ok({ major, additional, argument: arg, head_offset })
  }
  if additional == 25 {
    if r.remaining() < 2 {
      return Err(r.fail("truncated", Some(head_offset)))
    }
    let b0 = match r.read_byte() {
      Ok(b) => b
      Err(e) => return Err(e)
    }
    let b1 = match r.read_byte() {
      Ok(b) => b
      Err(e) => return Err(e)
    }
    let arg = (byte_to_uint64(b0) << 8) | byte_to_uint64(b1)
    if integer_argument && arg < 0x100UL {
      return Err(r.fail("non_shortest_form", Some(head_offset)))
    }
    return Ok({ major, additional, argument: arg, head_offset })
  }
  if additional == 26 {
    if r.remaining() < 4 {
      return Err(r.fail("truncated", Some(head_offset)))
    }
    let mut arg : UInt64 = 0UL
    let mut i = 0
    while i < 4 {
      let b = match r.read_byte() {
        Ok(x) => x
        Err(e) => return Err(e)
      }
      arg = (arg << 8) | byte_to_uint64(b)
      i = i + 1
    }
    if integer_argument && arg < 0x10000UL {
      return Err(r.fail("non_shortest_form", Some(head_offset)))
    }
    return Ok({ major, additional, argument: arg, head_offset })
  }
  if additional == 27 {
    if r.remaining() < 8 {
      return Err(r.fail("truncated", Some(head_offset)))
    }
    let mut arg : UInt64 = 0UL
    let mut i = 0
    while i < 8 {
      let b = match r.read_byte() {
        Ok(x) => x
        Err(e) => return Err(e)
      }
      arg = (arg << 8) | byte_to_uint64(b)
      i = i + 1
    }
    if integer_argument && arg < 0x100000000UL {
      return Err(r.fail("non_shortest_form", Some(head_offset)))
    }
    return Ok({ major, additional, argument: arg, head_offset })
  }
  if additional == 31 {
    return Err(r.fail("indefinite_length", Some(head_offset)))
  }
  Err(r.fail("reserved_additional_info", Some(head_offset)))
}

///|
/// Resolve a declared container/payload length under the TypeScript/Rust
/// agreement policy:
/// 1. values above MAX_SAFE_INTEGER => length_out_of_range at head_offset
/// 2. otherwise compare UInt64 against remaining input bytes => truncated
///    at truncation_offset (byte/text: offset after head; array/map: head_offset)
/// 3. only after remaining proves the length fits Int, narrow for allocation
fn declared_length_for_remaining(
  arg : UInt64,
  remaining : Int,
  head_offset : Int,
  truncation_offset : Int,
) -> Result[Int, CborError] {
  if arg > MAX_SAFE_INTEGER {
    return Err(CborError::new("length_out_of_range", head_offset))
  }
  let rem_u = remaining.to_uint64()
  if arg > rem_u {
    return Err(CborError::new("truncated", truncation_offset))
  }
  // arg <= remaining and remaining is Int, so narrowing is safe.
  Ok(arg.to_int())
}

///|
fn seen_contains(seen : Array[UInt64], key : UInt64) -> Bool {
  for k in seen {
    if k == key {
      return true
    }
  }
  false
}

///|
fn decode_value(r : Reader, depth : Int) -> Result[CborValue, CborError] {
  let head = match read_head(r) {
    Ok(h) => h
    Err(e) => return Err(e)
  }
  let major = head.major
  let additional = head.additional
  let argument = head.argument
  let head_offset = head.head_offset

  if major == MT_UINT {
    return Ok(CborValue::Unsigned(argument))
  }
  if major == MT_NINT {
    // value = -1 - argument; store raw argument.
    return Ok(CborValue::Negative(argument))
  }
  if major == MT_BYTES {
    // Byte truncation reports the reader offset after the head (TS/Rust readBytes).
    let len = match
      declared_length_for_remaining(
        argument,
        r.remaining(),
        head_offset,
        r.offset,
      ) {
      Ok(n) => n
      Err(e) => return Err(e)
    }
    let slice = match r.read_slice(len) {
      Ok(s) => s
      Err(e) => return Err(e)
    }
    return Ok(CborValue::Bytes(slice))
  }
  if major == MT_TEXT {
    // Text truncation reports the reader offset after the head (TS/Rust readBytes).
    let len = match
      declared_length_for_remaining(
        argument,
        r.remaining(),
        head_offset,
        r.offset,
      ) {
      Ok(n) => n
      Err(e) => return Err(e)
    }
    let slice = match r.read_slice(len) {
      Ok(s) => s
      Err(e) => return Err(e)
    }
    // ignore_bom=false preserves leading U+FEFF for UTF-8 BOM octets (EF BB BF),
    // matching TypeScript TextDecoder ignoreBOM=true and Rust from_utf8.
    try {
      let s = @utf8.decode(slice, ignore_bom=false)
      return Ok(CborValue::Text(s))
    } catch {
      @utf8.Malformed(_) =>
        return Err(CborError::new("invalid_utf8", head_offset))
    }
  }
  if major == MT_ARRAY {
    let next = depth + 1
    if next > MAX_NESTING_DEPTH {
      return Err(CborError::new("nesting_depth_exceeded", head_offset))
    }
    // Array truncation reports head_offset (TS/Rust container pre-check).
    let len = match
      declared_length_for_remaining(
        argument,
        r.remaining(),
        head_offset,
        head_offset,
      ) {
      Ok(n) => n
      Err(e) => return Err(e)
    }
    let out : Array[CborValue] = []
    let mut i = 0
    while i < len {
      let v = match decode_value(r, next) {
        Ok(x) => x
        Err(e) => return Err(e)
      }
      out.push(v)
      i = i + 1
    }
    return Ok(CborValue::Array(out))
  }
  if major == MT_MAP {
    let next = depth + 1
    if next > MAX_NESTING_DEPTH {
      return Err(CborError::new("nesting_depth_exceeded", head_offset))
    }
    if argument > MAX_MAP_ENTRIES.to_uint64() {
      return Err(CborError::new("map_entries_exceeded", head_offset))
    }
    // Entry count is already bounded by MAX_MAP_ENTRIES (4096), so it fits Int.
    // Still apply remaining-first agreement: each entry needs at least two bytes.
    let rem_u = r.remaining().to_uint64()
    if argument > 0UL && argument * 2UL > rem_u {
      return Err(CborError::new("truncated", head_offset))
    }
    let len = argument.to_int()
    let out : Array[(UInt64, CborValue)] = []
    let seen : Array[UInt64] = []
    let mut has_prev = false
    let mut prev_key : UInt64 = 0UL
    let mut i = 0
    while i < len {
      let key_head = match read_head(r) {
        Ok(h) => h
        Err(e) => return Err(e)
      }
      if key_head.major != MT_UINT {
        return Err(CborError::new("map_key_not_unsigned", key_head.head_offset))
      }
      let key = key_head.argument
      // Full-set duplicate detection before order checks.
      if seen_contains(seen, key) {
        return Err(CborError::new("duplicate_map_key", key_head.head_offset))
      }
      seen.push(key)
      if has_prev && key < prev_key {
        return Err(CborError::new("map_key_order", key_head.head_offset))
      }
      has_prev = true
      prev_key = key
      let val = match decode_value(r, next) {
        Ok(x) => x
        Err(e) => return Err(e)
      }
      out.push((key, val))
      i = i + 1
    }
    return Ok(CborValue::Map(out))
  }
  if major == MT_TAG {
    return Err(CborError::new("tag_not_allowed", head_offset))
  }
  if major == MT_SIMPLE {
    if additional == 25 || additional == 26 || additional == 27 {
      return Err(CborError::new("float_not_allowed", head_offset))
    }
    if additional == 24 {
      let simple = argument.to_int()
      if simple == SIMPLE_FALSE {
        return Ok(CborValue::Bool(false))
      }
      if simple == SIMPLE_TRUE {
        return Ok(CborValue::Bool(true))
      }
      if simple == SIMPLE_NULL {
        return Ok(CborValue::Null)
      }
      return Err(CborError::new("simple_not_allowed", head_offset))
    }
    if additional == SIMPLE_FALSE {
      return Ok(CborValue::Bool(false))
    }
    if additional == SIMPLE_TRUE {
      return Ok(CborValue::Bool(true))
    }
    if additional == SIMPLE_NULL {
      return Ok(CborValue::Null)
    }
    return Err(CborError::new("simple_not_allowed", head_offset))
  }
  Err(CborError::new("unsupported_major_type", head_offset))
}

///|
/// Decode exactly one complete R2WP v0 deterministic CBOR item.
/// Empty input, truncation, and trailing bytes map to stable CborError reasons.
pub fn decode_deterministic_cbor(
  bytes : BytesView,
) -> Result[CborValue, CborError] {
  if bytes.length() == 0 {
    return Err(CborError::new("empty_input", 0))
  }
  let r : Reader = { bytes, offset: 0 }
  let value = match decode_value(r, 0) {
    Ok(v) => v
    Err(e) => return Err(e)
  }
  if r.offset != bytes.length() {
    return Err(CborError::new("trailing_data", r.offset))
  }
  Ok(value)
}
