///|
/// Bounded CDR1 stream writer (M1-01b2).
/// Canonical encapsulation, deterministic zero padding, width-exact raw
/// integers, and capacity min(max_stream_bytes, max_temporary_allocation)
/// over the complete stream including the 4-byte header.
///
/// Initial `Buffer` allocation uses `HEADER_LENGTH` as a small lazy size_hint.
/// Core Buffer grows on demand; the logical hard ceiling remains `capacity`
/// (Phase 1 absolute backing cap still 64 MiB via limits). Position is always
/// `buf.length()` — the single mutable stream-length source.

///|
/// Initial Buffer size_hint: header only. Growth is lazy under the logical ceiling.
pub const WRITER_INITIAL_SIZE_HINT : Int = HEADER_LENGTH

///|
/// Mutable CDR1 writer into an owned buffer.
/// Package-private fields: external packages construct only via `new` /
/// `new_default` (MoonBit forbids foreign package struct literals for
/// non-exported field construction; factory validation is the sole entry).
pub struct CdrWriter {
  priv buf : Buffer
  priv capacity : Int
  priv limits : CdrLimits
  priv endian : CdrEndian
  priv representation : Int
  priv options : Int
}

///|
/// Construct a writer for `endian` with validated `limits`.
/// Emits the full 4-byte canonical header immediately (options `0x0000`).
/// Capacity is `min(max_stream_bytes, max_temporary_allocation)` including
/// the header. Temporary capacity below 4 bytes yields `bounds_exceeded`
/// with `needed = 4` and `remaining =` temporary capacity.
///
/// Allocation: `Buffer(size_hint=HEADER_LENGTH)` — small initial backing;
/// writes grow lazily until the logical `capacity` ceiling.
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
  let buf = Buffer(size_hint=WRITER_INITIAL_SIZE_HINT)
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
  Ok({ buf, capacity, limits, endian, representation, options })
}

///|
/// Construct with frozen default limits.
pub fn CdrWriter::new_default(
  endian : CdrEndian,
) -> Result[CdrWriter, CdrError] {
  CdrWriter::new(endian, CdrLimits::defaults())
}

///|
/// Absolute write cursor — always `buf.length()` after a successful mutation.
pub fn CdrWriter::position(self : CdrWriter) -> Int {
  self.buf.length()
}

///|
/// Bytes remaining until the logical capacity ceiling.
pub fn CdrWriter::remaining_capacity(self : CdrWriter) -> Int {
  self.capacity - self.buf.length()
}

///|
/// Logical hard ceiling (bytes), including the header.
pub fn CdrWriter::capacity(self : CdrWriter) -> Int {
  self.capacity
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
/// Owned snapshot of the stream so far (length ≤ capacity). Later writes leave
/// prior snapshots unchanged.
pub fn CdrWriter::to_bytes(self : CdrWriter) -> Bytes {
  self.buf.to_bytes()
}

///|
/// Preflight pad + size against capacity; mutate only after preflight succeeds.
/// On success, writes deterministic zero padding. Position is `buf.length()`.
fn CdrWriter::align_and_reserve(
  self : CdrWriter,
  align : Int,
  size : Int,
) -> Result[Unit, CdrError] {
  let field_start = self.buf.length()
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
  Ok(())
}

///|
/// Copy bytes from `data` into the stream (alignment width 1).
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
  Ok(())
}
