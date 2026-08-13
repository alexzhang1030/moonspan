# rclweb

Browser access to ROS 2. Install [`rcl-web`](https://www.npmjs.com/package/rcl-web),
point it at an [`rclwebd`](https://crates.io/crates/rclwebd) gateway, then use
`Node` the way you use rclcpp.

```ts
import { init, Node, std_msgs } from "rcl-web";

await init("ws://127.0.0.1:8794/ws");
const node = new Node("talker");

const pub = node.createPublisher(std_msgs.msg.String, "chatter", 10);
const msg = new std_msgs.msg.String();
msg.data = "hello";
pub.publish(msg);

node.createSubscription(std_msgs.msg.String, "chatter", 10, (incoming) => {
  console.log(incoming.data);
});
```

- [How to: node, topics, services, actions](./docs/typescript.md)
- [API reference](./docs/api.md)

## Install

```bash
npm install rcl-web
```

The page talks to ROS through a gateway on the robot (or on your laptop):

```bash
cargo install rclwebd --features ros
# with a sourced ROS 2 environment matching the gateway row
rclwebd
```

Default WebSocket URL is `ws://127.0.0.1:8794/ws`. Docker images:
`just gateway` (see [deploy](./docs/deploy.md)).

## License

Apache-2.0. [LICENSE](./LICENSE), [NOTICE](./NOTICE).

Contributing and the `just` command surface: [CONTRIBUTING.md](./CONTRIBUTING.md).
