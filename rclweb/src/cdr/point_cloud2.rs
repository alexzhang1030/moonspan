//! `sensor_msgs/msg/PointCloud2` borrowed-view codec.
//!
//! Decoding is O(1) in the point payload: metadata is read field-by-field and
//! `data` is a bounds-checked borrowed span into the caller-retained CDR
//! buffer. The point bytes are never copied into a `Vec<u8>` and never
//! iterated by this codec (R2-02 / performance plan).

use super::error::CdrError;
use super::limits::CdrEndian;
use super::reader::{CdrNesting, CdrReader};
use super::writer::CdrWriter;

/// One `sensor_msgs/msg/PointField` entry (owned metadata; small).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PointField {
    pub name: String,
    pub offset: u32,
    pub datatype: u8,
    pub count: u32,
}

/// `std_msgs/msg/Header` (owned; small).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Header {
    pub stamp_sec: i32,
    pub stamp_nanosec: u32,
    pub frame_id: String,
}

/// Borrowed PointCloud2 view: metadata plus a zero-copy `data` span.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PointCloud2View<'a> {
    pub header: Header,
    pub height: u32,
    pub width: u32,
    pub fields: Vec<PointField>,
    pub is_bigendian: bool,
    pub point_step: u32,
    pub row_step: u32,
    /// Borrowed point payload — identity must stay inside the input buffer.
    pub data: &'a [u8],
    pub is_dense: bool,
}

/// Wire type name for PointCloud2 channels.
pub const SENSOR_MSGS_POINT_CLOUD2: &str = "sensor_msgs/msg/PointCloud2";

/// Decode PointCloud2 from an open CDR reader. `data` borrows from the reader input.
pub fn decode_point_cloud2<'a>(
    reader: &mut CdrReader<'a>,
) -> Result<PointCloud2View<'a>, CdrError> {
    let root = reader.root_nesting();
    decode_point_cloud2_nested(reader, root)
}

fn decode_point_cloud2_nested<'a>(
    reader: &mut CdrReader<'a>,
    parent: CdrNesting,
) -> Result<PointCloud2View<'a>, CdrError> {
    let header = decode_header(reader, parent)?;
    let height = reader.read_u32()?;
    let width = reader.read_u32()?;
    let field_count = reader.read_sequence_length(None)?;
    let mut fields = Vec::with_capacity(field_count as usize);
    for _ in 0..field_count {
        let _nest = reader.enter_nested(parent)?;
        fields.push(decode_point_field(reader)?);
    }
    let is_bigendian = reader.read_bool()?;
    let point_step = reader.read_u32()?;
    let row_step = reader.read_u32()?;
    let data = reader.read_byte_sequence(None)?;
    let is_dense = reader.read_bool()?;
    Ok(PointCloud2View {
        header,
        height,
        width,
        fields,
        is_bigendian,
        point_step,
        row_step,
        data,
        is_dense,
    })
}

/// Encode PointCloud2. Writes `view.data` by reference (no payload materialization).
pub fn encode_point_cloud2(
    writer: &mut CdrWriter,
    view: &PointCloud2View<'_>,
) -> Result<(), CdrError> {
    let root = writer.root_nesting();
    encode_point_cloud2_nested(writer, view, root)
}

fn encode_point_cloud2_nested(
    writer: &mut CdrWriter,
    view: &PointCloud2View<'_>,
    parent: CdrNesting,
) -> Result<(), CdrError> {
    encode_header(writer, &view.header, parent)?;
    writer.write_u32(view.height)?;
    writer.write_u32(view.width)?;
    writer.write_sequence_length(view.fields.len() as u32, None)?;
    for field in &view.fields {
        let _nest = writer.enter_nested(parent)?;
        encode_point_field(writer, field)?;
    }
    writer.write_bool(view.is_bigendian)?;
    writer.write_u32(view.point_step)?;
    writer.write_u32(view.row_step)?;
    writer.write_byte_sequence(view.data, None)?;
    writer.write_bool(view.is_dense)?;
    Ok(())
}

/// Open a little-endian CDR stream and decode PointCloud2.
pub fn decode_point_cloud2_le(bytes: &[u8]) -> Result<PointCloud2View<'_>, CdrError> {
    let mut reader = CdrReader::open_default(bytes)?;
    let view = decode_point_cloud2(&mut reader)?;
    reader.ensure_complete_with_zero_tail(0)?;
    Ok(view)
}

/// Encode a PointCloud2 view as little-endian CDR bytes (metadata + borrowed data write).
pub fn encode_point_cloud2_le(view: &PointCloud2View<'_>) -> Result<Vec<u8>, CdrError> {
    let mut writer = CdrWriter::new_default(CdrEndian::Little)?;
    encode_point_cloud2(&mut writer, view)?;
    Ok(writer.to_bytes())
}

fn decode_header(reader: &mut CdrReader<'_>, parent: CdrNesting) -> Result<Header, CdrError> {
    let current = reader.enter_nested(parent)?;
    let _time = reader.enter_nested(current)?;
    let stamp_sec = reader.read_i32()?;
    let stamp_nanosec = reader.read_u32()?;
    let frame_id = reader.read_string(None)?;
    Ok(Header { stamp_sec, stamp_nanosec, frame_id })
}

fn encode_header(
    writer: &mut CdrWriter,
    header: &Header,
    parent: CdrNesting,
) -> Result<(), CdrError> {
    let current = writer.enter_nested(parent)?;
    let _time = writer.enter_nested(current)?;
    writer.write_i32(header.stamp_sec)?;
    writer.write_u32(header.stamp_nanosec)?;
    writer.write_string(&header.frame_id, None)?;
    Ok(())
}

fn decode_point_field(reader: &mut CdrReader<'_>) -> Result<PointField, CdrError> {
    Ok(PointField {
        name: reader.read_string(None)?,
        offset: reader.read_u32()?,
        datatype: reader.read_u8()?,
        count: reader.read_u32()?,
    })
}

fn encode_point_field(writer: &mut CdrWriter, field: &PointField) -> Result<(), CdrError> {
    writer.write_string(&field.name, None)?;
    writer.write_u32(field.offset)?;
    writer.write_u8(field.datatype)?;
    writer.write_u32(field.count)?;
    Ok(())
}

/// Encode a synthetic XYZ float32 PointCloud2 CDR buffer with `point_count` points.
///
/// ~1 MiB point payload uses `87_381` points (`87381 * 12 = 1_048_572`).
pub fn build_synthetic_xyz_cdr(point_count: u32) -> Result<Vec<u8>, CdrError> {
    let point_step = 12u32;
    let row_step = point_step.saturating_mul(point_count);
    let data_len = row_step as usize;
    let mut data = vec![0u8; data_len];
    for i in 0..point_count as usize {
        let base = i * 12;
        let x = (i as f32) * 0.01;
        let y = (i as f32) * 0.02;
        let z = (i as f32) * 0.03;
        data[base..base + 4].copy_from_slice(&x.to_le_bytes());
        data[base + 4..base + 8].copy_from_slice(&y.to_le_bytes());
        data[base + 8..base + 12].copy_from_slice(&z.to_le_bytes());
    }
    let view = PointCloud2View {
        header: Header { stamp_sec: 1, stamp_nanosec: 2, frame_id: "map".into() },
        height: 1,
        width: point_count,
        fields: vec![
            PointField {
                name: "x".into(),
                offset: 0,
                datatype: 7, // FLOAT32
                count: 1,
            },
            PointField { name: "y".into(), offset: 4, datatype: 7, count: 1 },
            PointField { name: "z".into(), offset: 8, datatype: 7, count: 1 },
        ],
        is_bigendian: false,
        point_step,
        row_step,
        data: &data,
        is_dense: true,
    };
    encode_point_cloud2_le(&view)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cdr::limits::CdrLimits;
    use crate::cdr::reader::CdrReader;

    #[test]
    fn borrowed_data_stays_inside_input() {
        let cdr = build_synthetic_xyz_cdr(8).unwrap();
        let view = decode_point_cloud2_le(&cdr).unwrap();
        assert_eq!(view.width, 8);
        assert_eq!(view.data.len(), 96);
        let start = cdr.as_ptr() as usize;
        let end = start + cdr.len();
        let data_start = view.data.as_ptr() as usize;
        assert!(data_start >= start && data_start + view.data.len() <= end);
    }

    #[test]
    fn large_cloud_decode_is_o1_under_tiny_temp_budget() {
        // ~1 MiB point payload (87381 * 12 = 1_048_572).
        const POINTS: u32 = 87_381;
        let cdr = build_synthetic_xyz_cdr(POINTS).unwrap();
        assert!(cdr.len() > 1_000_000);
        // Temporary budget far below payload size — borrowed span must not allocate it.
        let limits = CdrLimits::new(cdr.len(), 8, 64).unwrap();
        let mut reader = CdrReader::open(&cdr, limits).unwrap();
        let view = decode_point_cloud2(&mut reader).unwrap();
        reader.ensure_complete_with_zero_tail(0).unwrap();
        assert_eq!(view.data.len(), POINTS as usize * 12);
        let start = cdr.as_ptr() as usize;
        let data_start = view.data.as_ptr() as usize;
        assert!(data_start >= start && data_start < start + cdr.len());
    }

    #[test]
    fn round_trip_preserves_payload_bytes() {
        let cdr = build_synthetic_xyz_cdr(32).unwrap();
        let view = decode_point_cloud2_le(&cdr).unwrap();
        let again = encode_point_cloud2_le(&view).unwrap();
        assert_eq!(cdr, again);
    }
}
