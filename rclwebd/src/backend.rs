//! ROS attachment boundary for the gateway.
//!
//! One trait separates the R2WP session engine from the serialized-only rcl
//! surface so protocol behavior is testable without a ROS installation. The
//! real implementation is [`crate::ros::RclBackend`] (`feature = "ros"`);
//! tests substitute an in-memory backend.

use crate::qos::EffectiveQos;
use tokio::sync::mpsc;

/// Opaque backend entity handle (publisher or subscription).
pub type EntityId = u64;

/// Reserved frame-header prefix length inside a sample buffer.
pub const SAMPLE_HEADER_PREFIX: usize = rclweb::FRAME_HEADER_LENGTH;

/// One inbound serialized sample.
///
/// `frame_buf` holds `SAMPLE_HEADER_PREFIX` reserved zero bytes followed by
/// the serialized CDR payload, so the connection can fill the R2WP frame
/// header in place and send without another payload copy (one controllable
/// gateway copy total: rcl take buffer → this buffer).
#[derive(Debug)]
pub struct SubscriptionSample {
    pub channel_id: u32,
    pub frame_buf: Vec<u8>,
}

impl SubscriptionSample {
    /// Build a sample buffer from a serialized payload (the one controllable
    /// gateway copy).
    #[must_use]
    pub fn from_payload(channel_id: u32, payload: &[u8]) -> Self {
        let mut frame_buf = vec![0u8; SAMPLE_HEADER_PREFIX + payload.len()];
        frame_buf[SAMPLE_HEADER_PREFIX..].copy_from_slice(payload);
        Self {
            channel_id,
            frame_buf,
        }
    }

    #[must_use]
    pub fn payload(&self) -> &[u8] {
        &self.frame_buf[SAMPLE_HEADER_PREFIX..]
    }
}

/// Backend failure carrying the wire error code used in error bodies.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BackendError {
    /// Registry wire error code (for example 10 schema_unavailable,
    /// 11 qos_incompatible, 13 resource_exhausted).
    pub code: u8,
    pub message: String,
}

impl BackendError {
    #[must_use]
    pub fn new(code: u8, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

impl std::fmt::Display for BackendError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "backend error {}: {}", self.code, self.message)
    }
}

impl std::error::Error for BackendError {}

/// Channel attachment request resolved from OpenChannel.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChannelSpec {
    pub channel_id: u32,
    pub topic: String,
    /// ROS type name in `pkg/msg/Type` form.
    pub type_name: String,
    pub qos: EffectiveQos,
}

/// Serialized-only ROS attachment surface used by the session engine.
///
/// Methods return quickly; the rcl implementation forwards commands to its
/// dedicated ROS thread and awaits the reply.
pub trait RosBackend: Send + Sync + 'static {
    /// Create a serialized subscription; samples flow into `sink` tagged with
    /// the channel id.
    fn create_subscription(
        &self,
        spec: &ChannelSpec,
        sink: mpsc::Sender<SubscriptionSample>,
    ) -> impl Future<Output = Result<EntityId, BackendError>> + Send;

    /// Create a serialized publisher.
    fn create_publisher(
        &self,
        spec: &ChannelSpec,
    ) -> impl Future<Output = Result<EntityId, BackendError>> + Send;

    /// Publish one serialized CDR payload on a previously created publisher.
    fn publish(
        &self,
        entity: EntityId,
        payload: Vec<u8>,
    ) -> impl Future<Output = Result<(), BackendError>> + Send;

    /// Destroy a publisher or subscription (idempotent).
    fn destroy(&self, entity: EntityId) -> impl Future<Output = ()> + Send;
}
