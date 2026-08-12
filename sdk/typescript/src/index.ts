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
  type ConnectOptions,
  type Publisher,
  type QosOptions,
  type RclwebClient,
  type RclwebSession,
  type SampleLease,
  type StdMsgsString,
  type Subscription,
  type SubscriptionHandler,
} from "./client.ts";

export { encodeHostBatch, decodePollResult, loadWasm, pollEngine, readTelemetry } from "./wasm/abi.ts";
export type { EngineTelemetrySnapshot } from "./wasm/abi.ts";
export { IoHost } from "./host.ts";
