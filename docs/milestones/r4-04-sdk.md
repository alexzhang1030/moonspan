# R4-04: SDK stabilization, docs, and examples

Status: In progress. npm publish, a `1.0.0` version, and
[D-06](../../tasks/plan.md#kickoff-decision-register) licensing remain
follow-ups. This task does not publish the package.

The candidate application contract is [`docs/sdk.md`](../sdk.md). The
package stays `"private": true` and `"version": "0.0.0"`.

## Outcome (first slice — public surface)

| Area | Behavior |
|---|---|
| Public exports | `@rclweb/sdk` is `connect`, session types, String and PointCloud2 constants, sample type guards, and local-dev TLS helpers. A test pins the runtime export list. |
| Internal | `@rclweb/sdk/internal` holds `IoHost`, the wasm poll ABI, buffer strategies, and `connectOfflineForTests`. Not a stability promise. |
| Worker URL | Source loads `io-worker.ts`; the browser bundle loads `io-worker.js`. A hardcoded `.ts` URL broke `dist/`. |
| Docs | [SDK](../sdk.md) is the application contract. Package README points here. |
| Demo | [`examples/subscribe-chatter`](../../examples/subscribe-chatter/) serves `dist/` on the Worker path and can publish `/chatter`. |

## Outcome (second slice — Worker operations)

The default I/O Worker path implements the same session methods as the
inline host: services, actions, graph, and parameter wrappers. Service
and action CDR is copied out of wasm in the Worker; the lease is released
there. Main never sees payload pointers.

| Area | Behavior |
|---|---|
| Messages | [`sdk/typescript/src/worker/messages.ts`](../../sdk/typescript/src/worker/messages.ts) carries open/call/goal/graph events as application values. |
| Worker | [`io-worker.ts`](../../sdk/typescript/src/worker/io-worker.ts) copies payloads and releases leases before `postMessage`. |
| Client | [`WorkerClient`](../../sdk/typescript/src/client.ts) no longer throws `requires inline host` for those methods. |
| Tests | [`sdk/typescript/test/worker-ops.test.ts`](../../sdk/typescript/test/worker-ops.test.ts) drives subscribe, graph, service echo, action echo, and PointCloud2 without `inline: true`. |

## Outcome (this slice — typed PointCloud2 samples)

Subscribe delivers `sensor_msgs/msg/PointCloud2` as metadata plus a `data` TypedArray. The inline host borrows wasm memory (copy-budget 0 wasm→application). The I/O Worker copies only the `data` field and releases the lease before `postMessage`, because wasm memory is not shared with main.

| Area | Behavior |
|---|---|
| Public types | `SENSOR_MSGS_POINT_CLOUD2`, `PointCloud2`, `isPointCloud2` / `isStdMsgsString`. `subscribe(..., SENSOR_MSGS_POINT_CLOUD2)` types `onMessage` as PointCloud2. |
| Inline | [`IoHost.decodePointCloud2`](../../sdk/typescript/src/host.ts) returns a view into wasm memory. Tests assert `data.buffer === engineMemory()`. |
| Worker | [`io-worker.ts`](../../sdk/typescript/src/worker/io-worker.ts) copies `data`, releases the lease, and transfers the ArrayBuffer. |
| Fixtures | [`scripts/fixture-gen`](../../scripts/fixture-gen/) emits `pointCloud2Sample` (four XYZ points). |
| Publish | Still String-only. Other inbound types still drop and release. |

## Delivered scope

| Surface | Location |
|---|---|
| Public entry | [`sdk/typescript/src/index.ts`](../../sdk/typescript/src/index.ts) |
| Internal entry | [`sdk/typescript/src/internal.ts`](../../sdk/typescript/src/internal.ts) |
| Worker URL | [`resolveIoWorkerUrl`](../../sdk/typescript/src/client.ts) |
| Worker ops | [`sdk/typescript/src/worker/`](../../sdk/typescript/src/worker/) |
| Application docs | [`docs/sdk.md`](../sdk.md) |
| Demo | [`examples/subscribe-chatter`](../../examples/subscribe-chatter/) |

## Acceptance evidence

```bash
just check && just test && just build
bun test sdk/typescript/test
```

## Still open in R4-04

- Typed sample events beyond String and PointCloud2
- npm publish, `"private": false`, and a human-chosen version
- D-06 repository license on the package
