///|
/// Production surface that imports the CDR package so cross-package linkage is
/// exercised by `moon check` as well as black-box tests.
pub fn smoke_open_little_endian_header() -> Bool {
  match @cdr.CdrReader::open_default(b"\x00\x01\x00\x00"[:]) {
    Ok(r) => r.little_endian()
    Err(_) => false
  }
}
