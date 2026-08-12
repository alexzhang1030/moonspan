# R1-04: Wasm host boundary, I/O Worker, SDK subscribe path

Status: Complete. The `rclweb` client connection engine, hand-written wasm
poll ABI (ADR 0004), and `@rclweb/sdk` TypeScript host deliver
`connect(url)` → `session.subscribe(topic, type)` → typed
`std_msgs/msg/String` events with an explicit sample lease. Live browser CI
and demo evidence remain R1-05.

## Outcome

A synchronous client-role engine mirrors the gateway connection engine: it
drives `Session` + the R1-03 encoders to emit ClientHello / Authenticate /
OpenChannel and consume ServerHello / SessionReady / ChannelReady /
ROS_SAMPLE. In-process collision tests exchange bytes with a live
`rclwebd` WebSocket so both peers' state machines act as each other's
oracle.

The wasm export surface is a minimal hand-written ABI (`rclweb_alloc`,
`rclweb_free`, `rclweb_engine_new`, `rclweb_engine_free`, `rclweb_poll`,
`rclweb_last_result_*`) over flat little-endian batches — not
`wasm-bindgen`. The I/O Worker (or an inline host for bun tests) owns the
WebSocket (`binaryType = "arraybuffer"`) and feeds transferable-ingest
batches into `poll`. Sample payloads are borrowed views under an explicit
`ReleaseLease` protocol; the SDK never parses R2WP.

## Design decisions (R1-04)

| Topic | Ruling |
|---|---|
| Poll ABI | Hand-written `extern "C"` exports + flat `RCLB`/`RCLR` batches. Rejected full `wasm-bindgen` for R1 to keep the artifact small and the boundary explicit; size and poll latency remain R-D1 reopen inputs. |
| Worker ↔ main format | Application messages only (`connected`, `subscribed`, `sample{data}`, `releaseLease`, …). Opaque binary stays in the Worker. |
| Buffer lease | Each sample carries a `lease_id`. The host must `ReleaseLease` before the engine reclaims the retained inbound slab; `released_buffers` in the poll result lists reclaimable ids. |
| String path | Core decodes `std_msgs/msg/String` into `string_data` on the app event so the SDK delivers a typed `{ data }` without CDR parsing. |

## Delivered scope

| Surface | Location |
|---|---|
| Client connection engine | [`rclweb/src/engine/`](../../rclweb/src/engine/) |
| Poll batch layout | [`rclweb/src/host/batch.rs`](../../rclweb/src/host/batch.rs) |
| Wasm ABI (`cfg(wasm32)`) | [`rclweb/src/host/abi.rs`](../../rclweb/src/host/abi.rs) |
| Fat LTO ship profile | `[profile.release-wasm]` in root `Cargo.toml` |
| Wasm stage + size record | [`scripts/build-wasm.ts`](../../scripts/build-wasm.ts), [`docs/evidence/r1-04-wasm-size.json`](../evidence/r1-04-wasm-size.json) |
| SDK host + Worker | [`sdk/typescript/src/`](../../sdk/typescript/src/) |
| Scripted peer fixtures | [`scripts/fixture-gen/`](../../scripts/fixture-gen/), [`sdk/typescript/test/fixtures/`](../../sdk/typescript/test/fixtures/) |
| Engine ↔ gateway collision | [`rclwebd/tests/client_engine_collision.rs`](../../rclwebd/tests/client_engine_collision.rs) |

## Acceptance evidence

```bash
cargo test --locked -p rclweb
cargo test --locked -p rclwebd --test client_engine_collision
bun run scripts/build-wasm.ts          # stages sdk/typescript/wasm/rclweb.wasm + size JSON
bun test sdk/typescript/test
just check && just test && just build
```

Recorded wasm size (release-wasm, fat LTO, `codegen-units=1`, `opt-level=z`):
see [`docs/evidence/r1-04-wasm-size.json`](../evidence/r1-04-wasm-size.json).
Poll latency measurement is deferred to R1-05 with the docker-compose CI path.

## Ownership after completion

- [`rclweb` core](../runtime/core.md) owns the client engine and poll ABI.
- [`@rclweb/sdk`](../../sdk/typescript/) owns the Worker host and public API.
- End-to-end CI, demo, and copy counters remain [R1-05](../../tasks/plan.md).
