/**
 * @rclweb/sdk — TypeScript host around the `rclweb` wasm core.
 *
 * Public surface: `connect(url)` → `session.subscribe|publish(topic, type, qos?)`
 * → typed `std_msgs/msg/String` events (subscribe) or outbound samples (publish).
 * The SDK does not parse R2WP (architecture rule); the I/O Worker owns WebSocket
 * bytes and the poll ABI. Reconnect is a fresh session (SessionResume parked).
 *
 * Host, wasm ABI, and test helpers live on `@rclweb/sdk/internal`.
 */

export {
  connect,
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
