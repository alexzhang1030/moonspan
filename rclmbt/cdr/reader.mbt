///|
/// Bounded CDR1 stream reader (M1-01b1).
/// Encapsulation, endian-aware raw integer patterns, alignment, limits,
/// borrowed BytesView slices, and strict completion.
/// Semantic primitives, strings, collections, and ROS wstring land in M1-01c.

///|
/// Parsed encapsulation header.
pub struct CdrHeader {
  /// Representation identifier as network-order UInt16 (`0x0000` BE, `0x0001` LE).
  representation : Int
  /// Options field as network-order UInt16: `(byte2 << 8) | byte3`.
  /// Every two-byte value is accepted; field layout ignores options.
  options : Int
  /// True when representation is little endian (`0x0001`).
  little_endian : Bool
}

///|
/// Mutable CDR1 reader over a borrowed input view.
pub struct CdrReader {
  bytes : BytesView
  mut offset : Int
  limits : CdrLimits
  header : CdrHeader
}

///|
fn byte_u64(b : Byte) -> UInt64 {
  b.to_int().to_uint64()
}

///|
fn network_u16(hi : Byte, lo : Byte) -> Int {
  (hi.to_int() << 8) | lo.to_int()
}

///|
/// Open a CDR1 reader over `bytes` with the given limits.
pub fn CdrReader::open(
  bytes : BytesView,
  limits : CdrLimits,
) -> Result[CdrReader, CdrError] {
  let len = bytes.length()
  if len > limits.max_stream_bytes {
    return Err(CdrError::bounds_exceeded(0, limits.max_stream_bytes + 1, len))
  }
  if len < HEADER_LENGTH {
    return Err(CdrError::invalid_encapsulation(0, HEADER_LENGTH, len))
  }
  let b0 = bytes[0]
  let b1 = bytes[1]
  let b2 = bytes[2]
  let b3 = bytes[3]
  let representation = network_u16(b0, b1)
  let options = network_u16(b2, b3)
  let little_endian = if representation == REPRESENTATION_CDR_LE {
    true
  } else if representation == REPRESENTATION_CDR_BE {
    false
  } else {
    return Err(CdrError::unsupported_representation(0, len))
  }
  let header : CdrHeader = { representation, options, little_endian }
  Ok({ bytes, offset: BODY_ORIGIN, limits, header })
}

///|
/// Open with frozen default limits.
pub fn CdrReader::open_default(
  bytes : BytesView,
) -> Result[CdrReader, CdrError] {
  CdrReader::open(bytes, CdrLimits::defaults())
}

///|
/// Absolute cursor offset into the input view.
pub fn CdrReader::position(self : CdrReader) -> Int {
  self.offset
}

///|
/// Bytes remaining from the cursor to the end of the input view.
pub fn CdrReader::remaining(self : CdrReader) -> Int {
  self.bytes.length() - self.offset
}

///|
/// Encapsulation header captured at open.
pub fn CdrReader::header(self : CdrReader) -> CdrHeader {
  self.header
}

///|
/// Stream endianness from the representation identifier.
pub fn CdrReader::little_endian(self : CdrReader) -> Bool {
  self.header.little_endian
}

///|
/// Active resource limits.
pub fn CdrReader::limits(self : CdrReader) -> CdrLimits {
  self.limits
}

///|
/// Padding bytes required so `((offset - BODY_ORIGIN) % align) == 0`.
fn padding_for(offset : Int, align : Int) -> Int {
  if align <= 1 {
    return 0
  }
  let body_rel = offset - BODY_ORIGIN
  let rem = body_rel % align
  if rem == 0 {
    0
  } else {
    align - rem
  }
}

///|
/// Preflight pad + field size from `field_start`. Restores cursor on fault.
fn CdrReader::preflight(
  self : CdrReader,
  field_start : Int,
  align : Int,
  size : Int,
) -> Result[Int, CdrError] {
  let pad = padding_for(field_start, align)
  let needed = pad + size
  let rem = self.bytes.length() - field_start
  if pad > 0 && rem < pad {
    self.offset = field_start
    return Err(CdrError::alignment_overflow(field_start, pad, rem))
  }
  if rem < needed {
    self.offset = field_start
    return Err(CdrError::truncated(field_start, needed, rem))
  }
  Ok(pad)
}

///|
/// Advance past padding for `align`, then leave cursor at the field payload.
fn CdrReader::align_to(
  self : CdrReader,
  align : Int,
  size : Int,
) -> Result[Int, CdrError] {
  let field_start = self.offset
  let pad = match self.preflight(field_start, align, size) {
    Ok(p) => p
    Err(e) => return Err(e)
  }
  self.offset = field_start + pad
  Ok(field_start)
}

///|
/// Read one unaligned byte (alignment width 1).
pub fn CdrReader::read_u8(self : CdrReader) -> Result[Byte, CdrError] {
  let field_start = match self.align_to(1, 1) {
    Ok(s) => s
    Err(e) => return Err(e)
  }
  let b = self.bytes[self.offset]
  self.offset = self.offset + 1
  let _ = field_start
  Ok(b)
}

///|
/// Read a 16-bit unsigned bit pattern in stream endianness (align 2).
pub fn CdrReader::read_u16(self : CdrReader) -> Result[UInt64, CdrError] {
  let field_start = match self.align_to(2, 2) {
    Ok(s) => s
    Err(e) => return Err(e)
  }
  let b0 = self.bytes[self.offset]
  let b1 = self.bytes[self.offset + 1]
  self.offset = self.offset + 2
  let value = if self.header.little_endian {
    (byte_u64(b1) << 8) | byte_u64(b0)
  } else {
    (byte_u64(b0) << 8) | byte_u64(b1)
  }
  let _ = field_start
  Ok(value)
}

///|
/// Read a 32-bit unsigned bit pattern in stream endianness (align 4).
pub fn CdrReader::read_u32(self : CdrReader) -> Result[UInt64, CdrError] {
  let field_start = match self.align_to(4, 4) {
    Ok(s) => s
    Err(e) => return Err(e)
  }
  let b0 = self.bytes[self.offset]
  let b1 = self.bytes[self.offset + 1]
  let b2 = self.bytes[self.offset + 2]
  let b3 = self.bytes[self.offset + 3]
  self.offset = self.offset + 4
  let value = if self.header.little_endian {
    (byte_u64(b3) << 24) |
    (byte_u64(b2) << 16) |
    (byte_u64(b1) << 8) |
    byte_u64(b0)
  } else {
    (byte_u64(b0) << 24) |
    (byte_u64(b1) << 16) |
    (byte_u64(b2) << 8) |
    byte_u64(b3)
  }
  let _ = field_start
  Ok(value)
}

///|
/// Read a 64-bit unsigned bit pattern in stream endianness (align 8).
pub fn CdrReader::read_u64(self : CdrReader) -> Result[UInt64, CdrError] {
  let field_start = match self.align_to(8, 8) {
    Ok(s) => s
    Err(e) => return Err(e)
  }
  let mut value : UInt64 = 0UL
  if self.header.little_endian {
    let mut i = 0
    while i < 8 {
      let shift = i * 8
      value = value | (byte_u64(self.bytes[self.offset + i]) << shift)
      i = i + 1
    }
  } else {
    let mut i = 0
    while i < 8 {
      value = (value << 8) | byte_u64(self.bytes[self.offset + i])
      i = i + 1
    }
  }
  self.offset = self.offset + 8
  let _ = field_start
  Ok(value)
}

///|
/// Read `n` raw bytes as a borrowed subview (alignment width 1).
/// The returned view shares physical storage with the input `BytesView`.
pub fn CdrReader::read_bytes(
  self : CdrReader,
  n : Int,
) -> Result[BytesView, CdrError] {
  let field_start = self.offset
  if n < 0 {
    self.offset = field_start
    return Err(CdrError::length_overflow(field_start, 0, self.remaining()))
  }
  if n > self.limits.max_temporary_allocation {
    self.offset = field_start
    return Err(CdrError::bounds_exceeded(field_start, n, self.remaining()))
  }
  match self.align_to(1, n) {
    Ok(_) => ()
    Err(e) => {
      self.offset = field_start
      return Err(e)
    }
  }
  let start = self.offset
  let end = start + n
  self.offset = end
  Ok(self.bytes[start:end])
}

///|
/// Checked `count * element_size` against overflow and temporary-allocation ceiling.
/// Used by later string/sequence codecs and available for callers of raw reads.
pub fn CdrReader::checked_payload_length(
  self : CdrReader,
  count : UInt64,
  element_size : Int,
) -> Result[Int, CdrError] {
  let field_start = self.offset
  let rem = self.remaining()
  if element_size < 0 {
    return Err(CdrError::length_overflow(field_start, 0, rem))
  }
  if element_size == 0 {
    return Ok(0)
  }
  let elem_u = element_size.to_uint64()
  // Overflow when count > max_u64 / elem
  let max_count = 0xffffffffffffffffUL / elem_u
  if count > max_count {
    return Err(CdrError::length_overflow(field_start, 0, rem))
  }
  let bytes_u = count * elem_u
  if bytes_u > 2147483647UL {
    return Err(CdrError::length_overflow(field_start, 0, rem))
  }
  let bytes = bytes_u.to_int()
  if bytes > self.limits.max_temporary_allocation {
    return Err(CdrError::bounds_exceeded(field_start, bytes, rem))
  }
  Ok(bytes)
}

///|
/// Strict completion: require a fully consumed stream.
pub fn CdrReader::ensure_complete(self : CdrReader) -> Result[Unit, CdrError] {
  let rem = self.remaining()
  if rem > 0 {
    return Err(CdrError::trailing_data(self.offset, rem))
  }
  Ok(())
}
