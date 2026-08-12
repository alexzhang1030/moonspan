//! Stable R2WP protocol error surface for multi-language agreement.

/// Receiver validation failure with registry identity and stable reason.
///
/// Plain fields support direct agreement comparison.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProtocolError {
  /// Registry numeric error code (for example 1, 3, 4, 24, 25).
  pub code: u32,
  /// Stable registry error name (for example `malformed_frame`).
  pub name: &'static str,
  /// Stable implementation reason token (for example `truncated_header`).
  pub reason: &'static str,
  /// Absolute byte offset into the inspected input.
  pub offset: usize,
  /// Validation plane (`bootstrap` or `selected_frame`).
  pub plane: &'static str,
  /// Receiver validation-order step that failed.
  pub step: u8,
}

impl ProtocolError {
  #[must_use]
  pub const fn new(
    code: u32,
    name: &'static str,
    reason: &'static str,
    offset: usize,
    plane: &'static str,
    step: u8,
  ) -> Self {
    Self { code, name, reason, offset, plane, step }
  }

  #[must_use]
  pub const fn bootstrap(
    code: u32,
    name: &'static str,
    reason: &'static str,
    offset: usize,
    step: u8,
  ) -> Self {
    Self::new(code, name, reason, offset, "bootstrap", step)
  }

  #[must_use]
  pub const fn selected_frame(
    code: u32,
    name: &'static str,
    reason: &'static str,
    offset: usize,
    step: u8,
  ) -> Self {
    Self::new(code, name, reason, offset, "selected_frame", step)
  }

  #[must_use]
  pub const fn malformed_bootstrap(reason: &'static str, offset: usize, step: u8) -> Self {
    Self::bootstrap(1, "malformed_bootstrap", reason, offset, step)
  }

  #[must_use]
  pub const fn unsupported_version_bootstrap(
    reason: &'static str,
    offset: usize,
    step: u8,
  ) -> Self {
    Self::bootstrap(4, "unsupported_version", reason, offset, step)
  }

  #[must_use]
  pub const fn message_too_large_bootstrap(reason: &'static str, offset: usize, step: u8) -> Self {
    Self::bootstrap(24, "message_too_large", reason, offset, step)
  }

  // --- selected_frame registry codes used by steps 1–16 ---

  #[must_use]
  pub const fn malformed_frame(reason: &'static str, offset: usize, step: u8) -> Self {
    Self::selected_frame(3, "malformed_frame", reason, offset, step)
  }

  #[must_use]
  pub const fn unsupported_version_frame(reason: &'static str, offset: usize, step: u8) -> Self {
    Self::selected_frame(4, "unsupported_version", reason, offset, step)
  }

  #[must_use]
  pub const fn unsupported_opcode(reason: &'static str, offset: usize, step: u8) -> Self {
    Self::selected_frame(5, "unsupported_opcode", reason, offset, step)
  }

  #[must_use]
  pub const fn unsupported_flags(reason: &'static str, offset: usize, step: u8) -> Self {
    Self::selected_frame(6, "unsupported_flags", reason, offset, step)
  }

  #[must_use]
  pub const fn unsupported_extension(reason: &'static str, offset: usize, step: u8) -> Self {
    Self::selected_frame(22, "unsupported_extension", reason, offset, step)
  }

  #[must_use]
  pub const fn invalid_control(reason: &'static str, offset: usize, step: u8) -> Self {
    Self::selected_frame(23, "invalid_control", reason, offset, step)
  }

  #[must_use]
  pub const fn message_too_large_frame(reason: &'static str, offset: usize, step: u8) -> Self {
    Self::selected_frame(24, "message_too_large", reason, offset, step)
  }

  #[must_use]
  pub const fn protocol_violation(reason: &'static str, offset: usize, step: u8) -> Self {
    Self::selected_frame(25, "protocol_violation", reason, offset, step)
  }

  /// Selected-frame step 17: ready-required control or data before ready.
  #[must_use]
  pub const fn session_not_ready(reason: &'static str, offset: usize) -> Self {
    Self::selected_frame(27, "session_not_ready", reason, offset, 17)
  }

  /// Selected-frame step 20: data on failed, closed, or never-opened channel.
  #[must_use]
  pub const fn unknown_channel(reason: &'static str, offset: usize) -> Self {
    Self::selected_frame(7, "unknown_channel", reason, offset, 20)
  }

  #[must_use]
  pub const fn clock_unavailable(reason: &'static str, offset: usize, step: u8) -> Self {
    Self::selected_frame(28, "clock_unavailable", reason, offset, step)
  }

  /// Bootstrap-plane protocol violation (registry code 25).
  #[must_use]
  pub const fn protocol_violation_bootstrap(reason: &'static str, offset: usize, step: u8) -> Self {
    Self::bootstrap(25, "protocol_violation", reason, offset, step)
  }
}

// Backward-compatible aliases used by bootstrap module.
impl ProtocolError {
  #[must_use]
  pub const fn unsupported_version(reason: &'static str, offset: usize, step: u8) -> Self {
    Self::unsupported_version_bootstrap(reason, offset, step)
  }

  #[must_use]
  pub const fn message_too_large(reason: &'static str, offset: usize, step: u8) -> Self {
    Self::message_too_large_bootstrap(reason, offset, step)
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
