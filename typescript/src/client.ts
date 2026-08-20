/**
 * Session `connect` host: subscribe/publish and sample leases.
 * Application code uses `rcl-web` `init` / `Node`. This module is the
 * `rcl-web/internal` path. All R2WP work stays in the I/O Worker / inline
 * host (architecture rule).
 *
 * Reconnect (R2-01) is a fresh session: ClientHello → Authenticate → re-open
 * channels. SessionResume stays parked in the v0.1 subset.
 */

import { IoHost } from "./host.ts";
import type { AppEvent, EngineTelemetrySnapshot, SampleAppEvent } from "./wasm/abi.ts";
import { decodePointCloud2Cdr, decodeStdMsgsStringCdr } from "./cdr-le.ts";
import {
  Collections,
  NestedSample,
  PointCloud2 as PointCloud2Msg,
  PrimitiveScalars,
  String as StdMsgsStringMsg,
  generatedOpTypeName,
  isGeneratedMsgType,
  type GeneratedOpKind,
  typeNameOf,
  type TypeNameLike,
} from "./interfaces.ts";
import type {
  ActionClient,
  ActionFeedbackHandler,
  ActionServer,
  ActionServerHandlers,
  ActionStatusHandler,
  ConnectOptions,
  GraphHandler,
  GraphView,
  PointCloud2,
  QosOptions,
  SampleLease,
  SampleMessage,
  ServiceClient,
  ServiceServer,
  ServiceServerHandler,
  StdMsgsString,
  SubscriptionHandler,
} from "./types.ts";
import {
  DEFAULT_QOS_DEPTH,
  isPointCloud2,
  isStdMsgsString,
} from "./types.ts";
import {
  encodeGeneratedHostValue,
  reviveGenerated,
} from "./generated-value.ts";
import type { MainToWorker, WorkerToMain } from "./worker/messages.ts";
import { resolveGatewayConnect } from "./gateway-url.ts";

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
  PointCloud2,
  QosOptions,
  SampleLease,
  SampleMessage,
  ServerCertificateHash,
  ServiceClient,
  ServiceServer,
  ServiceServerHandler,
  StdMsgsString,
  SubscriptionHandler,
} from "./types.ts";
export { DEFAULT_QOS_DEPTH, isPointCloud2, isStdMsgsString };

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

function dispatchPublish(
  typeName: string,
  message: SampleMessage,
  sendString: (data: string) => void,
  sendCloud: (cloud: PointCloud2) => void,
  sendGenerated: (typeName: string, value: Uint8Array) => void,
): void {
  if (typeName === PointCloud2Msg.typeName) {
    if (!isPointCloud2(message)) {
      throw new Error("PointCloud2 publish requires a PointCloud2 message");
    }
    sendCloud(message);
    return;
  }
  if (isGeneratedMsgType(typeName)) {
    sendGenerated(typeName, encodeGeneratedHostValue(typeName, message));
    return;
  }
  if (!isStdMsgsString(message)) {
    throw new Error("String publish requires { data: string }");
  }
  sendString(message.data);
}

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
};

export type Subscription<T extends SampleMessage = SampleMessage> = {
  readonly topic: string;
  readonly typeName: string;
  readonly channelId: number;
  onMessage(handler: SubscriptionHandler<T>): void;
  unsubscribe(): Promise<void>;
};

export type Publisher<T extends SampleMessage = StdMsgsString> = {
  readonly topic: string;
  readonly typeName: string;
  readonly channelId: number;
  publish(message: T): Promise<void>;
  unadvertise(): Promise<void>;
};

export type RclwebSession = {
  subscribe(
    topic: string,
    type: typeof PointCloud2Msg,
    qos?: QosOptions,
  ): Promise<Subscription<PointCloud2>>;
  subscribe(
    topic: string,
    type: typeof PrimitiveScalars,
    qos?: QosOptions,
  ): Promise<Subscription<PrimitiveScalars>>;
  subscribe(
    topic: string,
    type: typeof NestedSample,
    qos?: QosOptions,
  ): Promise<Subscription<NestedSample>>;
  subscribe(
    topic: string,
    type: typeof Collections,
    qos?: QosOptions,
  ): Promise<Subscription<Collections>>;
  subscribe(
    topic: string,
    type?: typeof StdMsgsStringMsg | TypeNameLike,
    qos?: QosOptions,
  ): Promise<Subscription<StdMsgsString>>;
  subscribe(
    topic: string,
    type?: TypeNameLike,
    qos?: QosOptions,
  ): Promise<Subscription>;
  publish(
    topic: string,
    type: typeof PointCloud2Msg,
    qos?: QosOptions,
  ): Promise<Publisher<PointCloud2>>;
  publish(
    topic: string,
    type: typeof PrimitiveScalars,
    qos?: QosOptions,
  ): Promise<Publisher<PrimitiveScalars>>;
  publish(
    topic: string,
    type: typeof NestedSample,
    qos?: QosOptions,
  ): Promise<Publisher<NestedSample>>;
  publish(
    topic: string,
    type: typeof Collections,
    qos?: QosOptions,
  ): Promise<Publisher<Collections>>;
  publish(
    topic: string,
    type?: typeof StdMsgsStringMsg | TypeNameLike,
    qos?: QosOptions,
  ): Promise<Publisher<StdMsgsString>>;
  publish(
    topic: string,
    type?: TypeNameLike,
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
  /** Latest GraphSnapshot/Delta view (internal). */
  graph(): GraphView;
  /** Thin wrapper: `node/get_parameters` service call with raw CDR request bytes. */
  getParameters(node: string, requestCdr?: Uint8Array): Promise<Uint8Array>;
  setParameters(node: string, requestCdr?: Uint8Array): Promise<Uint8Array>;
  listParameters(node: string, requestCdr?: Uint8Array): Promise<Uint8Array>;
};

export type RclwebClient = {
  readonly session: RclwebSession;
  /** Browser-engine copy/poll counters (inline host, or last Worker poll). */
  telemetry(): EngineTelemetrySnapshot | null;
  /**
   * Fresh-session reconnect. Re-opens tracked subscribe, publish, service,
   * and action channels after SessionReady, keeping the same channel IDs so
   * existing session objects keep working. SessionResume stays parked.
   */
  reconnect(): Promise<void>;
  close(): Promise<void>;
};

type ChannelKind =
  | "subscribe"
  | "publish"
  | "serviceClient"
  | "serviceServer"
  | "actionClient"
  | "actionServer";

type ChannelRecord = {
  kind: ChannelKind;
  topic: string;
  typeName: string;
  qos: QosOptions;
  channelId: number;
  handler?: SubscriptionHandler;
  serviceHandler?: ServiceServerHandler;
  actionHandlers?: ActionServerHandlers;
};

async function reopenTrackedChannels(
  records: readonly ChannelRecord[],
  ops: {
    subscribe(
      topic: string,
      typeName: string,
      qos: QosOptions,
      channelId: number,
    ): Promise<Subscription>;
    publish(
      topic: string,
      typeName: string,
      qos: QosOptions,
      channelId: number,
    ): Promise<unknown>;
    createServiceClient(
      name: string,
      typeName: string,
      channelId: number,
    ): Promise<unknown>;
    createServiceServer(
      name: string,
      typeName: string,
      handler: ServiceServerHandler,
      channelId: number,
    ): Promise<unknown>;
    createActionClient(
      name: string,
      typeName: string,
      channelId: number,
    ): Promise<unknown>;
    createActionServer(
      name: string,
      typeName: string,
      handlers: ActionServerHandlers,
      channelId: number,
    ): Promise<unknown>;
  },
): Promise<void> {
  for (const record of records) {
    switch (record.kind) {
      case "subscribe": {
        const sub = await ops.subscribe(
          record.topic,
          record.typeName,
          record.qos,
          record.channelId,
        );
        if (record.handler) {
          sub.onMessage(record.handler);
        }
        break;
      }
      case "publish":
        await ops.publish(
          record.topic,
          record.typeName,
          record.qos,
          record.channelId,
        );
        break;
      case "serviceClient":
        await ops.createServiceClient(
          record.topic,
          record.typeName,
          record.channelId,
        );
        break;
      case "serviceServer":
        await ops.createServiceServer(
          record.topic,
          record.typeName,
          record.serviceHandler ?? (async () => new Uint8Array()),
          record.channelId,
        );
        break;
      case "actionClient":
        await ops.createActionClient(
          record.topic,
          record.typeName,
          record.channelId,
        );
        break;
      case "actionServer":
        await ops.createActionServer(
          record.topic,
          record.typeName,
          record.actionHandlers ?? {},
          record.channelId,
        );
        break;
    }
  }
}

type SampleSink = (event: SampleAppEvent) => void;

function sampleLease(host: IoHost, leaseId: number): SampleLease {
  return {
    leaseId,
    release: () => {
      host.releaseLease(leaseId);
      host.flushSync();
    },
  };
}

/**
 * Per-channel deliver function installed at `onMessage`. The sample hot
 * path is Map.get + this sink (Foxglove-shaped), not the generic event switch.
 */
function bindSampleSink(
  host: IoHost,
  typeName: string,
  handler: SubscriptionHandler,
): SampleSink {
  if (typeName === StdMsgsStringMsg.typeName) {
    return (event) => {
      let data: string | null = null;
      if (event.hostPayload) {
        data = decodeStdMsgsStringCdr(event.hostPayload);
      } else {
        host.fillStringSample(event, typeName);
        data = event.stringData;
      }
      if (data == null) {
        host.releaseLease(event.leaseId);
        return;
      }
      handler({ data }, sampleLease(host, event.leaseId));
    };
  }
  if (
    typeName === PointCloud2Msg.typeName ||
    typeName === "sensor_msgs/PointCloud2"
  ) {
    return (event) => {
      const cloud = event.hostPayload
        ? decodePointCloud2Cdr(event.hostPayload)
        : host.decodePointCloud2(
            event.payloadPtr,
            event.payloadLen,
            event.hostPayload,
          );
      if (!cloud) {
        host.releaseLease(event.leaseId);
        return;
      }
      handler(cloud, sampleLease(host, event.leaseId));
    };
  }
  if (isGeneratedMsgType(typeName)) {
    return (event) => {
      const generated = host.decodeGenerated(
        typeName,
        event.payloadPtr,
        event.payloadLen,
        event.hostPayload,
      );
      if (!generated) {
        host.releaseLease(event.leaseId);
        return;
      }
      handler(generated, sampleLease(host, event.leaseId));
    };
  }
  return (event) => {
    host.fillStringSample(event, typeName);
    if (event.stringData != null) {
      handler({ data: event.stringData }, sampleLease(host, event.leaseId));
      return;
    }
    const cloud = host.decodePointCloud2(
      event.payloadPtr,
      event.payloadLen,
      event.hostPayload,
    );
    if (!cloud) {
      host.releaseLease(event.leaseId);
      return;
    }
    handler(cloud, sampleLease(host, event.leaseId));
  };
}

class InlineClient implements RclwebClient {
  #host: IoHost;
  #url: string | null = null;
  #options: ConnectOptions;
  #sessionReady = false;
  #nextChannel = 1;
  #sampleSinks = new Map<number, SampleSink>();
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
  #channelTypes = new Map<number, string>();
  #graphHandlers = new Set<GraphHandler>();
  #graph: GraphView = { generation: 0, nodes: [], endpoints: [] };
  #connectWaiters: Array<() => void> = [];
  #reconnectAttempts = 0;
  #reconnecting = false;

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
        if (client.#reconnecting) return;
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
      subscribe: ((topic, type: TypeNameLike = StdMsgsStringMsg, qos = {}) =>
        this.#subscribe(topic, typeNameOf(type), qos)) as RclwebSession["subscribe"],
      publish: ((topic, type: TypeNameLike = StdMsgsStringMsg, qos = {}) =>
        this.#publish(topic, typeNameOf(type), qos)) as RclwebSession["publish"],
      createServiceClient: (name, typeName = "") =>
        this.#createServiceClient(name, typeName),
      createServiceServer: (name, typeName = "", handler) =>
        this.#createServiceServer(name, typeName, handler),
      createActionClient: (name, typeName = "") =>
        this.#createActionClient(name, typeName),
      createActionServer: (name, typeName = "", handlers = {}) =>
        this.#createActionServer(name, typeName, handlers),
      onGraph: (handler) => {
        this.#graphHandlers.add(handler);
        if (this.#graph.generation > 0) handler(this.#graph);
      },
      graph: () => this.#graph,
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

  #emitGraph(): void {
    for (const handler of this.#graphHandlers) {
      handler(this.#graph);
    }
  }

  async reconnect(): Promise<void> {
    if (!this.#url) {
      throw new Error("reconnect requires a live WebSocket url");
    }
    this.#reconnecting = true;
    try {
      this.#sessionReady = false;
      this.#rejectInflight("session reconnected");
      await this.#host.reconnect(this.#url);
      await this.#waitSessionReady();
      await this.#reopenChannels();
    } finally {
      this.#reconnecting = false;
    }
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

  #rejectInflight(message: string): void {
    const err = new Error(message);
    for (const pending of this.#pendingCalls.values()) {
      pending.reject(err);
    }
    this.#pendingCalls.clear();
    for (const pending of this.#pendingActionResults.values()) {
      pending.reject(err);
    }
    this.#pendingActionResults.clear();
    for (const pending of this.#pendingSubs.values()) {
      pending.reject(err);
    }
    this.#pendingSubs.clear();
    for (const pending of this.#pendingPubs.values()) {
      pending.reject(err);
    }
    this.#pendingPubs.clear();
    for (const pending of this.#pendingServices.values()) {
      pending.reject(err);
    }
    this.#pendingServices.clear();
    for (const pending of this.#pendingActions.values()) {
      pending.reject(err);
    }
    this.#pendingActions.clear();
  }

  async #reopenChannels(): Promise<void> {
    const snapshot = [...this.#channels.values()];
    this.#channels.clear();
    await reopenTrackedChannels(snapshot, {
      subscribe: (topic, typeName, qos, channelId) =>
        this.#subscribe(topic, typeName, qos, channelId),
      publish: (topic, typeName, qos, channelId) =>
        this.#publish(topic, typeName, qos, channelId),
      createServiceClient: (name, typeName, channelId) =>
        this.#createServiceClient(name, typeName, channelId),
      createServiceServer: (name, typeName, handler, channelId) =>
        this.#createServiceServer(name, typeName, handler, channelId),
      createActionClient: (name, typeName, channelId) =>
        this.#createActionClient(name, typeName, channelId),
      createActionServer: (name, typeName, handlers, channelId) =>
        this.#createActionServer(name, typeName, handlers, channelId),
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
            this.#sampleSinks.set(
              channelId,
              bindSampleSink(this.#host, typeName, handler),
            );
            const rec = this.#channels.get(channelId);
            if (rec) rec.handler = handler;
          },
          unsubscribe: async () => {
            this.#sampleSinks.delete(channelId);
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
            dispatchPublish(
              event.typeName,
              message,
              (data) => {
                this.#host.sendSample(channelId, data);
              },
              (cloud) => {
                this.#host.sendPointCloud2(channelId, cloud);
              },
              (typeName, value) => {
                this.#host.sendGenerated(channelId, typeName, value);
              },
            );
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
        const sink = this.#sampleSinks.get(event.channelId);
        if (!sink) {
          this.#host.releaseLease(event.leaseId);
          break;
        }
        sink(event);
        break;
      }
      case "serviceReady": {
        const pending = this.#pendingServices.get(event.channelId);
        if (!pending) break;
        this.#pendingServices.delete(event.channelId);
        const channelId = event.channelId;
        this.#channelTypes.set(channelId, event.typeName);
        this.#channels.set(channelId, {
          kind: pending.client ? "serviceClient" : "serviceServer",
          topic: event.name,
          typeName: event.typeName,
          qos: {},
          channelId,
          serviceHandler: pending.handler,
        });
        if (pending.client) {
          const client: ServiceClient = {
            name: event.name,
            typeName: event.typeName,
            channelId,
            call: (request) => this.#callService(channelId, request),
            close: async () => {
              this.#channels.delete(channelId);
              this.#channelTypes.delete(channelId);
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
              this.#channels.delete(channelId);
              this.#serviceHandlers.delete(channelId);
              this.#channelTypes.delete(channelId);
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
        const bytes = copyChannelOpPayload(
          this.#host,
          this.#channelTypes,
          event.channelId,
          "Response",
          event.payloadPtr,
          event.payloadLen,
          event.hostPayload,
        );
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
        const bytes = copyChannelOpPayload(
          this.#host,
          this.#channelTypes,
          event.channelId,
          "Request",
          event.payloadPtr,
          event.payloadLen,
          event.hostPayload,
        );
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
        this.#channelTypes.set(channelId, event.typeName);
        this.#channels.set(channelId, {
          kind: pending.client ? "actionClient" : "actionServer",
          topic: event.name,
          typeName: event.typeName,
          qos: {},
          channelId,
          actionHandlers: pending.handlers,
        });
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
              this.#channels.delete(channelId);
              this.#actionFeedback.delete(channelId);
              this.#actionStatus.delete(channelId);
              this.#channelTypes.delete(channelId);
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
              this.#channels.delete(channelId);
              this.#actionServerHandlers.delete(channelId);
              this.#channelTypes.delete(channelId);
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
        const bytes = copyChannelOpPayload(
          this.#host,
          this.#channelTypes,
          event.channelId,
          "Goal",
          event.payloadPtr,
          event.payloadLen,
          event.hostPayload,
        );
        this.#host.releaseLease(event.leaseId);
        this.#host.flushSync();
        if (handlers?.onGoal) {
          void handlers.onGoal(bytes, event.operationId.slice());
        }
        break;
      }
      case "actionFeedback": {
        const handler = this.#actionFeedback.get(event.channelId);
        const bytes = copyChannelOpPayload(
          this.#host,
          this.#channelTypes,
          event.channelId,
          "Feedback",
          event.payloadPtr,
          event.payloadLen,
          event.hostPayload,
        );
        this.#host.releaseLease(event.leaseId);
        this.#host.flushSync();
        handler?.(bytes, event.operationId.slice());
        break;
      }
      case "actionResult": {
        const key = opidKey(event.channelId, event.operationId);
        const pending = this.#pendingActionResults.get(key);
        const bytes = copyChannelOpPayload(
          this.#host,
          this.#channelTypes,
          event.channelId,
          "Result",
          event.payloadPtr,
          event.payloadLen,
          event.hostPayload,
        );
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
        const bytes = this.#host.copyPayload(
          event.payloadPtr,
          event.payloadLen,
          event.hostPayload,
        );
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
        this.#emitGraph();
        break;
      }
      case "graphDelta": {
        this.#graph = {
          ...this.#graph,
          generation: Number(event.generation),
        };
        this.#emitGraph();
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
    reuseChannelId?: number,
  ): Promise<Subscription> {
    const channelId = reuseChannelId ?? this.#nextChannel++;
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
    reuseChannelId?: number,
  ): Promise<Publisher> {
    const channelId = reuseChannelId ?? this.#nextChannel++;
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

  #createServiceClient(
    name: string,
    typeName: string,
    reuseChannelId?: number,
  ): Promise<ServiceClient> {
    const channelId = reuseChannelId ?? this.#nextChannel++;
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
    reuseChannelId?: number,
  ): Promise<ServiceServer> {
    const channelId = reuseChannelId ?? this.#nextChannel++;
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

  #createActionClient(
    name: string,
    typeName: string,
    reuseChannelId?: number,
  ): Promise<ActionClient> {
    const channelId = reuseChannelId ?? this.#nextChannel++;
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
    reuseChannelId?: number,
  ): Promise<ActionServer> {
    const channelId = reuseChannelId ?? this.#nextChannel++;
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

function asPayload(value: Uint8Array | number[]): Uint8Array {
  return value instanceof Uint8Array ? value : Uint8Array.from(value);
}

function copyChannelOpPayload(
  host: IoHost,
  channelTypes: Map<number, string>,
  channelId: number,
  op: GeneratedOpKind,
  payloadPtr: number,
  payloadLen: number,
  hostPayload?: Uint8Array,
): Uint8Array {
  const typeName = channelTypes.get(channelId);
  const section = typeName ? generatedOpTypeName(typeName, op) : undefined;
  if (section) {
    const bytes = host.copyGeneratedBytes(
      section,
      payloadPtr,
      payloadLen,
      hostPayload,
    );
    if (bytes) return bytes;
  }
  return host.copyPayload(payloadPtr, payloadLen, hostPayload);
}

class WorkerClient implements RclwebClient {
  #worker: Worker;
  #url: string;
  #options: ConnectOptions;
  #pending = new Map<number, Pending>();
  #nextRequest = 1;
  #nextChannel = 1;
  #handlers = new Map<number, SubscriptionHandler>();
  #serviceHandlers = new Map<number, ServiceServerHandler>();
  #actionFeedback = new Map<number, ActionFeedbackHandler>();
  #actionStatus = new Map<number, ActionStatusHandler>();
  #actionServerHandlers = new Map<number, ActionServerHandlers>();
  #inflightByChannel = new Map<number, Set<number>>();
  #channels = new Map<number, ChannelRecord>();
  #telemetry: EngineTelemetrySnapshot | null = null;
  #graphHandlers = new Set<GraphHandler>();
  #graph: GraphView = { generation: 0, nodes: [], endpoints: [] };
  #session: RclwebSession;
  #reconnectAttempts = 0;
  #reconnecting = false;

  private constructor(worker: Worker, url: string, options: ConnectOptions) {
    this.#worker = worker;
    this.#url = url;
    this.#options = options;
    this.#session = {
      subscribe: ((topic, type: TypeNameLike = StdMsgsStringMsg, qos = {}) =>
        this.#subscribe(topic, typeNameOf(type), qos)) as RclwebSession["subscribe"],
      publish: ((topic, type: TypeNameLike = StdMsgsStringMsg, qos = {}) =>
        this.#publish(topic, typeNameOf(type), qos)) as RclwebSession["publish"],
      createServiceClient: (name, typeName = "") =>
        this.#createServiceClient(name, typeName),
      createServiceServer: (name, typeName = "", handler) =>
        this.#createServiceServer(name, typeName, handler),
      createActionClient: (name, typeName = "") =>
        this.#createActionClient(name, typeName),
      createActionServer: (name, typeName = "", handlers = {}) =>
        this.#createActionServer(name, typeName, handlers),
      onGraph: (handler) => {
        this.#graphHandlers.add(handler);
        if (this.#graph.generation > 0) handler(this.#graph);
      },
      graph: () => this.#graph,
      getParameters: (node, requestCdr = new Uint8Array()) =>
        this.#paramService(
          node,
          "get_parameters",
          "rcl_interfaces/srv/GetParameters",
          requestCdr,
        ),
      setParameters: (node, requestCdr = new Uint8Array()) =>
        this.#paramService(
          node,
          "set_parameters",
          "rcl_interfaces/srv/SetParameters",
          requestCdr,
        ),
      listParameters: (node, requestCdr = new Uint8Array()) =>
        this.#paramService(
          node,
          "list_parameters",
          "rcl_interfaces/srv/ListParameters",
          requestCdr,
        ),
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
    const client = new WorkerClient(worker, url, options);
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
    return this.#telemetry;
  }

  #emitGraph(): void {
    for (const handler of this.#graphHandlers) {
      handler(this.#graph);
    }
  }

  async reconnect(): Promise<void> {
    this.#reconnecting = true;
    try {
      this.#rejectInflight("session reconnected");
      await this.#request({ type: "reconnect", requestId: 0 });
      await this.#reopenChannels();
    } finally {
      this.#reconnecting = false;
    }
  }

  async close(): Promise<void> {
    this.#options = { ...this.#options, reconnect: false };
    await this.#request({ type: "close", requestId: 0 });
    this.#worker.terminate();
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

  #rejectInflight(message: string): void {
    const err = new Error(message);
    for (const pending of this.#pending.values()) {
      pending.reject(err);
    }
    this.#pending.clear();
    this.#inflightByChannel.clear();
  }

  async #reopenChannels(): Promise<void> {
    const snapshot = [...this.#channels.values()];
    this.#channels.clear();
    await reopenTrackedChannels(snapshot, {
      subscribe: (topic, typeName, qos, channelId) =>
        this.#subscribe(topic, typeName, qos, channelId),
      publish: (topic, typeName, qos, channelId) =>
        this.#publish(topic, typeName, qos, channelId),
      createServiceClient: (name, typeName, channelId) =>
        this.#createServiceClient(name, typeName, channelId),
      createServiceServer: (name, typeName, handler, channelId) =>
        this.#createServiceServer(name, typeName, handler, channelId),
      createActionClient: (name, typeName, channelId) =>
        this.#createActionClient(name, typeName, channelId),
      createActionServer: (name, typeName, handlers, channelId) =>
        this.#createActionServer(name, typeName, handlers, channelId),
    });
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
        const rec = this.#channels.get(channelId);
        const sub: Subscription = {
          topic: msg.topic,
          typeName: msg.typeName,
          channelId,
          onMessage: (handler) => {
            this.#handlers.set(channelId, handler);
            const current = this.#channels.get(channelId);
            if (current) current.handler = handler;
          },
          unsubscribe: async () => {
            this.#handlers.delete(channelId);
            this.#channels.delete(channelId);
            await this.#request({
              type: "unsubscribe",
              requestId: 0,
              channelId,
              correlation: [...corrTag(0xc3)],
            });
          },
        };
        if (rec) {
          rec.topic = msg.topic;
          rec.typeName = msg.typeName;
        }
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
            if (msg.typeName === PointCloud2Msg.typeName) {
              if (!isPointCloud2(message)) {
                throw new Error("PointCloud2 publish requires a PointCloud2 message");
              }
              await this.#request({
                type: "sendPointCloud2",
                requestId: 0,
                channelId,
                message,
              });
              return;
            }
            if (isGeneratedMsgType(msg.typeName)) {
              const value = encodeGeneratedHostValue(msg.typeName, message);
              await this.#request({
                type: "sendGenerated",
                requestId: 0,
                channelId,
                typeName: msg.typeName,
                value,
              });
              return;
            }
            if (!isStdMsgsString(message)) {
              throw new Error("String publish requires { data: string }");
            }
            await this.#request({
              type: "sendSample",
              requestId: 0,
              channelId,
              data: message.data,
            });
          },
          unadvertise: async () => {
            this.#channels.delete(channelId);
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
      case "samplePointCloud2": {
        const handler = this.#handlers.get(msg.channelId);
        if (!handler) {
          break;
        }
        const leaseId = msg.leaseId;
        handler(msg.message, {
          leaseId,
          release: () => {
            this.#worker.postMessage({
              type: "releaseLease",
              leaseId,
            } satisfies MainToWorker);
          },
        });
        break;
      }
      case "sampleGenerated": {
        const handler = this.#handlers.get(msg.channelId);
        if (!handler) {
          break;
        }
        const leaseId = msg.leaseId;
        handler(reviveGenerated(msg.typeName, msg.message), {
          leaseId,
          release: () => {
            this.#worker.postMessage({
              type: "releaseLease",
              leaseId,
            } satisfies MainToWorker);
          },
        });
        break;
      }
      case "serviceReady": {
        const p = this.#pending.get(msg.requestId);
        if (!p) break;
        const channelId = msg.channelId;
        if (msg.client) {
          const client: ServiceClient = {
            name: msg.name,
            typeName: msg.typeName,
            channelId,
            call: (request) => this.#callService(channelId, request),
            close: async () => {
              this.#channels.delete(channelId);
              await this.#request({
                type: "unsubscribe",
                requestId: 0,
                channelId,
                correlation: [...corrTag(0xc5)],
              });
            },
          };
          p.resolve(client);
        } else {
          const server: ServiceServer = {
            name: msg.name,
            typeName: msg.typeName,
            channelId,
            close: async () => {
              this.#channels.delete(channelId);
              this.#serviceHandlers.delete(channelId);
              await this.#request({
                type: "unsubscribe",
                requestId: 0,
                channelId,
                correlation: [...corrTag(0xc6)],
              });
            },
          };
          p.resolve(server);
        }
        this.#pending.delete(msg.requestId);
        break;
      }
      case "serviceFailed": {
        const p = this.#pending.get(msg.requestId);
        if (!p) break;
        p.reject(new Error(`service failed (${msg.code}): ${msg.message}`));
        this.#pending.delete(msg.requestId);
        break;
      }
      case "serviceResponse": {
        this.#clearInflight(msg.channelId, msg.requestId);
        const p = this.#pending.get(msg.requestId);
        if (p) {
          p.resolve(asPayload(msg.payload));
          this.#pending.delete(msg.requestId);
        }
        break;
      }
      case "serviceRequest": {
        const handler = this.#serviceHandlers.get(msg.channelId);
        if (!handler) break;
        const opid = Uint8Array.from(msg.operationId);
        void Promise.resolve(handler(asPayload(msg.payload), opid)).then(
          (response) => {
            this.#worker.postMessage({
              type: "sendServiceResponse",
              requestId: this.#nextRequest++,
              channelId: msg.channelId,
              operationId: [...opid],
              response,
            } satisfies MainToWorker);
          },
        );
        break;
      }
      case "actionReady": {
        const p = this.#pending.get(msg.requestId);
        if (!p) break;
        const channelId = msg.channelId;
        if (msg.client) {
          const client: ActionClient = {
            name: msg.name,
            typeName: msg.typeName,
            channelId,
            sendGoal: (goal) => this.#sendActionGoal(channelId, goal),
            cancel: (opid) => {
              void this.#request({
                type: "cancelAction",
                requestId: 0,
                channelId,
                operationId: [...opid],
              });
            },
            onFeedback: (handler) => {
              this.#actionFeedback.set(channelId, handler);
            },
            onStatus: (handler) => {
              this.#actionStatus.set(channelId, handler);
            },
            close: async () => {
              this.#channels.delete(channelId);
              this.#actionFeedback.delete(channelId);
              this.#actionStatus.delete(channelId);
              await this.#request({
                type: "unsubscribe",
                requestId: 0,
                channelId,
                correlation: [...corrTag(0xc7)],
              });
            },
          };
          p.resolve(client);
        } else {
          const server: ActionServer = {
            name: msg.name,
            typeName: msg.typeName,
            channelId,
            sendFeedback: (opid, feedback) => {
              void this.#request({
                type: "sendActionFeedback",
                requestId: 0,
                channelId,
                operationId: [...opid],
                feedback,
              });
            },
            sendResult: (opid, result) => {
              void this.#request({
                type: "sendActionResult",
                requestId: 0,
                channelId,
                operationId: [...opid],
                result,
              });
            },
            sendStatus: (opid, status) => {
              void this.#request({
                type: "sendActionStatus",
                requestId: 0,
                channelId,
                operationId: [...opid],
                status,
              });
            },
            close: async () => {
              this.#channels.delete(channelId);
              this.#actionServerHandlers.delete(channelId);
              await this.#request({
                type: "unsubscribe",
                requestId: 0,
                channelId,
                correlation: [...corrTag(0xc8)],
              });
            },
          };
          p.resolve(server);
        }
        this.#pending.delete(msg.requestId);
        break;
      }
      case "actionFailed": {
        const p = this.#pending.get(msg.requestId);
        if (!p) break;
        p.reject(new Error(`action failed (${msg.code}): ${msg.message}`));
        this.#pending.delete(msg.requestId);
        break;
      }
      case "actionGoal": {
        const handlers = this.#actionServerHandlers.get(msg.channelId);
        if (handlers?.onGoal) {
          void handlers.onGoal(
            asPayload(msg.payload),
            Uint8Array.from(msg.operationId),
          );
        }
        break;
      }
      case "actionFeedback": {
        this.#actionFeedback.get(msg.channelId)?.(
          asPayload(msg.payload),
          Uint8Array.from(msg.operationId),
        );
        break;
      }
      case "actionResult": {
        this.#clearInflight(msg.channelId, msg.requestId);
        const p = this.#pending.get(msg.requestId);
        if (p) {
          p.resolve(asPayload(msg.payload));
          this.#pending.delete(msg.requestId);
        }
        break;
      }
      case "actionStatus": {
        this.#actionStatus.get(msg.channelId)?.(
          asPayload(msg.payload),
          Uint8Array.from(msg.operationId),
        );
        break;
      }
      case "graphSnapshot": {
        let nodes: GraphView["nodes"] = [];
        let endpoints: GraphView["endpoints"] = [];
        try {
          nodes = JSON.parse(msg.nodesJson) as GraphView["nodes"];
          endpoints = JSON.parse(msg.endpointsJson) as GraphView["endpoints"];
        } catch {
          // keep empty on malformed JSON from the engine
        }
        this.#graph = {
          generation: msg.generation,
          nodes,
          endpoints,
        };
        this.#emitGraph();
        break;
      }
      case "graphDelta": {
        this.#graph = {
          ...this.#graph,
          generation: msg.generation,
        };
        this.#emitGraph();
        break;
      }
      case "operationCancelled": {
        const inflight = this.#inflightByChannel.get(msg.channelId);
        if (inflight) {
          for (const requestId of inflight) {
            const p = this.#pending.get(requestId);
            if (p) {
              p.reject(
                new Error(
                  `operation cancelled (${msg.code}): ${msg.message}`,
                ),
              );
              this.#pending.delete(requestId);
            }
          }
          this.#inflightByChannel.delete(msg.channelId);
        }
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
      case "telemetry": {
        this.#telemetry = msg.snapshot;
        break;
      }
      case "closed": {
        if (msg.requestId != null) {
          const p = this.#pending.get(msg.requestId);
          if (p) {
            p.resolve(undefined);
            this.#pending.delete(msg.requestId);
          }
        } else if (
          !this.#reconnecting &&
          this.#options.reconnect &&
          this.#url
        ) {
          void this.#autoReconnect();
        }
        break;
      }
    }
  }

  async #subscribe(
    topic: string,
    typeName: string,
    qos: QosOptions,
    reuseChannelId?: number,
  ): Promise<Subscription> {
    const channelId = reuseChannelId ?? this.#nextChannel++;
    const requestId = this.#nextRequest++;
    this.#channels.set(channelId, {
      kind: "subscribe",
      topic,
      typeName,
      qos,
      channelId,
    });
    return new Promise((resolve, reject) => {
      this.#pending.set(requestId, {
        resolve: (value) => resolve(value as Subscription),
        reject: (err) => {
          this.#channels.delete(channelId);
          reject(err);
        },
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
    reuseChannelId?: number,
  ): Promise<Publisher> {
    const channelId = reuseChannelId ?? this.#nextChannel++;
    const requestId = this.#nextRequest++;
    this.#channels.set(channelId, {
      kind: "publish",
      topic,
      typeName,
      qos,
      channelId,
    });
    return new Promise((resolve, reject) => {
      this.#pending.set(requestId, {
        resolve: (value) => resolve(value as Publisher),
        reject: (err) => {
          this.#channels.delete(channelId);
          reject(err);
        },
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

  #createServiceClient(
    name: string,
    typeName: string,
    reuseChannelId?: number,
  ): Promise<ServiceClient> {
    const channelId = reuseChannelId ?? this.#nextChannel++;
    const requestId = this.#nextRequest++;
    this.#channels.set(channelId, {
      kind: "serviceClient",
      topic: name,
      typeName,
      qos: {},
      channelId,
    });
    return new Promise((resolve, reject) => {
      this.#pending.set(requestId, {
        resolve: (value) => resolve(value as ServiceClient),
        reject: (err) => {
          this.#channels.delete(channelId);
          reject(err);
        },
      });
      this.#worker.postMessage({
        type: "openService",
        requestId,
        channelId,
        name,
        typeName,
        client: true,
        correlation: [...corrTag(0xe0 + (channelId & 0x0f))],
      } satisfies MainToWorker);
    });
  }

  #createServiceServer(
    name: string,
    typeName: string,
    handler: ServiceServerHandler,
    reuseChannelId?: number,
  ): Promise<ServiceServer> {
    const channelId = reuseChannelId ?? this.#nextChannel++;
    const requestId = this.#nextRequest++;
    this.#serviceHandlers.set(channelId, handler);
    this.#channels.set(channelId, {
      kind: "serviceServer",
      topic: name,
      typeName,
      qos: {},
      channelId,
      serviceHandler: handler,
    });
    return new Promise((resolve, reject) => {
      this.#pending.set(requestId, {
        resolve: (value) => resolve(value as ServiceServer),
        reject: (err) => {
          this.#channels.delete(channelId);
          this.#serviceHandlers.delete(channelId);
          reject(err);
        },
      });
      this.#worker.postMessage({
        type: "openService",
        requestId,
        channelId,
        name,
        typeName,
        client: false,
        correlation: [...corrTag(0xe1 + (channelId & 0x0f))],
      } satisfies MainToWorker);
    });
  }

  #callService(channelId: number, request: Uint8Array): Promise<Uint8Array> {
    const operationId = crypto.getRandomValues(new Uint8Array(16));
    const requestId = this.#nextRequest++;
    this.#trackInflight(channelId, requestId);
    return new Promise((resolve, reject) => {
      this.#pending.set(requestId, {
        resolve: (value) => resolve(value as Uint8Array),
        reject,
      });
      this.#worker.postMessage({
        type: "callService",
        requestId,
        channelId,
        operationId: [...operationId],
        request,
      } satisfies MainToWorker);
    });
  }

  #createActionClient(
    name: string,
    typeName: string,
    reuseChannelId?: number,
  ): Promise<ActionClient> {
    const channelId = reuseChannelId ?? this.#nextChannel++;
    const requestId = this.#nextRequest++;
    this.#channels.set(channelId, {
      kind: "actionClient",
      topic: name,
      typeName,
      qos: {},
      channelId,
    });
    return new Promise((resolve, reject) => {
      this.#pending.set(requestId, {
        resolve: (value) => resolve(value as ActionClient),
        reject: (err) => {
          this.#channels.delete(channelId);
          reject(err);
        },
      });
      this.#worker.postMessage({
        type: "openAction",
        requestId,
        channelId,
        name,
        typeName,
        client: true,
        correlation: [...corrTag(0xe2 + (channelId & 0x0f))],
      } satisfies MainToWorker);
    });
  }

  #createActionServer(
    name: string,
    typeName: string,
    handlers: ActionServerHandlers,
    reuseChannelId?: number,
  ): Promise<ActionServer> {
    const channelId = reuseChannelId ?? this.#nextChannel++;
    const requestId = this.#nextRequest++;
    this.#actionServerHandlers.set(channelId, handlers);
    this.#channels.set(channelId, {
      kind: "actionServer",
      topic: name,
      typeName,
      qos: {},
      channelId,
      actionHandlers: handlers,
    });
    return new Promise((resolve, reject) => {
      this.#pending.set(requestId, {
        resolve: (value) => resolve(value as ActionServer),
        reject: (err) => {
          this.#channels.delete(channelId);
          this.#actionServerHandlers.delete(channelId);
          reject(err);
        },
      });
      this.#worker.postMessage({
        type: "openAction",
        requestId,
        channelId,
        name,
        typeName,
        client: false,
        correlation: [...corrTag(0xe3 + (channelId & 0x0f))],
      } satisfies MainToWorker);
    });
  }

  #sendActionGoal(
    channelId: number,
    goal: Uint8Array,
  ): { operationId: Uint8Array; result: Promise<Uint8Array> } {
    const operationId = crypto.getRandomValues(new Uint8Array(16));
    const requestId = this.#nextRequest++;
    this.#trackInflight(channelId, requestId);
    const result = new Promise<Uint8Array>((resolve, reject) => {
      this.#pending.set(requestId, {
        resolve: (value) => resolve(value as Uint8Array),
        reject,
      });
      this.#worker.postMessage({
        type: "sendActionGoal",
        requestId,
        channelId,
        operationId: [...operationId],
        goal,
      } satisfies MainToWorker);
    });
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

  #trackInflight(channelId: number, requestId: number): void {
    let set = this.#inflightByChannel.get(channelId);
    if (!set) {
      set = new Set();
      this.#inflightByChannel.set(channelId, set);
    }
    set.add(requestId);
  }

  #clearInflight(channelId: number, requestId: number): void {
    const set = this.#inflightByChannel.get(channelId);
    if (!set) return;
    set.delete(requestId);
    if (set.size === 0) this.#inflightByChannel.delete(channelId);
  }
}

/**
 * Open a session to an rclwebd WebSocket endpoint.
 *
 * `connect(url)` → session subscribe/publish/service/action/graph.
 */
export async function connect(
  url: string,
  options: ConnectOptions = {},
): Promise<RclwebClient> {
  const resolved = resolveGatewayConnect(url, options);
  if (resolved.note) {
    console.info(`rcl-web: ${resolved.note}`);
  }
  const resolvedOptions: ConnectOptions = {
    ...options,
    transport: resolved.transport,
  };
  const wasmUrl = resolvedOptions.wasmUrl
    ? String(resolvedOptions.wasmUrl)
    : defaultWasmUrl();
  if (resolvedOptions.inline) {
    const response = await fetch(wasmUrl);
    if (!response.ok) {
      throw new Error(`failed to fetch wasm: ${response.status}`);
    }
    const bytes = await response.arrayBuffer();
    return InlineClient.create(resolved.url, bytes, resolvedOptions);
  }
  return WorkerClient.create(resolved.url, wasmUrl, resolvedOptions);
}

/** @internal Test helper: offline inline client for scripted peer bytes. */
export async function connectOfflineForTests(
  wasmBytes: ArrayBuffer,
): Promise<InlineClient> {
  return InlineClient.createOffline(wasmBytes);
}
