# Browser SDK

`@rclweb/sdk` is the application contract for rclweb. Applications call `connect`, then session operations. The SDK does not parse R2WP: the I/O Worker owns transport bytes and the wasm core owns protocol, CDR, and ROS state ([architecture](./architecture.md), [ADR 0004](./adr/0004-browser-wasm-host-boundary.md)).

The package lives at [`sdk/typescript/`](../sdk/typescript/) and is consumed from this repository's Bun workspace. It stays `"private": true` and `"version": "0.0.0"` until a human release review. This slice does not publish to npm and does not pick [D-06](../tasks/plan.md#kickoff-decision-register) licensing.

## Install (workspace)

Root `package.json` already lists `sdk/*` as a workspace. Examples depend on `"@rclweb/sdk": "workspace:*"`. After `just setup`:

```ts
import { connect, STD_MSGS_STRING } from "@rclweb/sdk";
```

`just build` stages `sdk/typescript/wasm/rclweb.wasm` and emits `sdk/typescript/dist/` (gitignored). The workspace export map points at TypeScript source so Bun tests and scripts do not need `dist/`. Browser pages should load the built `dist/index.js` (see [subscribe-chatter](../examples/subscribe-chatter/README.md)).

## Connect

```ts
const client = await connect("ws://127.0.0.1:8794/ws", {
  wasmUrl: "/wasm/rclweb.wasm", // optional; default is next to the SDK script
});
```

| Option | Default | Role |
|---|---|---|
| `inline` | `false` | Run the host on the calling thread. Bun tests and the e2e harness use this. Browsers should leave it false (I/O Worker). |
| `wasmUrl` | sibling `../wasm/rclweb.wasm` | URL of the staged wasm artifact |
| `workerUrl` | sibling `./worker/io-worker.ts` or `.js` | Override the I/O Worker module. Source loads `.ts`; the browser bundle loads `.js` |
| `reconnect` | off | Fresh-session reconnect on transport close (SessionResume stays parked) |
| `reconnectAttempts` | `3` | Cap for automatic reconnect |
| `transport` | `"websocket"` | `"webtransport"` needs `globalThis.WebTransport` plus certificate hashes ([ADR 0011](./adr/0011-local-dev-webtransport-tls.md)) |
| `serverCertificateHashes` | none | SPKI hashes for `new WebTransport(...)` |
| `fetchLocalDevTls` | off | Fetch `{httpOrigin}/local-dev/tls` when hashes are omitted |
| `localDevTlsOrigin` | derived from the WT URL | HTTP origin of the advertise endpoint (ports often differ) |

`connect` currently authenticates as scheme `token` / `anonymous`. The gateway default is Authenticate `off` ([R4-01](./milestones/r4-01-oidc-sros2-audit.md)). There is no application credential API on `ConnectOptions` yet.

## Session (Worker path)

The default browser path supports subscribe, publish, reconnect, and close.

```ts
const sub = await client.session.subscribe("/chatter", STD_MSGS_STRING);
sub.onMessage((msg, lease) => {
  console.log(msg.data);
  lease.release();
});

const pub = await client.session.publish("/chatter", STD_MSGS_STRING);
await pub.publish({ data: "hello from the browser" });
```

Typed sample events are `std_msgs/msg/String` (`{ data: string }`). QoS on OpenChannel is reliability (`1` RELIABLE default, `2` BEST_EFFORT) plus KEEP_LAST depth (default `5`).

**Release every lease.** The engine reclaims a retained inbound slab only when every lease on it is released. Dropping a sample without `lease.release()` pins wasm memory ([gotcha](../.agents/docs/gotchas.md#every-sample-lease-has-exactly-one-owner)).

`client.reconnect()` starts a fresh session and re-opens tracked channels. `client.close()` tears the session down. `client.telemetry()` returns copy/poll counters on the inline host and `null` on the Worker path.

## Session (inline host)

`options.inline: true` runs wasm on the calling thread. Repository tests, `just e2e`, and `just e2e-h-ft` use this. The inline host also implements services, actions, graph, and parameter wrappers as raw CDR bytes:

| Method | Notes |
|---|---|
| `createServiceClient` / `createServiceServer` | Request and response are `Uint8Array` CDR |
| `createActionClient` / `createActionServer` | Goal, feedback, result, and status are `Uint8Array` CDR |
| `onGraph` | Snapshot plus deltas after SessionReady |
| `getParameters` / `setParameters` / `listParameters` | Sugar over `rcl_interfaces` service names |

The Worker path throws if those methods are called. Extending the Worker message protocol to carry them is a follow-up in R4-04, not this slice.

## Public vs internal

| Import | Stability | Contents |
|---|---|---|
| `@rclweb/sdk` | Candidate application contract | `connect`, session types, String constants, local-dev TLS helpers |
| `@rclweb/sdk/internal` | Repository only | `IoHost`, wasm poll ABI, buffer strategies, `connectOfflineForTests` |

Do not import the internal submodule from application code. A test asserts the public runtime export list; adding a host or ABI symbol to `@rclweb/sdk` is a contract change.

## Examples

| Path | Role |
|---|---|
| [`examples/subscribe-chatter`](../examples/subscribe-chatter/) | Browser page: Worker `connect` → subscribe and publish `/chatter` |
| [`examples/e2e-harness`](../examples/e2e-harness/) | Headless inline-host subscribe used by `just e2e` / `just e2e-h-ft` |

See [examples/README.md](../examples/README.md).

## Version and release

Independent SDK versioning is [ADR 0003](./adr/0003-monorepo-ownership.md). R2WP wire version is a separate identity ([ADR 0005](./adr/0005-r2wp-wire-versioning.md)). This slice freezes the candidate public export list and the docs; it does not bump to `1.0.0`, set `"private": false`, or publish. Remaining R4-04 work: Worker coverage for services/actions/graph, generated typed messages beyond String, npm publish after D-06, and a human release review.

## Related

- [R4-04 milestone](./milestones/r4-04-sdk.md)
- [R1-04 wasm host](./milestones/r1-04-wasm-host-sdk.md)
- [R2WP](./protocol/r2wp.md)
- [`rclweb` core](./runtime/core.md)
