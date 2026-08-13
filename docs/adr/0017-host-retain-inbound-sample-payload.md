# 0017: Host-retain inbound sample payloads

## Status

Accepted

## Date

2026-08-13

## Context

After [ADR 0004](./0004-browser-wasm-host-boundary.md) and the wasm ingest
cuts in #49, `just perf-baseline` still lost the hop **bytes already in JS →
usable ROS message** to Foxglove. Foxglove `@foxglove/cdr` returns an aligned
typed-array **view** of the WebSocket buffer
([CdrReader.typedArray](https://github.com/foxglove/cdr/blob/main/src/CdrReader.ts)).
rclweb memcpy'd the whole R2WP frame into wasm linear memory because Wasm
cannot alias a JS `ArrayBuffer`
([Wasm design #1162](https://github.com/WebAssembly/design/issues/1162)).

[docs/architecture.md](../architecture.md) had treated host-retain (headers in
wasm, payload in JS) as contrary to ADR 0004. That over-read the decision:
ADR 0004 requires a synchronous wasm state machine and that **JavaScript owns
buffer lifetimes**. It does not require sample bodies to live in linear
memory. Losing the Foxglove hop on a 1 MiB PointCloud2 is an accepted-gate
miss and an ADR 0004 revisit trigger (copy count / latency).

## Decision

- Inbound **application-data** frames (opcodes 2–12) copy only the R2WP
  header + extension prefix into wasm. The CDR body stays in the host
  `Uint8Array` for the sample lease.
- A poll-result sentinel `payload_ptr == 0 && payload_len > 0` means the
  body is host-backed. Wasm allocators never return a non-empty region at
  address 0.
- `std_msgs/msg/String` and `sensor_msgs/msg/PointCloud2` decode from that
  host buffer. PointCloud2 `data` is a view of the WebSocket bytes, matching
  Foxglove. Generated corpus types still copy CDR into wasm for
  `rclweb_decode_generated`.
- Control, bootstrap, and experimental opcodes still copy the full frame.
- Public `parse_frame` stays complete-frame-only. Prefix ingest uses
  `parse_frame_declared`. The gateway is unchanged.
- This does not reopen ADR 0004 (sync wasm, JS owns Promises, timers,
  transport, and buffer lifetimes) or ADR 0006 (RMW loans).

## Rationale

The 1 MiB memcpy was the hop Foxglove does not pay. Skipping it is the
path to matching that ingest. A 32-byte header poll remains: session,
sequence, and leases stay in wasm. Host-retain is the ADR 0004-legal way
to drop copy-budget slot 2 for sample bodies.

## Consequences

- Controllable inbound copies drop from two to **one** (RMW serialized
  take). Worker→wasm is 0 for sample bodies.
- `just perf-baseline` on the inline host should no longer lose 1 MiB
  PointCloud2 to a wasm memcpy. Small String messages still pay a wasm
  header poll that Foxglove's JS-only CDR does not.
- The I/O Worker still copies PointCloud2 `data` (and service/action CDR)
  onto the main thread.
- `hostRetainPrefixLen` peeks version, opcode, `payload_len`, and
  `extension_len`. It is not a second R2WP implementation.

## Revisit triggers

- Ingest latency, copy count, or RSS on `just perf-baseline` falls outside
  an accepted gate versus Foxglove.
- A required type cannot decode from a host-retained CDR view without a
  wasm copy that reintroduces the 1 MiB path.
- Wasm grows a way to alias an external `ArrayBuffer` (would reopen the
  prefix copy as well).

## Source

Owner (2026-08-13): merged #49, still not satisfied that rclweb loses to
Foxglove on this hop. ADR 0004 revisit trigger (copy count / latency)
plus the over-read that host-retain was forbidden.
