//! CDR resource ceilings and endianness ([docs/runtime/cdr.md](../../../docs/runtime/cdr.md)).

use super::error::CdrError;

/// Default / absolute Phase 1 maximum stream bytes (R2WP frame payload ceiling, 64 MiB).
pub const DEFAULT_MAX_STREAM_BYTES: usize = 67_108_864;

/// Default / absolute Phase 1 maximum nesting depth.
pub const DEFAULT_MAX_NESTING_DEPTH: usize = 64;

/// Default maximum temporary allocation per codec operation (matches stream ceiling).
pub const DEFAULT_MAX_TEMPORARY_ALLOCATION: usize = 67_108_864;

/// Minimum accepted `max_stream_bytes` (encapsulation header length).
pub const MIN_MAX_STREAM_BYTES: usize = 4;

/// Minimum accepted `max_nesting_depth`.
pub const MIN_MAX_NESTING_DEPTH: usize = 1;

/// Absolute body origin after the 4-byte encapsulation header.
pub const BODY_ORIGIN: usize = 4;

/// Encapsulation header length in bytes.
pub const HEADER_LENGTH: usize = 4;

/// CDR1 little-endian representation identifier (network-order UInt16 value).
pub const REPRESENTATION_CDR_LE: u16 = 0x0001;

/// CDR1 big-endian representation identifier (network-order UInt16 value).
pub const REPRESENTATION_CDR_BE: u16 = 0x0000;

/// Initial writer buffer size hint: header only.
pub const WRITER_INITIAL_SIZE_HINT: usize = HEADER_LENGTH;

/// Stream byte order from the encapsulation representation identifier.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum CdrEndian {
    /// CDR1 big endian (`0x0000`).
    Big,
    /// CDR1 little endian (`0x0001`).
    Little,
}

impl CdrEndian {
    #[must_use]
    pub const fn little() -> Self {
        Self::Little
    }

    #[must_use]
    pub const fn big() -> Self {
        Self::Big
    }

    #[must_use]
    pub const fn is_little(self) -> bool {
        matches!(self, Self::Little)
    }

    #[must_use]
    pub const fn representation(self) -> u16 {
        match self {
            Self::Little => REPRESENTATION_CDR_LE,
            Self::Big => REPRESENTATION_CDR_BE,
        }
    }
}

/// Codec resource ceilings for one encode or decode.
/// Defaults are absolute Phase 1 ceilings; construction validates ranges.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CdrLimits {
    /// Maximum accepted input/output stream length in bytes (`4..=67108864`).
    pub max_stream_bytes: usize,
    /// Maximum nesting depth for nested structures and containers (`1..=64`).
    pub max_nesting_depth: usize,
    /// Maximum owned temporary allocation for a single codec operation
    /// (`0..=max_stream_bytes`). Borrowed spans use stream bounds.
    pub max_temporary_allocation: usize,
}

impl CdrLimits {
    /// Frozen defaults at the absolute Phase 1 ceilings.
    #[must_use]
    pub const fn defaults() -> Self {
        Self {
            max_stream_bytes: DEFAULT_MAX_STREAM_BYTES,
            max_nesting_depth: DEFAULT_MAX_NESTING_DEPTH,
            max_temporary_allocation: DEFAULT_MAX_TEMPORARY_ALLOCATION,
        }
    }

    /// Validate absolute Phase 1 ranges. Shared by `new`, reader `open`, and writer construction.
    pub fn validate(self) -> Result<(), CdrError> {
        if self.max_stream_bytes < MIN_MAX_STREAM_BYTES
            || self.max_stream_bytes > DEFAULT_MAX_STREAM_BYTES
        {
            return Err(CdrError::invalid_limits(
                self.max_stream_bytes as u64,
                DEFAULT_MAX_STREAM_BYTES as u64,
            ));
        }
        if self.max_nesting_depth < MIN_MAX_NESTING_DEPTH
            || self.max_nesting_depth > DEFAULT_MAX_NESTING_DEPTH
        {
            return Err(CdrError::invalid_limits(
                self.max_nesting_depth as u64,
                DEFAULT_MAX_NESTING_DEPTH as u64,
            ));
        }
        if self.max_temporary_allocation > self.max_stream_bytes {
            return Err(CdrError::invalid_limits(
                self.max_temporary_allocation as u64,
                self.max_stream_bytes as u64,
            ));
        }
        Ok(())
    }

    /// Construct validated limits. Returns `invalid_limits` when a value is outside range.
    pub fn new(
        max_stream_bytes: usize,
        max_nesting_depth: usize,
        max_temporary_allocation: usize,
    ) -> Result<Self, CdrError> {
        let limits = Self {
            max_stream_bytes,
            max_nesting_depth,
            max_temporary_allocation,
        };
        limits.validate()?;
        Ok(limits)
    }
}

/// Padding bytes required so `((offset - BODY_ORIGIN) % align) == 0`.
#[must_use]
pub(crate) fn padding_for(offset: usize, align: usize) -> usize {
    if align <= 1 {
        return 0;
    }
    let body_rel = offset - BODY_ORIGIN;
    let rem = body_rel % align;
    if rem == 0 { 0 } else { align - rem }
}

/// Effective writer capacity: min(stream, temporary) over the full stream including header.
#[must_use]
pub(crate) fn writer_capacity(limits: CdrLimits) -> usize {
    limits.max_stream_bytes.min(limits.max_temporary_allocation)
}

/// Checked `a + b` into host `usize`. Overflow yields `None`.
#[must_use]
pub(crate) fn checked_add_usize(a: usize, b: usize) -> Option<usize> {
    a.checked_add(b)
}

/// Map an optional `u32` type bound into a host comparison ceiling.
/// Bounds that cannot fit in `usize` stay non-binding (open relative to stream ceiling).
#[must_use]
pub(crate) fn type_bound_ceiling(bound: Option<u32>) -> Option<usize> {
    bound.and_then(|b| usize::try_from(b).ok())
}
