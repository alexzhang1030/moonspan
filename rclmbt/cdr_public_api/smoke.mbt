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

///|
/// Compile-time binding: `CdrReader::read_wstring` returns owned `String`.
/// Optional `max_scalars` is the Unicode scalar / slot count bound.
pub fn require_read_wstring(
  reader : @cdr.CdrReader,
  max_scalars? : UInt,
) -> Result[String, @cdr.CdrError] {
  match max_scalars {
    Some(n) => reader.read_wstring(max_scalars=n)
    None => reader.read_wstring()
  }
}

///|
/// Compile-time binding: `CdrWriter::write_wstring` accepts `StringView`.
pub fn require_write_wstring(
  writer : @cdr.CdrWriter,
  value : StringView,
  max_scalars? : UInt,
) -> Result[Unit, @cdr.CdrError] {
  match max_scalars {
    Some(n) => writer.write_wstring(value, max_scalars=n)
    None => writer.write_wstring(value)
  }
}

///|
/// Compile-time binding: top-level declared zero-tail completion.
pub fn require_ensure_complete_with_zero_tail(
  reader : @cdr.CdrReader,
  expected_tail_bytes : Int,
) -> Result[Unit, @cdr.CdrError] {
  reader.ensure_complete_with_zero_tail(expected_tail_bytes)
}

///|
pub fn require_read_sequence_length(
  reader : @cdr.CdrReader,
  max_elements? : UInt,
) -> Result[Int, @cdr.CdrError] {
  match max_elements {
    Some(n) => reader.read_sequence_length(max_elements=n)
    None => reader.read_sequence_length()
  }
}

///|
pub fn require_write_sequence_length(
  writer : @cdr.CdrWriter,
  length : Int,
  max_elements? : UInt,
) -> Result[Unit, @cdr.CdrError] {
  match max_elements {
    Some(n) => writer.write_sequence_length(length, max_elements=n)
    None => writer.write_sequence_length(length)
  }
}

///|
pub fn require_read_byte_sequence(
  reader : @cdr.CdrReader,
  max_elements? : UInt,
) -> Result[BytesView, @cdr.CdrError] {
  match max_elements {
    Some(n) => reader.read_byte_sequence(max_elements=n)
    None => reader.read_byte_sequence()
  }
}

///|
pub fn require_write_byte_sequence(
  writer : @cdr.CdrWriter,
  value : BytesView,
  max_elements? : UInt,
) -> Result[Unit, @cdr.CdrError] {
  match max_elements {
    Some(n) => writer.write_byte_sequence(value, max_elements=n)
    None => writer.write_byte_sequence(value)
  }
}

///|
pub fn require_root_nesting_reader(reader : @cdr.CdrReader) -> @cdr.CdrNesting {
  reader.root_nesting()
}

///|
pub fn require_root_nesting_writer(writer : @cdr.CdrWriter) -> @cdr.CdrNesting {
  writer.root_nesting()
}

///|
pub fn require_enter_nested_reader(
  reader : @cdr.CdrReader,
  parent : @cdr.CdrNesting,
) -> Result[@cdr.CdrNesting, @cdr.CdrError] {
  reader.enter_nested(parent)
}

///|
pub fn require_enter_nested_writer(
  writer : @cdr.CdrWriter,
  parent : @cdr.CdrNesting,
) -> Result[@cdr.CdrNesting, @cdr.CdrError] {
  writer.enter_nested(parent)
}
