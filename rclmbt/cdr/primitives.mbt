///|
/// Semantic CDR1 primitive codecs (M1-01c1).
/// Built on width-exact raw reads/writes so alignment, endianness, and limits
/// stay centralized. Strings, ROS wstring, and collections land later.

///|
fn i8_from_byte(b : Byte) -> Int {
  let u = b.to_int()
  if u >= 128 {
    u - 256
  } else {
    u
  }
}

///|
fn i8_to_byte(value : Int) -> Byte {
  if value < 0 {
    (value + 256).to_byte()
  } else {
    value.to_byte()
  }
}

// --- Reader ---

///|
/// Decode a CDR boolean (`0` = false, `1` = true).
pub fn CdrReader::read_bool(self : CdrReader) -> Result[Bool, CdrError] {
  let field_start = self.position()
  let rem = self.remaining()
  match self.read_u8() {
    Ok(b) =>
      if b == b'\x00' {
        Ok(false)
      } else if b == b'\x01' {
        Ok(true)
      } else {
        self.offset = field_start
        Err(CdrError::invalid_boolean(field_start, rem))
      }
    Err(e) => Err(e)
  }
}

///|
/// Decode a signed 8-bit integer as host `Int` in range `-128..127`.
pub fn CdrReader::read_i8(self : CdrReader) -> Result[Int, CdrError] {
  match self.read_u8() {
    Ok(b) => Ok(i8_from_byte(b))
    Err(e) => Err(e)
  }
}

///|
/// Decode a signed 16-bit integer as host `Int` in range `-32768..32767`.
pub fn CdrReader::read_i16(self : CdrReader) -> Result[Int, CdrError] {
  match self.read_u16() {
    Ok(bits) => Ok(Int16::reinterpret_from_uint16(bits).to_int())
    Err(e) => Err(e)
  }
}

///|
/// Decode a signed 32-bit integer as host `Int`.
pub fn CdrReader::read_i32(self : CdrReader) -> Result[Int, CdrError] {
  match self.read_u32() {
    Ok(bits) => Ok(bits.reinterpret_as_int())
    Err(e) => Err(e)
  }
}

///|
/// Decode a signed 64-bit integer as host `Int64`.
pub fn CdrReader::read_i64(self : CdrReader) -> Result[Int64, CdrError] {
  match self.read_u64() {
    Ok(bits) => Ok(bits.reinterpret_as_int64())
    Err(e) => Err(e)
  }
}

///|
/// Decode IEEE-754 binary32 as host `Float` (exact bit pattern).
pub fn CdrReader::read_f32(self : CdrReader) -> Result[Float, CdrError] {
  match self.read_u32() {
    Ok(bits) => Ok(Float::reinterpret_from_uint(bits))
    Err(e) => Err(e)
  }
}

///|
/// Decode IEEE-754 binary64 as host `Double` (exact bit pattern).
pub fn CdrReader::read_f64(self : CdrReader) -> Result[Double, CdrError] {
  match self.read_u64() {
    Ok(bits) => Ok(UInt64::reinterpret_as_double(bits))
    Err(e) => Err(e)
  }
}

///|
/// Decode CDR Char8 as a single octet.
pub fn CdrReader::read_char8(self : CdrReader) -> Result[Byte, CdrError] {
  self.read_u8()
}

///|
/// Decode CDR Char16 as a 16-bit code unit.
pub fn CdrReader::read_char16(self : CdrReader) -> Result[UInt16, CdrError] {
  self.read_u16()
}

// --- Writer ---

///|
/// Encode a CDR boolean as `0` or `1`.
pub fn CdrWriter::write_bool(
  self : CdrWriter,
  value : Bool,
) -> Result[Unit, CdrError] {
  if value {
    self.write_u8(b'\x01')
  } else {
    self.write_u8(b'\x00')
  }
}

///|
/// Encode a signed 8-bit integer from host `Int` (`-128..127`).
pub fn CdrWriter::write_i8(
  self : CdrWriter,
  value : Int,
) -> Result[Unit, CdrError] {
  if value < -128 || value > 127 {
    return Err(
      CdrError::bounds_exceeded(self.position(), 1, self.remaining_capacity()),
    )
  }
  self.write_u8(i8_to_byte(value))
}

///|
/// Encode a signed 16-bit integer from host `Int` (`-32768..32767`).
pub fn CdrWriter::write_i16(
  self : CdrWriter,
  value : Int,
) -> Result[Unit, CdrError] {
  if value < -32768 || value > 32767 {
    return Err(
      CdrError::bounds_exceeded(self.position(), 2, self.remaining_capacity()),
    )
  }
  let bits = Int16::from_int(value).reinterpret_as_uint16()
  self.write_u16(bits)
}

///|
/// Encode a signed 32-bit integer from host `Int`.
pub fn CdrWriter::write_i32(
  self : CdrWriter,
  value : Int,
) -> Result[Unit, CdrError] {
  self.write_u32(value.reinterpret_as_uint())
}

///|
/// Encode a signed 64-bit integer from host `Int64`.
pub fn CdrWriter::write_i64(
  self : CdrWriter,
  value : Int64,
) -> Result[Unit, CdrError] {
  self.write_u64(value.reinterpret_as_uint64())
}

///|
/// Encode IEEE-754 binary32 from host `Float` (exact bit pattern).
pub fn CdrWriter::write_f32(
  self : CdrWriter,
  value : Float,
) -> Result[Unit, CdrError] {
  self.write_u32(Float::reinterpret_as_uint(value))
}

///|
/// Encode IEEE-754 binary64 from host `Double` (exact bit pattern).
pub fn CdrWriter::write_f64(
  self : CdrWriter,
  value : Double,
) -> Result[Unit, CdrError] {
  self.write_u64(value.reinterpret_as_uint64())
}

///|
/// Encode CDR Char8 as a single octet.
pub fn CdrWriter::write_char8(
  self : CdrWriter,
  value : Byte,
) -> Result[Unit, CdrError] {
  self.write_u8(value)
}

///|
/// Encode CDR Char16 as a 16-bit code unit.
pub fn CdrWriter::write_char16(
  self : CdrWriter,
  value : UInt16,
) -> Result[Unit, CdrError] {
  self.write_u16(value)
}
