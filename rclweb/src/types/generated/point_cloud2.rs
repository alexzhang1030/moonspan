//! `sensor_msgs/msg/PointCloud2` — adapts the CDR borrowed-view codec.
//!
//! Prefer [`crate::cdr::point_cloud2`] for the low-level API; this module adds
//! top-level helpers that apply `ensure_complete_with_zero_tail`.

use crate::cdr::{
    CdrEndian, CdrError, CdrReader, CdrWriter, PointCloud2View, SENSOR_MSGS_POINT_CLOUD2,
    decode_point_cloud2 as cdr_decode, encode_point_cloud2 as cdr_encode,
};

pub const TYPE_NAME: &str = SENSOR_MSGS_POINT_CLOUD2;

pub use crate::cdr::{PointCloud2Header, PointCloud2View as PointCloud2, PointField};

/// Decode a top-level PointCloud2 sample; `data` borrows from `bytes`.
pub fn decode<'a>(
    bytes: &'a [u8],
    zero_tail_bytes: usize,
) -> Result<PointCloud2View<'a>, CdrError> {
    let mut r = CdrReader::open_default(bytes)?;
    let view = cdr_decode(&mut r)?;
    r.ensure_complete_with_zero_tail(zero_tail_bytes)?;
    Ok(view)
}

/// Exact canonical encode (zero top-level tail).
pub fn encode(view: &PointCloud2View<'_>, endian: CdrEndian) -> Result<Vec<u8>, CdrError> {
    let mut w = CdrWriter::new_default(endian)?;
    cdr_encode(&mut w, view)?;
    Ok(w.to_bytes())
}
