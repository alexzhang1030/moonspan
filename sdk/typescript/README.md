# `@rclweb/sdk`

Browser TypeScript SDK for rclweb. The public surface is `connect` plus session operations; the I/O Worker and wasm core own R2WP bytes.

This package stays `"private": true` and `"version": "0.0.0"` until a human release review. Consume it from this repository's Bun workspace (`"@rclweb/sdk": "workspace:*"`). Do not publish it to npm in this slice.

Application contract: [SDK](../../docs/sdk.md). Milestone: [R4-04](../../docs/milestones/r4-04-sdk.md).

```ts
import { connect, SENSOR_MSGS_POINT_CLOUD2, STD_MSGS_STRING } from "@rclweb/sdk";

const client = await connect("ws://127.0.0.1:8794/ws");
const sub = await client.session.subscribe("/chatter", STD_MSGS_STRING);
sub.onMessage((msg, lease) => {
  console.log(msg.data);
  lease.release();
});
```

`subscribe(..., SENSOR_MSGS_POINT_CLOUD2)` delivers PointCloud2 metadata plus `data: Uint8Array` (borrowed on the inline host, copied on the Worker path). Publish stays String-only.

Host, wasm poll ABI, and test helpers: `@rclweb/sdk/internal` (not a stability promise).
