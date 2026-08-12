/**
 * @rclweb/sdk — TypeScript host around the `rclweb` wasm core.
 *
 * Public surface: `connect(url)` → `session.subscribe|publish(topic, type, qos?)`
 * → typed `std_msgs/msg/String` events (subscribe) or outbound samples (publish).
 * The SDK does not parse R2WP (architecture rule); the I/O Worker owns WebSocket
 * bytes and the poll ABI. Reconnect is a fresh session (SessionResume parked).
 */

export {
  connect,
  connectOfflineForTests,
  DEFAULT_QOS_DEPTH,
  STD_MSGS_STRING,
  type ActionClient,
  type ActionFeedbackHandler,
  type ActionServer,
  type ActionServerHandlers,
  type ActionStatusHandler,
  type ConnectOptions,
  type GraphEndpoint,
  type GraphHandler,
  type GraphNode,
  type GraphView,
  type Publisher,
  type QosOptions,
  type RclwebClient,
  type RclwebSession,
  type SampleLease,
  type ServiceClient,
  type ServiceServer,
  type ServiceServerHandler,
  type StdMsgsString,
  type Subscription,
  type SubscriptionHandler,
} from "./client.ts";

export {
  encodeHostBatch,
  encodeHostBatchExternalWs,
  decodePollResult,
  decodePointCloud2Meta,
  loadWasm,
  pointCloud2DataView,
  pollEngine,
  readTelemetry,
  LARGE_FRAME_INLINE_THRESHOLD,
} from "./wasm/abi.ts";
export type {
  EngineTelemetrySnapshot,
  PointCloud2Meta,
} from "./wasm/abi.ts";
export {
  TransferableArrayBufferStrategy,
  SharedArrayBufferRingStrategy,
  createBufferStrategy,
  sharedArrayBufferConstructible,
  type BufferStrategy,
  type BufferStrategyName,
  type BufferStrategyStats,
} from "./buffer/strategies.ts";
export { IoHost } from "./host.ts";
export const SENSOR_MSGS_POINT_CLOUD2 = "sensor_msgs/msg/PointCloud2";
