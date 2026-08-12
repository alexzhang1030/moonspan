//! Gateway telemetry for copy budget and disposition counters (R1-05 / R2-01).

use crate::budgets::DispositionCounters;
use std::sync::atomic::{AtomicU64, Ordering};

/// Process-wide gateway telemetry (daemon + ros-feature paths).
pub static PROCESS_TELEMETRY: GatewayTelemetry = GatewayTelemetry::new();

/// Controllable-copy and disposition counters at the edge.
#[derive(Debug)]
pub struct GatewayTelemetry {
  /// Times a serialized payload was copied into a framed sample buffer.
  pub payload_copies: AtomicU64,
  /// Bytes copied in those operations.
  pub bytes_copied: AtomicU64,
  /// Samples framed for outbound WebSocket send.
  pub samples_framed: AtomicU64,
  pub delivered: AtomicU64,
  pub sequence_gap: AtomicU64,
  pub stale_sequence: AtomicU64,
  pub reliable_queue_drop: AtomicU64,
}

impl GatewayTelemetry {
  pub const fn new() -> Self {
    Self {
      payload_copies: AtomicU64::new(0),
      bytes_copied: AtomicU64::new(0),
      samples_framed: AtomicU64::new(0),
      delivered: AtomicU64::new(0),
      sequence_gap: AtomicU64::new(0),
      stale_sequence: AtomicU64::new(0),
      reliable_queue_drop: AtomicU64::new(0),
    }
  }

  pub fn record_payload_copy(&self, bytes: usize) {
    self.payload_copies.fetch_add(1, Ordering::Relaxed);
    self.bytes_copied.fetch_add(bytes as u64, Ordering::Relaxed);
  }

  pub fn record_sample_framed(&self) {
    self.samples_framed.fetch_add(1, Ordering::Relaxed);
  }

  pub fn merge_dispositions(&self, counters: &DispositionCounters) {
    self.delivered.fetch_add(counters.delivered, Ordering::Relaxed);
    self.sequence_gap.fetch_add(counters.sequence_gap, Ordering::Relaxed);
    self.stale_sequence.fetch_add(counters.stale_sequence, Ordering::Relaxed);
    self.reliable_queue_drop.fetch_add(counters.reliable_queue_drop, Ordering::Relaxed);
  }

  pub fn add_delivered(&self, n: u64) {
    self.delivered.fetch_add(n, Ordering::Relaxed);
  }

  pub fn add_sequence_gap(&self, n: u64) {
    self.sequence_gap.fetch_add(n, Ordering::Relaxed);
  }

  pub fn add_stale_sequence(&self, n: u64) {
    self.stale_sequence.fetch_add(n, Ordering::Relaxed);
  }

  pub fn add_reliable_queue_drop(&self, n: u64) {
    self.reliable_queue_drop.fetch_add(n, Ordering::Relaxed);
  }

  #[must_use]
  pub fn snapshot(&self) -> GatewayTelemetrySnapshot {
    GatewayTelemetrySnapshot {
      payload_copies: self.payload_copies.load(Ordering::Relaxed),
      bytes_copied: self.bytes_copied.load(Ordering::Relaxed),
      samples_framed: self.samples_framed.load(Ordering::Relaxed),
      controllable_copies_per_sample: 1,
      delivered: self.delivered.load(Ordering::Relaxed),
      sequence_gap: self.sequence_gap.load(Ordering::Relaxed),
      stale_sequence: self.stale_sequence.load(Ordering::Relaxed),
      reliable_queue_drop: self.reliable_queue_drop.load(Ordering::Relaxed),
    }
  }
}

impl Default for GatewayTelemetry {
  fn default() -> Self {
    Self::new()
  }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GatewayTelemetrySnapshot {
  pub payload_copies: u64,
  pub bytes_copied: u64,
  pub samples_framed: u64,
  /// Structural: framing reuses the buffer from [`super::SubscriptionSample::from_payload`].
  pub controllable_copies_per_sample: u8,
  pub delivered: u64,
  pub sequence_gap: u64,
  pub stale_sequence: u64,
  pub reliable_queue_drop: u64,
}

impl GatewayTelemetrySnapshot {
  /// Compact JSON for `/telemetryz` (no serde dependency).
  #[must_use]
  pub fn to_json(self) -> String {
    format!(
      "{{\"payload_copies\":{},\"bytes_copied\":{},\"samples_framed\":{},\"controllable_copies_per_sample\":{},\"delivered\":{},\"sequence_gap\":{},\"stale_sequence\":{},\"reliable_queue_drop\":{}}}",
      self.payload_copies,
      self.bytes_copied,
      self.samples_framed,
      self.controllable_copies_per_sample,
      self.delivered,
      self.sequence_gap,
      self.stale_sequence,
      self.reliable_queue_drop
    )
  }
}
