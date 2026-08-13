# R4-04: SDK stabilization, docs, and examples

Status: In progress. npm publish, a `1.0.0` version, and
[D-06](../../tasks/plan.md#kickoff-decision-register) licensing remain
follow-ups. This task does not publish the package.

The candidate application contract is [`docs/sdk.md`](../sdk.md). The
package stays `"private": true` and `"version": "0.0.0"`.

## Outcome (first slice — public surface)

| Area | Behavior |
|---|---|
| Public exports | `@rclweb/sdk` is `connect`, session types, String constants, and local-dev TLS helpers. A test pins the runtime export list. |
| Internal | `@rclweb/sdk/internal` holds `IoHost`, the wasm poll ABI, buffer strategies, and `connectOfflineForTests`. Not a stability promise. |
| Worker URL | Source loads `io-worker.ts`; the browser bundle loads `io-worker.js`. A hardcoded `.ts` URL broke `dist/`. |
| Docs | [SDK](../sdk.md) is the application contract. Package README points here. |
| Demo | [`examples/subscribe-chatter`](../../examples/subscribe-chatter/) serves `dist/` on the Worker path and can publish `/chatter`. |

## Outcome (this slice — Worker operations)

The default I/O Worker path implements the same session methods as the
inline host: services, actions, graph, and parameter wrappers. Service
and action CDR is copied out of wasm in the Worker; the lease is released
there. Main never sees payload pointers.

| Area | Behavior |
|---|---|
| Messages | [`sdk/typescript/src/worker/messages.ts`](../../sdk/typescript/src/worker/messages.ts) carries open/call/goal/graph events as application values. |
| Worker | [`io-worker.ts`](../../sdk/typescript/src/worker/io-worker.ts) copies payloads and releases leases before `postMessage`. |
| Client | [`WorkerClient`](../../sdk/typescript/src/client.ts) no longer throws `requires inline host` for those methods. |
| Tests | [`sdk/typescript/test/worker-ops.test.ts`](../../sdk/typescript/test/worker-ops.test.ts) drives subscribe, graph, service echo, and action echo without `inline: true`. |

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

- Typed sample events beyond `std_msgs/msg/String`
- npm publish, `"private": false`, and a human-chosen version
- D-06 repository license on the package
