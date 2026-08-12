/// <reference lib="webworker" />
/**
 * I/O Worker: owns WebSocket + wasm poll. Main thread speaks only typed
 * application messages (ADR 0004).
 */

import { IoHost } from "../host.ts";
import type { MainToWorker, WorkerToMain } from "./messages.ts";

declare const self: DedicatedWorkerGlobalScope;

let host: IoHost | null = null;
let connectUrl = "";
let connectRequestId = 0;
const pendingSubscribe = new Map<
  number,
  { requestId: number; channelId: number }
>();
const pendingPublish = new Map<
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
              case "published": {
                const pending = pendingPublish.get(event.channelId);
                post({
                  type: "published",
                  requestId: pending?.requestId ?? 0,
                  channelId: event.channelId,
                  topic: event.topic,
                  typeName: event.typeName,
                  qosReliability: event.qosReliability,
                });
                pendingPublish.delete(event.channelId);
                break;
              }
              case "publishFailed": {
                const pending = pendingPublish.get(event.channelId);
                post({
                  type: "publishFailed",
                  requestId: pending?.requestId ?? 0,
                  channelId: event.channelId,
                  code: event.code,
                  message: event.message,
                });
                pendingPublish.delete(event.channelId);
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
        connectUrl = msg.url;
        host.connect(msg.url);
        break;
      }
      case "reconnect": {
        if (!host) throw new Error("host not initialized");
        if (!connectUrl) throw new Error("reconnect without prior connect");
        connectRequestId = msg.requestId;
        await host.reconnect(connectUrl);
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
          qosReliability: msg.qosReliability,
          qosDepth: msg.qosDepth,
        });
        break;
      }
      case "publish": {
        if (!host) throw new Error("host not initialized");
        pendingPublish.set(msg.channelId, {
          requestId: msg.requestId,
          channelId: msg.channelId,
        });
        host.publish({
          correlation: Uint8Array.from(msg.correlation),
          channelId: msg.channelId,
          topic: msg.topic,
          typeName: msg.typeName,
          qosReliability: msg.qosReliability,
          qosDepth: msg.qosDepth,
        });
        break;
      }
      case "sendSample": {
        if (!host) throw new Error("host not initialized");
        host.sendSample(msg.channelId, msg.data);
        host.flushSync();
        post({ type: "ack", requestId: msg.requestId });
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
