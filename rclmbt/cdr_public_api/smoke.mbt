///|
/// Production surface that imports the CDR package so cross-package linkage is
/// exercised by `moon check` as well as black-box tests.
pub fn smoke_open_little_endian_header() -> Bool {
  match @cdr.CdrReader::open_default(b"\x00\x01\x00\x00"[:]) {
    Ok(r) => r.little_endian()
    Err(_) => false
  }
}

///|
/// Compile-time binding: `CdrReader::read_u16` returns width-exact `UInt16`.
pub fn require_read_u16(
  reader : @cdr.CdrReader,
) -> Result[UInt16, @cdr.CdrError] {
  reader.read_u16()
}

///|
/// Compile-time binding: `CdrReader::read_u32` returns width-exact `UInt`.
pub fn require_read_u32(reader : @cdr.CdrReader) -> Result[UInt, @cdr.CdrError] {
  reader.read_u32()
}

///|
/// Compile-time binding: `CdrReader::read_u64` returns width-exact `UInt64`.
pub fn require_read_u64(
  reader : @cdr.CdrReader,
) -> Result[UInt64, @cdr.CdrError] {
  reader.read_u64()
}

///|
pub fn require_read_bool(
  reader : @cdr.CdrReader,
) -> Result[Bool, @cdr.CdrError] {
  reader.read_bool()
}

///|
pub fn require_read_i8(reader : @cdr.CdrReader) -> Result[Int, @cdr.CdrError] {
  reader.read_i8()
}

///|
pub fn require_read_i16(reader : @cdr.CdrReader) -> Result[Int, @cdr.CdrError] {
  reader.read_i16()
}

///|
pub fn require_read_i32(reader : @cdr.CdrReader) -> Result[Int, @cdr.CdrError] {
  reader.read_i32()
}

///|
pub fn require_read_i64(
  reader : @cdr.CdrReader,
) -> Result[Int64, @cdr.CdrError] {
  reader.read_i64()
}

///|
pub fn require_read_f32(
  reader : @cdr.CdrReader,
) -> Result[Float, @cdr.CdrError] {
  reader.read_f32()
}

///|
pub fn require_read_f64(
  reader : @cdr.CdrReader,
) -> Result[Double, @cdr.CdrError] {
  reader.read_f64()
}

///|
pub fn require_read_char8(
  reader : @cdr.CdrReader,
) -> Result[Byte, @cdr.CdrError] {
  reader.read_char8()
}

///|
pub fn require_read_char16(
  reader : @cdr.CdrReader,
) -> Result[UInt16, @cdr.CdrError] {
  reader.read_char16()
}

///|
pub fn require_write_bool(
  writer : @cdr.CdrWriter,
  value : Bool,
) -> Result[Unit, @cdr.CdrError] {
  writer.write_bool(value)
}

///|
pub fn require_write_i8(
  writer : @cdr.CdrWriter,
  value : Int,
) -> Result[Unit, @cdr.CdrError] {
  writer.write_i8(value)
}

///|
pub fn require_write_i16(
  writer : @cdr.CdrWriter,
  value : Int,
) -> Result[Unit, @cdr.CdrError] {
  writer.write_i16(value)
}

///|
pub fn require_write_i32(
  writer : @cdr.CdrWriter,
  value : Int,
) -> Result[Unit, @cdr.CdrError] {
  writer.write_i32(value)
}

///|
pub fn require_write_i64(
  writer : @cdr.CdrWriter,
  value : Int64,
) -> Result[Unit, @cdr.CdrError] {
  writer.write_i64(value)
}

///|
pub fn require_write_f32(
  writer : @cdr.CdrWriter,
  value : Float,
) -> Result[Unit, @cdr.CdrError] {
  writer.write_f32(value)
}

///|
pub fn require_write_f64(
  writer : @cdr.CdrWriter,
  value : Double,
) -> Result[Unit, @cdr.CdrError] {
  writer.write_f64(value)
}

///|
pub fn require_write_char8(
  writer : @cdr.CdrWriter,
  value : Byte,
) -> Result[Unit, @cdr.CdrError] {
  writer.write_char8(value)
}

///|
pub fn require_write_char16(
  writer : @cdr.CdrWriter,
  value : UInt16,
) -> Result[Unit, @cdr.CdrError] {
  writer.write_char16(value)
}

///|
/// Compile-time binding: `CdrReader::read_string` returns owned `String`.
/// Optional `max_bytes` counts UTF-8 payload bytes only; the terminating NUL
/// is outside that bound.
pub fn require_read_string(
  reader : @cdr.CdrReader,
  max_bytes? : UInt,
) -> Result[String, @cdr.CdrError] {
  match max_bytes {
    Some(n) => reader.read_string(max_bytes=n)
    None => reader.read_string()
  }
}

///|
/// Compile-time binding: `CdrWriter::write_string` accepts `StringView`.
/// Optional `max_bytes` counts UTF-8 payload bytes only; the terminating NUL
/// is outside that bound.
pub fn require_write_string(
  writer : @cdr.CdrWriter,
  value : StringView,
  max_bytes? : UInt,
) -> Result[Unit, @cdr.CdrError] {
  match max_bytes {
    Some(n) => writer.write_string(value, max_bytes=n)
    None => writer.write_string(value)
  }
}
