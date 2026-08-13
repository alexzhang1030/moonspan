/**
 * Host, wasm poll ABI, buffer strategies, and test helpers.
 *
 * Application code should import `@rclweb/sdk`. This submodule is for
 * repository tests, the e2e harness internals, and contributors working
 * on the poll boundary — not a stability promise.
 */

export { connectOfflineForTests } from "./client.ts";
export { resolveIoWorkerUrl } from "./client.ts";

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

export { SENSOR_MSGS_POINT_CLOUD2 } from "./types.ts";
