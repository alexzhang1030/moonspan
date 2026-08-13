# How to use rcl-web

`rcl-web` is the browser package. You connect once, construct a `Node`,
then create publishers, subscriptions, service clients/servers, and
action clients/servers. Names and QoS follow rclcpp. The type argument
is a value (`std_msgs.msg.String`) because TypeScript has no
`create_publisher<T>(topic)`.

Method list: [API reference](./api.md).

## Install

```bash
npm install rcl-web
```

You need a running [`rclwebd`](https://crates.io/crates/rclwebd) that
can see the ROS 2 graph you care about. Default URL:
`ws://127.0.0.1:8794/ws`. How to run the gateway: [deploy](./deploy.md).

```ts
import {
  init,
  Node,
  std_msgs,
  sensor_msgs,
  rclweb_cdr_interfaces,
  QoS,
} from "rcl-web";
```

## Connect

```ts
await init("ws://127.0.0.1:8794/ws");
```

Call `init` once. A second call throws until `shutdown()`.

| Function | What it does |
|---|---|
| `init(url)` | Connect to the gateway. Required before `new Node`. |
| `ok()` | `true` after `init`, `false` after `shutdown`. |
| `shutdown()` | Close the session. Existing nodes stop. |
| `spin()` | Wait until `shutdown()`. The browser already delivers callbacks; you do not need this for messages to arrive. |

Optional second argument (`InitOptions`): `reconnect`, `transport`,
local-dev WebTransport hashes. Applications leave it unset. See
[InitOptions](./api.md#initoptions).

`reconnect: true` opens a **new** session on disconnect and re-creates
your topics, services, and actions. In-flight `sendRequest` / `sendGoal`
promises reject with `"session reconnected"`.

## Node

```ts
const node = new Node("talker");
const namespaced = new Node("talker", "/demo");
```

Relative names (`"chatter"`) resolve under the node namespace, same as
rclcpp: `/chatter` vs `/demo/chatter`. Absolute names (`"/chatter"`)
stay absolute.

`node.destroy()` cancels timers and closes every publisher, subscription,
client, and server created on that node.

## Topics

`10` means KeepLast(10) + reliable.

```ts
const pub = node.createPublisher(std_msgs.msg.String, "chatter", 10);
const out = new std_msgs.msg.String();
out.data = "hello from the browser";
pub.publish(out);

node.createSubscription(std_msgs.msg.String, "chatter", 10, (msg) => {
  console.log(msg.data);
});
```

Point cloud (field names are ROS IDL, snake_case):

```ts
const cloudPub = node.createPublisher(sensor_msgs.msg.PointCloud2, "points", 10);
const cloud = new sensor_msgs.msg.PointCloud2();
cloud.header.frame_id = "map";
cloud.height = 1;
cloud.width = 4;
cloud.point_step = 12;
cloud.row_step = 48;
cloud.is_dense = true;
cloud.fields = [
  Object.assign(new sensor_msgs.msg.PointField(), {
    name: "x",
    offset: 0,
    datatype: sensor_msgs.msg.PointField.FLOAT32,
    count: 1,
  }),
  Object.assign(new sensor_msgs.msg.PointField(), {
    name: "y",
    offset: 4,
    datatype: sensor_msgs.msg.PointField.FLOAT32,
    count: 1,
  }),
  Object.assign(new sensor_msgs.msg.PointField(), {
    name: "z",
    offset: 8,
    datatype: sensor_msgs.msg.PointField.FLOAT32,
    count: 1,
  }),
];
cloud.data = new Uint8Array(48);
cloudPub.publish(cloud);

node.createSubscription(sensor_msgs.msg.PointCloud2, "points", 10, (msg) => {
  console.log(msg.width, msg.data.byteLength);
});
```

Best-effort:

```ts
node.createPublisher(std_msgs.msg.String, "chatter", new QoS(10).bestEffort());
```

The callback gets an owned message. You do not release a lease.

Typed topic types today: `std_msgs.msg.String`,
`sensor_msgs.msg.PointCloud2`, and
`rclweb_cdr_interfaces.msg.{PrimitiveScalars,Collections,NestedSample}`.
Other inbound topic types are dropped. `int64` / `uint64` are `bigint`.

`createWallTimer(periodMs, callback)` is `setInterval` scoped to the node.

## Services

Generated type (`EchoNested` is a class pair, not CDR):

```ts
const echo = node.createClient(rclweb_cdr_interfaces.srv.EchoNested, "echo");
await echo.waitForService();
const req = new rclweb_cdr_interfaces.srv.EchoNested.Request();
req.input.scalars.string_value = "ping";
const res = await echo.sendRequest(req);
console.log(res.accepted, res.output.scalars.string_value);

node.createService(rclweb_cdr_interfaces.srv.EchoNested, "echo", (request) => {
  const response = new rclweb_cdr_interfaces.srv.EchoNested.Response();
  response.output = request.input;
  response.accepted = true;
  return response;
});
```

Any other service type is raw CDR:

```ts
const add = node.createClient(
  { typeName: "example_interfaces/srv/AddTwoInts" },
  "add_two_ints",
);
await add.waitForService();
const responseCdr = await add.sendRequest(requestCdr);
```

`waitForService()` is `true` when the channel opened, `false` if it
failed.

## Actions

```ts
const seq = node.createActionClient(
  rclweb_cdr_interfaces.action.MeasureSequence,
  "seq",
);
await seq.waitForAction();
seq.onFeedback((fb) => {
  console.log(fb.progress);
});
const goal = new rclweb_cdr_interfaces.action.MeasureSequence.Goal();
const { operationId, result } = seq.sendGoal(goal);
const done = await result;
console.log(done.result.stamp.sec);
// seq.cancel(await operationId);
```

Server:

```ts
const server = node.createActionServer(
  rclweb_cdr_interfaces.action.MeasureSequence,
  "seq",
  {
    onGoal(goal, operationId) {
      const fb = new rclweb_cdr_interfaces.action.MeasureSequence.Feedback();
      fb.progress = 1;
      server.sendFeedback(operationId, fb);
      const result = new rclweb_cdr_interfaces.action.MeasureSequence.Result();
      server.sendResult(operationId, result);
    },
    onCancel(_operationId) {},
  },
);
```

Other action types take and return `Uint8Array` CDR.
`sendStatus(operationId, statusCdr)` is always CDR.

## Graph

```ts
node.onGraphChange(() => {
  console.log(node.getNodeNames());
  console.log(node.getTopicNamesAndTypes());
  console.log(node.getServiceNamesAndTypes());
  console.log(node.getActionNamesAndTypes());
});
console.log(node.countPublishers("chatter"));
console.log(node.countSubscribers("chatter"));
```

These are the last graph the gateway pushed. Relative topic names in
`countPublishers` / `countSubscribers` resolve under this node.

## Public vs internal

| Import | Use |
|---|---|
| `rcl-web` | Application code. `init`, `Node`, message types, QoS. |
| `rcl-web/internal` | Do not import. Host, wasm ABI, sample leases. |

## Example

[`examples/subscribe-chatter`](../examples/subscribe-chatter/) is a page
that subscribes and publishes `/chatter`.
