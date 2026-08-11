///|
/// Bounded CDR1 stream writer (M1-01b2).
/// Canonical encapsulation, deterministic zero padding, width-exact raw
/// integers, and capacity min(max_stream_bytes, max_temporary_allocation)
/// over the complete stream including the 4-byte header.

///|
/// Mutable CDR1 writer into an owned buffer.
pub struct CdrWriter {
  buf : Buffer
  mut offset : Int
  capacity : Int
  limits : CdrLimits
  endian : CdrEndian
  representation : Int
  options : Int
}

///|
/// Construct a writer for `endian` with validated `limits`.
/// Emits the full 4-byte canonical header immediately (options `0x0000`).
/// Capacity is `min(max_stream_bytes, max_temporary_allocation)` including
/// the header. Temporary capacity below 4 bytes yields `bounds_exceeded`
/// with `needed = 4` and `remaining =` temporary capacity.
pub fn CdrWriter::new(
  endian : CdrEndian,
  limits : CdrLimits,
) -> Result[CdrWriter, CdrError] {
  match limits.validate() {
    Ok(_) => ()
    Err(e) => return Err(e)
  }
  let capacity = writer_capacity(limits)
  if capacity < HEADER_LENGTH {
    return Err(
      CdrError::bounds_exceeded(
        0,
        HEADER_LENGTH,
        limits.max_temporary_allocation,
      ),
    )
  }
  let representation = representation_of(endian)
  let options = 0
  let buf = Buffer(size_hint=capacity)
  // Canonical header: representation network-order, options 0x0000.
  if is_little(endian) {
    buf.write_byte(b'\x00')
    buf.write_byte(b'\x01')
  } else {
    buf.write_byte(b'\x00')
    buf.write_byte(b'\x00')
  }
  buf.write_byte(b'\x00')
  buf.write_byte(b'\x00')
  Ok({
    buf,
    offset: HEADER_LENGTH,
    capacity,
    limits,
    endian,
    representation,
    options,
  })
}

///|
/// Construct with frozen default limits.
pub fn CdrWriter::new_default(
  endian : CdrEndian,
) -> Result[CdrWriter, CdrError] {
  CdrWriter::new(endian, CdrLimits::defaults())
}

///|
/// Absolute write cursor (equals the current stream length).
pub fn CdrWriter::position(self : CdrWriter) -> Int {
  self.offset
}

///|
/// Bytes remaining until the capacity ceiling.
pub fn CdrWriter::remaining_capacity(self : CdrWriter) -> Int {
  self.capacity - self.offset
}

///|
/// Stream endianness.
pub fn CdrWriter::endian(self : CdrWriter) -> CdrEndian {
  self.endian
}

///|
/// True when the stream is little endian.
pub fn CdrWriter::little_endian(self : CdrWriter) -> Bool {
  is_little(self.endian)
}

///|
/// Representation identifier (network-order UInt16 value).
pub fn CdrWriter::representation(self : CdrWriter) -> Int {
  self.representation
}

///|
/// Options field (always `0x0000` for the canonical writer).
pub fn CdrWriter::options(self : CdrWriter) -> Int {
  self.options
}

///|
/// Active resource limits.
pub fn CdrWriter::limits(self : CdrWriter) -> CdrLimits {
  self.limits
}

///|
/// Owned snapshot of the stream so far. Later writes leave prior snapshots unchanged.
pub fn CdrWriter::to_bytes(self : CdrWriter) -> Bytes {
  self.buf.to_bytes()
}

///|
/// Preflight pad + size against capacity without mutating the buffer.
/// On success, writes deterministic zero padding and advances the cursor.
fn CdrWriter::align_and_reserve(
  self : CdrWriter,
  align : Int,
  size : Int,
) -> Result[Unit, CdrError] {
  let field_start = self.offset
  if size < 0 {
    return Err(
      CdrError::length_overflow(field_start, 0, self.remaining_capacity()),
    )
  }
  let pad = padding_for(field_start, align)
  match checked_add_int(pad, size) {
    None =>
      return Err(
        CdrError::length_overflow(field_start, 0, self.remaining_capacity()),
      )
    Some(needed) => {
      match checked_add_int(field_start, needed) {
        None =>
          return Err(
            CdrError::length_overflow(field_start, 0, self.remaining_capacity()),
          )
        Some(end) =>
          if end > self.capacity {
            return Err(
              CdrError::bounds_exceeded(
                field_start,
                needed,
                self.remaining_capacity(),
              ),
            )
          }
      }
      // Mutate only after full preflight success.
      let mut i = 0
      while i < pad {
        self.buf.write_byte(b'\x00')
        i = i + 1
      }
      self.offset = field_start + pad
      Ok(())
    }
  }
}

///|
/// Write one byte (alignment width 1).
pub fn CdrWriter::write_u8(
  self : CdrWriter,
  value : Byte,
) -> Result[Unit, CdrError] {
  match self.align_and_reserve(1, 1) {
    Ok(_) => ()
    Err(e) => return Err(e)
  }
  self.buf.write_byte(value)
  self.offset = self.offset + 1
  Ok(())
}

///|
/// Write a 16-bit unsigned bit pattern (align 2).
pub fn CdrWriter::write_u16(
  self : CdrWriter,
  value : UInt16,
) -> Result[Unit, CdrError] {
  match self.align_and_reserve(2, 2) {
    Ok(_) => ()
    Err(e) => return Err(e)
  }
  if is_little(self.endian) {
    self.buf.write_uint16_le(value)
  } else {
    self.buf.write_uint16_be(value)
  }
  self.offset = self.offset + 2
  Ok(())
}

///|
/// Write a 32-bit unsigned bit pattern (align 4).
pub fn CdrWriter::write_u32(
  self : CdrWriter,
  value : UInt,
) -> Result[Unit, CdrError] {
  match self.align_and_reserve(4, 4) {
    Ok(_) => ()
    Err(e) => return Err(e)
  }
  if is_little(self.endian) {
    self.buf.write_uint_le(value)
  } else {
    self.buf.write_uint_be(value)
  }
  self.offset = self.offset + 4
  Ok(())
}

///|
/// Write a 64-bit unsigned bit pattern (align 8).
pub fn CdrWriter::write_u64(
  self : CdrWriter,
  value : UInt64,
) -> Result[Unit, CdrError] {
  match self.align_and_reserve(8, 8) {
    Ok(_) => ()
    Err(e) => return Err(e)
  }
  if is_little(self.endian) {
    self.buf.write_uint64_le(value)
  } else {
    self.buf.write_uint64_be(value)
  }
  self.offset = self.offset + 8
  Ok(())
}

///|
/// Copy `n` bytes from `data` into the stream (alignment width 1).
pub fn CdrWriter::write_bytes(
  self : CdrWriter,
  data : BytesView,
) -> Result[Unit, CdrError] {
  let n = data.length()
  match self.align_and_reserve(1, n) {
    Ok(_) => ()
    Err(e) => return Err(e)
  }
  self.buf.write_bytes(data)
  self.offset = self.offset + n
  Ok(())
}
