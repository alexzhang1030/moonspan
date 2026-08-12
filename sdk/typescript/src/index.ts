/**
 * @rclweb/sdk — TypeScript host around the `rclweb` wasm core.
 *
 * Public surface: `connect(url)` → `session.subscribe(topic, type)` → typed
 * `std_msgs/msg/String` events with an explicit sample lease. The SDK does
 * not parse R2WP (architecture rule); the I/O Worker owns WebSocket bytes and
 * the poll ABI.
 */

export {
  connect,
  connectOfflineForTests,
  STD_MSGS_STRING,
  type ConnectOptions,
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
