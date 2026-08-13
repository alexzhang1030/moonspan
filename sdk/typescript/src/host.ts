/**
 * Shared I/O + wasm poll host used by the Worker and the inline (test) path.
 * Owns the transport (WebSocket or WebTransport) and transferable ingest.
 */

import {
  type AppEvent,
  type EngineTelemetrySnapshot,
  type HostEventInput,
  type PointCloud2Meta,
  type WasmExports,
  decodePointCloud2Meta,
  loadWasm,
  pointCloud2DataView,
  pollEngine,
  readTelemetry,
} from "./wasm/abi.ts";
import type { PointCloud2, ServerCertificateHash } from "./types.ts";
import {
  decodeCertificateHashValue,
  fetchLocalDevTlsHashes,
  httpOriginFromWebTransportUrl,
} from "./local-dev-tls.ts";

export type HostCallbacks = {
  onEvent(event: AppEvent): void;
  onTransportError(message: string): void;
  onClosed(): void;
};

export type HostConnectOptions = {
  transport?: "websocket" | "webtransport";
  serverCertificateHashes?: ServerCertificateHash[];
  fetchLocalDevTls?: boolean;
  localDevTlsOrigin?: string;
};

type OutboundSink = {
  send(bytes: Uint8Array): void | Promise<void>;
  close(): void;
};

/** Minimal WebTransport surface used by the host (browser). */
type WebTransportLike = {
  ready: Promise<void>;
  closed: Promise<unknown>;
  close(): void;
  createBidirectionalStream(): Promise<{
    readable: ReadableStream<Uint8Array>;
    writable: WritableStream<Uint8Array>;
  }>;
};

type WebTransportConstructor = new (
  url: string,
  options?: { serverCertificateHashes?: Array<{ algorithm: string; value: BufferSource }> },
) => WebTransportLike;

export class IoHost {
  #wasm: WasmExports;
  #handle: number;
  #ws: WebSocket | null = null;
  #wt: WebTransportLike | null = null;
  #sink: OutboundSink | null = null;
  #useWebTransport = false;
  #callbacks: HostCallbacks;
  #started = false;
  #closed = false;
  #disposed = false;
  #pending: HostEventInput[] = [];
  #flushScheduled = false;
  #lastTelemetry: EngineTelemetrySnapshot | null = null;
  #suppressCloseHandler = false;
  #connectOptions: HostConnectOptions = {};

  private constructor(wasm: WasmExports, handle: number, callbacks: HostCallbacks) {
    this.#wasm = wasm;
    this.#handle = handle;
    this.#callbacks = callbacks;
  }

  static async create(
    wasmBytes: ArrayBuffer,
    callbacks: HostCallbacks,
  ): Promise<IoHost> {
    const wasm = await loadWasm(wasmBytes);
    const handle = wasm.rclweb_engine_new();
    if (handle === 0) {
      throw new Error("rclweb_engine_new failed");
    }
    return new IoHost(wasm, handle, callbacks);
  }

  connect(url: string, options: HostConnectOptions = {}): void {
    if (this.#ws || this.#wt) {
      throw new Error("already connected");
    }
    this.#connectOptions = options;
    const transport = options.transport ?? "websocket";
    if (transport === "webtransport") {
      void this.#connectWebTransport(url, options);
      return;
    }
    this.#connectWebSocket(url);
  }

  #connectWebSocket(url: string): void {
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    this.#ws = ws;
    this.#useWebTransport = false;
    this.#sink = {
      send: (bytes) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(bytes.slice().buffer);
        }
      },
      close: () => ws.close(),
    };
    ws.addEventListener("open", () => {
      this.#enqueue({
        type: "command",
        command: {
          type: "start",
          transferableArrayBuffer: true,
          webtransport: false,
        },
      });
    });
    ws.addEventListener("message", (ev) => {
      const data = ev.data;
      if (!(data instanceof ArrayBuffer)) {
        this.#callbacks.onTransportError("non-binary websocket message");
        return;
      }
      this.#enqueue({
        type: "wsBytes",
        bufferId: 0,
        bytes: new Uint8Array(data),
      });
    });
    ws.addEventListener("error", () => {
      this.#callbacks.onTransportError("websocket error");
    });
    ws.addEventListener("close", () => {
      this.#closed = true;
      if (!this.#suppressCloseHandler) {
        this.#callbacks.onClosed();
      }
    });
  }

  async #connectWebTransport(
    url: string,
    options: HostConnectOptions,
  ): Promise<void> {
    const WT = (globalThis as { WebTransport?: WebTransportConstructor }).WebTransport;
    if (!WT) {
      this.#callbacks.onTransportError(
        "WebTransport is not available in this runtime (use transport: \"websocket\")",
      );
      return;
    }

    let hashes = options.serverCertificateHashes ?? [];
    if (hashes.length === 0 && options.fetchLocalDevTls !== false) {
      const origin =
        options.localDevTlsOrigin ?? httpOriginFromWebTransportUrl(url);
      try {
        hashes = await fetchLocalDevTlsHashes(origin);
      } catch (err) {
        this.#callbacks.onTransportError(
          `failed to fetch /local-dev/tls: ${err instanceof Error ? err.message : String(err)}`,
        );
        return;
      }
    }

    const serverCertificateHashes = hashes.map((h) => ({
      algorithm: h.algorithm,
      value: decodeCertificateHashValue(h.value),
    }));

    try {
      const wt = new WT(url, { serverCertificateHashes });
      this.#wt = wt;
      this.#useWebTransport = true;
      await wt.ready;
      const stream = await wt.createBidirectionalStream();
      const writer = stream.writable.getWriter();
      const reader = stream.readable.getReader();
      this.#sink = {
        send: async (bytes) => {
          const len = new Uint8Array(4);
          new DataView(len.buffer).setUint32(0, bytes.byteLength, false);
          await writer.write(len);
          await writer.write(bytes.slice());
        },
        close: () => {
          try {
            wt.close();
          } catch {
            // ignore
          }
        },
      };
      this.#enqueue({
        type: "command",
        command: {
          type: "start",
          transferableArrayBuffer: true,
          webtransport: true,
        },
      });
      void this.#readWtLoop(reader);
      void wt.closed.then(() => {
        this.#closed = true;
        if (!this.#suppressCloseHandler) {
          this.#callbacks.onClosed();
        }
      });
    } catch (err) {
      this.#callbacks.onTransportError(
        `webtransport connect failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async #readWtLoop(
    reader: ReadableStreamDefaultReader<Uint8Array>,
  ): Promise<void> {
    let pending = new Uint8Array(0);
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value || value.byteLength === 0) continue;
        const merged = new Uint8Array(pending.length + value.length);
        merged.set(pending, 0);
        merged.set(value, pending.length);
        pending = merged;
        while (pending.length >= 4) {
          const len = new DataView(
            pending.buffer,
            pending.byteOffset,
            pending.byteLength,
          ).getUint32(0, false);
          if (pending.length < 4 + len) break;
          const frame = pending.slice(4, 4 + len);
          pending = pending.slice(4 + len);
          this.#enqueue({
            type: "wsBytes",
            bufferId: 0,
            bytes: frame,
          });
        }
      }
    } catch (err) {
      this.#callbacks.onTransportError(
        `webtransport read failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Feed scripted bytes (tests) as if they arrived on the WebSocket. */
  ingestBytes(bytes: Uint8Array): void {
    this.#enqueue({ type: "wsBytes", bufferId: 0, bytes });
  }

  /** Start bootstrap without a live socket (scripted-peer tests). */
  startOffline(): void {
    this.#enqueue({
      type: "command",
      command: {
        type: "start",
        transferableArrayBuffer: true,
        webtransport: false,
      },
    });
  }

  authenticate(correlation: Uint8Array): void {
    this.#enqueue({
      type: "command",
      command: {
        type: "authenticate",
        correlation,
        scheme: "token",
        token: new TextEncoder().encode("anonymous"),
      },
    });
  }

  subscribe(args: {
    correlation: Uint8Array;
    channelId: number;
    topic: string;
    typeName: string;
    qosReliability?: number;
    qosDepth?: number;
    domainId?: number;
  }): void {
    this.#enqueue({
      type: "command",
      command: {
        type: "subscribe",
        correlation: args.correlation,
        channelId: args.channelId,
        topic: args.topic,
        typeName: args.typeName,
        qosReliability: args.qosReliability ?? 1,
        qosDepth: args.qosDepth ?? 5,
        domainId: args.domainId ?? 0,
      },
    });
  }

  publish(args: {
    correlation: Uint8Array;
    channelId: number;
    topic: string;
    typeName: string;
    qosReliability?: number;
    qosDepth?: number;
    domainId?: number;
  }): void {
    this.#enqueue({
      type: "command",
      command: {
        type: "publish",
        correlation: args.correlation,
        channelId: args.channelId,
        topic: args.topic,
        typeName: args.typeName,
        qosReliability: args.qosReliability ?? 1,
        qosDepth: args.qosDepth ?? 5,
        domainId: args.domainId ?? 0,
      },
    });
  }

  sendSample(channelId: number, data: string): void {
    this.#enqueue({
      type: "command",
      command: { type: "sendSample", channelId, stringData: data },
    });
  }

  sendPointCloud2(channelId: number, cloud: PointCloud2): void {
    this.#enqueue({
      type: "command",
      command: {
        type: "sendPointCloud2",
        channelId,
        stampSec: cloud.stampSec,
        stampNanosec: cloud.stampNanosec,
        frameId: cloud.frameId,
        height: cloud.height,
        width: cloud.width,
        pointStep: cloud.pointStep,
        rowStep: cloud.rowStep,
        isBigendian: cloud.isBigendian,
        isDense: cloud.isDense,
        fields: cloud.fields,
        data: cloud.data,
      },
    });
  }

  openService(args: {
    correlation: Uint8Array;
    channelId: number;
    name: string;
    typeName: string;
    domainId?: number;
    client: boolean;
  }): void {
    this.#enqueue({
      type: "command",
      command: {
        type: "openService",
        correlation: args.correlation,
        channelId: args.channelId,
        name: args.name,
        typeName: args.typeName,
        domainId: args.domainId ?? 0,
        client: args.client,
      },
    });
  }

  callService(
    channelId: number,
    operationId: Uint8Array,
    request: Uint8Array,
  ): void {
    this.#enqueue({
      type: "command",
      command: { type: "callService", channelId, operationId, request },
    });
  }

  sendServiceResponse(
    channelId: number,
    operationId: Uint8Array,
    response: Uint8Array,
  ): void {
    this.#enqueue({
      type: "command",
      command: {
        type: "sendServiceResponse",
        channelId,
        operationId,
        response,
      },
    });
  }

  openAction(args: {
    correlation: Uint8Array;
    channelId: number;
    name: string;
    typeName: string;
    domainId?: number;
    client: boolean;
  }): void {
    this.#enqueue({
      type: "command",
      command: {
        type: "openAction",
        correlation: args.correlation,
        channelId: args.channelId,
        name: args.name,
        typeName: args.typeName,
        domainId: args.domainId ?? 0,
        client: args.client,
      },
    });
  }

  sendActionGoal(
    channelId: number,
    operationId: Uint8Array,
    goal: Uint8Array,
  ): void {
    this.#enqueue({
      type: "command",
      command: { type: "sendActionGoal", channelId, operationId, goal },
    });
  }

  cancelAction(channelId: number, operationId: Uint8Array): void {
    this.#enqueue({
      type: "command",
      command: { type: "cancelAction", channelId, operationId },
    });
  }

  sendActionFeedback(
    channelId: number,
    operationId: Uint8Array,
    feedback: Uint8Array,
  ): void {
    this.#enqueue({
      type: "command",
      command: {
        type: "sendActionFeedback",
        channelId,
        operationId,
        feedback,
      },
    });
  }

  sendActionResult(
    channelId: number,
    operationId: Uint8Array,
    result: Uint8Array,
  ): void {
    this.#enqueue({
      type: "command",
      command: { type: "sendActionResult", channelId, operationId, result },
    });
  }

  sendActionStatus(
    channelId: number,
    operationId: Uint8Array,
    status: Uint8Array,
  ): void {
    this.#enqueue({
      type: "command",
      command: { type: "sendActionStatus", channelId, operationId, status },
    });
  }

  copyPayload(payloadPtr: number, payloadLen: number): Uint8Array {
    return new Uint8Array(
      this.#wasm.memory.buffer,
      payloadPtr,
      payloadLen,
    ).slice();
  }

  /** Current wasm linear memory (tests: borrowed PointCloud2 views share this buffer). */
  engineMemory(): ArrayBufferLike {
    return this.#wasm.memory.buffer;
  }

  /**
   * Borrowed PointCloud2 view into wasm memory. Valid while the sample lease
   * is outstanding. Returns null when the payload is not PointCloud2 CDR.
   */
  decodePointCloud2(
    payloadPtr: number,
    payloadLen: number,
  ): PointCloud2 | null {
    try {
      const meta = decodePointCloud2Meta(this.#wasm, payloadPtr, payloadLen);
      return assemblePointCloud2(
        meta,
        pointCloud2DataView(this.#wasm, payloadPtr, meta),
      );
    } catch {
      return null;
    }
  }

  /**
   * Owned copy of PointCloud2 metadata plus the `data` field only.
   * Used on the I/O Worker path so main never holds a wasm pointer.
   */
  copyPointCloud2(
    payloadPtr: number,
    payloadLen: number,
  ): PointCloud2 | null {
    try {
      const meta = decodePointCloud2Meta(this.#wasm, payloadPtr, payloadLen);
      const view = pointCloud2DataView(this.#wasm, payloadPtr, meta);
      return assemblePointCloud2(meta, view.slice());
    } catch {
      return null;
    }
  }

  unsubscribe(correlation: Uint8Array, channelId: number): void {
    this.#enqueue({
      type: "command",
      command: { type: "unsubscribe", correlation, channelId },
    });
  }

  /**
   * Replace the engine and reopen the transport (fresh session reconnect).
   * Caller must re-issue subscribe/publish after sessionReady.
   */
  async reconnect(url: string): Promise<void> {
    this.#suppressCloseHandler = true;
    try {
      this.#sink?.close();
      this.#ws = null;
      this.#wt = null;
      this.#sink = null;
      this.#closed = false;
      this.#pending = [];
      if (this.#handle !== 0) {
        this.#wasm.rclweb_engine_free(this.#handle);
      }
      this.#handle = this.#wasm.rclweb_engine_new();
      if (this.#handle === 0) {
        throw new Error("rclweb_engine_new failed on reconnect");
      }
      this.#started = false;
      this.connect(url, this.#connectOptions);
    } finally {
      this.#suppressCloseHandler = false;
    }
  }

  releaseLease(leaseId: number): void {
    this.#enqueue({ type: "releaseLease", leaseId });
  }

  close(): void {
    if (this.#closed) return;
    this.#enqueue({ type: "command", command: { type: "close" } });
    this.#sink?.close();
    this.#closed = true;
    this.#flush();
  }

  dispose(): void {
    this.close();
    this.#pending = [];
    this.#flushScheduled = false;
    this.#disposed = true;
    if (this.#handle !== 0) {
      this.#wasm.rclweb_engine_free(this.#handle);
      this.#handle = 0;
    }
  }

  #enqueue(event: HostEventInput): void {
    if (this.#disposed) return;
    this.#pending.push(event);
    this.#scheduleFlush();
  }

  #scheduleFlush(): void {
    if (this.#flushScheduled || this.#disposed) return;
    this.#flushScheduled = true;
    queueMicrotask(() => {
      this.#flushScheduled = false;
      if (!this.#disposed) {
        this.#flush();
      }
    });
  }

  /** Synchronously drain the pending batch (tests). */
  flushSync(): void {
    if (!this.#disposed) {
      this.#flush();
    }
  }

  #flush(): void {
    if (this.#disposed || this.#handle === 0 || this.#pending.length === 0) {
      return;
    }
    const batch = this.#pending;
    this.#pending = [];
    const result = pollEngine(this.#wasm, this.#handle, batch);
    this.#lastTelemetry = readTelemetry(this.#wasm, this.#handle);
    for (const msg of result.outbound) {
      const sink = this.#sink;
      if (sink) {
        void sink.send(msg.bytes);
      }
    }
    for (const event of result.events) {
      if (event.type === "bootstrapComplete" && !this.#started) {
        this.#started = true;
        this.#pending.push({
          type: "command",
          command: {
            type: "authenticate",
            correlation: crypto.getRandomValues(new Uint8Array(16)),
            scheme: "token",
            token: new TextEncoder().encode("anonymous"),
          },
        });
        this.#scheduleFlush();
      }
      this.#callbacks.onEvent(event);
    }
  }

  get started(): boolean {
    return this.#started;
  }

  get usingWebTransport(): boolean {
    return this.#useWebTransport;
  }

  /** Engine telemetry snapshot (copy counters + poll timing). */
  engineTelemetry(): EngineTelemetrySnapshot | null {
    if (this.#disposed || this.#handle === 0) {
      return this.#lastTelemetry;
    }
    try {
      this.#lastTelemetry = readTelemetry(this.#wasm, this.#handle);
    } catch {
      // keep last known
    }
    return this.#lastTelemetry;
  }
}

function assemblePointCloud2(meta: PointCloud2Meta, data: Uint8Array): PointCloud2 {
  return {
    stampSec: meta.stampSec,
    stampNanosec: meta.stampNanosec,
    frameId: meta.frameId,
    height: meta.height,
    width: meta.width,
    fields: meta.fields,
    isBigendian: meta.isBigendian,
    pointStep: meta.pointStep,
    rowStep: meta.rowStep,
    isDense: meta.isDense,
    data,
  };
}
