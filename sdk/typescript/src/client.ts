/**
 * Public `@rclweb/sdk` client: connect → subscribe → typed String events.
 * All R2WP work stays in the I/O Worker / inline host (architecture rule).
 */

import { IoHost } from "./host.ts";
import type { AppEvent } from "./wasm/abi.ts";
import type {
  ConnectOptions,
  SampleLease,
  StdMsgsString,
  SubscriptionHandler,
} from "./types.ts";
import { STD_MSGS_STRING } from "./types.ts";
import type { MainToWorker, WorkerToMain } from "./worker/messages.ts";

export type { ConnectOptions, SampleLease, StdMsgsString, SubscriptionHandler };
export { STD_MSGS_STRING };

function defaultWasmUrl(): string {
  // Resolved relative to this module at build/runtime.
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

export type RclwebSession = {
  subscribe(topic: string, typeName?: string): Promise<Subscription>;
};

export type RclwebClient = {
  readonly session: RclwebSession;
  close(): Promise<void>;
};

class InlineClient implements RclwebClient {
  #host: IoHost;
  #sessionReady = false;
  #nextChannel = 1;
  #handlers = new Map<number, SubscriptionHandler>();
  #pendingSubs = new Map<
    number,
    {
      resolve: (sub: Subscription) => void;
      reject: (err: Error) => void;
      topic: string;
      typeName: string;
    }
  >();
  #connectWaiters: Array<() => void> = [];

  private constructor(host: IoHost) {
    this.#host = host;
  }

  static async create(
    url: string,
    wasmBytes: ArrayBuffer,
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
      },
      onClosed() {
        // no-op for tests
      },
    });
    client = new InlineClient(host);
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
    client = new InlineClient(host);
    return client;
  }

  get host(): IoHost {
    return this.#host;
  }

  get session(): RclwebSession {
    return {
      subscribe: (topic, typeName = STD_MSGS_STRING) =>
        this.#subscribe(topic, typeName),
    };
  }

  async close(): Promise<void> {
    this.#host.dispose();
  }

  #waitSessionReady(): Promise<void> {
    if (this.#sessionReady) return Promise.resolve();
    return new Promise((resolve) => {
      this.#connectWaiters.push(resolve);
    });
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
        const sub: Subscription = {
          topic,
          typeName,
          channelId,
          onMessage: (handler) => {
            this.#handlers.set(channelId, handler);
          },
          unsubscribe: async () => {
            this.#handlers.delete(channelId);
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
      case "sample": {
        const handler = this.#handlers.get(event.channelId);
        if (!handler || event.stringData == null) break;
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

  async #subscribe(topic: string, typeName: string): Promise<Subscription> {
    const channelId = this.#nextChannel++;
    return new Promise((resolve, reject) => {
      this.#pendingSubs.set(channelId, { resolve, reject, topic, typeName });
      this.#host.subscribe({
        correlation: corrTag(0xb0 + (channelId & 0x0f)),
        channelId,
        topic,
        typeName,
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
      subscribe: (topic, typeName = STD_MSGS_STRING) =>
        this.#subscribe(topic, typeName),
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
        // init request completes on ready
        const pending = this.#pending.get(1);
        // fall through — init uses first request id after bump; handle loosely
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
      case "sample": {
        const handler = this.#handlers.get(msg.channelId);
        if (!handler) break;
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

  async #subscribe(topic: string, typeName: string): Promise<Subscription> {
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
      } satisfies MainToWorker);
    });
  }
}

/**
 * Open a session to an rclwebd WebSocket endpoint.
 *
 * `connect(url) → session.subscribe(topic, type) → typed events`.
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
    return InlineClient.create(url, bytes);
  }
  return WorkerClient.create(url, wasmUrl);
}

/** @internal Test helper: offline inline client for scripted peer bytes. */
export async function connectOfflineForTests(
  wasmBytes: ArrayBuffer,
): Promise<InlineClient> {
  return InlineClient.createOffline(wasmBytes);
}
