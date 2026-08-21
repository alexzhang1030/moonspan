# API reference

Public exports of `rcl-web`. How to put them together:
[node, topics, services, actions](./typescript.md).

```ts
import {
  init,
  ok,
  shutdown,
  spin,
  Node,
  Publisher,
  Subscription,
  Client,
  Service,
  ActionClient,
  ActionServer,
  WallTimer,
  QoS,
  KeepLast,
  builtin_interfaces,
  std_msgs,
  sensor_msgs,
  rclweb_cdr_interfaces,
} from "rcl-web";
```

## Context

```ts
await init(url: string, options?: InitOptions): Promise<void>
ok(): boolean
await shutdown(): Promise<void>
await spin(node?: unknown): Promise<void>
```

`init` throws if a context already exists. `Node` throws if `init` has
not run. `spin` waits until `shutdown()`; the browser event loop already
runs subscription and service callbacks.

## InitOptions

All fields optional. Leave the object off unless you need one of these.

| Field | Default | Meaning |
|---|---|---|
| `reconnect` | `false` | On transport close, start a new session and re-open channels. In-flight calls reject with `"session reconnected"`. |
| `reconnectAttempts` | `3` | Cap for `reconnect`. |
| `transport` | auto | Unset: WebTransport (QUIC) on a secure context when the URL looks like the intranet default. A LAN-IP page throws. Set `websocket` to skip QUIC. |
| `serverCertificateHashes` | — | Local-dev WebTransport hashes (`algorithm: "sha-256"`). |
| `fetchLocalDevTls` | — | Fetch `{origin}/local-dev/tls` when hashes are omitted. |
| `localDevTlsOrigin` | WT `:4433` → HTTP `:8794` | HTTP origin for that fetch. Custom WT ports need this. |
| `inline` | `false` | Run wasm on the calling thread. Tests only; browsers leave this off. |
| `wasmUrl` | next to the bundle | Override `rclweb.wasm`. |
| `workerUrl` | next to the bundle | Override the I/O Worker module. |

Helpers: `fetchLocalDevTlsHashes`, `decodeCertificateHashValue`,
`httpOriginFromWebTransportUrl`, `resolveGatewayConnect`. Intranet
`init` on a LAN-IP page throws `IntranetQuicRequiresSecureContextError`.
See [local-dev TLS](./adr/0011-local-dev-webtransport-tls.md) and
[intranet certificates](./deploy.md#intranet-certificates).

## Node

```ts
new Node(name: string, namespace?: string)
```

`namespace` defaults to `""`. Relative names resolve as in rclcpp
(`"chatter"` → `/chatter`, or `/ns/chatter` when the namespace is `/ns`).

| Method | Returns |
|---|---|
| `getName()` | Node name. |
| `getNamespace()` | Namespace string. |
| `createPublisher(type, topic, qos?)` | [`Publisher`](#publisher) |
| `createSubscription(type, topic, qos, callback)` | [`Subscription`](#subscription) |
| `createClient(type, service)` | [`Client`](#client) |
| `createService(type, service, handler)` | [`Service`](#service) |
| `createActionClient(type, action)` | [`ActionClient`](#actionclient) |
| `createActionServer(type, action, handlers?)` | [`ActionServer`](#actionserver) |
| `createWallTimer(periodMs, callback)` | [`WallTimer`](#walltimer) |
| `getNodeNames()` | Fully qualified names from the last graph. |
| `getTopicNamesAndTypes()` | `{ name, types }[]` |
| `getServiceNamesAndTypes()` | `{ name, types }[]` |
| `getActionNamesAndTypes()` | `{ name, types }[]` |
| `countPublishers(topic)` | Count; relative `topic` uses this namespace. |
| `countSubscribers(topic)` | Same. |
| `onGraphChange(callback)` | Fires when the gateway pushes a new graph. Call the getters from the callback. |
| `destroy()` | Cancel timers and close every entity created on this node. |

`qos` is a `number` or [`QoS`](#qos). A number is KeepLast(n) + reliable.
`createPublisher` defaults to `10` when `qos` is omitted.
`createSubscription` requires `qos`.

## Publisher

```ts
publisher.topic: string
publisher.typeName: string
publisher.publish(message): void
publisher.destroy(): void
```

`publish` encodes and sends. It does not throw if the channel is still
opening; the send runs when the channel is ready.

## Subscription

```ts
subscription.topic: string
subscription.typeName: string
subscription.destroy(): void
```

`callback(msg)` receives an owned message. PointCloud2 `data` is a copy.

```ts
type SubscriptionCallback<T> = (msg: T) => void
```

## Client

```ts
client.name: string
client.typeName: string
await client.waitForService(): Promise<boolean>
await client.sendRequest(request): Promise<response>
client.destroy(): void
```

Generated service (`rclweb_cdr_interfaces.srv.EchoNested`): `request` /
`response` are ROS classes. Any other `{ typeName }` is `Uint8Array` CDR
both ways. `waitForService` is `false` if the channel failed to open.

## Service

```ts
service.name: string
service.typeName: string
service.destroy(): void
```

`handler(request)` may return the response or a `Promise` of it. Same
typed-vs-CDR rule as `createClient`.

## ActionClient

```ts
client.name: string
client.typeName: string
await client.waitForAction(): Promise<boolean>
client.onFeedback((feedback, operationId) => void): void
client.sendGoal(goal): { operationId: Promise<Uint8Array>; result: Promise<result> }
client.cancel(operationId: Uint8Array): void
client.destroy(): void
```

Generated action (`rclweb_cdr_interfaces.action.MeasureSequence`):
`Goal` / `Result` / `Feedback` classes. Other `{ typeName }` values are
CDR `Uint8Array`. Register `onFeedback` before `sendGoal` if you need
the first feedback frame.

## ActionServer

```ts
server.name: string
server.typeName: string
server.sendFeedback(operationId, feedback): void
server.sendResult(operationId, result): void
server.sendStatus(operationId, statusCdr: Uint8Array): void
server.destroy(): void
```

`createActionServer(type, name, { onGoal?, onCancel? })`.
`onGoal(goal, operationId)` and `onCancel(operationId)` may be async.
`sendStatus` is always CDR.

## WallTimer

```ts
timer.cancel(): void
```

`createWallTimer` uses `setInterval`. `cancel` / `node.destroy()` clear
it.

## QoS

```ts
new QoS(historyDepth: number)
KeepLast(depth: number): QoS   // same as new QoS(depth)
qos.keepLast(depth): this
qos.reliable(): this           // default
qos.bestEffort(): this
```

`QoSInput` is `number | QoS`. Reliability numbers on the wire: `1`
reliable, `2` best effort.

## Message types

Construct with `new`, set ROS IDL field names (snake_case).

| Value | `typeName` | Fields |
|---|---|---|
| `std_msgs.msg.String` | `std_msgs/msg/String` | `data: string` |
| `std_msgs.msg.Header` | `std_msgs/msg/Header` | `stamp: Time`, `frame_id: string` |
| `builtin_interfaces.msg.Time` | `builtin_interfaces/msg/Time` | `sec`, `nanosec` |
| `sensor_msgs.msg.PointCloud2` | `sensor_msgs/msg/PointCloud2` | `header`, `height`, `width`, `fields`, `is_bigendian`, `point_step`, `row_step`, `data: Uint8Array`, `is_dense` |
| `sensor_msgs.msg.PointField` | `sensor_msgs/msg/PointField` | `name`, `offset`, `datatype`, `count`. Constants: `INT8`…`FLOAT64`. |
| `rclweb_cdr_interfaces.msg.PrimitiveScalars` | `rclweb_cdr_interfaces/msg/PrimitiveScalars` | Primitive IDL fields; `int64_value` / `uint64_value` are `bigint`. |
| `rclweb_cdr_interfaces.msg.Collections` | `rclweb_cdr_interfaces/msg/Collections` | `fixed_i32`, `bounded_f64`, `bytes_value`, `bounded_string`, `bounded_wstring` |
| `rclweb_cdr_interfaces.msg.NestedSample` | `rclweb_cdr_interfaces/msg/NestedSample` | `stamp`, `scalars`, `collections` |

Also exported as `String`, `Header`, `Time`, `PointCloud2`, `PointField`,
`PrimitiveScalars`, `Collections`, `NestedSample`.

### EchoNested

`rclweb_cdr_interfaces.srv.EchoNested`

| Class | Fields |
|---|---|
| `.Request` | `input: NestedSample` |
| `.Response` | `output: NestedSample`, `accepted: boolean` |

### MeasureSequence

`rclweb_cdr_interfaces.action.MeasureSequence`

| Class | Fields |
|---|---|
| `.Goal` | `target: Collections` |
| `.Result` | `result: NestedSample` |
| `.Feedback` | `progress: number`, `sample: NestedSample` |

Anything else: pass `{ typeName: "pkg/srv/Foo" }` or
`{ typeName: "pkg/action/Bar" }` and use `Uint8Array` CDR. Unknown
**topic** types are not delivered.

## NamesAndTypes

```ts
type NamesAndTypes = { name: string; types: string[] }
```
