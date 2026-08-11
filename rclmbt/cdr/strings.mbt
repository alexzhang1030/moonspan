///|
/// CDR1 UTF-8 Char8 string codecs (M1-01c2a).
/// ROS legacy wstring and corpus-tail completion land in M1-01c2b.
///
/// Wire layout: endian-aware `UInt32` length (includes the final single NUL),
/// then UTF-8 payload bytes, then required `0x00`. Empty string is length 1
/// plus `0x00`.
///
/// Optional `max_bytes` counts **UTF-8 payload bytes only** and excludes the
/// required terminating NUL. Exact bound succeeds; bound + 1 fails with
/// `bounds_exceeded` before decode allocation / writer mutation.

///|
/// Host `Int` ceiling as `UInt` for safe length conversion.
const HOST_INT_MAX_U : UInt = 2147483647U

///|
/// Map a non-negative size that fits host `Int` into error `needed`/`remaining`.
/// Values above the host `Int` domain use the `needed = 0` sentinel.
fn uint_size_field(v : UInt) -> Int {
  if v > HOST_INT_MAX_U {
    0
  } else {
    v.reinterpret_as_int()
  }
}

///|
/// Validate UTF-16 scalars in `view` and return the UTF-8 payload byte length.
/// Unpaired surrogates yield `Err(())` (maps to `invalid_utf8`).
fn utf8_payload_len(view : StringView) -> Result[Int, Unit] {
  let n = view.length()
  let mut i = 0
  let mut len = 0
  while i < n {
    let unit = view[i].to_int()
    if unit >= 0xD800 && unit <= 0xDBFF {
      // Leading surrogate: require a trailing pair.
      if i + 1 >= n {
        return Err(())
      }
      let trail = view[i + 1].to_int()
      if trail < 0xDC00 || trail > 0xDFFF {
        return Err(())
      }
      // Non-BMP scalar → 4 UTF-8 bytes.
      match checked_add_int(len, 4) {
        None => return Err(())
        Some(next) => len = next
      }
      i = i + 2
    } else if unit >= 0xDC00 && unit <= 0xDFFF {
      // Unpaired trailing surrogate.
      return Err(())
    } else {
      let add = if unit < 0x80 { 1 } else if unit < 0x800 { 2 } else { 3 }
      match checked_add_int(len, add) {
        None => return Err(())
        Some(next) => len = next
      }
      i = i + 1
    }
  }
  Ok(len)
}

///|
/// Emit one validated Unicode scalar as UTF-8 into the writer buffer.
/// Caller must have reserved capacity; no preflight here.
fn write_scalar_utf8(buf : Buffer, code : Int) -> Unit {
  if code < 0x80 {
    buf.write_byte(code.to_byte())
  } else if code < 0x800 {
    buf.write_byte((0xC0 | (code >> 6)).to_byte())
    buf.write_byte((0x80 | (code & 0x3F)).to_byte())
  } else if code < 0x10000 {
    buf.write_byte((0xE0 | (code >> 12)).to_byte())
    buf.write_byte((0x80 | ((code >> 6) & 0x3F)).to_byte())
    buf.write_byte((0x80 | (code & 0x3F)).to_byte())
  } else {
    buf.write_byte((0xF0 | (code >> 18)).to_byte())
    buf.write_byte((0x80 | ((code >> 12) & 0x3F)).to_byte())
    buf.write_byte((0x80 | ((code >> 6) & 0x3F)).to_byte())
    buf.write_byte((0x80 | (code & 0x3F)).to_byte())
  }
}

///|
/// Write UTF-8 payload for a previously validated `StringView` (no unpaired
/// surrogates). Emits directly into `buf` without a second payload temporary.
fn write_validated_utf8_payload(buf : Buffer, view : StringView) -> Unit {
  let n = view.length()
  let mut i = 0
  while i < n {
    let unit = view[i].to_int()
    if unit >= 0xD800 && unit <= 0xDBFF {
      let trail = view[i + 1].to_int()
      let scalar = ((unit - 0xD800) << 10) + (trail - 0xDC00) + 0x10000
      write_scalar_utf8(buf, scalar)
      i = i + 2
    } else {
      write_scalar_utf8(buf, unit)
      i = i + 1
    }
  }
}

// --- Reader ---

///|
/// Decode a CDR1 UTF-8 Char8 string into an owned `String`.
///
/// `max_bytes`, when supplied, is the maximum **UTF-8 payload** byte count
/// (excludes the required terminating NUL). The bound is enforced before any
/// owned decode allocation.
pub fn CdrReader::read_string(
  self : CdrReader,
  max_bytes? : UInt,
) -> Result[String, CdrError] {
  let field_start = self.offset
  let rem_at_start = self.remaining()
  // Preflight pad + UInt32 length only; character span checked after length.
  let pad = match self.preflight(field_start, 4, 4) {
    Ok(p) => p
    Err(e) => return Err(e)
  }
  let len_pos = field_start + pad
  // Assemble endian-aware UInt32 length (includes final NUL).
  let b0 = self.bytes[len_pos].to_uint()
  let b1 = self.bytes[len_pos + 1].to_uint()
  let b2 = self.bytes[len_pos + 2].to_uint()
  let b3 = self.bytes[len_pos + 3].to_uint()
  let len_u = if is_little(self.header.endian) {
    (b3 << 24) | (b2 << 16) | (b1 << 8) | b0
  } else {
    (b0 << 24) | (b1 << 16) | (b2 << 8) | b3
  }
  // Length 0: no room for the required terminator.
  if len_u == 0U {
    self.offset = field_start
    return Err(
      CdrError::missing_string_terminator(field_start, 1, rem_at_start),
    )
  }
  let payload_u = len_u - 1U
  // Type bound before decode allocation / stream consume.
  match max_bytes {
    Some(bound) =>
      if payload_u > bound {
        self.offset = field_start
        return Err(
          CdrError::bounds_exceeded(
            field_start,
            uint_size_field(payload_u),
            uint_size_field(bound),
          ),
        )
      }
    None => ()
  }
  // Host Int conversion after arithmetic domain checks.
  if len_u > HOST_INT_MAX_U {
    self.offset = field_start
    return Err(CdrError::length_overflow(field_start, 0, rem_at_start))
  }
  let len_i = len_u.reinterpret_as_int()
  let payload_i = len_i - 1
  // Complete field size from field_start: pad + 4 + length.
  let header_and_pad = match checked_add_int(pad, 4) {
    None => {
      self.offset = field_start
      return Err(CdrError::length_overflow(field_start, 0, rem_at_start))
    }
    Some(n) => n
  }
  let total_needed = match checked_add_int(header_and_pad, len_i) {
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
  // Worst-case owned UTF-16 String storage: payload_bytes * 2.
  let worst_u = payload_u.to_uint64() * 2UL
  if worst_u > HOST_INT_MAX.to_uint64() {
    self.offset = field_start
    return Err(CdrError::length_overflow(field_start, 0, rem_at_start))
  }
  let worst_i = worst_u.to_int()
  let temp_cap = self.limits.max_temporary_allocation
  if worst_i > temp_cap {
    self.offset = field_start
    return Err(CdrError::bounds_exceeded(field_start, worst_i, temp_cap))
  }
  // Consume length + character span (including NUL).
  let data_start = len_pos + 4
  let data_end = data_start + len_i
  let span = self.bytes[data_start:data_end]
  // Required terminator is the final byte of the declared span.
  if span[len_i - 1] != b'\x00' {
    self.offset = field_start
    return Err(
      CdrError::missing_string_terminator(field_start, len_i, rem_at_start),
    )
  }
  let payload = if payload_i == 0 {
    self.bytes[data_start:data_start]
  } else {
    self.bytes[data_start:data_start + payload_i]
  }
  // Strict UTF-8; ignore_bom=false preserves leading U+FEFF (EF BB BF).
  try {
    let s = @utf8.decode(payload, ignore_bom=false)
    self.offset = data_end
    Ok(s)
  } catch {
    @utf8.Malformed(_) => {
      self.offset = field_start
      Err(CdrError::invalid_utf8(field_start, len_i, rem_at_start))
    }
  }
}

// --- Writer ---

///|
/// Encode a CDR1 UTF-8 Char8 string from `value`.
///
/// `max_bytes`, when supplied, is the maximum **UTF-8 payload** byte count
/// (excludes the required terminating NUL). The bound is enforced before any
/// buffer mutation. After validation and one complete field preflight, the
/// encoder writes length, payload, and NUL directly into the owned writer
/// buffer (no second payload-sized temporary).
pub fn CdrWriter::write_string(
  self : CdrWriter,
  value : StringView,
  max_bytes? : UInt,
) -> Result[Unit, CdrError] {
  let field_start = self.buf.length()
  let rem_cap = self.remaining_capacity()
  // Validate scalars and compute UTF-8 payload length before mutation.
  let payload_len = match utf8_payload_len(value) {
    Ok(n) => n
    Err(_) => return Err(CdrError::invalid_utf8(field_start, 0, rem_cap))
  }
  let payload_u = payload_len.reinterpret_as_uint()
  match max_bytes {
    Some(bound) =>
      if payload_u > bound {
        return Err(
          CdrError::bounds_exceeded(
            field_start,
            payload_len,
            uint_size_field(bound),
          ),
        )
      }
    None => ()
  }
  // Wire length = payload + required NUL.
  let wire_len = match checked_add_int(payload_len, 1) {
    None => return Err(CdrError::length_overflow(field_start, 0, rem_cap))
    Some(n) => n
  }
  // One complete field preflight: align-4 pad + UInt32 + payload + NUL.
  let body_size = match checked_add_int(4, wire_len) {
    None => return Err(CdrError::length_overflow(field_start, 0, rem_cap))
    Some(n) => n
  }
  match self.align_and_reserve(4, body_size) {
    Ok(_) => ()
    Err(e) => return Err(e)
  }
  // Emit length (includes NUL), payload, then NUL — direct into owned buffer.
  let wire_u = wire_len.reinterpret_as_uint()
  if is_little(self.endian) {
    self.buf.write_uint_le(wire_u)
  } else {
    self.buf.write_uint_be(wire_u)
  }
  write_validated_utf8_payload(self.buf, value)
  self.buf.write_byte(b'\x00')
  Ok(())
}
