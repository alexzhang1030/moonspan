# e2e-harness

Headless inline-host subscribe used by `just e2e` and `just e2e-h-ft`.
It is not a human demo — see [subscribe-chatter](../subscribe-chatter/)
for the browser page.

The process calls `init` with `inline: true`, creates a `Node`, subscribes to
`/chatter`, waits for a minimum sample count, prints `e2e ok`, and
exits 0. Gateway URL and wasm path come from the environment; compose
files set those.
