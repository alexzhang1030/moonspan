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
