/**
 * Main ↔ I/O Worker message protocol.
 * Application-facing only — no R2WP field knowledge on either side beyond
 * opaque binary frames the Worker already owns.
 */

export type MainToWorker =
  | { type: "init"; wasmUrl: string }
  | { type: "connect"; url: string; requestId: number }
  | {
      type: "subscribe";
      requestId: number;
      topic: string;
      typeName: string;
      channelId: number;
      correlation: number[];
    }
  | {
      type: "unsubscribe";
      requestId: number;
      channelId: number;
      correlation: number[];
    }
  | { type: "releaseLease"; leaseId: number }
  | { type: "close"; requestId: number };

export type WorkerToMain =
  | { type: "ready" }
  | { type: "connected"; requestId: number }
  | {
      type: "subscribed";
      requestId: number;
      channelId: number;
      topic: string;
      typeName: string;
    }
  | {
      type: "subscribeFailed";
      requestId: number;
      channelId: number;
      code: number;
      message: string;
    }
  | {
      type: "sample";
      channelId: number;
      leaseId: number;
      data: string;
    }
  | { type: "error"; requestId?: number; message: string }
  | { type: "closed"; requestId?: number };
