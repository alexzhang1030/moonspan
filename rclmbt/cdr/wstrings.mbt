///|
/// ROS 2 legacy wstring codecs and corpus-tail completion (M1-01c2b).
///
/// Wire layout: endian-aware `UInt32` element count `N`, then exactly `N`
/// endian-aware `UInt32` scalar slots (`N * 4` payload bytes). Empty value is
/// count 0 with zero payload slots. Canonical encode ends at the core field
/// boundary (zero top-level tail slack).
///
/// Accepted slots: `0x00000000..0x0000D7FF` and `0x0000E000..0x0010FFFF`.
/// Surrogate halves and values above `0x10FFFF` map to `invalid_wstring_scalar`.
///
/// Optional `max_scalars` counts Unicode scalar / 32-bit slots. Bounds above
/// `HOST_INT_MAX_U` stay open relative to the stream ceiling (c2a large-bound
/// rule).

///|
/// True when `slot` is an accepted ROS legacy wstring Unicode scalar.
fn is_accepted_wstring_scalar(slot : UInt) -> Bool {
  if slot <= 0x0000D7FFU {
    true
  } else if slot < 0x0000E000U {
    false
  } else if slot <= 0x0010FFFFU {
    true
  } else {
    false
  }
}

///|
/// Maximum scalar count that fits the writer field from `field_start` given
/// `rem_cap`. Returns `-1` when even an empty wstring (pad + count) exceeds
/// remaining capacity.
fn max_scalars_for_writer(field_start : Int, rem_cap : Int) -> Int {
  let pad = padding_for(field_start, 4)
  if rem_cap < pad {
    return -1
  }
  let body_space = rem_cap - pad
  // Empty wstring body: 4-byte count only.
  if body_space < 4 {
    return -1
  }
  (body_space - 4) / 4
}

///|
/// Capacity fault for needing at least `min_scalars` slots.
fn wstring_capacity_bounds_error(
  field_start : Int,
  rem_cap : Int,
  pad : Int,
  min_scalars : Int,
) -> CdrError {
  // needed = pad + count UInt32 + min_scalars * 4
  let payload = match checked_add_int(min_scalars, min_scalars) {
    None => return CdrError::length_overflow(field_start, 0, rem_cap)
    Some(n) =>
      match checked_add_int(n, n) {
        None => return CdrError::length_overflow(field_start, 0, rem_cap)
        Some(m) => m
      }
  }
  let body = match checked_add_int(4, payload) {
    None => return CdrError::length_overflow(field_start, 0, rem_cap)
    Some(n) => n
  }
  let needed = match checked_add_int(pad, body) {
    None => return CdrError::length_overflow(field_start, 0, rem_cap)
    Some(n) => n
  }
  CdrError::bounds_exceeded(field_start, needed, rem_cap)
}

///|
/// Decode the next Unicode scalar from `view` at UTF-16 index `i`.
/// Advances `i` by one code unit or a surrogate pair. Returns the scalar as
/// `UInt` and the new index. Unpaired surrogates yield `None`.
fn next_wstring_scalar(view : StringView, i : Int) -> (UInt, Int)? {
  let n = view.length()
  if i >= n {
    return None
  }
  let unit = view[i].to_int()
  if unit >= 0xD800 && unit <= 0xDBFF {
    if i + 1 >= n {
      return None
    }
    let trail = view[i + 1].to_int()
    if trail < 0xDC00 || trail > 0xDFFF {
      return None
    }
    let cp = ((unit - 0xD800) << 10) + (trail - 0xDC00) + 0x10000
    Some((cp.reinterpret_as_uint(), i + 2))
  } else if unit >= 0xDC00 && unit <= 0xDFFF {
    None
  } else {
    Some((unit.reinterpret_as_uint(), i + 1))
  }
}

///|
/// Validate UTF-16 scalars in `view` and return only the scalar count.
/// Uses constant auxiliary state: a running count and UTF-16 index. Stops once
/// the count crosses type or capacity ceilings. Fault order: type-bound excess,
/// then writer-capacity excess; unpaired surrogates map to
/// `invalid_wstring_scalar`.
fn count_wstring_scalars(
  view : StringView,
  type_bound : UInt?,
  cap_max_scalars : Int,
  field_start : Int,
  rem_cap : Int,
  pad : Int,
) -> Result[Int, CdrError] {
  let type_max = type_bound_ceiling(type_bound)
  let n = view.length()
  let mut i = 0
  let mut count = 0
  while i < n {
    let step = match next_wstring_scalar(view, i) {
      Some(pair) => pair
      None => return Err(CdrError::invalid_wstring_scalar(field_start, rem_cap))
    }
    let scalar = step.0
    i = step.1
    if !is_accepted_wstring_scalar(scalar) {
      return Err(CdrError::invalid_wstring_scalar(field_start, rem_cap))
    }
    let next_count = count + 1
    match type_max {
      Some(t) =>
        if next_count > t {
          return Err(CdrError::bounds_exceeded(field_start, next_count, t))
        }
      None => ()
    }
    if cap_max_scalars < 0 || next_count > cap_max_scalars {
      let min_n = if cap_max_scalars < 0 { 1 } else { cap_max_scalars + 1 }
      return Err(
        wstring_capacity_bounds_error(field_start, rem_cap, pad, min_n),
      )
    }
    count = next_count
  }
  Ok(count)
}

///|
/// Second writer walk: emit validated scalars from immutable `view` directly
/// into `buf`. Caller has already reserved capacity and written the count;
/// the view was validated by `count_wstring_scalars` so this walk is infallible
/// for well-formed inputs that passed the first pass.
fn emit_wstring_scalars(buf : Buffer, view : StringView, little : Bool) -> Unit {
  let n = view.length()
  let mut i = 0
  while i < n {
    // First pass already accepted every scalar; decode is structural only.
    let step = match next_wstring_scalar(view, i) {
      Some(pair) => pair
      None =>
        abort("wstring emit: unexpected unpaired surrogate after validation")
    }
    let scalar = step.0
    i = step.1
    if little {
      buf.write_uint_le(scalar)
    } else {
      buf.write_uint_be(scalar)
    }
  }
}

///|
/// Read one endian-aware UInt32 from `bytes` at absolute `pos`.
fn read_u32_at(bytes : BytesView, pos : Int, little : Bool) -> UInt {
  let b0 = bytes[pos].to_uint()
  let b1 = bytes[pos + 1].to_uint()
  let b2 = bytes[pos + 2].to_uint()
  let b3 = bytes[pos + 3].to_uint()
  if little {
    (b3 << 24) | (b2 << 16) | (b1 << 8) | b0
  } else {
    (b0 << 24) | (b1 << 16) | (b2 << 8) | b3
  }
}

// --- Reader ---

///|
/// Decode a ROS 2 legacy wstring into an owned `String`.
///
/// `max_scalars`, when supplied, is the maximum Unicode scalar / slot count.
/// Complete field preflight runs before owned allocation or cursor commit.
pub fn CdrReader::read_wstring(
  self : CdrReader,
  max_scalars? : UInt,
) -> Result[String, CdrError] {
  let field_start = self.offset
  let rem_at_start = self.remaining()
  let max_stream = self.limits.max_stream_bytes
  let little = is_little(self.header.endian)
  let pad = match self.preflight(field_start, 4, 4) {
    Ok(p) => p
    Err(e) => return Err(e)
  }
  let count_pos = field_start + pad
  let count_u = read_u32_at(self.bytes, count_pos, little)
  // Optional type bound before span arithmetic / allocation.
  match max_scalars {
    Some(bound) =>
      if count_u > bound {
        self.offset = field_start
        return Err(
          CdrError::bounds_exceeded(
            field_start,
            uint_size_field(count_u),
            uint_size_field(bound),
          ),
        )
      }
    None => ()
  }
  // Host Int conversion for count.
  if count_u > HOST_INT_MAX_U {
    self.offset = field_start
    return Err(CdrError::length_overflow(field_start, 0, rem_at_start))
  }
  let count_i = count_u.reinterpret_as_int()
  // Checked N * 4 in UInt64 / host domain.
  let payload_u64 = count_u.to_uint64() * 4UL
  if payload_u64 > HOST_INT_MAX.to_uint64() {
    self.offset = field_start
    return Err(CdrError::length_overflow(field_start, 0, rem_at_start))
  }
  let payload_i = payload_u64.to_int()
  // Absolute stream ceiling on the declared payload span before remaining.
  if payload_i > max_stream {
    self.offset = field_start
    return Err(CdrError::length_overflow(field_start, payload_i, max_stream))
  }
  let header_and_pad = match checked_add_int(pad, 4) {
    None => {
      self.offset = field_start
      return Err(CdrError::length_overflow(field_start, 0, rem_at_start))
    }
    Some(n) => n
  }
  let total_needed = match checked_add_int(header_and_pad, payload_i) {
    None => {
      self.offset = field_start
      return Err(CdrError::length_overflow(field_start, 0, rem_at_start))
    }
    Some(n) => n
  }
  if rem_at_start < total_needed {
    self.offset = field_start
    return Err(CdrError::truncated(field_start, total_needed, rem_at_start))
  }
  // Worst-case owned UTF-16 storage: N * 4 bytes.
  let worst_i = payload_i
  let temp_cap = self.limits.max_temporary_allocation
  if worst_i > temp_cap {
    self.offset = field_start
    return Err(CdrError::bounds_exceeded(field_start, worst_i, temp_cap))
  }
  // Validate every slot and build the owned String before cursor commit.
  let data_start = count_pos + 4
  let sb = StringBuilder(size_hint=count_i)
  let mut k = 0
  while k < count_i {
    let slot = read_u32_at(self.bytes, data_start + k * 4, little)
    if !is_accepted_wstring_scalar(slot) {
      self.offset = field_start
      return Err(CdrError::invalid_wstring_scalar(field_start, rem_at_start))
    }
    // Slot values fit host Int for accepted range (max 0x10FFFF).
    sb.write_char(slot.reinterpret_as_int().unsafe_to_char())
    k = k + 1
  }
  self.offset = data_start + payload_i
  Ok(sb.to_string())
}

///|
/// Corpus completion after a terminal wstring: succeed when the stream is fully
/// consumed, or when exactly four remaining zero bytes form Phase 1 top-level
/// tail slack (those four bytes are consumed). Every other trailing shape
/// returns `trailing_data` and leaves the cursor unchanged.
pub fn CdrReader::ensure_corpus_complete_terminal_wstring(
  self : CdrReader,
) -> Result[Unit, CdrError] {
  let rem = self.remaining()
  if rem == 0 {
    return Ok(())
  }
  if rem == 4 {
    let p = self.offset
    if self.bytes[p] == b'\x00' &&
      self.bytes[p + 1] == b'\x00' &&
      self.bytes[p + 2] == b'\x00' &&
      self.bytes[p + 3] == b'\x00' {
      self.offset = p + 4
      return Ok(())
    }
    return Err(CdrError::trailing_data(p, rem))
  }
  Err(CdrError::trailing_data(self.offset, rem))
}

// --- Writer ---

///|
/// Encode a ROS 2 legacy wstring from `value`.
///
/// `max_scalars`, when supplied, is the maximum Unicode scalar / slot count.
/// First pass validates and counts under type/capacity ceilings with constant
/// auxiliary state. After one complete field preflight, a second walk emits
/// count and slots directly into the owned writer buffer (zero top-level tail
/// slack). Failed writes leave position and bytes unchanged.
pub fn CdrWriter::write_wstring(
  self : CdrWriter,
  value : StringView,
  max_scalars? : UInt,
) -> Result[Unit, CdrError] {
  let field_start = self.buf.length()
  let rem_cap = self.remaining_capacity()
  let pad = padding_for(field_start, 4)
  let cap_max = max_scalars_for_writer(field_start, rem_cap)
  let type_bound : UInt? = match max_scalars {
    Some(b) => Some(b)
    None => None
  }
  let count = match
    count_wstring_scalars(value, type_bound, cap_max, field_start, rem_cap, pad) {
    Ok(n) => n
    Err(e) => return Err(e)
  }
  let payload = match checked_add_int(count, count) {
    None => return Err(CdrError::length_overflow(field_start, 0, rem_cap))
    Some(n) =>
      match checked_add_int(n, n) {
        None => return Err(CdrError::length_overflow(field_start, 0, rem_cap))
        Some(m) => m
      }
  }
  let body_size = match checked_add_int(4, payload) {
    None => return Err(CdrError::length_overflow(field_start, 0, rem_cap))
    Some(n) => n
  }
  match self.align_and_reserve(4, body_size) {
    Ok(_) => ()
    Err(e) => return Err(e)
  }
  let count_u = count.reinterpret_as_uint()
  let little = is_little(self.endian)
  if little {
    self.buf.write_uint_le(count_u)
  } else {
    self.buf.write_uint_be(count_u)
  }
  emit_wstring_scalars(self.buf, value, little)
  Ok(())
}
