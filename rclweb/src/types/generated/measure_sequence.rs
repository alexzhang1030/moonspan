//! `rclweb_cdr_interfaces/action/MeasureSequence_{Goal,Result,Feedback}`.

use super::collections::{Collections, decode_collections, encode_collections};
use super::nested_sample::{NestedSample, decode_nested_sample, encode_nested_sample};
use crate::cdr::{CdrEndian, CdrError, CdrReader, CdrWriter};

pub const GOAL_TYPE_NAME: &str = "rclweb_cdr_interfaces/action/MeasureSequence_Goal";
pub const RESULT_TYPE_NAME: &str = "rclweb_cdr_interfaces/action/MeasureSequence_Result";
pub const FEEDBACK_TYPE_NAME: &str = "rclweb_cdr_interfaces/action/MeasureSequence_Feedback";

#[derive(Debug, Clone, PartialEq)]
pub struct MeasureSequenceGoal {
  pub target: Collections,
}

#[derive(Debug, Clone, PartialEq)]
pub struct MeasureSequenceResult {
  pub result: NestedSample,
}

#[derive(Debug, Clone, PartialEq)]
pub struct MeasureSequenceFeedback {
  pub progress: f32,
  pub sample: NestedSample,
}

pub fn decode_goal(bytes: &[u8], zero_tail_bytes: usize) -> Result<MeasureSequenceGoal, CdrError> {
  let mut r = CdrReader::open_default(bytes)?;
  let root = r.root_nesting();
  let n = r.enter_nested(root)?;
  let target = decode_collections(&mut r, n)?;
  r.ensure_complete_with_zero_tail(zero_tail_bytes)?;
  Ok(MeasureSequenceGoal { target })
}

pub fn encode_goal(v: &MeasureSequenceGoal, endian: CdrEndian) -> Result<Vec<u8>, CdrError> {
  let mut w = CdrWriter::new_default(endian)?;
  let root = w.root_nesting();
  let n = w.enter_nested(root)?;
  encode_collections(&mut w, &v.target, n)?;
  Ok(w.to_bytes())
}

pub fn decode_result(
  bytes: &[u8],
  zero_tail_bytes: usize,
) -> Result<MeasureSequenceResult, CdrError> {
  let mut r = CdrReader::open_default(bytes)?;
  let root = r.root_nesting();
  let n = r.enter_nested(root)?;
  let result = decode_nested_sample(&mut r, n)?;
  r.ensure_complete_with_zero_tail(zero_tail_bytes)?;
  Ok(MeasureSequenceResult { result })
}

pub fn encode_result(v: &MeasureSequenceResult, endian: CdrEndian) -> Result<Vec<u8>, CdrError> {
  let mut w = CdrWriter::new_default(endian)?;
  let root = w.root_nesting();
  let n = w.enter_nested(root)?;
  encode_nested_sample(&mut w, &v.result, n)?;
  Ok(w.to_bytes())
}

pub fn decode_feedback(
  bytes: &[u8],
  zero_tail_bytes: usize,
) -> Result<MeasureSequenceFeedback, CdrError> {
  let mut r = CdrReader::open_default(bytes)?;
  let root = r.root_nesting();
  let progress = r.read_f32()?;
  let n = r.enter_nested(root)?;
  let sample = decode_nested_sample(&mut r, n)?;
  r.ensure_complete_with_zero_tail(zero_tail_bytes)?;
  Ok(MeasureSequenceFeedback { progress, sample })
}

pub fn encode_feedback(
  v: &MeasureSequenceFeedback,
  endian: CdrEndian,
) -> Result<Vec<u8>, CdrError> {
  let mut w = CdrWriter::new_default(endian)?;
  let root = w.root_nesting();
  w.write_f32(v.progress)?;
  let n = w.enter_nested(root)?;
  encode_nested_sample(&mut w, &v.sample, n)?;
  Ok(w.to_bytes())
}
