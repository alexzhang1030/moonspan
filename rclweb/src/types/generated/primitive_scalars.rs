//! `moonspan_cdr_interfaces/msg/PrimitiveScalars`.

use crate::cdr::{CdrEndian, CdrError, CdrNesting, CdrReader, CdrWriter};

/// Fully qualified ROS type name.
pub const TYPE_NAME: &str = "moonspan_cdr_interfaces/msg/PrimitiveScalars";

#[derive(Debug, Clone, PartialEq)]
pub struct PrimitiveScalars {
  pub bool_value: bool,
  pub byte_value: u8,
  pub char_value: u8,
  pub float32_value: f32,
  pub float64_value: f64,
  pub int8_value: i8,
  pub uint8_value: u8,
  pub int16_value: i16,
  pub uint16_value: u16,
  pub int32_value: i32,
  pub uint32_value: u32,
  pub int64_value: i64,
  pub uint64_value: u64,
  pub string_value: String,
  pub wstring_value: String,
}

pub fn decode_primitive_scalars(
  r: &mut CdrReader<'_>,
  _n: CdrNesting,
) -> Result<PrimitiveScalars, CdrError> {
  Ok(PrimitiveScalars {
    bool_value: r.read_bool()?,
    byte_value: r.read_u8()?,
    char_value: r.read_u8()?,
    float32_value: r.read_f32()?,
    float64_value: r.read_f64()?,
    int8_value: r.read_i8()?,
    uint8_value: r.read_u8()?,
    int16_value: r.read_i16()?,
    uint16_value: r.read_u16()?,
    int32_value: r.read_i32()?,
    uint32_value: r.read_u32()?,
    int64_value: r.read_i64()?,
    uint64_value: r.read_u64()?,
    string_value: r.read_string(None)?,
    wstring_value: r.read_wstring(None)?,
  })
}

pub fn encode_primitive_scalars(
  w: &mut CdrWriter,
  v: &PrimitiveScalars,
  _n: CdrNesting,
) -> Result<(), CdrError> {
  w.write_bool(v.bool_value)?;
  w.write_u8(v.byte_value)?;
  w.write_u8(v.char_value)?;
  w.write_f32(v.float32_value)?;
  w.write_f64(v.float64_value)?;
  w.write_i8(v.int8_value)?;
  w.write_u8(v.uint8_value)?;
  w.write_i16(v.int16_value)?;
  w.write_u16(v.uint16_value)?;
  w.write_i32(v.int32_value)?;
  w.write_u32(v.uint32_value)?;
  w.write_i64(v.int64_value)?;
  w.write_u64(v.uint64_value)?;
  w.write_string(&v.string_value, None)?;
  w.write_wstring(&v.wstring_value, None)?;
  Ok(())
}

/// Decode a top-level sample and require the declared zero-tail.
pub fn decode(bytes: &[u8], zero_tail_bytes: usize) -> Result<PrimitiveScalars, CdrError> {
  let mut r = CdrReader::open_default(bytes)?;
  let root = r.root_nesting();
  let v = decode_primitive_scalars(&mut r, root)?;
  r.ensure_complete_with_zero_tail(zero_tail_bytes)?;
  Ok(v)
}

/// Exact canonical encode (zero top-level tail).
pub fn encode(v: &PrimitiveScalars, endian: CdrEndian) -> Result<Vec<u8>, CdrError> {
  let mut w = CdrWriter::new_default(endian)?;
  let root = w.root_nesting();
  encode_primitive_scalars(&mut w, v, root)?;
  Ok(w.to_bytes())
}
