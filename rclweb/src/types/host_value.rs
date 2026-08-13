//! Packed little-endian host layout for Phase 1 generated message types.
//!
//! The TypeScript SDK and the wasm poll ABI share this layout. It is not CDR:
//! the engine converts it to and from CDR with the generated codecs. Point
//! payloads stay on the PointCloud2 command; these types are small.

use super::generated::{
  COLLECTIONS_TYPE_NAME, Collections, NESTED_SAMPLE_TYPE_NAME, NestedSample,
  PRIMITIVE_SCALARS_TYPE_NAME, PrimitiveScalars, Time, collections, nested_sample,
  primitive_scalars,
};
use crate::cdr::{CdrEndian, CdrError, CdrNesting, CdrReader};

#[derive(Debug, Clone, PartialEq)]
pub enum GeneratedMessage {
  PrimitiveScalars(PrimitiveScalars),
  Collections(Collections),
  NestedSample(NestedSample),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GeneratedValueError {
  Truncated,
  UnknownType,
  Cdr,
}

impl GeneratedMessage {
  pub fn type_name(&self) -> &'static str {
    match self {
      Self::PrimitiveScalars(_) => PRIMITIVE_SCALARS_TYPE_NAME,
      Self::Collections(_) => COLLECTIONS_TYPE_NAME,
      Self::NestedSample(_) => NESTED_SAMPLE_TYPE_NAME,
    }
  }
}

pub fn is_generated_msg_type(type_name: &str) -> bool {
  matches!(type_name, PRIMITIVE_SCALARS_TYPE_NAME | COLLECTIONS_TYPE_NAME | NESTED_SAMPLE_TYPE_NAME)
}

/// CDR → generated model for a live sample (0 / 4 / 12 zero-tail).
pub fn decode_generated_cdr(
  type_name: &str,
  bytes: &[u8],
) -> Result<GeneratedMessage, GeneratedValueError> {
  match type_name {
    PRIMITIVE_SCALARS_TYPE_NAME => Ok(GeneratedMessage::PrimitiveScalars(decode_live(
      bytes,
      primitive_scalars::decode_primitive_scalars,
    )?)),
    COLLECTIONS_TYPE_NAME => {
      Ok(GeneratedMessage::Collections(decode_live(bytes, collections::decode_collections)?))
    }
    NESTED_SAMPLE_TYPE_NAME => {
      Ok(GeneratedMessage::NestedSample(decode_live(bytes, nested_sample::decode_nested_sample)?))
    }
    _ => Err(GeneratedValueError::UnknownType),
  }
}

/// Generated model → little-endian CDR (canonical zero tail).
pub fn encode_generated_cdr(msg: &GeneratedMessage) -> Result<Vec<u8>, CdrError> {
  match msg {
    GeneratedMessage::PrimitiveScalars(v) => primitive_scalars::encode(v, CdrEndian::Little),
    GeneratedMessage::Collections(v) => collections::encode(v, CdrEndian::Little),
    GeneratedMessage::NestedSample(v) => nested_sample::encode(v, CdrEndian::Little),
  }
}

pub fn encode_host_value(msg: &GeneratedMessage) -> Vec<u8> {
  let mut out = Vec::new();
  match msg {
    GeneratedMessage::PrimitiveScalars(v) => write_primitive_scalars(&mut out, v),
    GeneratedMessage::Collections(v) => write_collections(&mut out, v),
    GeneratedMessage::NestedSample(v) => write_nested_sample(&mut out, v),
  }
  out
}

pub fn decode_host_value(
  type_name: &str,
  bytes: &[u8],
) -> Result<GeneratedMessage, GeneratedValueError> {
  let mut offset = 0usize;
  let msg = match type_name {
    PRIMITIVE_SCALARS_TYPE_NAME => {
      GeneratedMessage::PrimitiveScalars(read_primitive_scalars(bytes, &mut offset)?)
    }
    COLLECTIONS_TYPE_NAME => GeneratedMessage::Collections(read_collections(bytes, &mut offset)?),
    NESTED_SAMPLE_TYPE_NAME => {
      GeneratedMessage::NestedSample(read_nested_sample(bytes, &mut offset)?)
    }
    _ => return Err(GeneratedValueError::UnknownType),
  };
  if offset != bytes.len() {
    return Err(GeneratedValueError::Truncated);
  }
  Ok(msg)
}

fn decode_live<T>(
  bytes: &[u8],
  body: impl Fn(&mut CdrReader<'_>, CdrNesting) -> Result<T, CdrError>,
) -> Result<T, GeneratedValueError> {
  let mut r = CdrReader::open_default(bytes).map_err(|_| GeneratedValueError::Cdr)?;
  let root = r.root_nesting();
  let v = body(&mut r, root).map_err(|_| GeneratedValueError::Cdr)?;
  let rem = r.remaining();
  let tail = if rem == 0 || rem == 4 || rem == 12 { rem } else { 0 };
  r.ensure_complete_with_zero_tail(tail).map_err(|_| GeneratedValueError::Cdr)?;
  Ok(v)
}

fn write_primitive_scalars(out: &mut Vec<u8>, v: &PrimitiveScalars) {
  out.push(u8::from(v.bool_value));
  out.push(v.byte_value);
  out.push(v.char_value);
  out.extend_from_slice(&v.float32_value.to_le_bytes());
  out.extend_from_slice(&v.float64_value.to_le_bytes());
  out.push(v.int8_value as u8);
  out.push(v.uint8_value);
  out.extend_from_slice(&v.int16_value.to_le_bytes());
  out.extend_from_slice(&v.uint16_value.to_le_bytes());
  out.extend_from_slice(&v.int32_value.to_le_bytes());
  out.extend_from_slice(&v.uint32_value.to_le_bytes());
  out.extend_from_slice(&v.int64_value.to_le_bytes());
  out.extend_from_slice(&v.uint64_value.to_le_bytes());
  write_u16_str(out, &v.string_value);
  write_u16_str(out, &v.wstring_value);
}

fn read_primitive_scalars(
  bytes: &[u8],
  offset: &mut usize,
) -> Result<PrimitiveScalars, GeneratedValueError> {
  if *offset + 45 > bytes.len() {
    return Err(GeneratedValueError::Truncated);
  }
  let bool_value = bytes[*offset] != 0;
  *offset += 1;
  let byte_value = bytes[*offset];
  *offset += 1;
  let char_value = bytes[*offset];
  *offset += 1;
  let float32_value = f32::from_le_bytes(bytes[*offset..*offset + 4].try_into().unwrap());
  *offset += 4;
  let float64_value = f64::from_le_bytes(bytes[*offset..*offset + 8].try_into().unwrap());
  *offset += 8;
  let int8_value = bytes[*offset] as i8;
  *offset += 1;
  let uint8_value = bytes[*offset];
  *offset += 1;
  let int16_value = i16::from_le_bytes(bytes[*offset..*offset + 2].try_into().unwrap());
  *offset += 2;
  let uint16_value = u16::from_le_bytes(bytes[*offset..*offset + 2].try_into().unwrap());
  *offset += 2;
  let int32_value = i32::from_le_bytes(bytes[*offset..*offset + 4].try_into().unwrap());
  *offset += 4;
  let uint32_value = u32::from_le_bytes(bytes[*offset..*offset + 4].try_into().unwrap());
  *offset += 4;
  let int64_value = i64::from_le_bytes(bytes[*offset..*offset + 8].try_into().unwrap());
  *offset += 8;
  let uint64_value = u64::from_le_bytes(bytes[*offset..*offset + 8].try_into().unwrap());
  *offset += 8;
  let string_value = read_u16_str(bytes, offset)?;
  let wstring_value = read_u16_str(bytes, offset)?;
  Ok(PrimitiveScalars {
    bool_value,
    byte_value,
    char_value,
    float32_value,
    float64_value,
    int8_value,
    uint8_value,
    int16_value,
    uint16_value,
    int32_value,
    uint32_value,
    int64_value,
    uint64_value,
    string_value,
    wstring_value,
  })
}

fn write_collections(out: &mut Vec<u8>, v: &Collections) {
  for x in v.fixed_i32 {
    out.extend_from_slice(&x.to_le_bytes());
  }
  write_u32(out, v.bounded_f64.len() as u32);
  for x in &v.bounded_f64 {
    out.extend_from_slice(&x.to_le_bytes());
  }
  write_u32(out, v.bytes_value.len() as u32);
  out.extend_from_slice(&v.bytes_value);
  write_u16_str(out, &v.bounded_string);
  write_u16_str(out, &v.bounded_wstring);
}

fn read_collections(bytes: &[u8], offset: &mut usize) -> Result<Collections, GeneratedValueError> {
  if *offset + 12 > bytes.len() {
    return Err(GeneratedValueError::Truncated);
  }
  let mut fixed_i32 = [0i32; 3];
  for slot in &mut fixed_i32 {
    *slot = i32::from_le_bytes(bytes[*offset..*offset + 4].try_into().unwrap());
    *offset += 4;
  }
  let f64_len = read_u32(bytes, offset)? as usize;
  if *offset + f64_len.saturating_mul(8) > bytes.len() {
    return Err(GeneratedValueError::Truncated);
  }
  let mut bounded_f64 = Vec::with_capacity(f64_len);
  for _ in 0..f64_len {
    bounded_f64.push(f64::from_le_bytes(bytes[*offset..*offset + 8].try_into().unwrap()));
    *offset += 8;
  }
  let bytes_len = read_u32(bytes, offset)? as usize;
  if *offset + bytes_len > bytes.len() {
    return Err(GeneratedValueError::Truncated);
  }
  let bytes_value = bytes[*offset..*offset + bytes_len].to_vec();
  *offset += bytes_len;
  let bounded_string = read_u16_str(bytes, offset)?;
  let bounded_wstring = read_u16_str(bytes, offset)?;
  Ok(Collections { fixed_i32, bounded_f64, bytes_value, bounded_string, bounded_wstring })
}

fn write_nested_sample(out: &mut Vec<u8>, v: &NestedSample) {
  out.extend_from_slice(&v.stamp.sec.to_le_bytes());
  out.extend_from_slice(&v.stamp.nanosec.to_le_bytes());
  write_primitive_scalars(out, &v.scalars);
  write_collections(out, &v.collections);
}

fn read_nested_sample(
  bytes: &[u8],
  offset: &mut usize,
) -> Result<NestedSample, GeneratedValueError> {
  if *offset + 8 > bytes.len() {
    return Err(GeneratedValueError::Truncated);
  }
  let sec = i32::from_le_bytes(bytes[*offset..*offset + 4].try_into().unwrap());
  *offset += 4;
  let nanosec = u32::from_le_bytes(bytes[*offset..*offset + 4].try_into().unwrap());
  *offset += 4;
  let scalars = read_primitive_scalars(bytes, offset)?;
  let collections = read_collections(bytes, offset)?;
  Ok(NestedSample { stamp: Time { sec, nanosec }, scalars, collections })
}

fn write_u16_str(out: &mut Vec<u8>, value: &str) {
  let bytes = value.as_bytes();
  write_u16(out, bytes.len() as u16);
  out.extend_from_slice(bytes);
}

fn read_u16_str(bytes: &[u8], offset: &mut usize) -> Result<String, GeneratedValueError> {
  let len = read_u16(bytes, offset)? as usize;
  if *offset + len > bytes.len() {
    return Err(GeneratedValueError::Truncated);
  }
  let s = std::str::from_utf8(&bytes[*offset..*offset + len])
    .map_err(|_| GeneratedValueError::Truncated)?;
  *offset += len;
  Ok(s.to_owned())
}

fn write_u16(out: &mut Vec<u8>, value: u16) {
  out.extend_from_slice(&value.to_le_bytes());
}

fn write_u32(out: &mut Vec<u8>, value: u32) {
  out.extend_from_slice(&value.to_le_bytes());
}

fn read_u16(bytes: &[u8], offset: &mut usize) -> Result<u16, GeneratedValueError> {
  if *offset + 2 > bytes.len() {
    return Err(GeneratedValueError::Truncated);
  }
  let v = u16::from_le_bytes(bytes[*offset..*offset + 2].try_into().unwrap());
  *offset += 2;
  Ok(v)
}

fn read_u32(bytes: &[u8], offset: &mut usize) -> Result<u32, GeneratedValueError> {
  if *offset + 4 > bytes.len() {
    return Err(GeneratedValueError::Truncated);
  }
  let v = u32::from_le_bytes(bytes[*offset..*offset + 4].try_into().unwrap());
  *offset += 4;
  Ok(v)
}

fn sample_scalars() -> PrimitiveScalars {
  PrimitiveScalars {
    bool_value: true,
    byte_value: 7,
    char_value: 65,
    float32_value: 1.5,
    float64_value: 2.25,
    int8_value: -3,
    uint8_value: 9,
    int16_value: -300,
    uint16_value: 400,
    int32_value: -50_000,
    uint32_value: 60_000,
    int64_value: -70_000,
    uint64_value: 80_000,
    string_value: "hello-scalars".into(),
    wstring_value: "wide".into(),
  }
}

fn sample_collections() -> Collections {
  Collections {
    fixed_i32: [1, 2, 3],
    bounded_f64: vec![1.0, 2.0],
    bytes_value: vec![10, 20, 30],
    bounded_string: "abc".into(),
    bounded_wstring: "xyz".into(),
  }
}

pub fn sample_primitive_scalars() -> PrimitiveScalars {
  sample_scalars()
}

pub fn sample_nested_sample() -> NestedSample {
  NestedSample {
    stamp: Time { sec: 11, nanosec: 22 },
    scalars: sample_scalars(),
    collections: sample_collections(),
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn host_value_round_trips_primitive_scalars() {
    let msg = GeneratedMessage::PrimitiveScalars(sample_scalars());
    let bytes = encode_host_value(&msg);
    let round = decode_host_value(PRIMITIVE_SCALARS_TYPE_NAME, &bytes).unwrap();
    assert_eq!(round, msg);
  }

  #[test]
  fn host_value_round_trips_nested_sample() {
    let msg = GeneratedMessage::NestedSample(NestedSample {
      stamp: Time { sec: 11, nanosec: 22 },
      scalars: sample_scalars(),
      collections: sample_collections(),
    });
    let bytes = encode_host_value(&msg);
    let round = decode_host_value(NESTED_SAMPLE_TYPE_NAME, &bytes).unwrap();
    assert_eq!(round, msg);
  }

  #[test]
  fn cdr_and_host_value_agree() {
    let original = sample_scalars();
    let cdr = primitive_scalars::encode(&original, CdrEndian::Little).unwrap();
    let decoded = decode_generated_cdr(PRIMITIVE_SCALARS_TYPE_NAME, &cdr).unwrap();
    let GeneratedMessage::PrimitiveScalars(got) = decoded else { panic!("kind") };
    assert_eq!(got, original);
    let again = encode_generated_cdr(&GeneratedMessage::PrimitiveScalars(got.clone())).unwrap();
    assert_eq!(again, cdr);
  }
}
