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
  ActionClient,
  ActionFeedbackHandler,
  ActionServer,
  ActionServerHandlers,
  ActionStatusHandler,
  ConnectOptions,
  GraphHandler,
  GraphView,
  QosOptions,
  SampleLease,
  ServiceClient,
  ServiceServer,
  ServiceServerHandler,
  StdMsgsString,
  SubscriptionHandler,
} from "./types.ts";
import { DEFAULT_QOS_DEPTH, STD_MSGS_STRING } from "./types.ts";
import type { MainToWorker, WorkerToMain } from "./worker/messages.ts";

export type {
  ActionClient,
  ActionFeedbackHandler,
  ActionServer,
  ActionServerHandlers,
  ActionStatusHandler,
  ConnectOptions,
  GraphEndpoint,
  GraphHandler,
  GraphNode,
  GraphView,
  QosOptions,
  SampleLease,
  ServerCertificateHash,
  ServiceClient,
  ServiceServer,
  ServiceServerHandler,
  StdMsgsString,
  SubscriptionHandler,
} from "./types.ts";
export { DEFAULT_QOS_DEPTH, STD_MSGS_STRING };

function defaultWasmUrl(): string {
  return new URL("../wasm/rclweb.wasm", import.meta.url).href;
}

/**
 * Resolve the I/O Worker module URL next to this script.
 *
 * Workspace source is `io-worker.ts`. The browser build emits `index.js`, so
 * the sibling must be `io-worker.js` — a hardcoded `.ts` URL breaks `dist/`.
 */
export function resolveIoWorkerUrl(
  scriptUrl: string,
  override?: string | URL,
): URL {
  if (override !== undefined) {
    return new URL(String(override), scriptUrl);
  }
  const name = scriptUrl.endsWith(".ts") ? "io-worker.ts" : "io-worker.js";
  return new URL(`./worker/${name}`, scriptUrl);
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
  createServiceClient(name: string, typeName?: string): Promise<ServiceClient>;
  createServiceServer(
    name: string,
    typeName: string | undefined,
    handler: ServiceServerHandler,
  ): Promise<ServiceServer>;
  createActionClient(name: string, typeName?: string): Promise<ActionClient>;
  createActionServer(
    name: string,
    typeName: string | undefined,
    handlers?: ActionServerHandlers,
  ): Promise<ActionServer>;
  onGraph(handler: GraphHandler): void;
  /** Thin wrapper: `node/get_parameters` service call with raw CDR request bytes. */
  getParameters(node: string, requestCdr?: Uint8Array): Promise<Uint8Array>;
  setParameters(node: string, requestCdr?: Uint8Array): Promise<Uint8Array>;
  listParameters(node: string, requestCdr?: Uint8Array): Promise<Uint8Array>;
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
  #pendingServices = new Map<
    number,
    {
      resolve: (value: ServiceClient | ServiceServer) => void;
      reject: (err: Error) => void;
      name: string;
      typeName: string;
      client: boolean;
      handler?: ServiceServerHandler;
    }
  >();
  #pendingActions = new Map<
    number,
    {
      resolve: (value: ActionClient | ActionServer) => void;
      reject: (err: Error) => void;
      name: string;
      typeName: string;
      client: boolean;
      handlers?: ActionServerHandlers;
    }
  >();
  #pendingCalls = new Map<
    string,
    { resolve: (bytes: Uint8Array) => void; reject: (err: Error) => void }
  >();
  #pendingActionResults = new Map<
    string,
    { resolve: (bytes: Uint8Array) => void; reject: (err: Error) => void }
  >();
  #serviceHandlers = new Map<number, ServiceServerHandler>();
  #actionFeedback = new Map<number, ActionFeedbackHandler>();
  #actionStatus = new Map<number, ActionStatusHandler>();
  #actionServerHandlers = new Map<number, ActionServerHandlers>();
  #graphHandler: GraphHandler | null = null;
  #graph: GraphView = { generation: 0, nodes: [], endpoints: [] };
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
    host.connect(url, {
      transport: options.transport,
      serverCertificateHashes: options.serverCertificateHashes,
      fetchLocalDevTls: options.fetchLocalDevTls,
      localDevTlsOrigin: options.localDevTlsOrigin,
    });
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
      createServiceClient: (name, typeName = "") =>
        this.#createServiceClient(name, typeName),
      createServiceServer: (name, typeName = "", handler) =>
        this.#createServiceServer(name, typeName, handler),
      createActionClient: (name, typeName = "") =>
        this.#createActionClient(name, typeName),
      createActionServer: (name, typeName = "", handlers = {}) =>
        this.#createActionServer(name, typeName, handlers),
      onGraph: (handler) => {
        this.#graphHandler = handler;
        if (this.#graph.generation > 0) handler(this.#graph);
      },
      getParameters: (node, requestCdr = new Uint8Array()) =>
        this.#paramService(node, "get_parameters", "rcl_interfaces/srv/GetParameters", requestCdr),
      setParameters: (node, requestCdr = new Uint8Array()) =>
        this.#paramService(node, "set_parameters", "rcl_interfaces/srv/SetParameters", requestCdr),
      listParameters: (node, requestCdr = new Uint8Array()) =>
        this.#paramService(node, "list_parameters", "rcl_interfaces/srv/ListParameters", requestCdr),
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
      case "serviceReady": {
        const pending = this.#pendingServices.get(event.channelId);
        if (!pending) break;
        this.#pendingServices.delete(event.channelId);
        const channelId = event.channelId;
        if (pending.client) {
          const client: ServiceClient = {
            name: event.name,
            typeName: event.typeName,
            channelId,
            call: (request) => this.#callService(channelId, request),
            close: async () => {
              this.#host.unsubscribe(corrTag(0xc5), channelId);
              this.#host.flushSync();
            },
          };
          pending.resolve(client);
        } else {
          if (pending.handler) {
            this.#serviceHandlers.set(channelId, pending.handler);
          }
          const server: ServiceServer = {
            name: event.name,
            typeName: event.typeName,
            channelId,
            close: async () => {
              this.#serviceHandlers.delete(channelId);
              this.#host.unsubscribe(corrTag(0xc6), channelId);
              this.#host.flushSync();
            },
          };
          pending.resolve(server);
        }
        break;
      }
      case "serviceFailed": {
        const pending = this.#pendingServices.get(event.channelId);
        if (!pending) break;
        this.#pendingServices.delete(event.channelId);
        pending.reject(
          new Error(`service failed (${event.code}): ${event.message}`),
        );
        break;
      }
      case "serviceResponse": {
        const key = opidKey(event.channelId, event.operationId);
        const pending = this.#pendingCalls.get(key);
        const bytes = this.#host.copyPayload(event.payloadPtr, event.payloadLen);
        this.#host.releaseLease(event.leaseId);
        this.#host.flushSync();
        if (pending) {
          this.#pendingCalls.delete(key);
          pending.resolve(bytes);
        }
        break;
      }
      case "serviceRequest": {
        const handler = this.#serviceHandlers.get(event.channelId);
        const bytes = this.#host.copyPayload(event.payloadPtr, event.payloadLen);
        this.#host.releaseLease(event.leaseId);
        this.#host.flushSync();
        if (!handler) break;
        const opid = event.operationId.slice();
        void Promise.resolve(handler(bytes, opid)).then((response) => {
          this.#host.sendServiceResponse(event.channelId, opid, response);
          this.#host.flushSync();
        });
        break;
      }
      case "actionReady": {
        const pending = this.#pendingActions.get(event.channelId);
        if (!pending) break;
        this.#pendingActions.delete(event.channelId);
        const channelId = event.channelId;
        if (pending.client) {
          const client: ActionClient = {
            name: event.name,
            typeName: event.typeName,
            channelId,
            sendGoal: (goal) => this.#sendActionGoal(channelId, goal),
            cancel: (opid) => {
              this.#host.cancelAction(channelId, opid);
              this.#host.flushSync();
            },
            onFeedback: (handler) => {
              this.#actionFeedback.set(channelId, handler);
            },
            onStatus: (handler) => {
              this.#actionStatus.set(channelId, handler);
            },
            close: async () => {
              this.#actionFeedback.delete(channelId);
              this.#actionStatus.delete(channelId);
              this.#host.unsubscribe(corrTag(0xc7), channelId);
              this.#host.flushSync();
            },
          };
          pending.resolve(client);
        } else {
          if (pending.handlers) {
            this.#actionServerHandlers.set(channelId, pending.handlers);
          }
          const server: ActionServer = {
            name: event.name,
            typeName: event.typeName,
            channelId,
            sendFeedback: (opid, feedback) => {
              this.#host.sendActionFeedback(channelId, opid, feedback);
              this.#host.flushSync();
            },
            sendResult: (opid, result) => {
              this.#host.sendActionResult(channelId, opid, result);
              this.#host.flushSync();
            },
            sendStatus: (opid, status) => {
              this.#host.sendActionStatus(channelId, opid, status);
              this.#host.flushSync();
            },
            close: async () => {
              this.#actionServerHandlers.delete(channelId);
              this.#host.unsubscribe(corrTag(0xc8), channelId);
              this.#host.flushSync();
            },
          };
          pending.resolve(server);
        }
        break;
      }
      case "actionFailed": {
        const pending = this.#pendingActions.get(event.channelId);
        if (!pending) break;
        this.#pendingActions.delete(event.channelId);
        pending.reject(
          new Error(`action failed (${event.code}): ${event.message}`),
        );
        break;
      }
      case "actionGoal": {
        const handlers = this.#actionServerHandlers.get(event.channelId);
        const bytes = this.#host.copyPayload(event.payloadPtr, event.payloadLen);
        this.#host.releaseLease(event.leaseId);
        this.#host.flushSync();
        if (handlers?.onGoal) {
          void handlers.onGoal(bytes, event.operationId.slice());
        }
        break;
      }
      case "actionFeedback": {
        const handler = this.#actionFeedback.get(event.channelId);
        const bytes = this.#host.copyPayload(event.payloadPtr, event.payloadLen);
        this.#host.releaseLease(event.leaseId);
        this.#host.flushSync();
        handler?.(bytes, event.operationId.slice());
        break;
      }
      case "actionResult": {
        const key = opidKey(event.channelId, event.operationId);
        const pending = this.#pendingActionResults.get(key);
        const bytes = this.#host.copyPayload(event.payloadPtr, event.payloadLen);
        this.#host.releaseLease(event.leaseId);
        this.#host.flushSync();
        if (pending) {
          this.#pendingActionResults.delete(key);
          pending.resolve(bytes);
        }
        break;
      }
      case "actionStatus": {
        const handler = this.#actionStatus.get(event.channelId);
        const bytes = this.#host.copyPayload(event.payloadPtr, event.payloadLen);
        this.#host.releaseLease(event.leaseId);
        this.#host.flushSync();
        handler?.(bytes, event.operationId.slice());
        break;
      }
      case "graphSnapshot": {
        let nodes: GraphView["nodes"] = [];
        let endpoints: GraphView["endpoints"] = [];
        try {
          nodes = JSON.parse(event.nodesJson) as GraphView["nodes"];
          endpoints = JSON.parse(event.endpointsJson) as GraphView["endpoints"];
        } catch {
          // keep empty on malformed JSON from the engine
        }
        this.#graph = {
          generation: Number(event.generation),
          nodes,
          endpoints,
        };
        this.#graphHandler?.(this.#graph);
        break;
      }
      case "graphDelta": {
        this.#graph = {
          ...this.#graph,
          generation: Number(event.generation),
        };
        this.#graphHandler?.(this.#graph);
        break;
      }
      case "operationCancelled": {
        // Reject in-flight service/action ops on this channel.
        for (const [key, pending] of this.#pendingCalls) {
          if (key.startsWith(`${event.channelId}:`)) {
            pending.reject(
              new Error(`operation cancelled (${event.code}): ${event.message}`),
            );
            this.#pendingCalls.delete(key);
          }
        }
        for (const [key, pending] of this.#pendingActionResults) {
          if (key.startsWith(`${event.channelId}:`)) {
            pending.reject(
              new Error(`operation cancelled (${event.code}): ${event.message}`),
            );
            this.#pendingActionResults.delete(key);
          }
        }
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

  #createServiceClient(name: string, typeName: string): Promise<ServiceClient> {
    const channelId = this.#nextChannel++;
    return new Promise((resolve, reject) => {
      this.#pendingServices.set(channelId, {
        resolve: (v) => resolve(v as ServiceClient),
        reject,
        name,
        typeName,
        client: true,
      });
      this.#host.openService({
        correlation: corrTag(0xe0 + (channelId & 0x0f)),
        channelId,
        name,
        typeName,
        client: true,
      });
      this.#host.flushSync();
    });
  }

  #createServiceServer(
    name: string,
    typeName: string,
    handler: ServiceServerHandler,
  ): Promise<ServiceServer> {
    const channelId = this.#nextChannel++;
    return new Promise((resolve, reject) => {
      this.#pendingServices.set(channelId, {
        resolve: (v) => resolve(v as ServiceServer),
        reject,
        name,
        typeName,
        client: false,
        handler,
      });
      this.#host.openService({
        correlation: corrTag(0xe1 + (channelId & 0x0f)),
        channelId,
        name,
        typeName,
        client: false,
      });
      this.#host.flushSync();
    });
  }

  #callService(channelId: number, request: Uint8Array): Promise<Uint8Array> {
    const operationId = crypto.getRandomValues(new Uint8Array(16));
    const key = opidKey(channelId, operationId);
    return new Promise((resolve, reject) => {
      this.#pendingCalls.set(key, { resolve, reject });
      this.#host.callService(channelId, operationId, request);
      this.#host.flushSync();
    });
  }

  #createActionClient(name: string, typeName: string): Promise<ActionClient> {
    const channelId = this.#nextChannel++;
    return new Promise((resolve, reject) => {
      this.#pendingActions.set(channelId, {
        resolve: (v) => resolve(v as ActionClient),
        reject,
        name,
        typeName,
        client: true,
      });
      this.#host.openAction({
        correlation: corrTag(0xe2 + (channelId & 0x0f)),
        channelId,
        name,
        typeName,
        client: true,
      });
      this.#host.flushSync();
    });
  }

  #createActionServer(
    name: string,
    typeName: string,
    handlers: ActionServerHandlers,
  ): Promise<ActionServer> {
    const channelId = this.#nextChannel++;
    return new Promise((resolve, reject) => {
      this.#pendingActions.set(channelId, {
        resolve: (v) => resolve(v as ActionServer),
        reject,
        name,
        typeName,
        client: false,
        handlers,
      });
      this.#host.openAction({
        correlation: corrTag(0xe3 + (channelId & 0x0f)),
        channelId,
        name,
        typeName,
        client: false,
      });
      this.#host.flushSync();
    });
  }

  #sendActionGoal(
    channelId: number,
    goal: Uint8Array,
  ): { operationId: Uint8Array; result: Promise<Uint8Array> } {
    const operationId = crypto.getRandomValues(new Uint8Array(16));
    const key = opidKey(channelId, operationId);
    const result = new Promise<Uint8Array>((resolve, reject) => {
      this.#pendingActionResults.set(key, { resolve, reject });
    });
    this.#host.sendActionGoal(channelId, operationId, goal);
    this.#host.flushSync();
    return { operationId, result };
  }

  async #paramService(
    node: string,
    suffix: string,
    typeName: string,
    requestCdr: Uint8Array,
  ): Promise<Uint8Array> {
    const name = node.endsWith("/")
      ? `${node}${suffix}`
      : `${node}/${suffix}`;
    const client = await this.#createServiceClient(name, typeName);
    try {
      return await client.call(requestCdr);
    } finally {
      await client.close();
    }
  }
}

function opidKey(channelId: number, operationId: Uint8Array): string {
  let hex = `${channelId}:`;
  for (let i = 0; i < operationId.length; i++) {
    hex += operationId[i]!.toString(16).padStart(2, "0");
  }
  return hex;
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
      createServiceClient: async () => {
        throw new Error("createServiceClient requires inline host (options.inline)");
      },
      createServiceServer: async () => {
        throw new Error("createServiceServer requires inline host (options.inline)");
      },
      createActionClient: async () => {
        throw new Error("createActionClient requires inline host (options.inline)");
      },
      createActionServer: async () => {
        throw new Error("createActionServer requires inline host (options.inline)");
      },
      onGraph: () => {
        throw new Error("onGraph requires inline host (options.inline)");
      },
      getParameters: async () => {
        throw new Error("getParameters requires inline host (options.inline)");
      },
      setParameters: async () => {
        throw new Error("setParameters requires inline host (options.inline)");
      },
      listParameters: async () => {
        throw new Error("listParameters requires inline host (options.inline)");
      },
    };
    worker.onmessage = (ev: MessageEvent<WorkerToMain>) => {
      this.#onWorker(ev.data);
    };
  }

  static async create(
    url: string,
    wasmUrl: string,
    options: ConnectOptions = {},
  ): Promise<WorkerClient> {
    const workerUrl = resolveIoWorkerUrl(import.meta.url, options.workerUrl);
    const worker = new Worker(workerUrl.href, { type: "module" });
    const client = new WorkerClient(worker);
    await client.#request({ type: "init", wasmUrl });
    await client.#request({
      type: "connect",
      url,
      requestId: 0,
      transport: options.transport,
      serverCertificateHashes: options.serverCertificateHashes?.map((h) => ({
        algorithm: h.algorithm,
        value:
          typeof h.value === "string"
            ? h.value
            : Array.from(
                h.value instanceof ArrayBuffer
                  ? new Uint8Array(h.value)
                  : new Uint8Array(
                      h.value.buffer,
                      h.value.byteOffset,
                      h.value.byteLength,
                    ),
              ),
      })),
      fetchLocalDevTls: options.fetchLocalDevTls,
      localDevTlsOrigin: options.localDevTlsOrigin,
    });
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
  return WorkerClient.create(url, wasmUrl, options);
}

/** @internal Test helper: offline inline client for scripted peer bytes. */
export async function connectOfflineForTests(
  wasmBytes: ArrayBuffer,
): Promise<InlineClient> {
  return InlineClient.createOffline(wasmBytes);
}
