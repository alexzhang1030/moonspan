//! Gateway telemetry for the R1 copy-budget contract.

use std::sync::atomic::{AtomicU64, Ordering};

/// Process-wide gateway telemetry (daemon + ros-feature paths).
pub static PROCESS_TELEMETRY: GatewayTelemetry = GatewayTelemetry::new();

/// Controllable-copy counters at the edge (budget slot 1: rcl take → frame buf).
#[derive(Debug)]
pub struct GatewayTelemetry {
    /// Times a serialized payload was copied into a framed sample buffer.
    pub payload_copies: AtomicU64,
    /// Bytes copied in those operations.
    pub bytes_copied: AtomicU64,
    /// Samples framed for outbound WebSocket send.
    pub samples_framed: AtomicU64,
}

impl GatewayTelemetry {
    pub const fn new() -> Self {
        Self {
            payload_copies: AtomicU64::new(0),
            bytes_copied: AtomicU64::new(0),
            samples_framed: AtomicU64::new(0),
        }
    }

    pub fn record_payload_copy(&self, bytes: usize) {
        self.payload_copies.fetch_add(1, Ordering::Relaxed);
        self.bytes_copied.fetch_add(bytes as u64, Ordering::Relaxed);
    }

    pub fn record_sample_framed(&self) {
        self.samples_framed.fetch_add(1, Ordering::Relaxed);
    }

    #[must_use]
    pub fn snapshot(&self) -> GatewayTelemetrySnapshot {
        GatewayTelemetrySnapshot {
            payload_copies: self.payload_copies.load(Ordering::Relaxed),
            bytes_copied: self.bytes_copied.load(Ordering::Relaxed),
            samples_framed: self.samples_framed.load(Ordering::Relaxed),
            controllable_copies_per_sample: 1,
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
}

impl GatewayTelemetrySnapshot {
    /// Compact JSON for `/telemetryz` (no serde dependency).
    #[must_use]
    pub fn to_json(&self) -> String {
        format!(
            "{{\"payload_copies\":{},\"bytes_copied\":{},\"samples_framed\":{},\"controllable_copies_per_sample\":{}}}",
            self.payload_copies,
            self.bytes_copied,
            self.samples_framed,
            self.controllable_copies_per_sample
        )
    }
}
