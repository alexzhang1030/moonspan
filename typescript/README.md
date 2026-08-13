# `rcl-web`

TypeScript package for rclweb. If you can write rclcpp, you can write
this package: `init` → `Node` → `createPublisher` / `createSubscription`.

The first published version is `0.0.1`. The package is public. The npm
name is `rcl-web` because npm rejected unscoped `rclweb` as too similar
to `rrweb`. The tarball is the tsdown ESM + `.d.ts` bundle, not
TypeScript source, plus [LICENSE](../LICENSE) and [NOTICE](../NOTICE)
(copied here at pack time; do not commit those copies). Consume it from
npm as `rcl-web`, or from this repository's Bun workspace
(`"rcl-web": "workspace:*"`). Licensed under Apache License 2.0; see
[licensing](../docs/licensing.md).

Application contract: [`rcl-web`](../docs/typescript.md).

```ts
import { init, Node, std_msgs } from "rcl-web";

await init("ws://127.0.0.1:8794/ws");
const node = new Node("minimal_subscriber");
node.createSubscription(std_msgs.msg.String, "chatter", 10, (msg) => {
  console.log(msg.data);
});
```

Host, wasm poll ABI, session `connect`, and sample leases: `rcl-web/internal` (not a stability promise).
