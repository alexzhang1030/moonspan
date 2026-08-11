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
  /// Stream endianness from the representation identifier.
  endian : CdrEndian
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
fn is_little(endian : CdrEndian) -> Bool {
  match endian {
    CdrEndian::Little => true
    CdrEndian::Big => false
  }
}

///|
/// Open a CDR1 reader over `bytes` with validated limits.
/// Always re-validates `limits` at this trust boundary so public field writes
/// or package-internal literals cannot bypass `CdrLimits::new`.
pub fn CdrReader::open(
  bytes : BytesView,
  limits : CdrLimits,
) -> Result[CdrReader, CdrError] {
  match limits.validate() {
    Ok(_) => ()
    Err(e) => return Err(e)
  }
  let len = bytes.length()
  if len > limits.max_stream_bytes {
    // needed = requested input size; remaining = available stream capacity.
    return Err(CdrError::bounds_exceeded(0, len, limits.max_stream_bytes))
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
  let endian = if representation == REPRESENTATION_CDR_LE {
    CdrEndian::Little
  } else if representation == REPRESENTATION_CDR_BE {
    CdrEndian::Big
  } else {
    return Err(CdrError::unsupported_representation(0, len))
  }
  let header : CdrHeader = { representation, options, endian }
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
/// Representation identifier (network-order UInt16).
pub fn CdrReader::representation(self : CdrReader) -> Int {
  self.header.representation
}

///|
/// Options field (network-order UInt16).
pub fn CdrReader::options(self : CdrReader) -> Int {
  self.header.options
}

///|
/// Stream endianness.
pub fn CdrReader::endian(self : CdrReader) -> CdrEndian {
  self.header.endian
}

///|
/// True when the stream is little endian.
pub fn CdrReader::little_endian(self : CdrReader) -> Bool {
  is_little(self.header.endian)
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
/// On fault the cursor is restored to the field-start offset.
fn CdrReader::align_to(
  self : CdrReader,
  align : Int,
  size : Int,
) -> Result[Unit, CdrError] {
  let field_start = self.offset
  let pad = match self.preflight(field_start, align, size) {
    Ok(p) => p
    Err(e) => return Err(e)
  }
  self.offset = field_start + pad
  Ok(())
}

///|
/// Read one unaligned byte (alignment width 1).
pub fn CdrReader::read_u8(self : CdrReader) -> Result[Byte, CdrError] {
  match self.align_to(1, 1) {
    Ok(_) => ()
    Err(e) => return Err(e)
  }
  let b = self.bytes[self.offset]
  self.offset = self.offset + 1
  Ok(b)
}

///|
/// Read a 16-bit unsigned bit pattern in stream endianness (align 2).
pub fn CdrReader::read_u16(self : CdrReader) -> Result[UInt64, CdrError] {
  match self.align_to(2, 2) {
    Ok(_) => ()
    Err(e) => return Err(e)
  }
  let b0 = self.bytes[self.offset]
  let b1 = self.bytes[self.offset + 1]
  self.offset = self.offset + 2
  let value = if is_little(self.header.endian) {
    (byte_u64(b1) << 8) | byte_u64(b0)
  } else {
    (byte_u64(b0) << 8) | byte_u64(b1)
  }
  Ok(value)
}

///|
/// Read a 32-bit unsigned bit pattern in stream endianness (align 4).
pub fn CdrReader::read_u32(self : CdrReader) -> Result[UInt64, CdrError] {
  match self.align_to(4, 4) {
    Ok(_) => ()
    Err(e) => return Err(e)
  }
  let b0 = self.bytes[self.offset]
  let b1 = self.bytes[self.offset + 1]
  let b2 = self.bytes[self.offset + 2]
  let b3 = self.bytes[self.offset + 3]
  self.offset = self.offset + 4
  let value = if is_little(self.header.endian) {
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
  Ok(value)
}

///|
/// Read a 64-bit unsigned bit pattern in stream endianness (align 8).
pub fn CdrReader::read_u64(self : CdrReader) -> Result[UInt64, CdrError] {
  match self.align_to(8, 8) {
    Ok(_) => ()
    Err(e) => return Err(e)
  }
  let mut value : UInt64 = 0UL
  if is_little(self.header.endian) {
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
  Ok(value)
}

///|
/// Read `n` raw bytes as a borrowed zero-copy subview (alignment width 1).
/// Length is governed by remaining input and max stream size only.
/// `max_temporary_allocation` does not apply to borrowed spans.
pub fn CdrReader::read_bytes(
  self : CdrReader,
  n : Int,
) -> Result[BytesView, CdrError] {
  let field_start = self.offset
  if n < 0 {
    self.offset = field_start
    return Err(CdrError::length_overflow(field_start, 0, self.remaining()))
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
/// Checked `count * element_size` for a borrowed span length.
/// Order: multiply → absolute stream ceiling (`length_overflow`) → remaining
/// (`truncated`). Does not consult `max_temporary_allocation`.
pub fn CdrReader::checked_span_length(
  self : CdrReader,
  count : UInt64,
  element_size : Int,
) -> Result[Int, CdrError] {
  let field_start = self.offset
  let rem = self.remaining()
  let max_stream = self.limits.max_stream_bytes
  match multiply_length(count, element_size, field_start, rem) {
    Ok(bytes) => {
      // Absolute stream ceiling before remaining: validated openers keep
      // rem <= max_stream, so this branch is for computed spans above the ceiling.
      if bytes > max_stream {
        return Err(CdrError::length_overflow(field_start, bytes, max_stream))
      }
      if bytes > rem {
        return Err(CdrError::truncated(field_start, bytes, rem))
      }
      Ok(bytes)
    }
    Err(e) => Err(e)
  }
}

///|
/// Checked `count * element_size` for an owned temporary allocation budget.
/// Detects arithmetic overflow and lengths above `max_temporary_allocation`.
/// `needed` = requested size; `remaining` = allocation capacity.
pub fn CdrReader::checked_alloc_length(
  self : CdrReader,
  count : UInt64,
  element_size : Int,
) -> Result[Int, CdrError] {
  let field_start = self.offset
  let rem = self.remaining()
  let capacity = self.limits.max_temporary_allocation
  match multiply_length(count, element_size, field_start, rem) {
    Ok(bytes) => {
      if bytes > capacity {
        return Err(CdrError::bounds_exceeded(field_start, bytes, capacity))
      }
      Ok(bytes)
    }
    Err(e) => Err(e)
  }
}

///|

///|
/// Multiply `count * element_size` into a host `Int`. On overflow that cannot
/// fit `Int`, returns `length_overflow` with **`needed = 0`** (sentinel).
fn multiply_length(
  count : UInt64,
  element_size : Int,
  field_start : Int,
  rem : Int,
) -> Result[Int, CdrError] {
  if element_size < 0 {
    return Err(CdrError::length_overflow(field_start, 0, rem))
  }
  if element_size == 0 {
    return Ok(0)
  }
  let elem_u = element_size.to_uint64()
  let max_count = 0xffffffffffffffffUL / elem_u
  if count > max_count {
    return Err(CdrError::length_overflow(field_start, 0, rem))
  }
  let bytes_u = count * elem_u
  // Int-domain ceiling for MoonBit host sizes; needed=0 sentinel.
  if bytes_u > 2147483647UL {
    return Err(CdrError::length_overflow(field_start, 0, rem))
  }
  Ok(bytes_u.to_int())
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
