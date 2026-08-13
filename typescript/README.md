# rcl-web

TypeScript client for ROS 2 in the browser. Connect to an
[`rclwebd`](https://crates.io/crates/rclwebd) gateway, then use `Node`
like rclcpp.

```ts
import { init, Node, std_msgs } from "rcl-web";

await init("ws://127.0.0.1:8794/ws");
const node = new Node("listener");

node.createSubscription(std_msgs.msg.String, "chatter", 10, (msg) => {
  console.log(msg.data);
});
```

```bash
npm install rcl-web
```

- [How to: node, topics, services, actions](../docs/typescript.md)
- [API reference](../docs/api.md)

Do not import `rcl-web/internal` from application code.
