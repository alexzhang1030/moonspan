//! `rclweb_cdr_interfaces/msg/NestedSample`.

use super::collections::{Collections, decode_collections, encode_collections};
use super::primitive_scalars::{
  PrimitiveScalars, decode_primitive_scalars, encode_primitive_scalars,
};
use super::time::{Time, decode_time, encode_time};
use crate::cdr::{CdrEndian, CdrError, CdrNesting, CdrReader, CdrWriter};

pub const TYPE_NAME: &str = "rclweb_cdr_interfaces/msg/NestedSample";

#[derive(Debug, Clone, PartialEq)]
pub struct NestedSample {
  pub stamp: Time,
  pub scalars: PrimitiveScalars,
  pub collections: Collections,
}

pub fn decode_nested_sample(
  r: &mut CdrReader<'_>,
  current: CdrNesting,
) -> Result<NestedSample, CdrError> {
  let time_n = r.enter_nested(current)?;
  let stamp = decode_time(r, time_n)?;
  let scalars_n = r.enter_nested(current)?;
  let scalars = decode_primitive_scalars(r, scalars_n)?;
  let coll_n = r.enter_nested(current)?;
  let collections = decode_collections(r, coll_n)?;
  Ok(NestedSample { stamp, scalars, collections })
}

pub fn encode_nested_sample(
  w: &mut CdrWriter,
  v: &NestedSample,
  current: CdrNesting,
) -> Result<(), CdrError> {
  let time_n = w.enter_nested(current)?;
  encode_time(w, &v.stamp, time_n)?;
  let scalars_n = w.enter_nested(current)?;
  encode_primitive_scalars(w, &v.scalars, scalars_n)?;
  let coll_n = w.enter_nested(current)?;
  encode_collections(w, &v.collections, coll_n)?;
  Ok(())
}

pub fn decode(bytes: &[u8], zero_tail_bytes: usize) -> Result<NestedSample, CdrError> {
  let mut r = CdrReader::open_default(bytes)?;
  let root = r.root_nesting();
  let v = decode_nested_sample(&mut r, root)?;
  r.ensure_complete_with_zero_tail(zero_tail_bytes)?;
  Ok(v)
}

pub fn encode(v: &NestedSample, endian: CdrEndian) -> Result<Vec<u8>, CdrError> {
  let mut w = CdrWriter::new_default(endian)?;
  let root = w.root_nesting();
  encode_nested_sample(&mut w, v, root)?;
  Ok(w.to_bytes())
}
