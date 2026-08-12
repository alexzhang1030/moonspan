//! `moonspan_cdr_interfaces/msg/Collections`.

use crate::cdr::{CdrEndian, CdrError, CdrNesting, CdrReader, CdrWriter};

pub const TYPE_NAME: &str = "moonspan_cdr_interfaces/msg/Collections";

#[derive(Debug, Clone, PartialEq)]
pub struct Collections {
    pub fixed_i32: [i32; 3],
    pub bounded_f64: Vec<f64>,
    pub bytes_value: Vec<u8>,
    pub bounded_string: String,
    pub bounded_wstring: String,
}

pub fn decode_collections(r: &mut CdrReader<'_>, _n: CdrNesting) -> Result<Collections, CdrError> {
    let mut fixed_i32 = [0i32; 3];
    for slot in &mut fixed_i32 {
        *slot = r.read_i32()?;
    }
    let f64_count = r.read_sequence_length(Some(4))?;
    let mut bounded_f64 = Vec::with_capacity(f64_count as usize);
    for _ in 0..f64_count {
        bounded_f64.push(r.read_f64()?);
    }
    let bytes_value = r.read_byte_sequence(None)?.to_vec();
    let bounded_string = r.read_string(Some(16))?;
    let bounded_wstring = r.read_wstring(Some(16))?;
    Ok(Collections {
        fixed_i32,
        bounded_f64,
        bytes_value,
        bounded_string,
        bounded_wstring,
    })
}

pub fn encode_collections(
    w: &mut CdrWriter,
    v: &Collections,
    _n: CdrNesting,
) -> Result<(), CdrError> {
    for x in v.fixed_i32 {
        w.write_i32(x)?;
    }
    w.write_sequence_length(v.bounded_f64.len() as u32, Some(4))?;
    for x in &v.bounded_f64 {
        w.write_f64(*x)?;
    }
    w.write_byte_sequence(&v.bytes_value, None)?;
    w.write_string(&v.bounded_string, Some(16))?;
    w.write_wstring(&v.bounded_wstring, Some(16))?;
    Ok(())
}

pub fn decode(bytes: &[u8], zero_tail_bytes: usize) -> Result<Collections, CdrError> {
    let mut r = CdrReader::open_default(bytes)?;
    let root = r.root_nesting();
    let v = decode_collections(&mut r, root)?;
    r.ensure_complete_with_zero_tail(zero_tail_bytes)?;
    Ok(v)
}

pub fn encode(v: &Collections, endian: CdrEndian) -> Result<Vec<u8>, CdrError> {
    let mut w = CdrWriter::new_default(endian)?;
    let root = w.root_nesting();
    encode_collections(&mut w, v, root)?;
    Ok(w.to_bytes())
}
