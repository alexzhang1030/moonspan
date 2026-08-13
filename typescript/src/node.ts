/**
 * rclcpp-shaped Node: createPublisher / createSubscription / createClient /
 * createService / createActionClient / createActionServer / createWallTimer /
 * getNodeNames / getTopicNamesAndTypes.
 *
 * TypeScript cannot do `create_publisher<std_msgs::msg::String>(topic, qos)`,
 * so the message type is the first argument (the template parameter as a value):
 *
 *   node.createPublisher(std_msgs.msg.String, "chatter", 10)
 */

import type {
  ActionClient as SessionActionClient,
  ActionServer as SessionActionServer,
  GraphView,
  Publisher as SessionPublisher,
  RclwebClient,
  Subscription as SessionSubscription,
} from "./client.ts";
import { requireClient } from "./context.ts";
import {
  EchoNested,
  EchoNested_Request,
  EchoNested_Response,
  MeasureSequence,
  MeasureSequence_Feedback,
  MeasureSequence_Goal,
  MeasureSequence_Result,
  PointCloud2,
  PointField,
  String as StdMsgsStringMsg,
  isGeneratedMsgType,
  type MessageType,
} from "./interfaces.ts";
import { qosToOptions, type QoSInput } from "./qos.ts";
import { decodeOpPayload, encodeOpPayload, reviveGenerated } from "./generated-value.ts";
import {
  isPointCloud2,
  isStdMsgsString,
  type PointCloud2 as WirePointCloud2,
  type SampleMessage,
  type ServiceClient,
  type ServiceServer,
} from "./types.ts";

export type SubscriptionCallback<T> = (msg: T) => void;

/** rclcpp `get_topic_names_and_types` row. */
export type NamesAndTypes = {
  name: string;
  types: string[];
};

/** Registry `graph_endpoint_kinds` (kept off the public surface). */
const TOPIC_PUB = 0;
const TOPIC_SUB = 1;
const SERVICE_SERVER = 2;
const SERVICE_CLIENT = 3;
const ACTION_SERVER = 4;
const ACTION_CLIENT = 5;

export class Publisher<T> {
  readonly topic: string;
  readonly typeName: string;
  #inner: Promise<SessionPublisher<SampleMessage>>;

  constructor(
    topic: string,
    typeName: string,
    inner: Promise<SessionPublisher<SampleMessage>>,
  ) {
    this.topic = topic;
    this.typeName = typeName;
    this.#inner = inner;
    void inner.catch(() => {});
  }

  publish(message: T): void {
    const wire = toWire(this.typeName, message);
    void this.#inner.then((pub) => pub.publish(wire));
  }

  destroy(): void {
    void this.#inner.then((pub) => pub.unadvertise());
  }
}

export class Subscription<T> {
  readonly topic: string;
  readonly typeName: string;
  #inner: Promise<SessionSubscription<SampleMessage>>;

  constructor(
    topic: string,
    typeName: string,
    inner: Promise<SessionSubscription<SampleMessage>>,
  ) {
    this.topic = topic;
    this.typeName = typeName;
    this.#inner = inner;
    void inner.catch(() => {});
  }

  destroy(): void {
    void this.#inner.then((sub) => sub.unsubscribe());
  }
}

export class Client<Req = Uint8Array, Res = Uint8Array> {
  readonly name: string;
  readonly typeName: string;
  #inner: Promise<ServiceClient>;

  constructor(name: string, typeName: string, inner: Promise<ServiceClient>) {
    this.name = name;
    this.typeName = typeName;
    this.#inner = inner;
    void inner.catch(() => {});
  }

  async waitForService(): Promise<boolean> {
    try {
      await this.#inner;
      return true;
    } catch {
      return false;
    }
  }

  /** rclcpp `async_send_request`. Phase 1 generated types are ROS classes; others are CDR. */
  async sendRequest(request: Req): Promise<Res> {
    const client = await this.#inner;
    const bytes = encodeOpPayload(this.typeName, "Request", request);
    const response = await client.call(bytes);
    return decodeOpPayload(this.typeName, "Response", response) as Res;
  }

  destroy(): void {
    void this.#inner.then((client) => client.close());
  }
}

export class Service {
  readonly name: string;
  readonly typeName: string;
  #inner: Promise<ServiceServer>;

  constructor(name: string, typeName: string, inner: Promise<ServiceServer>) {
    this.name = name;
    this.typeName = typeName;
    this.#inner = inner;
    void inner.catch(() => {});
  }

  destroy(): void {
    void this.#inner.then((server) => server.close());
  }
}

export class ActionClient<G = Uint8Array, R = Uint8Array, F = Uint8Array> {
  readonly name: string;
  readonly typeName: string;
  #inner: Promise<SessionActionClient>;

  constructor(name: string, typeName: string, inner: Promise<SessionActionClient>) {
    this.name = name;
    this.typeName = typeName;
    this.#inner = inner;
    void inner.catch(() => {});
  }

  async waitForAction(): Promise<boolean> {
    try {
      await this.#inner;
      return true;
    } catch {
      return false;
    }
  }

  sendGoal(goal: G): { operationId: Promise<Uint8Array>; result: Promise<R> } {
    const sent = this.#inner.then((client) =>
      client.sendGoal(encodeOpPayload(this.typeName, "Goal", goal)),
    );
    return {
      operationId: sent.then((s) => s.operationId),
      result: sent.then(async (s) => {
        const bytes = await s.result;
        return decodeOpPayload(this.typeName, "Result", bytes) as R;
      }),
    };
  }

  onFeedback(callback: (feedback: F, operationId: Uint8Array) => void): void {
    void this.#inner.then((client) => {
      client.onFeedback((bytes, operationId) => {
        callback(decodeOpPayload(this.typeName, "Feedback", bytes) as F, operationId);
      });
    });
  }

  cancel(operationId: Uint8Array): void {
    void this.#inner.then((client) => client.cancel(operationId));
  }

  destroy(): void {
    void this.#inner.then((client) => client.close());
  }
}

export class ActionServer<G = Uint8Array, R = Uint8Array, F = Uint8Array> {
  readonly name: string;
  readonly typeName: string;
  #inner: Promise<SessionActionServer>;

  constructor(name: string, typeName: string, inner: Promise<SessionActionServer>) {
    this.name = name;
    this.typeName = typeName;
    this.#inner = inner;
    void inner.catch(() => {});
  }

  sendFeedback(operationId: Uint8Array, feedback: F): void {
    void this.#inner.then((server) => {
      server.sendFeedback(operationId, encodeOpPayload(this.typeName, "Feedback", feedback));
    });
  }

  sendResult(operationId: Uint8Array, result: R): void {
    void this.#inner.then((server) => {
      server.sendResult(operationId, encodeOpPayload(this.typeName, "Result", result));
    });
  }

  sendStatus(operationId: Uint8Array, status: Uint8Array): void {
    void this.#inner.then((server) => server.sendStatus(operationId, status));
  }

  destroy(): void {
    void this.#inner.then((server) => server.close());
  }
}

export class WallTimer {
  #id: ReturnType<typeof setInterval> | null;

  constructor(periodMs: number, callback: () => void) {
    this.#id = setInterval(callback, periodMs);
  }

  cancel(): void {
    if (this.#id !== null) {
      clearInterval(this.#id);
      this.#id = null;
    }
  }
}

export class Node {
  readonly name: string;
  readonly namespace: string;
  #client: RclwebClient;
  #graph: GraphView;
  #graphChanges: Array<() => void> = [];
  #publishers: Publisher<unknown>[] = [];
  #subscriptions: Subscription<unknown>[] = [];
  #clients: Client[] = [];
  #services: Service[] = [];
  #actionClients: ActionClient[] = [];
  #actionServers: ActionServer[] = [];
  #timers: WallTimer[] = [];

  constructor(name: string, namespace = "") {
    this.name = name;
    this.namespace = namespace;
    this.#client = requireClient();
    this.#graph = this.#client.session.graph();
    this.#client.session.onGraph((view) => {
      this.#graph = view;
      for (const callback of this.#graphChanges) {
        callback();
      }
    });
  }

  getName(): string {
    return this.name;
  }

  getNamespace(): string {
    return this.namespace;
  }

  /**
   * rclcpp `get_node_names`. Fully qualified names from the last GraphSnapshot.
   */
  getNodeNames(): string[] {
    return this.#graph.nodes.map((node) => node.name);
  }

  /**
   * rclcpp `get_topic_names_and_types`.
   */
  getTopicNamesAndTypes(): NamesAndTypes[] {
    return namesAndTypes(this.#graph, [TOPIC_PUB, TOPIC_SUB]);
  }

  /**
   * rclcpp `get_service_names_and_types`.
   */
  getServiceNamesAndTypes(): NamesAndTypes[] {
    return namesAndTypes(this.#graph, [SERVICE_SERVER, SERVICE_CLIENT]);
  }

  /**
   * rclcpp_action `get_action_names_and_types`.
   */
  getActionNamesAndTypes(): NamesAndTypes[] {
    return namesAndTypes(this.#graph, [ACTION_SERVER, ACTION_CLIENT]);
  }

  /**
   * rclcpp `count_publishers`. Relative names resolve under this node namespace.
   */
  countPublishers(topicName: string): number {
    return countEndpoints(this.#graph, TOPIC_PUB, resolveName(this.namespace, topicName));
  }

  /**
   * rclcpp `count_subscribers`.
   */
  countSubscribers(topicName: string): number {
    return countEndpoints(this.#graph, TOPIC_SUB, resolveName(this.namespace, topicName));
  }

  /**
   * Event-loop analog of rclcpp `wait_for_graph_change`: call the getters
   * from the callback. GraphSnapshot/Delta stay off this surface.
   */
  onGraphChange(callback: () => void): void {
    this.#graphChanges.push(callback);
  }

  createPublisher(
    type: typeof StdMsgsStringMsg,
    topicName: string,
    qos?: QoSInput,
  ): Publisher<StdMsgsStringMsg>;
  createPublisher(
    type: typeof PointCloud2,
    topicName: string,
    qos?: QoSInput,
  ): Publisher<PointCloud2>;
  createPublisher<T>(
    type: MessageType<T>,
    topicName: string,
    qos?: QoSInput,
  ): Publisher<T>;
  createPublisher<T>(
    type: MessageType<T>,
    topicName: string,
    qos: QoSInput = 10,
  ): Publisher<T> {
    const topic = resolveName(this.namespace, topicName);
    const inner = this.#client.session.publish(
      topic,
      type.typeName,
      qosToOptions(qos),
    ) as Promise<SessionPublisher<SampleMessage>>;
    const publisher = new Publisher<T>(topic, type.typeName, inner);
    this.#publishers.push(publisher as Publisher<unknown>);
    return publisher;
  }

  createSubscription(
    type: typeof StdMsgsStringMsg,
    topicName: string,
    qos: QoSInput,
    callback: SubscriptionCallback<StdMsgsStringMsg>,
  ): Subscription<StdMsgsStringMsg>;
  createSubscription(
    type: typeof PointCloud2,
    topicName: string,
    qos: QoSInput,
    callback: SubscriptionCallback<PointCloud2>,
  ): Subscription<PointCloud2>;
  createSubscription<T>(
    type: MessageType<T>,
    topicName: string,
    qos: QoSInput,
    callback: SubscriptionCallback<T>,
  ): Subscription<T>;
  createSubscription<T>(
    type: MessageType<T>,
    topicName: string,
    qos: QoSInput,
    callback: SubscriptionCallback<T>,
  ): Subscription<T> {
    const topic = resolveName(this.namespace, topicName);
    const inner = this.#client.session.subscribe(
      topic,
      type.typeName,
      qosToOptions(qos),
    ) as Promise<SessionSubscription<SampleMessage>>;
    void inner.then((sub) => {
      sub.onMessage((wire, lease) => {
        try {
          callback(fromWire(type.typeName, wire) as T);
        } finally {
          lease.release();
        }
      });
    });
    const subscription = new Subscription<T>(topic, type.typeName, inner);
    this.#subscriptions.push(subscription as Subscription<unknown>);
    return subscription;
  }

  createClient(
    type: typeof EchoNested,
    serviceName: string,
  ): Client<EchoNested_Request, EchoNested_Response>;
  createClient(
    type: { readonly typeName: string },
    serviceName: string,
  ): Client<Uint8Array, Uint8Array>;
  createClient(type: { readonly typeName: string }, serviceName: string): Client {
    const name = resolveName(this.namespace, serviceName);
    const inner = this.#client.session.createServiceClient(name, type.typeName);
    const client = new Client(name, type.typeName, inner);
    this.#clients.push(client);
    return client;
  }

  createService(
    type: typeof EchoNested,
    serviceName: string,
    handler: (
      request: EchoNested_Request,
    ) => EchoNested_Response | Promise<EchoNested_Response>,
  ): Service;
  createService(
    type: { readonly typeName: string },
    serviceName: string,
    handler: (request: Uint8Array) => Uint8Array | Promise<Uint8Array>,
  ): Service;
  createService(
    type: { readonly typeName: string },
    serviceName: string,
    handler: (request: never) => unknown,
  ): Service {
    const name = resolveName(this.namespace, serviceName);
    const typeName = type.typeName;
    const inner = this.#client.session.createServiceServer(
      name,
      typeName,
      (request) => {
        const decoded = decodeOpPayload(typeName, "Request", request);
        return Promise.resolve(handler(decoded as never)).then((response) =>
          encodeOpPayload(typeName, "Response", response),
        );
      },
    );
    const service = new Service(name, typeName, inner);
    this.#services.push(service);
    return service;
  }

  createActionClient(
    type: typeof MeasureSequence,
    actionName: string,
  ): ActionClient<
    MeasureSequence_Goal,
    MeasureSequence_Result,
    MeasureSequence_Feedback
  >;
  createActionClient(
    type: { readonly typeName: string },
    actionName: string,
  ): ActionClient<Uint8Array, Uint8Array, Uint8Array>;
  createActionClient(
    type: { readonly typeName: string },
    actionName: string,
  ): ActionClient {
    const name = resolveName(this.namespace, actionName);
    const inner = this.#client.session.createActionClient(name, type.typeName);
    const client = new ActionClient(name, type.typeName, inner);
    this.#actionClients.push(client);
    return client;
  }

  createActionServer(
    type: typeof MeasureSequence,
    actionName: string,
    handlers: {
      onGoal?: (
        goal: MeasureSequence_Goal,
        operationId: Uint8Array,
      ) => void | Promise<void>;
      onCancel?: (operationId: Uint8Array) => void | Promise<void>;
    },
  ): ActionServer<
    MeasureSequence_Goal,
    MeasureSequence_Result,
    MeasureSequence_Feedback
  >;
  createActionServer(
    type: { readonly typeName: string },
    actionName: string,
    handlers?: {
      onGoal?: (goal: Uint8Array, operationId: Uint8Array) => void | Promise<void>;
      onCancel?: (operationId: Uint8Array) => void | Promise<void>;
    },
  ): ActionServer<Uint8Array, Uint8Array, Uint8Array>;
  createActionServer(
    type: { readonly typeName: string },
    actionName: string,
    handlers: {
      onGoal?: (goal: never, operationId: Uint8Array) => void | Promise<void>;
      onCancel?: (operationId: Uint8Array) => void | Promise<void>;
    } = {},
  ): ActionServer {
    const name = resolveName(this.namespace, actionName);
    const typeName = type.typeName;
    const inner = this.#client.session.createActionServer(name, typeName, {
      onGoal: handlers.onGoal
        ? (goal, operationId) =>
            handlers.onGoal!(decodeOpPayload(typeName, "Goal", goal) as never, operationId)
        : undefined,
      onCancel: handlers.onCancel,
    });
    const server = new ActionServer(name, typeName, inner);
    this.#actionServers.push(server);
    return server;
  }

  createWallTimer(periodMs: number, callback: () => void): WallTimer {
    const timer = new WallTimer(periodMs, callback);
    this.#timers.push(timer);
    return timer;
  }

  destroy(): void {
    for (const timer of this.#timers) timer.cancel();
    for (const pub of this.#publishers) pub.destroy();
    for (const sub of this.#subscriptions) sub.destroy();
    for (const client of this.#clients) client.destroy();
    for (const service of this.#services) service.destroy();
    for (const client of this.#actionClients) client.destroy();
    for (const server of this.#actionServers) server.destroy();
    this.#timers = [];
    this.#publishers = [];
    this.#subscriptions = [];
    this.#clients = [];
    this.#services = [];
    this.#actionClients = [];
    this.#actionServers = [];
  }
}

function resolveName(namespace: string, name: string): string {
  if (name.startsWith("/")) return name;
  if (!namespace || namespace === "/") return `/${name}`;
  const ns = namespace.endsWith("/") ? namespace.slice(0, -1) : namespace;
  return `${ns.startsWith("/") ? ns : `/${ns}`}/${name}`;
}

function namesAndTypes(graph: GraphView, kinds: number[]): NamesAndTypes[] {
  const map = new Map<string, string[]>();
  for (const endpoint of graph.endpoints) {
    if (endpoint.kind === undefined || !kinds.includes(endpoint.kind)) {
      continue;
    }
    const types = map.get(endpoint.name) ?? [];
    if (endpoint.type_name && !types.includes(endpoint.type_name)) {
      types.push(endpoint.type_name);
    }
    map.set(endpoint.name, types);
  }
  return [...map.entries()].map(([name, types]) => ({ name, types }));
}

function countEndpoints(graph: GraphView, kind: number, name: string): number {
  let count = 0;
  for (const endpoint of graph.endpoints) {
    if (endpoint.kind === kind && endpoint.name === name) {
      count += 1;
    }
  }
  return count;
}

function field(
  name: string,
  offset: number,
  datatype: number,
  count: number,
): PointField {
  const f = new PointField();
  f.name = name;
  f.offset = offset;
  f.datatype = datatype;
  f.count = count;
  return f;
}

function fromWire(typeName: string, wire: SampleMessage): unknown {
  if (typeName === StdMsgsStringMsg.typeName && isStdMsgsString(wire)) {
    const msg = new StdMsgsStringMsg();
    msg.data = wire.data;
    return msg;
  }
  if (typeName === PointCloud2.typeName && isPointCloud2(wire)) {
    return wireToRos(wire);
  }
  if (isGeneratedMsgType(typeName)) {
    return reviveGenerated(typeName, wire);
  }
  throw new Error(`unsupported message type ${typeName}`);
}

function toWire(typeName: string, message: unknown): SampleMessage {
  if (typeName === StdMsgsStringMsg.typeName) {
    const data = (message as { data?: unknown }).data;
    if (typeof data !== "string") {
      throw new Error("std_msgs.msg.String publish requires .data: string");
    }
    return { data };
  }
  if (typeName === PointCloud2.typeName) {
    return rosToWire(message as PointCloud2);
  }
  if (isGeneratedMsgType(typeName)) {
    return message as SampleMessage;
  }
  throw new Error(`unsupported message type ${typeName}`);
}

function wireToRos(wire: WirePointCloud2): PointCloud2 {
  const msg = new PointCloud2();
  msg.header.stamp.sec = wire.stampSec;
  msg.header.stamp.nanosec = wire.stampNanosec;
  msg.header.frame_id = wire.frameId;
  msg.height = wire.height;
  msg.width = wire.width;
  msg.point_step = wire.pointStep;
  msg.row_step = wire.rowStep;
  msg.is_bigendian = wire.isBigendian;
  msg.is_dense = wire.isDense;
  msg.data = wire.data.slice();
  msg.fields = wire.fields.map((f) => field(f.name, f.offset, f.datatype, f.count));
  return msg;
}

function rosToWire(msg: PointCloud2): WirePointCloud2 {
  return {
    stampSec: msg.header.stamp.sec,
    stampNanosec: msg.header.stamp.nanosec,
    frameId: msg.header.frame_id,
    height: msg.height,
    width: msg.width,
    fields: msg.fields.map((f) => ({
      name: f.name,
      offset: f.offset,
      datatype: f.datatype,
      count: f.count,
    })),
    isBigendian: msg.is_bigendian,
    pointStep: msg.point_step,
    rowStep: msg.row_step,
    isDense: msg.is_dense,
    data: msg.data,
  };
}
