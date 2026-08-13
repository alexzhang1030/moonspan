/**
 * Host, wasm poll ABI, buffer strategies, session `connect`, and test helpers.
 *
 * Application code should import `rclweb` (`init` / `Node`). This
 * submodule is for repository tests, the e2e harness internals, and
 * contributors working on the poll boundary — not a stability promise.
 */

export { connect, connectOfflineForTests, resolveIoWorkerUrl } from "./client.ts";
export type {
  ActionClient,
  ActionFeedbackHandler,
  ActionServer,
  ActionServerHandlers,
  ActionStatusHandler,
  ConnectOptions,
  GraphEndpoint,
  GraphHandler,
  GraphNode,
  GraphView,
  Publisher,
  QosOptions,
  RclwebClient,
  RclwebSession,
  SampleLease,
  SampleMessage,
  ServiceClient,
  ServiceServer,
  ServiceServerHandler,
  StdMsgsString,
  Subscription,
  SubscriptionHandler,
} from "./client.ts";
export { DEFAULT_QOS_DEPTH, isPointCloud2, isStdMsgsString } from "./client.ts";

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
