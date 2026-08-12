//! Stable CDR codec fault codes ([docs/runtime/cdr.md](../../../docs/runtime/cdr.md)).

/// Stable fault code from the CDR taxonomy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum CdrErrorCode {
    /// The 4-byte header is truncated or structurally unavailable.
    InvalidEncapsulation,
    /// Representation identifier is outside `{0x0000, 0x0001}`.
    UnsupportedRepresentation,
    /// `CdrLimits` construction is outside absolute Phase 1 ranges.
    InvalidLimits,
    /// Input ends before a required field completes.
    Truncated,
    /// Boolean byte is outside `{0, 1}`.
    InvalidBoolean,
    /// Char8 string payload fails UTF-8 well-formedness.
    InvalidUtf8,
    /// ROS legacy `wstring` 32-bit slot is outside accepted Unicode scalar values.
    InvalidWstringScalar,
    /// Char8 declared span ends on a nonzero byte (or length is zero).
    MissingStringTerminator,
    /// Stream, temporary allocation, or type bound exceeded.
    BoundsExceeded,
    /// Length arithmetic overflow, or span above the absolute stream ceiling.
    LengthOverflow,
    /// Required padding would advance past the end of the stream.
    AlignmentOverflow,
    /// Strict or declared zero-tail completion mismatch.
    TrailingData,
}

impl CdrErrorCode {
    /// Stable string token matching the contract taxonomy.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::InvalidEncapsulation => "invalid_encapsulation",
            Self::UnsupportedRepresentation => "unsupported_representation",
            Self::InvalidLimits => "invalid_limits",
            Self::Truncated => "truncated",
            Self::InvalidBoolean => "invalid_boolean",
            Self::InvalidUtf8 => "invalid_utf8",
            Self::InvalidWstringScalar => "invalid_wstring_scalar",
            Self::MissingStringTerminator => "missing_string_terminator",
            Self::BoundsExceeded => "bounds_exceeded",
            Self::LengthOverflow => "length_overflow",
            Self::AlignmentOverflow => "alignment_overflow",
            Self::TrailingData => "trailing_data",
        }
    }
}

impl std::fmt::Display for CdrErrorCode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Structured CDR fault. All fields are public for cross-package agreement.
///
/// Numeric convention: `needed` = requested/required size;
/// `remaining` = available capacity.
/// - `offset`: absolute fault site (field-start on failed field reads; `0` for open/config).
/// - `needed`: requested input length, computed span/alloc size, header length, or
///   rejected limit value for `invalid_limits`. **`needed = 0`** when a `u64`
///   request exceeds the host `usize` domain.
/// - `remaining`: stream capacity, alloc capacity, or bytes remaining at the fault site.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CdrError {
    /// Stable fault code from the CDR taxonomy.
    pub code: CdrErrorCode,
    /// Absolute byte offset of the fault.
    pub offset: usize,
    /// Requested or required size.
    pub needed: u64,
    /// Available capacity at the fault site.
    pub remaining: u64,
}

impl CdrError {
    #[must_use]
    pub const fn new(code: CdrErrorCode, offset: usize, needed: u64, remaining: u64) -> Self {
        Self { code, offset, needed, remaining }
    }

    #[must_use]
    pub const fn invalid_encapsulation(offset: usize, needed: u64, remaining: u64) -> Self {
        Self::new(CdrErrorCode::InvalidEncapsulation, offset, needed, remaining)
    }

    #[must_use]
    pub const fn unsupported_representation(offset: usize, remaining: u64) -> Self {
        Self::new(CdrErrorCode::UnsupportedRepresentation, offset, 0, remaining)
    }

    /// `needed` is the rejected limit field value; `remaining` is the peer constraint.
    #[must_use]
    pub const fn invalid_limits(needed: u64, remaining: u64) -> Self {
        Self::new(CdrErrorCode::InvalidLimits, 0, needed, remaining)
    }

    #[must_use]
    pub const fn truncated(offset: usize, needed: u64, remaining: u64) -> Self {
        Self::new(CdrErrorCode::Truncated, offset, needed, remaining)
    }

    /// Boolean octet outside `{0, 1}`. `needed` is the field width (1).
    #[must_use]
    pub const fn invalid_boolean(offset: usize, remaining: u64) -> Self {
        Self::new(CdrErrorCode::InvalidBoolean, offset, 1, remaining)
    }

    #[must_use]
    pub const fn invalid_utf8(offset: usize, needed: u64, remaining: u64) -> Self {
        Self::new(CdrErrorCode::InvalidUtf8, offset, needed, remaining)
    }

    /// Char8 declared span ends on a nonzero final byte, or length is zero.
    #[must_use]
    pub const fn missing_string_terminator(offset: usize, needed: u64, remaining: u64) -> Self {
        Self::new(CdrErrorCode::MissingStringTerminator, offset, needed, remaining)
    }

    /// ROS legacy wstring slot outside accepted Unicode scalars. `needed` is 4.
    #[must_use]
    pub const fn invalid_wstring_scalar(offset: usize, remaining: u64) -> Self {
        Self::new(CdrErrorCode::InvalidWstringScalar, offset, 4, remaining)
    }

    #[must_use]
    pub const fn bounds_exceeded(offset: usize, needed: u64, remaining: u64) -> Self {
        Self::new(CdrErrorCode::BoundsExceeded, offset, needed, remaining)
    }

    #[must_use]
    pub const fn length_overflow(offset: usize, needed: u64, remaining: u64) -> Self {
        Self::new(CdrErrorCode::LengthOverflow, offset, needed, remaining)
    }

    #[must_use]
    pub const fn alignment_overflow(offset: usize, needed: u64, remaining: u64) -> Self {
        Self::new(CdrErrorCode::AlignmentOverflow, offset, needed, remaining)
    }

    #[must_use]
    pub const fn trailing_data(offset: usize, remaining: u64) -> Self {
        Self::new(CdrErrorCode::TrailingData, offset, 0, remaining)
    }
}

impl std::fmt::Display for CdrError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{} offset={} needed={} remaining={}",
            self.code, self.offset, self.needed, self.remaining
        )
    }
}

impl std::error::Error for CdrError {}

/// Map a size into `needed`/`remaining` metrics. Values above `usize::MAX` use
/// the `needed = 0` sentinel (host size-domain overflow).
#[must_use]
pub(crate) fn size_field_u64(v: u64) -> u64 {
    if usize::try_from(v).is_err() { 0 } else { v }
}
