//! `rclweb_cdr_interfaces/srv/EchoNested_{Request,Response}`.

use super::nested_sample::{NestedSample, decode_nested_sample, encode_nested_sample};
use crate::cdr::{CdrEndian, CdrError, CdrReader, CdrWriter};

pub const REQUEST_TYPE_NAME: &str = "rclweb_cdr_interfaces/srv/EchoNested_Request";
pub const RESPONSE_TYPE_NAME: &str = "rclweb_cdr_interfaces/srv/EchoNested_Response";

#[derive(Debug, Clone, PartialEq)]
pub struct EchoNestedRequest {
  pub input: NestedSample,
}

#[derive(Debug, Clone, PartialEq)]
pub struct EchoNestedResponse {
  pub output: NestedSample,
  pub accepted: bool,
}

pub fn decode_request(bytes: &[u8], zero_tail_bytes: usize) -> Result<EchoNestedRequest, CdrError> {
  let mut r = CdrReader::open_default(bytes)?;
  let root = r.root_nesting();
  let input_n = r.enter_nested(root)?;
  let input = decode_nested_sample(&mut r, input_n)?;
  r.ensure_complete_with_zero_tail(zero_tail_bytes)?;
  Ok(EchoNestedRequest { input })
}

pub fn encode_request(v: &EchoNestedRequest, endian: CdrEndian) -> Result<Vec<u8>, CdrError> {
  let mut w = CdrWriter::new_default(endian)?;
  let root = w.root_nesting();
  let n = w.enter_nested(root)?;
  encode_nested_sample(&mut w, &v.input, n)?;
  Ok(w.to_bytes())
}

pub fn decode_response(
  bytes: &[u8],
  zero_tail_bytes: usize,
) -> Result<EchoNestedResponse, CdrError> {
  let mut r = CdrReader::open_default(bytes)?;
  let root = r.root_nesting();
  let output_n = r.enter_nested(root)?;
  let output = decode_nested_sample(&mut r, output_n)?;
  let accepted = r.read_bool()?;
  r.ensure_complete_with_zero_tail(zero_tail_bytes)?;
  Ok(EchoNestedResponse { output, accepted })
}

pub fn encode_response(v: &EchoNestedResponse, endian: CdrEndian) -> Result<Vec<u8>, CdrError> {
  let mut w = CdrWriter::new_default(endian)?;
  let root = w.root_nesting();
  let n = w.enter_nested(root)?;
  encode_nested_sample(&mut w, &v.output, n)?;
  w.write_bool(v.accepted)?;
  Ok(w.to_bytes())
}
