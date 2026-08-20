# Examples

Runnable consumers of `rcl-web`.
[How to](../docs/typescript.md) · [API](../docs/api.md).

| Path | Role |
|---|---|
| [`subscribe-chatter`](./subscribe-chatter/) | Browser demo: `init` → `Node` subscribe and publish `/chatter`. `RCLWEB_TRANSPORT=webtransport` is the intranet WT path; keep the page on localhost. |
| [`e2e-harness`](./e2e-harness/) | Headless inline-host subscribe. Gate for `just e2e` and `just e2e-h-ft`; not a human demo |

Both packages depend on `"rcl-web": "workspace:*"`. That specifier
resolves to the tsdown `dist/` bundle. Run `just setup` and `just build`
from the repository root before either example.
