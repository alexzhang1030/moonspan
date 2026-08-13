/** Host/session message and lease types. Application code uses `rclweb` `Node`. */

import type { GeneratedMsg } from "./generated-value.ts";

/** Default KEEP_LAST depth when callers omit QoS depth (matches core). */
export const DEFAULT_QOS_DEPTH = 5;

export type StdMsgsString = {
  data: string;
};

/** Host/session wire shape for PointCloud2. Application code uses `sensor_msgs.msg.PointCloud2`. */
export type PointCloud2Field = {
  name: string;
  offset: number;
  datatype: number;
  count: number;
};

export type PointCloud2 = {
  stampSec: number;
  stampNanosec: number;
  frameId: string;
  height: number;
  width: number;
  fields: PointCloud2Field[];
  isBigendian: boolean;
  pointStep: number;
  rowStep: number;
  isDense: boolean;
  data: Uint8Array;
};

export type SampleMessage = StdMsgsString | PointCloud2 | GeneratedMsg;

export function isStdMsgsString(message: SampleMessage): message is StdMsgsString {
  return "data" in message && typeof message.data === "string";
}

export function isPointCloud2(message: SampleMessage): message is PointCloud2 {
  return (
    "data" in message &&
    message.data instanceof Uint8Array &&
    "frameId" in message
  );
}

/** Borrowed-view lease: call `release()` when the payload is no longer needed. */
export type SampleLease = {
  readonly leaseId: number;
  release(): void;
};

export type SubscriptionHandler<T extends SampleMessage = SampleMessage> = (
  message: T,
  lease: SampleLease,
) => void;

/** R2-01 QoS subset: reliability + KEEP_LAST depth. */
export type QosOptions = {
  /** 1 RELIABLE (default), 2 BEST_EFFORT. */
  reliability?: number;
  /** KEEP_LAST history depth (default 5). */
  depth?: number;
};

export type ConnectOptions = {
  /**
   * When true, run the I/O + wasm host on the calling thread instead of a
   * Worker. Used by bun tests; browsers should leave this false.
   */
  inline?: boolean;
  /** Override path/URL to the `rclweb.wasm` artifact. */
  wasmUrl?: string | URL;
  /**
   * Override the I/O Worker module URL. Default is `./worker/io-worker.ts`
   * next to this script when the caller loaded TypeScript, or
   * `./worker/io-worker.js` next to the browser bundle.
   */
  workerUrl?: string | URL;
  /**
   * Fresh-session reconnect on transport close (R2-01). SessionResume stays
   * parked in the v0.1 subset — this re-runs ClientHello → Auth → SessionReady
   * and re-opens subscribe, publish, service, and action channels with the
   * same client-assigned channel IDs so existing session objects keep working.
   */
  reconnect?: boolean;
  /** Max reconnect attempts (default 3). */
  reconnectAttempts?: number;
  /**
   * Transport for the session plane. Default `websocket`. `webtransport`
   * requires a host that exposes `globalThis.WebTransport` (browsers); bun
   * tests without WT should keep the default.
   */
  transport?: "websocket" | "webtransport";
  /**
   * Certificate hashes for `new WebTransport(url, { serverCertificateHashes })`
   * (ADR 0011 local-dev path). `value` may be base64 text or raw bytes.
   */
  serverCertificateHashes?: Array<{
    algorithm: "sha-256";
    value: string | BufferSource;
  }>;
  /**
   * When using WebTransport without explicit hashes, fetch
   * `{httpOrigin}/local-dev/tls` and use the advertised SPKI hashes.
   */
  fetchLocalDevTls?: boolean;
  /** HTTP origin for `/local-dev/tls` (defaults from the WT URL). */
  localDevTlsOrigin?: string;
};

/** One entry for WebTransport `serverCertificateHashes`. */
export type ServerCertificateHash = {
  algorithm: "sha-256";
  value: string | BufferSource;
};

export type ServiceClient = {
  readonly name: string;
  readonly typeName: string;
  readonly channelId: number;
  call(request: Uint8Array): Promise<Uint8Array>;
  close(): Promise<void>;
};

export type ServiceServerHandler = (
  request: Uint8Array,
  operationId: Uint8Array,
) => Uint8Array | Promise<Uint8Array>;

export type ServiceServer = {
  readonly name: string;
  readonly typeName: string;
  readonly channelId: number;
  close(): Promise<void>;
};

export type ActionFeedbackHandler = (
  feedback: Uint8Array,
  operationId: Uint8Array,
) => void;

export type ActionStatusHandler = (
  status: Uint8Array,
  operationId: Uint8Array,
) => void;

export type ActionClient = {
  readonly name: string;
  readonly typeName: string;
  readonly channelId: number;
  sendGoal(goal: Uint8Array): {
    operationId: Uint8Array;
    result: Promise<Uint8Array>;
  };
  cancel(operationId: Uint8Array): void;
  onFeedback(handler: ActionFeedbackHandler): void;
  onStatus(handler: ActionStatusHandler): void;
  close(): Promise<void>;
};

export type ActionServerHandlers = {
  onGoal?: (
    goal: Uint8Array,
    operationId: Uint8Array,
  ) => void | Promise<void>;
  onCancel?: (operationId: Uint8Array) => void | Promise<void>;
};

export type ActionServer = {
  readonly name: string;
  readonly typeName: string;
  readonly channelId: number;
  sendFeedback(operationId: Uint8Array, feedback: Uint8Array): void;
  sendResult(operationId: Uint8Array, result: Uint8Array): void;
  sendStatus(operationId: Uint8Array, status: Uint8Array): void;
  close(): Promise<void>;
};

export type GraphNode = {
  id: string;
  name: string;
  domain_id: number;
};

export type GraphEndpoint = {
  id: string;
  node_id?: string;
  name: string;
  kind?: number;
  type_name?: string;
  domain_id: number;
};

export type GraphView = {
  generation: number;
  nodes: GraphNode[];
  endpoints: GraphEndpoint[];
};

export type GraphHandler = (graph: GraphView) => void;
