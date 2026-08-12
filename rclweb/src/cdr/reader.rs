//! Bounded CDR1 stream reader.

use super::error::{CdrError, size_field_u64};
use super::limits::{
    BODY_ORIGIN, CdrEndian, CdrLimits, HEADER_LENGTH, REPRESENTATION_CDR_BE, REPRESENTATION_CDR_LE,
    checked_add_usize, padding_for,
};
/// Parsed encapsulation header.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CdrHeader {
    /// Representation identifier as network-order UInt16 (`0x0000` BE, `0x0001` LE).
    pub representation: u16,
    /// Options field as network-order UInt16. Every two-byte value is accepted.
    pub options: u16,
    /// Stream endianness from the representation identifier.
    pub endian: CdrEndian,
}

/// Immutable nesting-depth token. Carries depth by value so sibling branches
/// keep independent state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct CdrNesting {
    pub(crate) depth: usize,
}

impl CdrNesting {
    /// Root nesting token at depth 0.
    #[must_use]
    pub const fn root() -> Self {
        Self { depth: 0 }
    }

    /// Current nesting depth (0 at the stream root).
    #[must_use]
    pub const fn depth(self) -> usize {
        self.depth
    }
}

/// Mutable CDR1 reader over a borrowed input view.
#[derive(Debug)]
pub struct CdrReader<'a> {
    bytes: &'a [u8],
    offset: usize,
    limits: CdrLimits,
    header: CdrHeader,
}

impl<'a> CdrReader<'a> {
    /// Open a CDR1 reader over `bytes` with validated limits.
    pub fn open(bytes: &'a [u8], limits: CdrLimits) -> Result<Self, CdrError> {
        limits.validate()?;
        let len = bytes.len();
        if len > limits.max_stream_bytes {
            return Err(CdrError::bounds_exceeded(0, len as u64, limits.max_stream_bytes as u64));
        }
        if len < HEADER_LENGTH {
            return Err(CdrError::invalid_encapsulation(0, HEADER_LENGTH as u64, len as u64));
        }
        let representation = u16::from_be_bytes([bytes[0], bytes[1]]);
        let options = u16::from_be_bytes([bytes[2], bytes[3]]);
        let endian = if representation == REPRESENTATION_CDR_LE {
            CdrEndian::Little
        } else if representation == REPRESENTATION_CDR_BE {
            CdrEndian::Big
        } else {
            return Err(CdrError::unsupported_representation(0, len as u64));
        };
        Ok(Self {
            bytes,
            offset: BODY_ORIGIN,
            limits,
            header: CdrHeader { representation, options, endian },
        })
    }

    /// Open with frozen default limits.
    pub fn open_default(bytes: &'a [u8]) -> Result<Self, CdrError> {
        Self::open(bytes, CdrLimits::defaults())
    }

    /// Absolute cursor offset into the input view.
    #[must_use]
    pub fn position(&self) -> usize {
        self.offset
    }

    /// Bytes remaining from the cursor to the end of the input view.
    #[must_use]
    pub fn remaining(&self) -> usize {
        self.bytes.len() - self.offset
    }

    /// Encapsulation header captured at open.
    #[must_use]
    pub fn header(&self) -> CdrHeader {
        self.header
    }

    /// Representation identifier (network-order UInt16).
    #[must_use]
    pub fn representation(&self) -> u16 {
        self.header.representation
    }

    /// Options field (network-order UInt16).
    #[must_use]
    pub fn options(&self) -> u16 {
        self.header.options
    }

    /// Stream endianness.
    #[must_use]
    pub fn endian(&self) -> CdrEndian {
        self.header.endian
    }

    /// True when the stream is little endian.
    #[must_use]
    pub fn little_endian(&self) -> bool {
        self.header.endian.is_little()
    }

    /// Active resource limits.
    #[must_use]
    pub fn limits(&self) -> CdrLimits {
        self.limits
    }

    /// Root nesting token at depth 0.
    #[must_use]
    pub fn root_nesting(&self) -> CdrNesting {
        let _ = self;
        CdrNesting::root()
    }

    /// Enter one nested aggregate under `parent`. Leaves cursor unchanged.
    pub fn enter_nested(&self, parent: CdrNesting) -> Result<CdrNesting, CdrError> {
        let next = parent.depth + 1;
        let max_d = self.limits.max_nesting_depth;
        if next > max_d {
            return Err(CdrError::bounds_exceeded(self.offset, next as u64, max_d as u64));
        }
        Ok(CdrNesting { depth: next })
    }

    fn preflight(
        &mut self,
        field_start: usize,
        align: usize,
        size: usize,
    ) -> Result<usize, CdrError> {
        let pad = padding_for(field_start, align);
        let rem = self.bytes.len() - field_start;
        let Some(needed) = checked_add_usize(pad, size) else {
            self.offset = field_start;
            return Err(CdrError::length_overflow(field_start, 0, rem as u64));
        };
        if pad > 0 && rem < pad {
            self.offset = field_start;
            return Err(CdrError::alignment_overflow(field_start, pad as u64, rem as u64));
        }
        if rem < needed {
            self.offset = field_start;
            return Err(CdrError::truncated(field_start, needed as u64, rem as u64));
        }
        Ok(pad)
    }

    fn align_to(&mut self, align: usize, size: usize) -> Result<(), CdrError> {
        let field_start = self.offset;
        let pad = self.preflight(field_start, align, size)?;
        self.offset = field_start + pad;
        Ok(())
    }

    fn read_u32_at(&self, pos: usize) -> u32 {
        let b = &self.bytes[pos..pos + 4];
        if self.little_endian() {
            u32::from_le_bytes([b[0], b[1], b[2], b[3]])
        } else {
            u32::from_be_bytes([b[0], b[1], b[2], b[3]])
        }
    }

    /// Read one unaligned byte (alignment width 1).
    pub fn read_u8(&mut self) -> Result<u8, CdrError> {
        self.align_to(1, 1)?;
        let b = self.bytes[self.offset];
        self.offset += 1;
        Ok(b)
    }

    /// Read a 16-bit unsigned bit pattern in stream endianness (align 2).
    pub fn read_u16(&mut self) -> Result<u16, CdrError> {
        self.align_to(2, 2)?;
        let b = &self.bytes[self.offset..self.offset + 2];
        let value = if self.little_endian() {
            u16::from_le_bytes([b[0], b[1]])
        } else {
            u16::from_be_bytes([b[0], b[1]])
        };
        self.offset += 2;
        Ok(value)
    }

    /// Read a 32-bit unsigned bit pattern in stream endianness (align 4).
    pub fn read_u32(&mut self) -> Result<u32, CdrError> {
        self.align_to(4, 4)?;
        let value = self.read_u32_at(self.offset);
        self.offset += 4;
        Ok(value)
    }

    /// Read a 64-bit unsigned bit pattern in stream endianness (align 8).
    pub fn read_u64(&mut self) -> Result<u64, CdrError> {
        self.align_to(8, 8)?;
        let b = &self.bytes[self.offset..self.offset + 8];
        let value = if self.little_endian() {
            u64::from_le_bytes([b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7]])
        } else {
            u64::from_be_bytes([b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7]])
        };
        self.offset += 8;
        Ok(value)
    }

    /// Decode a CDR boolean (`0` = false, `1` = true).
    pub fn read_bool(&mut self) -> Result<bool, CdrError> {
        let field_start = self.offset;
        let rem = self.remaining();
        let b = self.read_u8()?;
        match b {
            0 => Ok(false),
            1 => Ok(true),
            _ => {
                self.offset = field_start;
                Err(CdrError::invalid_boolean(field_start, rem as u64))
            }
        }
    }

    /// Decode a signed 8-bit integer.
    pub fn read_i8(&mut self) -> Result<i8, CdrError> {
        Ok(self.read_u8()? as i8)
    }

    /// Decode a signed 16-bit integer.
    pub fn read_i16(&mut self) -> Result<i16, CdrError> {
        Ok(self.read_u16()? as i16)
    }

    /// Decode a signed 32-bit integer.
    pub fn read_i32(&mut self) -> Result<i32, CdrError> {
        Ok(self.read_u32()? as i32)
    }

    /// Decode a signed 64-bit integer.
    pub fn read_i64(&mut self) -> Result<i64, CdrError> {
        Ok(self.read_u64()? as i64)
    }

    /// Decode IEEE-754 binary32 (exact bit pattern).
    pub fn read_f32(&mut self) -> Result<f32, CdrError> {
        Ok(f32::from_bits(self.read_u32()?))
    }

    /// Decode IEEE-754 binary64 (exact bit pattern).
    pub fn read_f64(&mut self) -> Result<f64, CdrError> {
        Ok(f64::from_bits(self.read_u64()?))
    }

    /// Decode CDR Char8 as a single octet.
    pub fn read_char8(&mut self) -> Result<u8, CdrError> {
        self.read_u8()
    }

    /// Decode CDR Char16 as a 16-bit code unit.
    pub fn read_char16(&mut self) -> Result<u16, CdrError> {
        self.read_u16()
    }

    /// Read `n` raw bytes as a borrowed zero-copy subview (alignment width 1).
    /// Governed by remaining input and `max_stream_bytes` only.
    pub fn read_bytes(&mut self, n: usize) -> Result<&'a [u8], CdrError> {
        let field_start = self.offset;
        if let Err(e) = self.align_to(1, n) {
            self.offset = field_start;
            return Err(e);
        }
        let start = self.offset;
        let end = start + n;
        self.offset = end;
        Ok(&self.bytes[start..end])
    }

    /// Checked `count * element_size` for a borrowed span length.
    /// Order: multiply → absolute stream ceiling (`length_overflow`) → remaining (`truncated`).
    pub fn checked_span_length(&self, count: u64, element_size: usize) -> Result<usize, CdrError> {
        let field_start = self.offset;
        let rem = self.remaining();
        let max_stream = self.limits.max_stream_bytes;
        let bytes = multiply_length(count, element_size, field_start, rem)?;
        if bytes > max_stream {
            return Err(CdrError::length_overflow(field_start, bytes as u64, max_stream as u64));
        }
        if bytes > rem {
            return Err(CdrError::truncated(field_start, bytes as u64, rem as u64));
        }
        Ok(bytes)
    }

    /// Checked `count * element_size` for an owned temporary allocation budget.
    pub fn checked_alloc_length(&self, count: u64, element_size: usize) -> Result<usize, CdrError> {
        let field_start = self.offset;
        let rem = self.remaining();
        let capacity = self.limits.max_temporary_allocation;
        let bytes = multiply_length(count, element_size, field_start, rem)?;
        if bytes > capacity {
            return Err(CdrError::bounds_exceeded(field_start, bytes as u64, capacity as u64));
        }
        Ok(bytes)
    }

    /// Strict completion: require a fully consumed stream.
    pub fn ensure_complete(&self) -> Result<(), CdrError> {
        let rem = self.remaining();
        if rem > 0 {
            return Err(CdrError::trailing_data(self.offset, rem as u64));
        }
        Ok(())
    }

    /// Top-level completion with a declared all-zero tail.
    /// Exact end always succeeds for every valid declaration.
    pub fn ensure_complete_with_zero_tail(
        &mut self,
        expected_tail_bytes: usize,
    ) -> Result<(), CdrError> {
        let cursor = self.offset;
        let rem = self.remaining();
        let max_stream = self.limits.max_stream_bytes;
        if expected_tail_bytes > max_stream {
            return Err(CdrError::bounds_exceeded(
                cursor,
                expected_tail_bytes as u64,
                max_stream as u64,
            ));
        }
        if rem == 0 {
            return Ok(());
        }
        if rem != expected_tail_bytes {
            return Err(CdrError::trailing_data(cursor, rem as u64));
        }
        if self.bytes[cursor..cursor + rem].iter().any(|&b| b != 0) {
            return Err(CdrError::trailing_data(cursor, rem as u64));
        }
        self.offset = cursor + rem;
        Ok(())
    }

    /// Decode a CDR1 UTF-8 Char8 string into an owned `String`.
    ///
    /// `max_bytes`, when supplied, is the maximum UTF-8 payload byte count
    /// (excluding the required terminating NUL).
    pub fn read_string(&mut self, max_bytes: Option<u32>) -> Result<String, CdrError> {
        let field_start = self.offset;
        let rem_at_start = self.remaining();
        let max_stream = self.limits.max_stream_bytes;
        let pad = self.preflight(field_start, 4, 4)?;
        let len_pos = field_start + pad;
        let len_u = self.read_u32_at(len_pos);
        if len_u == 0 {
            self.offset = field_start;
            return Err(CdrError::missing_string_terminator(field_start, 1, rem_at_start as u64));
        }
        let payload_u = u64::from(len_u) - 1;
        if let Some(bound) = max_bytes
            && payload_u > u64::from(bound)
        {
            self.offset = field_start;
            return Err(CdrError::bounds_exceeded(
                field_start,
                size_field_u64(payload_u),
                size_field_u64(u64::from(bound)),
            ));
        }
        let Ok(len_i) = usize::try_from(len_u) else {
            self.offset = field_start;
            return Err(CdrError::length_overflow(field_start, 0, rem_at_start as u64));
        };
        let payload_i = len_i - 1;
        if len_i > max_stream {
            self.offset = field_start;
            return Err(CdrError::length_overflow(field_start, len_i as u64, max_stream as u64));
        }
        let Some(header_and_pad) = checked_add_usize(pad, 4) else {
            self.offset = field_start;
            return Err(CdrError::length_overflow(field_start, 0, rem_at_start as u64));
        };
        let Some(total_needed) = checked_add_usize(header_and_pad, len_i) else {
            self.offset = field_start;
            return Err(CdrError::length_overflow(field_start, 0, rem_at_start as u64));
        };
        if rem_at_start < total_needed {
            self.offset = field_start;
            return Err(CdrError::truncated(field_start, total_needed as u64, rem_at_start as u64));
        }
        // Worst-case owned UTF-16 storage charge: payload_bytes * 2.
        let Some(worst_u) = payload_u.checked_mul(2) else {
            self.offset = field_start;
            return Err(CdrError::length_overflow(field_start, 0, rem_at_start as u64));
        };
        let Ok(worst_i) = usize::try_from(worst_u) else {
            self.offset = field_start;
            return Err(CdrError::length_overflow(field_start, 0, rem_at_start as u64));
        };
        let temp_cap = self.limits.max_temporary_allocation;
        if worst_i > temp_cap {
            self.offset = field_start;
            return Err(CdrError::bounds_exceeded(field_start, worst_i as u64, temp_cap as u64));
        }
        let data_start = len_pos + 4;
        let data_end = data_start + len_i;
        let span = &self.bytes[data_start..data_end];
        if span[len_i - 1] != 0 {
            self.offset = field_start;
            return Err(CdrError::missing_string_terminator(
                field_start,
                len_i as u64,
                rem_at_start as u64,
            ));
        }
        let payload = &span[..payload_i];
        match std::str::from_utf8(payload) {
            Ok(s) => {
                self.offset = data_end;
                Ok(s.to_owned())
            }
            Err(_) => {
                self.offset = field_start;
                Err(CdrError::invalid_utf8(field_start, len_i as u64, rem_at_start as u64))
            }
        }
    }

    /// Decode a ROS 2 legacy wstring into an owned `String`.
    ///
    /// `max_scalars`, when supplied, is the maximum Unicode scalar / slot count.
    pub fn read_wstring(&mut self, max_scalars: Option<u32>) -> Result<String, CdrError> {
        let field_start = self.offset;
        let rem_at_start = self.remaining();
        let max_stream = self.limits.max_stream_bytes;
        let pad = self.preflight(field_start, 4, 4)?;
        let count_pos = field_start + pad;
        let count_u = self.read_u32_at(count_pos);
        if let Some(bound) = max_scalars
            && count_u > bound
        {
            self.offset = field_start;
            return Err(CdrError::bounds_exceeded(
                field_start,
                size_field_u64(u64::from(count_u)),
                size_field_u64(u64::from(bound)),
            ));
        }
        let Ok(count_i) = usize::try_from(count_u) else {
            self.offset = field_start;
            return Err(CdrError::length_overflow(field_start, 0, rem_at_start as u64));
        };
        let Some(payload_u64) = u64::from(count_u).checked_mul(4) else {
            self.offset = field_start;
            return Err(CdrError::length_overflow(field_start, 0, rem_at_start as u64));
        };
        let Ok(payload_i) = usize::try_from(payload_u64) else {
            self.offset = field_start;
            return Err(CdrError::length_overflow(field_start, 0, rem_at_start as u64));
        };
        if payload_i > max_stream {
            self.offset = field_start;
            return Err(CdrError::length_overflow(
                field_start,
                payload_i as u64,
                max_stream as u64,
            ));
        }
        let Some(header_and_pad) = checked_add_usize(pad, 4) else {
            self.offset = field_start;
            return Err(CdrError::length_overflow(field_start, 0, rem_at_start as u64));
        };
        let Some(total_needed) = checked_add_usize(header_and_pad, payload_i) else {
            self.offset = field_start;
            return Err(CdrError::length_overflow(field_start, 0, rem_at_start as u64));
        };
        if rem_at_start < total_needed {
            self.offset = field_start;
            return Err(CdrError::truncated(field_start, total_needed as u64, rem_at_start as u64));
        }
        let temp_cap = self.limits.max_temporary_allocation;
        if payload_i > temp_cap {
            self.offset = field_start;
            return Err(CdrError::bounds_exceeded(field_start, payload_i as u64, temp_cap as u64));
        }
        let data_start = count_pos + 4;
        let mut out = String::with_capacity(count_i);
        for k in 0..count_i {
            let slot = self.read_u32_at(data_start + k * 4);
            if !is_accepted_wstring_scalar(slot) {
                self.offset = field_start;
                return Err(CdrError::invalid_wstring_scalar(field_start, rem_at_start as u64));
            }
            // Accepted range fits in char.
            out.push(char::from_u32(slot).expect("accepted wstring scalar"));
        }
        self.offset = data_start + payload_i;
        Ok(out)
    }

    /// Read an endian-aware aligned `UInt32` sequence element count.
    pub fn read_sequence_length(&mut self, max_elements: Option<u32>) -> Result<u32, CdrError> {
        let field_start = self.offset;
        let max_stream = self.limits.max_stream_bytes;
        let pad = self.preflight(field_start, 4, 4)?;
        let count_pos = field_start + pad;
        let count_u = self.read_u32_at(count_pos);
        if let Some(bound) = max_elements
            && count_u > bound
        {
            self.offset = field_start;
            return Err(CdrError::bounds_exceeded(
                field_start,
                size_field_u64(u64::from(count_u)),
                size_field_u64(u64::from(bound)),
            ));
        }
        let max_stream_u = u32::try_from(max_stream).unwrap_or(u32::MAX);
        if count_u > max_stream_u {
            self.offset = field_start;
            return Err(CdrError::bounds_exceeded(
                field_start,
                size_field_u64(u64::from(count_u)),
                max_stream as u64,
            ));
        }
        self.offset = count_pos + 4;
        Ok(count_u)
    }

    /// Read a CDR sequence of octets as a borrowed zero-copy view.
    pub fn read_byte_sequence(&mut self, max_elements: Option<u32>) -> Result<&'a [u8], CdrError> {
        let field_start = self.offset;
        let rem_at_start = self.remaining();
        let max_stream = self.limits.max_stream_bytes;
        let pad = self.preflight(field_start, 4, 4)?;
        let count_pos = field_start + pad;
        let count_u = self.read_u32_at(count_pos);
        if let Some(bound) = max_elements
            && count_u > bound
        {
            self.offset = field_start;
            return Err(CdrError::bounds_exceeded(
                field_start,
                size_field_u64(u64::from(count_u)),
                size_field_u64(u64::from(bound)),
            ));
        }
        let max_stream_u = u32::try_from(max_stream).unwrap_or(u32::MAX);
        if count_u > max_stream_u {
            self.offset = field_start;
            return Err(CdrError::bounds_exceeded(
                field_start,
                size_field_u64(u64::from(count_u)),
                max_stream as u64,
            ));
        }
        let count_i = count_u as usize;
        let Some(header_and_pad) = checked_add_usize(pad, 4) else {
            self.offset = field_start;
            return Err(CdrError::length_overflow(field_start, 0, rem_at_start as u64));
        };
        let Some(total_needed) = checked_add_usize(header_and_pad, count_i) else {
            self.offset = field_start;
            return Err(CdrError::length_overflow(field_start, 0, rem_at_start as u64));
        };
        if rem_at_start < total_needed {
            self.offset = field_start;
            return Err(CdrError::truncated(field_start, total_needed as u64, rem_at_start as u64));
        }
        let data_start = count_pos + 4;
        let data_end = data_start + count_i;
        self.offset = data_end;
        Ok(&self.bytes[data_start..data_end])
    }
}

/// True when `slot` is an accepted ROS legacy wstring Unicode scalar.
#[must_use]
pub(crate) fn is_accepted_wstring_scalar(slot: u32) -> bool {
    slot <= 0x0000_D7FF || (0x0000_E000..=0x0010_FFFF).contains(&slot)
}

/// Multiply `count * element_size` into a host `usize`.
/// When the product exceeds the host domain, returns `length_overflow` with `needed = 0`.
fn multiply_length(
    count: u64,
    element_size: usize,
    field_start: usize,
    rem: usize,
) -> Result<usize, CdrError> {
    if element_size == 0 {
        return Ok(0);
    }
    let elem_u = element_size as u64;
    let Some(bytes_u) = count.checked_mul(elem_u) else {
        return Err(CdrError::length_overflow(field_start, 0, rem as u64));
    };
    usize::try_from(bytes_u).map_err(|_| CdrError::length_overflow(field_start, 0, rem as u64))
}
