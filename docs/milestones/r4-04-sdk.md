# R4-04: SDK stabilization, docs, and examples

Status: In progress (first slice). npm publish, a `1.0.0` version, and
[D-06](../../tasks/plan.md#kickoff-decision-register) licensing remain
follow-ups. This slice does not publish the package.

The candidate application contract is [`docs/sdk.md`](../sdk.md). The
package stays `"private": true` and `"version": "0.0.0"`.

## Outcome (this slice)

| Area | Behavior |
|---|---|
| Public exports | `@rclweb/sdk` is `connect`, session types, String constants, and local-dev TLS helpers. A test pins the runtime export list. |
| Internal | `@rclweb/sdk/internal` holds `IoHost`, the wasm poll ABI, buffer strategies, and `connectOfflineForTests`. Not a stability promise. |
| Worker URL | Source loads `io-worker.ts`; the browser bundle loads `io-worker.js`. A hardcoded `.ts` URL broke `dist/`. |
| Docs | [SDK](../sdk.md) is the application contract. Package README points here. |
| Demo | [`examples/subscribe-chatter`](../../examples/subscribe-chatter/) serves `dist/` on the Worker path and can publish `/chatter`. |

## Delivered scope

| Surface | Location |
|---|---|
| Public entry | [`sdk/typescript/src/index.ts`](../../sdk/typescript/src/index.ts) |
| Internal entry | [`sdk/typescript/src/internal.ts`](../../sdk/typescript/src/internal.ts) |
| Worker URL | [`resolveIoWorkerUrl`](../../sdk/typescript/src/client.ts) |
| Application docs | [`docs/sdk.md`](../sdk.md) |
| Demo | [`examples/subscribe-chatter`](../../examples/subscribe-chatter/) |

## Acceptance evidence

```bash
just check && just test && just build
bun test sdk/typescript/test
```

## Still open in R4-04

- Worker message protocol for services, actions, graph, and parameters
- Typed sample events beyond `std_msgs/msg/String`
- npm publish, `"private": false`, and a human-chosen version
- D-06 repository license on the package
