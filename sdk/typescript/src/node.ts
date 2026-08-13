/**
 * rclcpp-shaped Node: createPublisher / createSubscription / createClient /
 * createService / createWallTimer.
 *
 * TypeScript cannot do `create_publisher<std_msgs::msg::String>(topic, qos)`,
 * so the message type is the first argument (the template parameter as a value):
 *
 *   node.createPublisher(std_msgs.msg.String, "chatter", 10)
 */

import type {
  Publisher as SessionPublisher,
  RclwebClient,
  Subscription as SessionSubscription,
} from "./client.ts";
import { requireClient } from "./context.ts";
import {
  PointCloud2,
  PointField,
  String as StdMsgsStringMsg,
  type MessageType,
} from "./interfaces.ts";
import { qosToOptions, type QoSInput } from "./qos.ts";
import {
  isPointCloud2,
  isStdMsgsString,
  type PointCloud2 as WirePointCloud2,
  type SampleMessage,
  type ServiceClient,
  type ServiceServer,
} from "./types.ts";

export type SubscriptionCallback<T> = (msg: T) => void;

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

export class Client {
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

  /** rclcpp `async_send_request` — request/response are CDR until typed generation. */
  async sendRequest(request: Uint8Array): Promise<Uint8Array> {
    const client = await this.#inner;
    return client.call(request);
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
  #publishers: Publisher<unknown>[] = [];
  #subscriptions: Subscription<unknown>[] = [];
  #clients: Client[] = [];
  #services: Service[] = [];
  #timers: WallTimer[] = [];

  constructor(name: string, namespace = "") {
    this.name = name;
    this.namespace = namespace;
    this.#client = requireClient();
  }

  getName(): string {
    return this.name;
  }

  getNamespace(): string {
    return this.namespace;
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

  createClient(type: { readonly typeName: string }, serviceName: string): Client {
    const name = resolveName(this.namespace, serviceName);
    const inner = this.#client.session.createServiceClient(name, type.typeName);
    const client = new Client(name, type.typeName, inner);
    this.#clients.push(client);
    return client;
  }

  createService(
    type: { readonly typeName: string },
    serviceName: string,
    handler: (request: Uint8Array) => Uint8Array | Promise<Uint8Array>,
  ): Service {
    const name = resolveName(this.namespace, serviceName);
    const inner = this.#client.session.createServiceServer(
      name,
      type.typeName,
      (request) => handler(request),
    );
    const service = new Service(name, type.typeName, inner);
    this.#services.push(service);
    return service;
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
    this.#timers = [];
    this.#publishers = [];
    this.#subscriptions = [];
    this.#clients = [];
    this.#services = [];
  }
}

function resolveName(namespace: string, name: string): string {
  if (name.startsWith("/")) return name;
  if (!namespace || namespace === "/") return `/${name}`;
  const ns = namespace.endsWith("/") ? namespace.slice(0, -1) : namespace;
  return `${ns.startsWith("/") ? ns : `/${ns}`}/${name}`;
}

function xyzFields(): PointField[] {
  return [
    field("x", 0, PointField.FLOAT32, 1),
    field("y", 4, PointField.FLOAT32, 1),
    field("z", 8, PointField.FLOAT32, 1),
  ];
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
  throw new Error(`unsupported message type ${typeName}`);
}

function wireToRos(wire: WirePointCloud2): PointCloud2 {
  const msg = new PointCloud2();
  msg.height = wire.height;
  msg.width = wire.width;
  msg.point_step = wire.pointStep;
  msg.row_step = wire.rowStep;
  msg.is_bigendian = wire.isBigendian;
  msg.is_dense = wire.isDense;
  msg.data = wire.data.slice();
  if (wire.fieldCount === 3 && wire.pointStep >= 12) {
    msg.fields = xyzFields();
  } else if (wire.fieldCount > 0) {
    msg.fields = [field("data", 0, PointField.UINT8, Math.max(wire.pointStep, 1))];
  }
  return msg;
}

function rosToWire(msg: PointCloud2): WirePointCloud2 {
  return {
    height: msg.height,
    width: msg.width,
    pointStep: msg.point_step,
    rowStep: msg.row_step,
    isBigendian: msg.is_bigendian,
    isDense: msg.is_dense,
    fieldCount: msg.fields.length,
    data: msg.data,
  };
}
