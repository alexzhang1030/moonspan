/**
 * Public `@rclweb/sdk` client: connect → subscribe/publish → typed String events.
 * All R2WP work stays in the I/O Worker / inline host (architecture rule).
 *
 * Reconnect (R2-01) is a fresh session: ClientHello → Authenticate → re-open
 * channels. SessionResume stays parked in the v0.1 subset.
 */

import { IoHost } from "./host.ts";
import type { AppEvent } from "./wasm/abi.ts";
import type {
  ConnectOptions,
  QosOptions,
  SampleLease,
  StdMsgsString,
  SubscriptionHandler,
} from "./types.ts";
import { DEFAULT_QOS_DEPTH, STD_MSGS_STRING } from "./types.ts";
import type { MainToWorker, WorkerToMain } from "./worker/messages.ts";

export type {
  ConnectOptions,
  QosOptions,
  SampleLease,
  StdMsgsString,
  SubscriptionHandler,
};
export { DEFAULT_QOS_DEPTH, STD_MSGS_STRING };

function defaultWasmUrl(): string {
  return new URL("../wasm/rclweb.wasm", import.meta.url).href;
}

function corrTag(tag: number): Uint8Array {
  return new Uint8Array(16).fill(tag & 0xff);
}

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
};

export type Subscription = {
  readonly topic: string;
  readonly typeName: string;
  readonly channelId: number;
  onMessage(handler: SubscriptionHandler): void;
  unsubscribe(): Promise<void>;
};

export type Publisher = {
  readonly topic: string;
  readonly typeName: string;
  readonly channelId: number;
  publish(message: StdMsgsString): Promise<void>;
  unadvertise(): Promise<void>;
};

export type RclwebSession = {
  subscribe(
    topic: string,
    typeName?: string,
    qos?: QosOptions,
  ): Promise<Subscription>;
  publish(
    topic: string,
    typeName?: string,
    qos?: QosOptions,
  ): Promise<Publisher>;
};

export type RclwebClient = {
  readonly session: RclwebSession;
  /** Browser-engine copy/poll counters when running on the inline host. */
  telemetry(): import("./wasm/abi.ts").EngineTelemetrySnapshot | null;
  /**
   * Fresh-session reconnect (inline host). Re-opens tracked subscribe/publish
   * channels after SessionReady. No-op when reconnect was not configured and
   * the transport is still up.
   */
  reconnect(): Promise<void>;
  close(): Promise<void>;
};

type ChannelRecord = {
  kind: "subscribe" | "publish";
  topic: string;
  typeName: string;
  qos: QosOptions;
  channelId: number;
  handler?: SubscriptionHandler;
};

class InlineClient implements RclwebClient {
  #host: IoHost;
  #url: string | null = null;
  #options: ConnectOptions;
  #sessionReady = false;
  #nextChannel = 1;
  #handlers = new Map<number, SubscriptionHandler>();
  #channels = new Map<number, ChannelRecord>();
  #pendingSubs = new Map<
    number,
    {
      resolve: (sub: Subscription) => void;
      reject: (err: Error) => void;
      topic: string;
      typeName: string;
      qos: QosOptions;
    }
  >();
  #pendingPubs = new Map<
    number,
    {
      resolve: (pub: Publisher) => void;
      reject: (err: Error) => void;
      topic: string;
      typeName: string;
      qos: QosOptions;
    }
  >();
  #connectWaiters: Array<() => void> = [];
  #reconnectAttempts = 0;

  private constructor(
    host: IoHost,
    options: ConnectOptions,
    url: string | null,
  ) {
    this.#host = host;
    this.#options = options;
    this.#url = url;
  }

  static async create(
    url: string,
    wasmBytes: ArrayBuffer,
    options: ConnectOptions = {},
  ): Promise<InlineClient> {
    let client!: InlineClient;
    const host = await IoHost.create(wasmBytes, {
      onEvent(event) {
        client.#onEvent(event);
      },
      onTransportError(message) {
        for (const pending of client.#pendingSubs.values()) {
          pending.reject(new Error(message));
        }
        client.#pendingSubs.clear();
        for (const pending of client.#pendingPubs.values()) {
          pending.reject(new Error(message));
        }
        client.#pendingPubs.clear();
      },
      onClosed() {
        if (client.#options.reconnect && client.#url) {
          void client.#autoReconnect();
        }
      },
    });
    client = new InlineClient(host, options, url);
    host.connect(url);
    await client.#waitSessionReady();
    return client;
  }

  /** Scripted-peer path: no live WebSocket. */
  static async createOffline(wasmBytes: ArrayBuffer): Promise<InlineClient> {
    let client!: InlineClient;
    const host = await IoHost.create(wasmBytes, {
      onEvent(event) {
        client.#onEvent(event);
      },
      onTransportError() {},
      onClosed() {},
    });
    client = new InlineClient(host, {}, null);
    return client;
  }

  get host(): IoHost {
    return this.#host;
  }

  get session(): RclwebSession {
    return {
      subscribe: (topic, typeName = STD_MSGS_STRING, qos = {}) =>
        this.#subscribe(topic, typeName, qos),
      publish: (topic, typeName = STD_MSGS_STRING, qos = {}) =>
        this.#publish(topic, typeName, qos),
    };
  }

  telemetry() {
    return this.#host.engineTelemetry();
  }

  async reconnect(): Promise<void> {
    if (!this.#url) {
      throw new Error("reconnect requires a live WebSocket url");
    }
    this.#sessionReady = false;
    await this.#host.reconnect(this.#url);
    await this.#waitSessionReady();
    await this.#reopenChannels();
  }

  async close(): Promise<void> {
    this.#options = { ...this.#options, reconnect: false };
    this.#host.dispose();
  }

  async #autoReconnect(): Promise<void> {
    const max = this.#options.reconnectAttempts ?? 3;
    if (this.#reconnectAttempts >= max || !this.#url) {
      return;
    }
    this.#reconnectAttempts += 1;
    try {
      await this.reconnect();
      this.#reconnectAttempts = 0;
    } catch {
      // Leave channels closed; caller can invoke reconnect() manually.
    }
  }

  #waitSessionReady(): Promise<void> {
    if (this.#sessionReady) return Promise.resolve();
    return new Promise((resolve) => {
      this.#connectWaiters.push(resolve);
    });
  }

  async #reopenChannels(): Promise<void> {
    const snapshot = [...this.#channels.values()];
    this.#channels.clear();
    this.#handlers.clear();
    for (const record of snapshot) {
      if (record.kind === "subscribe") {
        const sub = await this.#subscribe(
          record.topic,
          record.typeName,
          record.qos,
        );
        if (record.handler) {
          sub.onMessage(record.handler);
        }
      } else {
        await this.#publish(record.topic, record.typeName, record.qos);
      }
    }
  }

  #onEvent(event: AppEvent): void {
    switch (event.type) {
      case "sessionReady":
        this.#sessionReady = true;
        for (const w of this.#connectWaiters.splice(0)) w();
        break;
      case "subscribed": {
        const pending = this.#pendingSubs.get(event.channelId);
        if (!pending) break;
        this.#pendingSubs.delete(event.channelId);
        const channelId = event.channelId;
        const topic = event.topic;
        const typeName = event.typeName;
        this.#channels.set(channelId, {
          kind: "subscribe",
          topic,
          typeName,
          qos: pending.qos,
          channelId,
        });
        const sub: Subscription = {
          topic,
          typeName,
          channelId,
          onMessage: (handler) => {
            this.#handlers.set(channelId, handler);
            const rec = this.#channels.get(channelId);
            if (rec) rec.handler = handler;
          },
          unsubscribe: async () => {
            this.#handlers.delete(channelId);
            this.#channels.delete(channelId);
            this.#host.unsubscribe(corrTag(0xc3), channelId);
            this.#host.flushSync();
          },
        };
        pending.resolve(sub);
        break;
      }
      case "subscribeFailed": {
        const pending = this.#pendingSubs.get(event.channelId);
        if (!pending) break;
        this.#pendingSubs.delete(event.channelId);
        pending.reject(
          new Error(`subscribe failed (${event.code}): ${event.message}`),
        );
        break;
      }
      case "published": {
        const pending = this.#pendingPubs.get(event.channelId);
        if (!pending) break;
        this.#pendingPubs.delete(event.channelId);
        const channelId = event.channelId;
        this.#channels.set(channelId, {
          kind: "publish",
          topic: event.topic,
          typeName: event.typeName,
          qos: pending.qos,
          channelId,
        });
        const pub: Publisher = {
          topic: event.topic,
          typeName: event.typeName,
          channelId,
          publish: async (message) => {
            this.#host.sendSample(channelId, message.data);
            this.#host.flushSync();
          },
          unadvertise: async () => {
            this.#channels.delete(channelId);
            this.#host.unsubscribe(corrTag(0xc4), channelId);
            this.#host.flushSync();
          },
        };
        pending.resolve(pub);
        break;
      }
      case "publishFailed": {
        const pending = this.#pendingPubs.get(event.channelId);
        if (!pending) break;
        this.#pendingPubs.delete(event.channelId);
        pending.reject(
          new Error(`publish failed (${event.code}): ${event.message}`),
        );
        break;
      }
      case "sample": {
        const handler = this.#handlers.get(event.channelId);
        if (!handler || event.stringData == null) {
          this.#host.releaseLease(event.leaseId);
          break;
        }
        const leaseId = event.leaseId;
        const lease: SampleLease = {
          leaseId,
          release: () => {
            this.#host.releaseLease(leaseId);
            this.#host.flushSync();
          },
        };
        handler({ data: event.stringData }, lease);
        break;
      }
      default:
        break;
    }
  }

  async #subscribe(
    topic: string,
    typeName: string,
    qos: QosOptions,
  ): Promise<Subscription> {
    const channelId = this.#nextChannel++;
    const depth = qos.depth ?? DEFAULT_QOS_DEPTH;
    return new Promise((resolve, reject) => {
      this.#pendingSubs.set(channelId, {
        resolve,
        reject,
        topic,
        typeName,
        qos,
      });
      this.#host.subscribe({
        correlation: corrTag(0xb0 + (channelId & 0x0f)),
        channelId,
        topic,
        typeName,
        qosReliability: qos.reliability ?? 1,
        qosDepth: depth,
      });
      this.#host.flushSync();
    });
  }

  async #publish(
    topic: string,
    typeName: string,
    qos: QosOptions,
  ): Promise<Publisher> {
    const channelId = this.#nextChannel++;
    const depth = qos.depth ?? DEFAULT_QOS_DEPTH;
    return new Promise((resolve, reject) => {
      this.#pendingPubs.set(channelId, {
        resolve,
        reject,
        topic,
        typeName,
        qos,
      });
      this.#host.publish({
        correlation: corrTag(0xd0 + (channelId & 0x0f)),
        channelId,
        topic,
        typeName,
        qosReliability: qos.reliability ?? 1,
        qosDepth: depth,
      });
      this.#host.flushSync();
    });
  }
}

class WorkerClient implements RclwebClient {
  #worker: Worker;
  #pending = new Map<number, Pending>();
  #nextRequest = 1;
  #nextChannel = 1;
  #handlers = new Map<number, SubscriptionHandler>();
  #session: RclwebSession;

  private constructor(worker: Worker) {
    this.#worker = worker;
    this.#session = {
      subscribe: (topic, typeName = STD_MSGS_STRING, qos = {}) =>
        this.#subscribe(topic, typeName, qos),
      publish: (topic, typeName = STD_MSGS_STRING, qos = {}) =>
        this.#publish(topic, typeName, qos),
    };
    worker.onmessage = (ev: MessageEvent<WorkerToMain>) => {
      this.#onWorker(ev.data);
    };
  }

  static async create(url: string, wasmUrl: string): Promise<WorkerClient> {
    const workerUrl = new URL("./worker/io-worker.ts", import.meta.url);
    const worker = new Worker(workerUrl.href, { type: "module" });
    const client = new WorkerClient(worker);
    await client.#request({ type: "init", wasmUrl });
    await client.#request({ type: "connect", url, requestId: 0 });
    return client;
  }

  get session(): RclwebSession {
    return this.#session;
  }

  telemetry() {
    return null;
  }

  async reconnect(): Promise<void> {
    await this.#request({ type: "reconnect", requestId: 0 });
  }

  async close(): Promise<void> {
    await this.#request({ type: "close", requestId: 0 });
    this.#worker.terminate();
  }

  #request(msg: MainToWorker): Promise<unknown> {
    const requestId =
      "requestId" in msg && typeof msg.requestId === "number"
        ? msg.requestId === 0
          ? this.#nextRequest++
          : msg.requestId
        : this.#nextRequest++;
    const payload = { ...msg, requestId } as MainToWorker;
    return new Promise((resolve, reject) => {
      this.#pending.set(requestId, { resolve, reject });
      this.#worker.postMessage(payload);
    });
  }

  #onWorker(msg: WorkerToMain): void {
    switch (msg.type) {
      case "ready": {
        const pending = this.#pending.get(1);
        for (const [id, p] of this.#pending) {
          if (id >= 1) {
            p.resolve(undefined);
            this.#pending.delete(id);
            break;
          }
        }
        void pending;
        break;
      }
      case "connected": {
        const p = this.#pending.get(msg.requestId);
        if (p) {
          p.resolve(undefined);
          this.#pending.delete(msg.requestId);
        }
        break;
      }
      case "subscribed": {
        const p = this.#pending.get(msg.requestId);
        if (!p) break;
        const channelId = msg.channelId;
        const sub: Subscription = {
          topic: msg.topic,
          typeName: msg.typeName,
          channelId,
          onMessage: (handler) => {
            this.#handlers.set(channelId, handler);
          },
          unsubscribe: async () => {
            this.#handlers.delete(channelId);
            await this.#request({
              type: "unsubscribe",
              requestId: 0,
              channelId,
              correlation: [...corrTag(0xc3)],
            });
          },
        };
        p.resolve(sub);
        this.#pending.delete(msg.requestId);
        break;
      }
      case "subscribeFailed": {
        const p = this.#pending.get(msg.requestId);
        if (!p) break;
        p.reject(new Error(`subscribe failed (${msg.code}): ${msg.message}`));
        this.#pending.delete(msg.requestId);
        break;
      }
      case "published": {
        const p = this.#pending.get(msg.requestId);
        if (!p) break;
        const channelId = msg.channelId;
        const pub: Publisher = {
          topic: msg.topic,
          typeName: msg.typeName,
          channelId,
          publish: async (message) => {
            await this.#request({
              type: "sendSample",
              requestId: 0,
              channelId,
              data: message.data,
            });
          },
          unadvertise: async () => {
            await this.#request({
              type: "unsubscribe",
              requestId: 0,
              channelId,
              correlation: [...corrTag(0xc4)],
            });
          },
        };
        p.resolve(pub);
        this.#pending.delete(msg.requestId);
        break;
      }
      case "publishFailed": {
        const p = this.#pending.get(msg.requestId);
        if (!p) break;
        p.reject(new Error(`publish failed (${msg.code}): ${msg.message}`));
        this.#pending.delete(msg.requestId);
        break;
      }
      case "sample": {
        const handler = this.#handlers.get(msg.channelId);
        if (!handler) {
          this.#worker.postMessage({
            type: "releaseLease",
            leaseId: msg.leaseId,
          } satisfies MainToWorker);
          break;
        }
        const leaseId = msg.leaseId;
        handler(
          { data: msg.data },
          {
            leaseId,
            release: () => {
              this.#worker.postMessage({
                type: "releaseLease",
                leaseId,
              } satisfies MainToWorker);
            },
          },
        );
        break;
      }
      case "error": {
        if (msg.requestId != null) {
          const p = this.#pending.get(msg.requestId);
          if (p) {
            p.reject(new Error(msg.message));
            this.#pending.delete(msg.requestId);
          }
        }
        break;
      }
      case "ack": {
        const p = this.#pending.get(msg.requestId);
        if (p) {
          p.resolve(undefined);
          this.#pending.delete(msg.requestId);
        }
        break;
      }
      case "closed": {
        if (msg.requestId != null) {
          const p = this.#pending.get(msg.requestId);
          if (p) {
            p.resolve(undefined);
            this.#pending.delete(msg.requestId);
          }
        }
        break;
      }
    }
  }

  async #subscribe(
    topic: string,
    typeName: string,
    qos: QosOptions,
  ): Promise<Subscription> {
    const channelId = this.#nextChannel++;
    const requestId = this.#nextRequest++;
    return new Promise((resolve, reject) => {
      this.#pending.set(requestId, {
        resolve: (value) => resolve(value as Subscription),
        reject,
      });
      this.#worker.postMessage({
        type: "subscribe",
        requestId,
        topic,
        typeName,
        channelId,
        correlation: [...corrTag(0xb0 + (channelId & 0x0f))],
        qosReliability: qos.reliability ?? 1,
        qosDepth: qos.depth ?? DEFAULT_QOS_DEPTH,
      } satisfies MainToWorker);
    });
  }

  async #publish(
    topic: string,
    typeName: string,
    qos: QosOptions,
  ): Promise<Publisher> {
    const channelId = this.#nextChannel++;
    const requestId = this.#nextRequest++;
    return new Promise((resolve, reject) => {
      this.#pending.set(requestId, {
        resolve: (value) => resolve(value as Publisher),
        reject,
      });
      this.#worker.postMessage({
        type: "publish",
        requestId,
        topic,
        typeName,
        channelId,
        correlation: [...corrTag(0xd0 + (channelId & 0x0f))],
        qosReliability: qos.reliability ?? 1,
        qosDepth: qos.depth ?? DEFAULT_QOS_DEPTH,
      } satisfies MainToWorker);
    });
  }
}

/**
 * Open a session to an rclwebd WebSocket endpoint.
 *
 * `connect(url) → session.subscribe|publish(topic, type, qos?) → typed events`.
 */
export async function connect(
  url: string,
  options: ConnectOptions = {},
): Promise<RclwebClient> {
  const wasmUrl = options.wasmUrl
    ? String(options.wasmUrl)
    : defaultWasmUrl();
  if (options.inline) {
    const response = await fetch(wasmUrl);
    if (!response.ok) {
      throw new Error(`failed to fetch wasm: ${response.status}`);
    }
    const bytes = await response.arrayBuffer();
    return InlineClient.create(url, bytes, options);
  }
  return WorkerClient.create(url, wasmUrl);
}

/** @internal Test helper: offline inline client for scripted peer bytes. */
export async function connectOfflineForTests(
  wasmBytes: ArrayBuffer,
): Promise<InlineClient> {
  return InlineClient.createOffline(wasmBytes);
}
