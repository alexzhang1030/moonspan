/// <reference lib="webworker" />
/**
 * I/O Worker: owns WebSocket + wasm poll. Main thread speaks only typed
 * application messages (ADR 0004).
 */

import { IoHost } from "../host.ts";
import type { MainToWorker, WorkerToMain } from "./messages.ts";

declare const self: DedicatedWorkerGlobalScope;

let host: IoHost | null = null;
let connectRequestId = 0;
const pendingSubscribe = new Map<
  number,
  { requestId: number; channelId: number }
>();

function post(msg: WorkerToMain): void {
  self.postMessage(msg);
}

self.onmessage = async (ev: MessageEvent<MainToWorker>) => {
  const msg = ev.data;
  try {
    switch (msg.type) {
      case "init": {
        const response = await fetch(msg.wasmUrl);
        if (!response.ok) {
          throw new Error(`failed to fetch wasm: ${response.status}`);
        }
        const bytes = await response.arrayBuffer();
        host = await IoHost.create(bytes, {
          onEvent(event) {
            switch (event.type) {
              case "sessionReady":
                post({ type: "connected", requestId: connectRequestId });
                break;
              case "subscribed": {
                const pending = pendingSubscribe.get(event.channelId);
                post({
                  type: "subscribed",
                  requestId: pending?.requestId ?? 0,
                  channelId: event.channelId,
                  topic: event.topic,
                  typeName: event.typeName,
                });
                pendingSubscribe.delete(event.channelId);
                break;
              }
              case "subscribeFailed": {
                const pending = pendingSubscribe.get(event.channelId);
                post({
                  type: "subscribeFailed",
                  requestId: pending?.requestId ?? 0,
                  channelId: event.channelId,
                  code: event.code,
                  message: event.message,
                });
                pendingSubscribe.delete(event.channelId);
                break;
              }
              case "sample":
                if (event.stringData != null) {
                  post({
                    type: "sample",
                    channelId: event.channelId,
                    leaseId: event.leaseId,
                    data: event.stringData,
                  });
                } else {
                  // Undelivered sample: release the lease at the drop site so
                  // the engine can reclaim the retained slab.
                  host?.releaseLease(event.leaseId);
                }
                break;
              case "error":
                post({ type: "error", message: event.message });
                break;
              case "closed":
                post({ type: "closed" });
                break;
              default:
                break;
            }
          },
          onTransportError(message) {
            post({ type: "error", message });
          },
          onClosed() {
            post({ type: "closed" });
          },
        });
        post({ type: "ready" });
        break;
      }
      case "connect": {
        if (!host) throw new Error("host not initialized");
        connectRequestId = msg.requestId;
        host.connect(msg.url);
        break;
      }
      case "subscribe": {
        if (!host) throw new Error("host not initialized");
        pendingSubscribe.set(msg.channelId, {
          requestId: msg.requestId,
          channelId: msg.channelId,
        });
        host.subscribe({
          correlation: Uint8Array.from(msg.correlation),
          channelId: msg.channelId,
          topic: msg.topic,
          typeName: msg.typeName,
        });
        break;
      }
      case "unsubscribe": {
        if (!host) throw new Error("host not initialized");
        host.unsubscribe(Uint8Array.from(msg.correlation), msg.channelId);
        break;
      }
      case "releaseLease": {
        host?.releaseLease(msg.leaseId);
        break;
      }
      case "close": {
        host?.dispose();
        host = null;
        post({ type: "closed", requestId: msg.requestId });
        break;
      }
    }
  } catch (err) {
    post({
      type: "error",
      requestId: "requestId" in msg ? msg.requestId : undefined,
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
