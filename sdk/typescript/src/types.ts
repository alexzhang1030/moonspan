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
};
