/**
 * Shared I/O + wasm poll host used by the Worker and the inline (test) path.
 * Owns the WebSocket (`binaryType = "arraybuffer"`) and transferable ingest.
 */

import {
  type AppEvent,
  type EngineTelemetrySnapshot,
  type HostEventInput,
  type WasmExports,
  loadWasm,
  pollEngine,
  readTelemetry,
} from "./wasm/abi.ts";

export type HostCallbacks = {
  onEvent(event: AppEvent): void;
  onTransportError(message: string): void;
  onClosed(): void;
};

export class IoHost {
  #wasm: WasmExports;
  #handle: number;
  #ws: WebSocket | null = null;
  #callbacks: HostCallbacks;
  #started = false;
  #closed = false;
  #disposed = false;
  #pending: HostEventInput[] = [];
  #flushScheduled = false;
  #lastTelemetry: EngineTelemetrySnapshot | null = null;
  #suppressCloseHandler = false;

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

  connect(url: string): void {
    if (this.#ws) {
      throw new Error("already connected");
    }
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    this.#ws = ws;
    ws.addEventListener("open", () => {
      this.#enqueue({
        type: "command",
        command: { type: "start", transferableArrayBuffer: true },
      });
    });
    ws.addEventListener("message", (ev) => {
      const data = ev.data;
      if (!(data instanceof ArrayBuffer)) {
        this.#callbacks.onTransportError("non-binary websocket message");
        return;
      }
      // Transferable path: take ownership of the ArrayBuffer contents.
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

  /** Feed scripted bytes (tests) as if they arrived on the WebSocket. */
  ingestBytes(bytes: Uint8Array): void {
    this.#enqueue({ type: "wsBytes", bufferId: 0, bytes });
  }

  /** Start bootstrap without a live socket (scripted-peer tests). */
  startOffline(): void {
    this.#enqueue({
      type: "command",
      command: { type: "start", transferableArrayBuffer: true },
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

  sendSample(channelId: number, stringData: string): void {
    this.#enqueue({
      type: "command",
      command: { type: "sendSample", channelId, stringData },
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

  /** Copy a leased payload view out of wasm linear memory (valid until release). */
  copyPayload(payloadPtr: number, payloadLen: number): Uint8Array {
    if (payloadLen === 0) return new Uint8Array();
    return new Uint8Array(
      this.#wasm.memory.buffer,
      payloadPtr,
      payloadLen,
    ).slice();
  }

  unsubscribe(correlation: Uint8Array, channelId: number): void {
    this.#enqueue({
      type: "command",
      command: { type: "unsubscribe", correlation, channelId },
    });
  }

  /**
   * Replace the engine and reopen the WebSocket (fresh session reconnect).
   * Caller must re-issue subscribe/publish after sessionReady.
   */
  async reconnect(url: string): Promise<void> {
    this.#suppressCloseHandler = true;
    try {
      this.#ws?.close();
      this.#ws = null;
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
      this.connect(url);
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
    this.#ws?.close();
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
      if (this.#ws && this.#ws.readyState === WebSocket.OPEN) {
        // Send a copy — ws may retain the buffer.
        this.#ws.send(msg.bytes.slice().buffer);
      }
    }
    for (const event of result.events) {
      if (event.type === "bootstrapComplete" && !this.#started) {
        this.#started = true;
        // Fresh path: Authenticate immediately after ServerHello.
        this.#pending.push({
          type: "command",
          command: {
            type: "authenticate",
            correlation: crypto.getRandomValues(new Uint8Array(16)),
            scheme: "token",
            token: new TextEncoder().encode("anonymous"),
          },
        });
        // Continue flushing in the same turn so Authenticate leaves promptly.
        this.#scheduleFlush();
      }
      this.#callbacks.onEvent(event);
    }
  }

  get started(): boolean {
    return this.#started;
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
