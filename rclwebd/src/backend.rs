//! ROS attachment boundary for the gateway.
//!
//! One trait separates the R2WP session engine from the serialized-only rcl
//! surface so protocol behavior is testable without a ROS installation. The
//! real implementation is [`crate::ros::RclBackend`] (`feature = "ros"`);
//! tests substitute an in-memory backend.

use crate::qos::EffectiveQos;
use crate::telemetry::GatewayTelemetry;
use bytes::Bytes;
use tokio::sync::mpsc;

/// Opaque backend entity handle (publisher, subscription, service, or action).
pub type EntityId = u64;

/// Reserved frame-header prefix length inside a sample / service / action buffer.
pub const SAMPLE_HEADER_PREFIX: usize = rclweb::FRAME_HEADER_LENGTH;

/// One inbound serialized sample.
///
/// `frame_buf` holds `SAMPLE_HEADER_PREFIX` reserved zero bytes followed by
/// the serialized CDR payload, so the connection can fill the R2WP frame
/// header in place. Live ROS take writes CDR into that layout (rmw copy
/// only); [`Self::from_payload`] copies a borrowed slice into it (mock inject).
#[derive(Debug)]
pub struct SubscriptionSample {
  pub channel_id: u32,
  pub frame_buf: Vec<u8>,
}

impl SubscriptionSample {
  /// Adopt an already-prefixed frame buffer (header zeros + CDR). No payload
  /// copy — live ROS take writes CDR after the reserved prefix and steals
  /// this Vec.
  #[must_use]
  pub fn from_prefixed_buffer(channel_id: u32, frame_buf: Vec<u8>) -> Self {
    debug_assert!(frame_buf.len() >= SAMPLE_HEADER_PREFIX);
    Self { channel_id, frame_buf }
  }

  /// Build a sample buffer from a serialized payload (the one controllable
  /// gateway copy). Live ROS take uses [`Self::from_prefixed_buffer`] instead.
  #[must_use]
  pub fn from_payload(channel_id: u32, payload: &[u8]) -> Self {
    Self::from_payload_with_telemetry(channel_id, payload, None)
  }

  /// As [`Self::from_payload`], also bump gateway copy counters when provided.
  #[must_use]
  pub fn from_payload_with_telemetry(
    channel_id: u32,
    payload: &[u8],
    telemetry: Option<&GatewayTelemetry>,
  ) -> Self {
    let mut frame_buf = vec![0u8; SAMPLE_HEADER_PREFIX + payload.len()];
    frame_buf[SAMPLE_HEADER_PREFIX..].copy_from_slice(payload);
    if let Some(telemetry) = telemetry {
      telemetry.record_payload_copy(payload.len());
    }
    Self { channel_id, frame_buf }
  }

  #[must_use]
  pub fn payload(&self) -> &[u8] {
    &self.frame_buf[SAMPLE_HEADER_PREFIX..]
  }
}

/// Inbound service request destined for a ServiceServer channel (browser server).
///
/// Layout matches [`SubscriptionSample`]: reserved header prefix + CDR body.
/// The connection fills the header and attaches `OPERATION_ID` in the extension
/// area before sending.
#[derive(Debug)]
pub struct ServiceRequest {
  pub channel_id: u32,
  pub operation_id: [u8; 16],
  pub frame_buf: Vec<u8>,
}

impl ServiceRequest {
  #[must_use]
  pub fn from_payload(channel_id: u32, operation_id: [u8; 16], payload: &[u8]) -> Self {
    let mut frame_buf = vec![0u8; SAMPLE_HEADER_PREFIX + payload.len()];
    frame_buf[SAMPLE_HEADER_PREFIX..].copy_from_slice(payload);
    Self { channel_id, operation_id, frame_buf }
  }

  #[must_use]
  pub fn payload(&self) -> &[u8] {
    &self.frame_buf[SAMPLE_HEADER_PREFIX..]
  }
}

/// Inbound action goal or cancel for an ActionServer channel (browser server).
#[derive(Debug)]
pub enum ActionInbound {
  Goal { channel_id: u32, operation_id: [u8; 16], frame_buf: Vec<u8> },
  Cancel { channel_id: u32, operation_id: [u8; 16], frame_buf: Vec<u8> },
}

impl ActionInbound {
  #[must_use]
  pub fn from_goal_payload(channel_id: u32, operation_id: [u8; 16], payload: &[u8]) -> Self {
    Self::Goal { channel_id, operation_id, frame_buf: Self::prefixed(payload) }
  }

  #[must_use]
  pub fn from_cancel_payload(channel_id: u32, operation_id: [u8; 16], payload: &[u8]) -> Self {
    Self::Cancel { channel_id, operation_id, frame_buf: Self::prefixed(payload) }
  }

  fn prefixed(payload: &[u8]) -> Vec<u8> {
    let mut frame_buf = vec![0u8; SAMPLE_HEADER_PREFIX + payload.len()];
    frame_buf[SAMPLE_HEADER_PREFIX..].copy_from_slice(payload);
    frame_buf
  }

  #[must_use]
  pub fn channel_id(&self) -> u32 {
    match self {
      Self::Goal { channel_id, .. } | Self::Cancel { channel_id, .. } => *channel_id,
    }
  }

  #[must_use]
  pub fn operation_id(&self) -> [u8; 16] {
    match self {
      Self::Goal { operation_id, .. } | Self::Cancel { operation_id, .. } => *operation_id,
    }
  }

  #[must_use]
  pub fn frame_buf(&self) -> &[u8] {
    match self {
      Self::Goal { frame_buf, .. } | Self::Cancel { frame_buf, .. } => frame_buf,
    }
  }

  #[must_use]
  pub fn payload(&self) -> &[u8] {
    &self.frame_buf()[SAMPLE_HEADER_PREFIX..]
  }
}

/// Graph node row for GraphSnapshot / GraphDelta builders.
#[derive(Debug, Clone)]
pub struct GraphNodeInfo {
  pub id: Vec<u8>,
  pub name: String,
  pub namespace: Option<String>,
  pub domain_id: u8,
}

/// Graph endpoint row (`graph_endpoint_kinds` in the registry).
#[derive(Debug, Clone)]
pub struct GraphEndpointInfo {
  pub id: Vec<u8>,
  pub node_id: Vec<u8>,
  pub name: String,
  /// Registry `graph_endpoint_kinds`: 0 topic_pub, 1 topic_sub, 2 service_server,
  /// 3 service_client, 4 action_server, 5 action_client.
  pub kind: u8,
  pub type_name: String,
  pub domain_id: u8,
}

/// Current backend graph view used to build GraphSnapshot / GraphDelta.
#[derive(Debug, Clone, Default)]
pub struct GraphView {
  pub nodes: Vec<GraphNodeInfo>,
  pub endpoints: Vec<GraphEndpointInfo>,
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
    Self { code, message: message.into() }
  }

  /// Live ROS service/action FFI is not linked in this build.
  #[must_use]
  pub fn schema_unavailable(message: impl Into<String>) -> Self {
    Self::new(10, message)
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
  /// ROS type name (`pkg/msg/Type`, `pkg/srv/Type`, or `pkg/action/Type`).
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
  ///
  /// `payload` is a `Bytes` subslice of the inbound R2WP frame so the
  /// connection does not copy CDR before the ROS thread borrows it.
  fn publish(
    &self,
    entity: EntityId,
    payload: Bytes,
  ) -> impl Future<Output = Result<(), BackendError>> + Send;

  /// Destroy a publisher, subscription, service, or action entity (idempotent).
  fn destroy(&self, entity: EntityId) -> impl Future<Output = ()> + Send;

  /// Opaque service client entity.
  fn create_client(
    &self,
    spec: &ChannelSpec,
  ) -> impl Future<Output = Result<EntityId, BackendError>> + Send;

  /// Opaque service server; inbound requests are pushed to `sink`.
  fn create_service(
    &self,
    spec: &ChannelSpec,
    sink: mpsc::Sender<ServiceRequest>,
  ) -> impl Future<Output = Result<EntityId, BackendError>> + Send;

  /// Call a service client entity; returns the serialized response.
  fn call(
    &self,
    entity: EntityId,
    operation_id: [u8; 16],
    request: Bytes,
  ) -> impl Future<Output = Result<Vec<u8>, BackendError>> + Send;

  /// Reply on a service server entity for an inbound request.
  fn send_service_response(
    &self,
    entity: EntityId,
    operation_id: [u8; 16],
    response: Bytes,
  ) -> impl Future<Output = Result<(), BackendError>> + Send;

  /// Opaque action client entity.
  fn create_action_client(
    &self,
    spec: &ChannelSpec,
  ) -> impl Future<Output = Result<EntityId, BackendError>> + Send;

  /// Opaque action server; inbound goals/cancels are pushed to `sink`.
  fn create_action_server(
    &self,
    spec: &ChannelSpec,
    sink: mpsc::Sender<ActionInbound>,
  ) -> impl Future<Output = Result<EntityId, BackendError>> + Send;

  /// Send a goal on an action client; mock returns the result payload.
  fn send_action_goal(
    &self,
    entity: EntityId,
    operation_id: [u8; 16],
    request: Bytes,
  ) -> impl Future<Output = Result<Vec<u8>, BackendError>> + Send;

  /// Cancel on an action client; mock returns the cancel response payload.
  fn cancel_action(
    &self,
    entity: EntityId,
    operation_id: [u8; 16],
    request: Bytes,
  ) -> impl Future<Output = Result<Vec<u8>, BackendError>> + Send;

  /// Forward feedback from an ActionServer (browser) toward ROS.
  fn send_action_feedback(
    &self,
    entity: EntityId,
    operation_id: [u8; 16],
    payload: Bytes,
  ) -> impl Future<Output = Result<(), BackendError>> + Send;

  /// Forward result from an ActionServer (browser) toward ROS.
  fn send_action_result(
    &self,
    entity: EntityId,
    operation_id: [u8; 16],
    payload: Bytes,
  ) -> impl Future<Output = Result<(), BackendError>> + Send;

  /// Forward status from an ActionServer (browser) toward ROS.
  fn send_action_status(
    &self,
    entity: EntityId,
    operation_id: [u8; 16],
    payload: Bytes,
  ) -> impl Future<Output = Result<(), BackendError>> + Send;

  /// Current graph view for GraphSnapshot / GraphDelta.
  fn graph_view(&self) -> impl Future<Output = Result<GraphView, BackendError>> + Send;
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn from_prefixed_buffer_keeps_payload_in_place() {
    let mut frame_buf = vec![0u8; SAMPLE_HEADER_PREFIX + 4];
    frame_buf[SAMPLE_HEADER_PREFIX..].copy_from_slice(b"abcd");
    let ptr = frame_buf[SAMPLE_HEADER_PREFIX..].as_ptr();
    let sample = SubscriptionSample::from_prefixed_buffer(7, frame_buf);
    assert_eq!(sample.channel_id, 7);
    assert_eq!(sample.payload(), b"abcd");
    assert_eq!(sample.payload().as_ptr(), ptr, "steal must not copy CDR");
  }

  #[test]
  fn from_payload_reserves_header_prefix() {
    let sample = SubscriptionSample::from_payload(3, b"xy");
    assert_eq!(sample.frame_buf.len(), SAMPLE_HEADER_PREFIX + 2);
    assert!(sample.frame_buf[..SAMPLE_HEADER_PREFIX].iter().all(|b| *b == 0));
    assert_eq!(sample.payload(), b"xy");
  }
}
