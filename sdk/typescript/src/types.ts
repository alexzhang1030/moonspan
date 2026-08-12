/** Public SDK message and lease types. Protocol bytes stay inside the Worker. */

export const STD_MSGS_STRING = "std_msgs/msg/String";

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

export type ConnectOptions = {
  /**
   * When true, run the I/O + wasm host on the calling thread instead of a
   * Worker. Used by bun tests; browsers should leave this false.
   */
  inline?: boolean;
  /** Override path/URL to the `rclweb.wasm` artifact. */
  wasmUrl?: string | URL;
};
