//! Bounded CDR1 stream writer.

use super::error::CdrError;
use super::limits::{
    CdrEndian, CdrLimits, HEADER_LENGTH, WRITER_INITIAL_SIZE_HINT, checked_add_usize, padding_for,
    type_bound_ceiling, writer_capacity,
};
use super::reader::{CdrNesting, is_accepted_wstring_scalar};

/// Mutable CDR1 writer into an owned buffer.
#[derive(Debug)]
pub struct CdrWriter {
    buf: Vec<u8>,
    capacity: usize,
    limits: CdrLimits,
    endian: CdrEndian,
    representation: u16,
    options: u16,
}

impl CdrWriter {
    /// Construct a writer for `endian` with validated `limits`.
    /// Emits the full 4-byte canonical header immediately (options `0x0000`).
    pub fn new(endian: CdrEndian, limits: CdrLimits) -> Result<Self, CdrError> {
        limits.validate()?;
        let capacity = writer_capacity(limits);
        if capacity < HEADER_LENGTH {
            return Err(CdrError::bounds_exceeded(
                0,
                HEADER_LENGTH as u64,
                limits.max_temporary_allocation as u64,
            ));
        }
        let representation = endian.representation();
        let mut buf = Vec::with_capacity(WRITER_INITIAL_SIZE_HINT);
        if endian.is_little() {
            buf.extend_from_slice(&[0x00, 0x01, 0x00, 0x00]);
        } else {
            buf.extend_from_slice(&[0x00, 0x00, 0x00, 0x00]);
        }
        Ok(Self { buf, capacity, limits, endian, representation, options: 0 })
    }

    /// Construct with frozen default limits.
    pub fn new_default(endian: CdrEndian) -> Result<Self, CdrError> {
        Self::new(endian, CdrLimits::defaults())
    }

    /// Absolute write cursor — always `buf.len()` after a successful mutation.
    #[must_use]
    pub fn position(&self) -> usize {
        self.buf.len()
    }

    /// Bytes remaining until the logical capacity ceiling.
    #[must_use]
    pub fn remaining_capacity(&self) -> usize {
        self.capacity - self.buf.len()
    }

    /// Logical hard ceiling (bytes), including the header.
    #[must_use]
    pub fn capacity(&self) -> usize {
        self.capacity
    }

    /// Stream endianness.
    #[must_use]
    pub fn endian(&self) -> CdrEndian {
        self.endian
    }

    /// True when the stream is little endian.
    #[must_use]
    pub fn little_endian(&self) -> bool {
        self.endian.is_little()
    }

    /// Representation identifier (network-order UInt16 value).
    #[must_use]
    pub fn representation(&self) -> u16 {
        self.representation
    }

    /// Options field (always `0x0000` for the canonical writer).
    #[must_use]
    pub fn options(&self) -> u16 {
        self.options
    }

    /// Active resource limits.
    #[must_use]
    pub fn limits(&self) -> CdrLimits {
        self.limits
    }

    /// Owned snapshot of the stream so far. Later writes leave prior snapshots unchanged.
    #[must_use]
    pub fn to_bytes(&self) -> Vec<u8> {
        self.buf.clone()
    }

    /// Root nesting token at depth 0.
    #[must_use]
    pub fn root_nesting(&self) -> CdrNesting {
        let _ = self;
        CdrNesting::root()
    }

    /// Enter one nested aggregate under `parent`. Leaves position and bytes unchanged.
    pub fn enter_nested(&self, parent: CdrNesting) -> Result<CdrNesting, CdrError> {
        let next = parent.depth + 1;
        let max_d = self.limits.max_nesting_depth;
        if next > max_d {
            return Err(CdrError::bounds_exceeded(self.position(), next as u64, max_d as u64));
        }
        Ok(CdrNesting { depth: next })
    }

    fn align_and_reserve(&mut self, align: usize, size: usize) -> Result<(), CdrError> {
        let field_start = self.buf.len();
        let pad = padding_for(field_start, align);
        let rem_cap = self.remaining_capacity();
        let Some(needed) = checked_add_usize(pad, size) else {
            return Err(CdrError::length_overflow(field_start, 0, rem_cap as u64));
        };
        let Some(end) = checked_add_usize(field_start, needed) else {
            return Err(CdrError::length_overflow(field_start, 0, rem_cap as u64));
        };
        if end > self.capacity {
            return Err(CdrError::bounds_exceeded(field_start, needed as u64, rem_cap as u64));
        }
        // Mutate only after full preflight success.
        self.buf.resize(field_start + pad, 0);
        Ok(())
    }

    fn write_u32_raw(&mut self, value: u32) {
        if self.little_endian() {
            self.buf.extend_from_slice(&value.to_le_bytes());
        } else {
            self.buf.extend_from_slice(&value.to_be_bytes());
        }
    }

    /// Write one byte (alignment width 1).
    pub fn write_u8(&mut self, value: u8) -> Result<(), CdrError> {
        self.align_and_reserve(1, 1)?;
        self.buf.push(value);
        Ok(())
    }

    /// Write a 16-bit unsigned bit pattern (align 2).
    pub fn write_u16(&mut self, value: u16) -> Result<(), CdrError> {
        self.align_and_reserve(2, 2)?;
        if self.little_endian() {
            self.buf.extend_from_slice(&value.to_le_bytes());
        } else {
            self.buf.extend_from_slice(&value.to_be_bytes());
        }
        Ok(())
    }

    /// Write a 32-bit unsigned bit pattern (align 4).
    pub fn write_u32(&mut self, value: u32) -> Result<(), CdrError> {
        self.align_and_reserve(4, 4)?;
        self.write_u32_raw(value);
        Ok(())
    }

    /// Write a 64-bit unsigned bit pattern (align 8).
    pub fn write_u64(&mut self, value: u64) -> Result<(), CdrError> {
        self.align_and_reserve(8, 8)?;
        if self.little_endian() {
            self.buf.extend_from_slice(&value.to_le_bytes());
        } else {
            self.buf.extend_from_slice(&value.to_be_bytes());
        }
        Ok(())
    }

    /// Encode a CDR boolean as `0` or `1`.
    pub fn write_bool(&mut self, value: bool) -> Result<(), CdrError> {
        self.write_u8(u8::from(value))
    }

    /// Encode a signed 8-bit integer.
    pub fn write_i8(&mut self, value: i8) -> Result<(), CdrError> {
        self.write_u8(value as u8)
    }

    /// Encode a signed 16-bit integer.
    pub fn write_i16(&mut self, value: i16) -> Result<(), CdrError> {
        self.write_u16(value as u16)
    }

    /// Encode a signed 32-bit integer.
    pub fn write_i32(&mut self, value: i32) -> Result<(), CdrError> {
        self.write_u32(value as u32)
    }

    /// Encode a signed 64-bit integer.
    pub fn write_i64(&mut self, value: i64) -> Result<(), CdrError> {
        self.write_u64(value as u64)
    }

    /// Encode IEEE-754 binary32 (exact bit pattern).
    pub fn write_f32(&mut self, value: f32) -> Result<(), CdrError> {
        self.write_u32(value.to_bits())
    }

    /// Encode IEEE-754 binary64 (exact bit pattern).
    pub fn write_f64(&mut self, value: f64) -> Result<(), CdrError> {
        self.write_u64(value.to_bits())
    }

    /// Encode CDR Char8 as a single octet.
    pub fn write_char8(&mut self, value: u8) -> Result<(), CdrError> {
        self.write_u8(value)
    }

    /// Encode CDR Char16 as a 16-bit code unit.
    pub fn write_char16(&mut self, value: u16) -> Result<(), CdrError> {
        self.write_u16(value)
    }

    /// Copy bytes from `data` into the stream (alignment width 1).
    pub fn write_bytes(&mut self, data: &[u8]) -> Result<(), CdrError> {
        let n = data.len();
        self.align_and_reserve(1, n)?;
        self.buf.extend_from_slice(data);
        Ok(())
    }

    /// Encode a CDR1 UTF-8 Char8 string from `value`.
    ///
    /// `max_bytes`, when supplied, is the maximum UTF-8 payload byte count
    /// (excluding the required terminating NUL).
    pub fn write_string(&mut self, value: &str, max_bytes: Option<u32>) -> Result<(), CdrError> {
        let field_start = self.buf.len();
        let rem_cap = self.remaining_capacity();
        let pad = padding_for(field_start, 4);
        let payload_len = value.len();
        if let Some(bound) = type_bound_ceiling(max_bytes)
            && payload_len > bound
        {
            return Err(CdrError::bounds_exceeded(field_start, payload_len as u64, bound as u64));
        }
        let cap_max = max_payload_for_writer(field_start, rem_cap);
        if cap_max < 0 {
            if payload_len > 0 {
                return Err(capacity_bounds_error(field_start, rem_cap, pad, 1));
            }
        } else if payload_len > cap_max as usize {
            return Err(capacity_bounds_error(field_start, rem_cap, pad, (cap_max as usize) + 1));
        }
        let Some(wire_len) = checked_add_usize(payload_len, 1) else {
            return Err(CdrError::length_overflow(field_start, 0, rem_cap as u64));
        };
        let Some(body_size) = checked_add_usize(4, wire_len) else {
            return Err(CdrError::length_overflow(field_start, 0, rem_cap as u64));
        };
        self.align_and_reserve(4, body_size)?;
        let wire_u = u32::try_from(wire_len)
            .map_err(|_| CdrError::length_overflow(field_start, 0, rem_cap as u64))?;
        self.write_u32_raw(wire_u);
        self.buf.extend_from_slice(value.as_bytes());
        self.buf.push(0);
        Ok(())
    }

    /// Encode a ROS 2 legacy wstring from `value`.
    ///
    /// `max_scalars`, when supplied, is the maximum Unicode scalar / slot count.
    pub fn write_wstring(&mut self, value: &str, max_scalars: Option<u32>) -> Result<(), CdrError> {
        let field_start = self.buf.len();
        let rem_cap = self.remaining_capacity();
        let pad = padding_for(field_start, 4);
        let type_max = type_bound_ceiling(max_scalars);
        let cap_max = max_scalars_for_writer(field_start, rem_cap);
        let mut count = 0usize;
        for ch in value.chars() {
            let slot = u32::from(ch);
            if !is_accepted_wstring_scalar(slot) {
                return Err(CdrError::invalid_wstring_scalar(field_start, rem_cap as u64));
            }
            let next_count = count + 1;
            if let Some(t) = type_max
                && next_count > t
            {
                return Err(CdrError::bounds_exceeded(field_start, next_count as u64, t as u64));
            }
            if cap_max < 0 || next_count > cap_max as usize {
                let min_n = if cap_max < 0 { 1 } else { (cap_max as usize) + 1 };
                return Err(wstring_capacity_bounds_error(field_start, rem_cap, pad, min_n));
            }
            count = next_count;
        }
        let Some(payload) = count.checked_mul(4) else {
            return Err(CdrError::length_overflow(field_start, 0, rem_cap as u64));
        };
        let Some(body_size) = checked_add_usize(4, payload) else {
            return Err(CdrError::length_overflow(field_start, 0, rem_cap as u64));
        };
        self.align_and_reserve(4, body_size)?;
        let count_u = u32::try_from(count)
            .map_err(|_| CdrError::length_overflow(field_start, 0, rem_cap as u64))?;
        self.write_u32_raw(count_u);
        for ch in value.chars() {
            self.write_u32_raw(u32::from(ch));
        }
        Ok(())
    }

    /// Write an endian-aware aligned `UInt32` sequence element count.
    pub fn write_sequence_length(
        &mut self,
        length: u32,
        max_elements: Option<u32>,
    ) -> Result<(), CdrError> {
        let field_start = self.buf.len();
        if let Some(bound) = max_elements
            && length > bound
        {
            return Err(CdrError::bounds_exceeded(
                field_start,
                u64::from(length),
                u64::from(bound),
            ));
        }
        let max_stream = self.limits.max_stream_bytes;
        if (length as usize) > max_stream {
            return Err(CdrError::bounds_exceeded(
                field_start,
                u64::from(length),
                max_stream as u64,
            ));
        }
        self.align_and_reserve(4, 4)?;
        self.write_u32_raw(length);
        Ok(())
    }

    /// Write a CDR sequence of octets.
    pub fn write_byte_sequence(
        &mut self,
        value: &[u8],
        max_elements: Option<u32>,
    ) -> Result<(), CdrError> {
        let field_start = self.buf.len();
        let rem_cap = self.remaining_capacity();
        let n = value.len();
        if let Some(bound) = max_elements
            && n as u64 > u64::from(bound)
        {
            return Err(CdrError::bounds_exceeded(field_start, n as u64, u64::from(bound)));
        }
        let max_stream = self.limits.max_stream_bytes;
        if n > max_stream {
            return Err(CdrError::bounds_exceeded(field_start, n as u64, max_stream as u64));
        }
        let Some(body_size) = checked_add_usize(4, n) else {
            return Err(CdrError::length_overflow(field_start, 0, rem_cap as u64));
        };
        self.align_and_reserve(4, body_size)?;
        let n_u = u32::try_from(n)
            .map_err(|_| CdrError::length_overflow(field_start, 0, rem_cap as u64))?;
        self.write_u32_raw(n_u);
        self.buf.extend_from_slice(value);
        Ok(())
    }
}

/// Maximum UTF-8 payload bytes that fit the writer field. Returns `-1` when even
/// an empty string field exceeds remaining capacity.
fn max_payload_for_writer(field_start: usize, rem_cap: usize) -> isize {
    let pad = padding_for(field_start, 4);
    if rem_cap < pad {
        return -1;
    }
    let body_space = rem_cap - pad;
    if body_space < 5 {
        return -1;
    }
    (body_space - 5) as isize
}

fn capacity_bounds_error(
    field_start: usize,
    rem_cap: usize,
    pad: usize,
    min_payload: usize,
) -> CdrError {
    let Some(wire) = checked_add_usize(min_payload, 1) else {
        return CdrError::length_overflow(field_start, 0, rem_cap as u64);
    };
    let Some(body) = checked_add_usize(4, wire) else {
        return CdrError::length_overflow(field_start, 0, rem_cap as u64);
    };
    let Some(needed) = checked_add_usize(pad, body) else {
        return CdrError::length_overflow(field_start, 0, rem_cap as u64);
    };
    CdrError::bounds_exceeded(field_start, needed as u64, rem_cap as u64)
}

fn max_scalars_for_writer(field_start: usize, rem_cap: usize) -> isize {
    let pad = padding_for(field_start, 4);
    if rem_cap < pad {
        return -1;
    }
    let body_space = rem_cap - pad;
    if body_space < 4 {
        return -1;
    }
    ((body_space - 4) / 4) as isize
}

fn wstring_capacity_bounds_error(
    field_start: usize,
    rem_cap: usize,
    pad: usize,
    min_scalars: usize,
) -> CdrError {
    let Some(payload) = min_scalars.checked_mul(4) else {
        return CdrError::length_overflow(field_start, 0, rem_cap as u64);
    };
    let Some(body) = checked_add_usize(4, payload) else {
        return CdrError::length_overflow(field_start, 0, rem_cap as u64);
    };
    let Some(needed) = checked_add_usize(pad, body) else {
        return CdrError::length_overflow(field_start, 0, rem_cap as u64);
    };
    CdrError::bounds_exceeded(field_start, needed as u64, rem_cap as u64)
}
