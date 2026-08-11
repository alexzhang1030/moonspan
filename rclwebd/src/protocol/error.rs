//! Stable R2WP protocol error surface for multi-language agreement.

/// Receiver validation failure with registry identity and stable reason.
///
/// Plain fields support direct agreement comparison.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProtocolError {
    /// Registry numeric error code (for example 1, 4, 24).
    pub code: u32,
    /// Stable registry error name (for example `malformed_bootstrap`).
    pub name: &'static str,
    /// Stable implementation reason token (for example `bad_magic`).
    pub reason: &'static str,
    /// Absolute byte offset into the inspected input.
    pub offset: usize,
    /// Validation plane (`bootstrap` for this batch).
    pub plane: &'static str,
    /// Receiver validation-order step that failed.
    pub step: u8,
}

impl ProtocolError {
    #[must_use]
    pub const fn bootstrap(
        code: u32,
        name: &'static str,
        reason: &'static str,
        offset: usize,
        step: u8,
    ) -> Self {
        Self {
            code,
            name,
            reason,
            offset,
            plane: "bootstrap",
            step,
        }
    }

    #[must_use]
    pub const fn malformed_bootstrap(reason: &'static str, offset: usize, step: u8) -> Self {
        Self::bootstrap(1, "malformed_bootstrap", reason, offset, step)
    }

    #[must_use]
    pub const fn unsupported_version(reason: &'static str, offset: usize, step: u8) -> Self {
        Self::bootstrap(4, "unsupported_version", reason, offset, step)
    }

    #[must_use]
    pub const fn message_too_large(reason: &'static str, offset: usize, step: u8) -> Self {
        Self::bootstrap(24, "message_too_large", reason, offset, step)
    }
}

impl std::fmt::Display for ProtocolError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{} ({}) reason={} plane={} step={} offset={}",
            self.name, self.code, self.reason, self.plane, self.step, self.offset
        )
    }
}

impl std::error::Error for ProtocolError {}
