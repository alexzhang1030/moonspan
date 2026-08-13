# Examples

Runnable consumers of `@rclweb/sdk`. Application API: [SDK](../docs/sdk.md).

| Path | Role |
|---|---|
| [`subscribe-chatter`](./subscribe-chatter/) | Browser demo: `init` → `Node` subscribe and publish `/chatter` |
| [`e2e-harness`](./e2e-harness/) | Headless inline-host subscribe. Gate for `just e2e` and `just e2e-h-ft`; not a human demo |

Both packages depend on `"@rclweb/sdk": "workspace:*"`. Run `just setup` from the repository root before either example.
