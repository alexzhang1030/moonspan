# 0004: Keep a synchronous Wasm state machine behind an async Worker host

## Status

Accepted

## Date

2026-08-10

## Context

`rclmbt` needs deterministic ROS-facing state, codecs, graph, QoS, and executor behavior in the browser. Browser hosts expose Promises, timers, WebTransport, WebSocket, Worker scheduling, and buffer transfer APIs that already own asynchronous completion.

## Decision

Adopt a synchronous, deterministic MoonBit/Wasm state machine with an asynchronous TypeScript Worker host.

- Each host turn delivers a bounded ready-event batch into `rclmbt.poll(batch)`.
- The poll result returns outbound work, completed operations, application events, released buffers, and the next deadline.
- JavaScript owns Promises, timers, WebTransport, WebSocket, Worker scheduling, and transferable buffer lifetimes.
- The first compatibility path uses transferable `ArrayBuffer` ownership.
- The cross-origin-isolated profile adds a bounded `SharedArrayBuffer` ring fast path.
- Both buffer paths share one semantic contract and collect separate performance evidence.
- MoonBit async or other Wasm async integrations enter only through a later ADR with benchmark evidence.

## Rationale

- A synchronous Wasm core keeps graph, QoS, executor, and CDR transitions deterministic and measurable.
- Browser async APIs remain in their native JavaScript execution model.
- Bounded poll batches reduce boundary overhead while capping host-turn cost.
- Transferable `ArrayBuffer` covers general deployments; `SharedArrayBuffer` serves isolated fast-path profiles under the same event lifecycle.
- Deferring Wasm-native async keeps M1 host-ABI work on a stable boundary with evidence gates.

## Consequences

- M1 establishes the host poll ABI, Worker scheduling, and both buffer paths under one behavioral contract.
- Runtime and SDK ownership split along the poll boundary documented for the runtime (now the [`rclweb` core](../runtime/core.md); ADR 0010 replaced MoonBit with Rust, boundary unchanged).
- Buffer pools, leases, and release paths appear in host results and memory evidence.
- Batch size and execution time carry measured caps in validation and benchmarks.
- Application presentation belongs to U0 after the mainline release.

## Revisit triggers

- Bounded poll throughput, latency, copy count, or memory evidence falls outside an accepted gate.
- Transferable `ArrayBuffer` or `SharedArrayBuffer` path fails a required browser or deployment profile.
- MoonBit or Wasm async support produces measured gains that justify a host-boundary redesign.
- Host ownership of timers, transport, or buffer lifetime blocks a required N2 semantic behavior.

## Source

Host and buffer model in [architecture](../architecture.md), [architecture rationale](../../.agents/docs/architecture.md), the [runtime record](../runtime/core.md), and [technology stack rationale](../../.agents/docs/technology-stack.md).
