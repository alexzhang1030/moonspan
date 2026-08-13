/// <reference lib="webworker" />
/**
 * I/O Worker: owns WebSocket + wasm poll. Main thread speaks only typed
 * application messages (ADR 0004).
 *
 * Service/action payloads are copied out of wasm here and the lease is
 * released before the message crosses to main. Generated service/action
 * roots become packed host-value bytes; untyped channels stay CDR.
 * PointCloud2 `data` is copied the same way; generated corpus messages are
 * copied as host-value objects. String samples keep the lease until main
 * calls release().
 */

import { IoHost } from "../host.ts";
import { generatedOpTypeName, isGeneratedMsgType, type GeneratedOpKind } from "../interfaces.ts";
import type { GeneratedMsg } from "../generated-value.ts";
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
const pendingService = new Map<
  number,
  { requestId: number; channelId: number }
>();
const pendingAction = new Map<
  number,
  { requestId: number; channelId: number }
>();
const pendingCalls = new Map<string, number>();
const pendingActionResults = new Map<string, number>();
const channelTypes = new Map<number, string>();

function post(msg: WorkerToMain, transfer: Transferable[] = []): void {
  if (transfer.length > 0) {
    self.postMessage(msg, transfer);
  } else {
    self.postMessage(msg);
  }
}

function opidKey(channelId: number, operationId: Uint8Array): string {
  let hex = `${channelId}:`;
  for (let i = 0; i < operationId.length; i++) {
    hex += operationId[i]!.toString(16).padStart(2, "0");
  }
  return hex;
}

function generatedTransferables(message: GeneratedMsg): Transferable[] {
  if ("bytes_value" in message && message.bytes_value.byteLength > 0) {
    return [message.bytes_value.buffer];
  }
  if ("collections" in message && message.collections.bytes_value.byteLength > 0) {
    return [message.collections.bytes_value.buffer];
  }
  return [];
}

function asBytes(value: Uint8Array | number[]): Uint8Array {
  return value instanceof Uint8Array ? value : Uint8Array.from(value);
}

function copyAndRelease(
  event: {
    payloadPtr: number;
    payloadLen: number;
    leaseId: number;
    operationId: Uint8Array;
  },
  channelId: number,
  op?: GeneratedOpKind,
): { operationId: number[]; payload: Uint8Array } {
  const typeName = channelTypes.get(channelId);
  const section = op && typeName ? generatedOpTypeName(typeName, op) : undefined;
  const payload = section
    ? (host!.copyGeneratedBytes(section, event.payloadPtr, event.payloadLen) ??
      host!.copyPayload(event.payloadPtr, event.payloadLen))
    : host!.copyPayload(event.payloadPtr, event.payloadLen);
  const operationId = Array.from(event.operationId);
  host!.releaseLease(event.leaseId);
  host!.flushSync();
  return { operationId, payload };
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
                  const typeName = channelTypes.get(event.channelId);
                  if (typeName && isGeneratedMsgType(typeName)) {
                    const copied = host?.decodeGenerated(
                      typeName,
                      event.payloadPtr,
                      event.payloadLen,
                    );
                    host?.releaseLease(event.leaseId);
                    host?.flushSync();
                    if (copied) {
                      post(
                        {
                          type: "sampleGenerated",
                          channelId: event.channelId,
                          leaseId: event.leaseId,
                          typeName,
                          message: copied,
                        },
                        generatedTransferables(copied),
                      );
                    }
                  } else {
                    const copied = host?.copyPointCloud2(
                      event.payloadPtr,
                      event.payloadLen,
                    );
                    host?.releaseLease(event.leaseId);
                    host?.flushSync();
                    if (copied) {
                      post(
                        {
                          type: "samplePointCloud2",
                          channelId: event.channelId,
                          leaseId: event.leaseId,
                          message: copied,
                        },
                        [copied.data.buffer],
                      );
                    }
                  }
                }
                break;
              case "serviceReady": {
                const pending = pendingService.get(event.channelId);
                post({
                  type: "serviceReady",
                  requestId: pending?.requestId ?? 0,
                  channelId: event.channelId,
                  name: event.name,
                  typeName: event.typeName,
                  client: event.client,
                });
                pendingService.delete(event.channelId);
                break;
              }
              case "serviceFailed": {
                const pending = pendingService.get(event.channelId);
                post({
                  type: "serviceFailed",
                  requestId: pending?.requestId ?? 0,
                  channelId: event.channelId,
                  code: event.code,
                  message: event.message,
                });
                pendingService.delete(event.channelId);
                break;
              }
              case "serviceResponse": {
                const copied = copyAndRelease(event, event.channelId, "Response");
                const key = opidKey(event.channelId, event.operationId);
                const requestId = pendingCalls.get(key) ?? 0;
                pendingCalls.delete(key);
                post({
                  type: "serviceResponse",
                  requestId,
                  channelId: event.channelId,
                  operationId: copied.operationId,
                  payload: copied.payload,
                });
                break;
              }
              case "serviceRequest": {
                const copied = copyAndRelease(event, event.channelId, "Request");
                post({
                  type: "serviceRequest",
                  channelId: event.channelId,
                  operationId: copied.operationId,
                  payload: copied.payload,
                });
                break;
              }
              case "actionReady": {
                const pending = pendingAction.get(event.channelId);
                post({
                  type: "actionReady",
                  requestId: pending?.requestId ?? 0,
                  channelId: event.channelId,
                  name: event.name,
                  typeName: event.typeName,
                  client: event.client,
                });
                pendingAction.delete(event.channelId);
                break;
              }
              case "actionFailed": {
                const pending = pendingAction.get(event.channelId);
                post({
                  type: "actionFailed",
                  requestId: pending?.requestId ?? 0,
                  channelId: event.channelId,
                  code: event.code,
                  message: event.message,
                });
                pendingAction.delete(event.channelId);
                break;
              }
              case "actionGoal": {
                const copied = copyAndRelease(event, event.channelId, "Goal");
                post({
                  type: "actionGoal",
                  channelId: event.channelId,
                  operationId: copied.operationId,
                  payload: copied.payload,
                });
                break;
              }
              case "actionFeedback": {
                const copied = copyAndRelease(event, event.channelId, "Feedback");
                post({
                  type: "actionFeedback",
                  channelId: event.channelId,
                  operationId: copied.operationId,
                  payload: copied.payload,
                });
                break;
              }
              case "actionResult": {
                const copied = copyAndRelease(event, event.channelId, "Result");
                const key = opidKey(event.channelId, event.operationId);
                const requestId = pendingActionResults.get(key) ?? 0;
                pendingActionResults.delete(key);
                post({
                  type: "actionResult",
                  requestId,
                  channelId: event.channelId,
                  operationId: copied.operationId,
                  payload: copied.payload,
                });
                break;
              }
              case "actionStatus": {
                const copied = copyAndRelease(event, event.channelId);
                post({
                  type: "actionStatus",
                  channelId: event.channelId,
                  operationId: copied.operationId,
                  payload: copied.payload,
                });
                break;
              }
              case "graphSnapshot":
                post({
                  type: "graphSnapshot",
                  generation: Number(event.generation),
                  nodesJson: event.nodesJson,
                  endpointsJson: event.endpointsJson,
                });
                break;
              case "graphDelta":
                post({
                  type: "graphDelta",
                  generation: Number(event.generation),
                });
                break;
              case "operationCancelled":
                post({
                  type: "operationCancelled",
                  channelId: event.channelId,
                  code: event.code,
                  message: event.message,
                });
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
          onPollEnd(snapshot) {
            if (snapshot) {
              post({ type: "telemetry", snapshot });
            }
          },
        });
        post({ type: "ready" });
        break;
      }
      case "connect": {
        if (!host) throw new Error("host not initialized");
        connectRequestId = msg.requestId;
        connectUrl = msg.url;
        const hashes = msg.serverCertificateHashes?.map((h) => ({
          algorithm: h.algorithm,
          value:
            typeof h.value === "string"
              ? h.value
              : Uint8Array.from(h.value),
        }));
        host.connect(msg.url, {
          transport: msg.transport,
          serverCertificateHashes: hashes,
          fetchLocalDevTls: msg.fetchLocalDevTls,
          localDevTlsOrigin: msg.localDevTlsOrigin,
        });
        break;
      }
      case "reconnect": {
        if (!host) throw new Error("host not initialized");
        if (!connectUrl) throw new Error("reconnect without prior connect");
        connectRequestId = msg.requestId;
        pendingSubscribe.clear();
        pendingPublish.clear();
        pendingService.clear();
        pendingAction.clear();
        pendingCalls.clear();
        pendingActionResults.clear();
        await host.reconnect(connectUrl);
        break;
      }
      case "subscribe": {
        if (!host) throw new Error("host not initialized");
        pendingSubscribe.set(msg.channelId, {
          requestId: msg.requestId,
          channelId: msg.channelId,
        });
        channelTypes.set(msg.channelId, msg.typeName);
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
        channelTypes.set(msg.channelId, msg.typeName);
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
      case "sendPointCloud2": {
        if (!host) throw new Error("host not initialized");
        host.sendPointCloud2(msg.channelId, msg.message);
        host.flushSync();
        post({ type: "ack", requestId: msg.requestId });
        break;
      }
      case "sendGenerated": {
        if (!host) throw new Error("host not initialized");
        host.sendGenerated(msg.channelId, msg.typeName, asBytes(msg.value));
        host.flushSync();
        post({ type: "ack", requestId: msg.requestId });
        break;
      }
      case "unsubscribe": {
        if (!host) throw new Error("host not initialized");
        channelTypes.delete(msg.channelId);
        host.unsubscribe(Uint8Array.from(msg.correlation), msg.channelId);
        break;
      }
      case "openService": {
        if (!host) throw new Error("host not initialized");
        pendingService.set(msg.channelId, {
          requestId: msg.requestId,
          channelId: msg.channelId,
        });
        channelTypes.set(msg.channelId, msg.typeName);
        host.openService({
          correlation: Uint8Array.from(msg.correlation),
          channelId: msg.channelId,
          name: msg.name,
          typeName: msg.typeName,
          client: msg.client,
        });
        break;
      }
      case "callService": {
        if (!host) throw new Error("host not initialized");
        const operationId = asBytes(msg.operationId);
        pendingCalls.set(opidKey(msg.channelId, operationId), msg.requestId);
        host.callService(msg.channelId, operationId, asBytes(msg.request));
        host.flushSync();
        break;
      }
      case "sendServiceResponse": {
        if (!host) throw new Error("host not initialized");
        host.sendServiceResponse(
          msg.channelId,
          asBytes(msg.operationId),
          asBytes(msg.response),
        );
        host.flushSync();
        post({ type: "ack", requestId: msg.requestId });
        break;
      }
      case "openAction": {
        if (!host) throw new Error("host not initialized");
        pendingAction.set(msg.channelId, {
          requestId: msg.requestId,
          channelId: msg.channelId,
        });
        channelTypes.set(msg.channelId, msg.typeName);
        host.openAction({
          correlation: Uint8Array.from(msg.correlation),
          channelId: msg.channelId,
          name: msg.name,
          typeName: msg.typeName,
          client: msg.client,
        });
        break;
      }
      case "sendActionGoal": {
        if (!host) throw new Error("host not initialized");
        const operationId = asBytes(msg.operationId);
        pendingActionResults.set(
          opidKey(msg.channelId, operationId),
          msg.requestId,
        );
        host.sendActionGoal(msg.channelId, operationId, asBytes(msg.goal));
        host.flushSync();
        break;
      }
      case "cancelAction": {
        if (!host) throw new Error("host not initialized");
        host.cancelAction(msg.channelId, asBytes(msg.operationId));
        host.flushSync();
        post({ type: "ack", requestId: msg.requestId });
        break;
      }
      case "sendActionFeedback": {
        if (!host) throw new Error("host not initialized");
        host.sendActionFeedback(
          msg.channelId,
          asBytes(msg.operationId),
          asBytes(msg.feedback),
        );
        host.flushSync();
        post({ type: "ack", requestId: msg.requestId });
        break;
      }
      case "sendActionResult": {
        if (!host) throw new Error("host not initialized");
        host.sendActionResult(
          msg.channelId,
          asBytes(msg.operationId),
          asBytes(msg.result),
        );
        host.flushSync();
        post({ type: "ack", requestId: msg.requestId });
        break;
      }
      case "sendActionStatus": {
        if (!host) throw new Error("host not initialized");
        host.sendActionStatus(
          msg.channelId,
          asBytes(msg.operationId),
          asBytes(msg.status),
        );
        host.flushSync();
        post({ type: "ack", requestId: msg.requestId });
        break;
      }
      case "releaseLease": {
        host?.releaseLease(msg.leaseId);
        break;
      }
      case "close": {
        host?.dispose();
        host = null;
        channelTypes.clear();
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
