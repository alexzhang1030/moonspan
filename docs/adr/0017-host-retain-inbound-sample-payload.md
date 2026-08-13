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

- Inbound **ROS_SAMPLE** frames with no extension stay on the host. The
  host peeks the R2WP header, pins the WebSocket `Uint8Array` until
  `lease.release()`, and decodes String / PointCloud2 from that buffer.
  Wasm is not on that data plane (session still owns control, channels,
  service/action, and generated codecs).
- Other application-data frames (opcodes 3–12, or samples with an
  extension) copy only the R2WP header + extension prefix into wasm. The
  CDR body stays in the host `Uint8Array` for the sample lease.
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

The 1 MiB memcpy was the hop Foxglove does not pay. Skipping it is
necessary but not sufficient: a wasm poll of a 32-byte header still lost
that hop by an order of magnitude. Host-side sample dispatch matches
Foxglove's JS CDR path. ADR 0004 still holds for control and codecs;
JavaScript already owned buffer lifetimes.

## Consequences

- Controllable inbound copies drop from two to **one** (RMW serialized
  take). Worker→wasm is 0 for sample bodies.
- `just perf-baseline` splits decode hops (header skip + CDR, paired)
  from deliver hops (framed bytes → callback). `rclweb.ingest` pairs
  with `foxglove.deliver`, not with a 13-byte MessageData skip.
- The I/O Worker still copies PointCloud2 `data` (and service/action CDR)
  onto the main thread.
- `hostRetainPrefixLen` peeks version, opcode, `payload_len`, and
  `extension_len`. It is not a second R2WP implementation. The ROS_SAMPLE
  hot path additionally reads channel / sequence / time from that header.

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
