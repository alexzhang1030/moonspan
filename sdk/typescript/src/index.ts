/**
 * @rclweb/sdk — TypeScript host around the `rclweb` wasm core.
 *
 * Public surface: `connect(url)` → `session.subscribe|publish(topic, type, qos?)`
 * → typed `std_msgs/msg/String` and `sensor_msgs/msg/PointCloud2` events.
 * The SDK does not parse R2WP (architecture rule); the I/O Worker owns WebSocket
 * bytes and the poll ABI. Reconnect is a fresh session (SessionResume parked).
 *
 * Host, wasm ABI, and test helpers live on `@rclweb/sdk/internal`.
 */

export {
  connect,
  DEFAULT_QOS_DEPTH,
  SENSOR_MSGS_POINT_CLOUD2,
  STD_MSGS_STRING,
  isPointCloud2,
  isStdMsgsString,
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
  type PointCloud2,
  type Publisher,
  type QosOptions,
  type RclwebClient,
  type RclwebSession,
  type SampleLease,
  type SampleMessage,
  type ServerCertificateHash,
  type ServiceClient,
  type ServiceServer,
  type ServiceServerHandler,
  type StdMsgsString,
  type Subscription,
  type SubscriptionHandler,
} from "./client.ts";

export type { EngineTelemetrySnapshot } from "./wasm/abi.ts";

export {
  fetchLocalDevTlsHashes,
  decodeCertificateHashValue,
  httpOriginFromWebTransportUrl,
} from "./local-dev-tls.ts";
