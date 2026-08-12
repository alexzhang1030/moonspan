/** Public SDK message and lease types. Protocol bytes stay inside the Worker. */

export const STD_MSGS_STRING = "std_msgs/msg/String";

/** Default KEEP_LAST depth when callers omit QoS depth (matches core). */
export const DEFAULT_QOS_DEPTH = 5;

export type StdMsgsString = {
  data: string;
};

/** Borrowed-view lease: call `release()` when the payload is no longer needed. */
export type SampleLease = {
  readonly leaseId: number;
  release(): void;
};

export type SubscriptionHandler = (
  message: StdMsgsString,
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
   * Fresh-session reconnect on transport close (R2-01). SessionResume stays
   * parked in the v0.1 subset — this re-runs ClientHello → Auth → channel opens.
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
