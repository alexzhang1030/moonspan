/**
 * Main ↔ I/O Worker message protocol.
 * Application-facing only — no R2WP field knowledge on either side beyond
 * opaque binary frames the Worker already owns.
 *
 * Service/action payloads are copied out of wasm in the Worker and the lease
 * is released there. Generated service/action roots copy packed host-value
 * bytes; untyped channels stay CDR. PointCloud2 `data` is copied the same
 * way. Generated corpus messages are copied as host-value objects. Main never
 * sees payload pointers.
 */

import type { GeneratedMsg } from "../generated-value.ts";
import type { PointCloud2 } from "../types.ts";
import type { EngineTelemetrySnapshot } from "../wasm/abi.ts";

export type MainToWorker =
  | { type: "init"; wasmUrl: string }
  | {
      type: "connect";
      url: string;
      requestId: number;
      transport?: "websocket" | "webtransport";
      serverCertificateHashes?: Array<{
        algorithm: "sha-256";
        value: string | number[];
      }>;
      fetchLocalDevTls?: boolean;
      localDevTlsOrigin?: string;
    }
  | { type: "reconnect"; requestId: number }
  | {
      type: "subscribe";
      requestId: number;
      topic: string;
      typeName: string;
      channelId: number;
      correlation: number[];
      qosReliability?: number;
      qosDepth?: number;
    }
  | {
      type: "publish";
      requestId: number;
      topic: string;
      typeName: string;
      channelId: number;
      correlation: number[];
      qosReliability?: number;
      qosDepth?: number;
    }
  | {
      type: "sendSample";
      requestId: number;
      channelId: number;
      data: string;
    }
  | {
      type: "sendPointCloud2";
      requestId: number;
      channelId: number;
      message: PointCloud2;
    }
  | {
      type: "sendGenerated";
      requestId: number;
      channelId: number;
      typeName: string;
      value: Uint8Array;
    }
  | {
      type: "unsubscribe";
      requestId: number;
      channelId: number;
      correlation: number[];
    }
  | {
      type: "openService";
      requestId: number;
      channelId: number;
      name: string;
      typeName: string;
      client: boolean;
      correlation: number[];
    }
  | {
      type: "callService";
      requestId: number;
      channelId: number;
      operationId: number[];
      request: Uint8Array;
    }
  | {
      type: "sendServiceResponse";
      requestId: number;
      channelId: number;
      operationId: number[];
      response: Uint8Array;
    }
  | {
      type: "openAction";
      requestId: number;
      channelId: number;
      name: string;
      typeName: string;
      client: boolean;
      correlation: number[];
    }
  | {
      type: "sendActionGoal";
      requestId: number;
      channelId: number;
      operationId: number[];
      goal: Uint8Array;
    }
  | {
      type: "cancelAction";
      requestId: number;
      channelId: number;
      operationId: number[];
    }
  | {
      type: "sendActionFeedback";
      requestId: number;
      channelId: number;
      operationId: number[];
      feedback: Uint8Array;
    }
  | {
      type: "sendActionResult";
      requestId: number;
      channelId: number;
      operationId: number[];
      result: Uint8Array;
    }
  | {
      type: "sendActionStatus";
      requestId: number;
      channelId: number;
      operationId: number[];
      status: Uint8Array;
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
      type: "published";
      requestId: number;
      channelId: number;
      topic: string;
      typeName: string;
      qosReliability: number;
    }
  | {
      type: "publishFailed";
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
  | {
      type: "samplePointCloud2";
      channelId: number;
      leaseId: number;
      message: PointCloud2;
    }
  | {
      type: "sampleGenerated";
      channelId: number;
      leaseId: number;
      typeName: string;
      message: GeneratedMsg;
    }
  | {
      type: "serviceReady";
      requestId: number;
      channelId: number;
      name: string;
      typeName: string;
      client: boolean;
    }
  | {
      type: "serviceFailed";
      requestId: number;
      channelId: number;
      code: number;
      message: string;
    }
  | {
      type: "serviceResponse";
      requestId: number;
      channelId: number;
      operationId: number[];
      payload: Uint8Array;
    }
  | {
      type: "serviceRequest";
      channelId: number;
      operationId: number[];
      payload: Uint8Array;
    }
  | {
      type: "actionReady";
      requestId: number;
      channelId: number;
      name: string;
      typeName: string;
      client: boolean;
    }
  | {
      type: "actionFailed";
      requestId: number;
      channelId: number;
      code: number;
      message: string;
    }
  | {
      type: "actionGoal";
      channelId: number;
      operationId: number[];
      payload: Uint8Array;
    }
  | {
      type: "actionFeedback";
      channelId: number;
      operationId: number[];
      payload: Uint8Array;
    }
  | {
      type: "actionResult";
      requestId: number;
      channelId: number;
      operationId: number[];
      payload: Uint8Array;
    }
  | {
      type: "actionStatus";
      channelId: number;
      operationId: number[];
      payload: Uint8Array;
    }
  | {
      type: "graphSnapshot";
      generation: number;
      nodesJson: string;
      endpointsJson: string;
    }
  | { type: "graphDelta"; generation: number }
  | {
      type: "operationCancelled";
      channelId: number;
      code: number;
      message: string;
    }
  | { type: "error"; requestId?: number; message: string }
  | { type: "ack"; requestId: number }
  | { type: "telemetry"; snapshot: EngineTelemetrySnapshot }
  | { type: "closed"; requestId?: number };
