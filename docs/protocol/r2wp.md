# R2WP protocol

R2WP is Moonspan's versioned binary transport for ROS 2 data and control. Wire version 0 is frozen and implemented in TypeScript, Rust, and MoonBit.

## Sources of truth

| Surface | Source |
|---|---|
| Normative wire contract | [`protocol/r2wp-v0.md`](../../protocol/r2wp-v0.md) |
| Numeric registry and layouts | [`protocol/registry/r2wp-v0.json`](../../protocol/registry/r2wp-v0.json) |
| Control schema | [`protocol/schema/control-v0.cddl`](../../protocol/schema/control-v0.cddl) |
| Encoding decision | [ADR 0009](../adr/0009-r2wp-v0-wire-encoding.md) |
| Versioning model | [ADR 0005](../adr/0005-r2wp-wire-versioning.md) |
| Fixtures | [`protocol/testdata/`](../../protocol/testdata/README.md) |
| Agreement result | [`protocol/testdata/agreement/`](../../protocol/testdata/agreement/README.md) |
| Completion note | [M0-03](../milestones/m0-03-r2wp-foundation.md) |

This page explains the design. The normative contract owns byte layout, limits, validation order, registries, error codes, and transport rules.

## Goals

- Preserve CDR on the sample path.
- Negotiate type, schema identity, QoS, permissions, and budgets once per channel.
- Map ROS reliability and deadlines onto browser transport channels.
- Bound every queue by samples and bytes.
- Carry stable disposition and error reasons.
- Keep WebTransport and binary WebSocket semantically equivalent.
- Correlate timing across ROS, gateway, browser, runtime, and application stages.

## Protocol model

A bootstrap exchange selects one wire version, capabilities, support-row identity, and effective limits. Selected-version frames then carry control messages, ROS data, operations, media, recordings, and assets.

Control messages use deterministic CBOR. Application data keeps its declared encoding, usually CDR. Extensions carry trace, operation, and delivery metadata. Exact framing and receiver validation live in the normative package.

## Schema and provenance

Schema identity is the pair `(scheme, value)` defined by [ADR 0007](../adr/0007-humble-jazzy-schema-identity.md).

| ROS profile | Scheme |
|---|---|
| Jazzy | `rep2011-rihs` |
| Humble | `moonspan-schema-v1` |

Schema-bearing records also carry type name, encoding, and schema generation. Graph and channel records retain `gateway_instance_id`, `support_row_id`, and `domain_id` so applications can compose multiple sessions without losing origin.

One session binds one gateway instance and one adapter support row. The session may expose multiple ROS domain IDs under that row. Cross-row views use independent sessions.

## Sessions and channels

The fresh session path authenticates a client and returns `SessionReady` with capabilities, provenance, policy revision, and budgets. Resume revalidates identity, wire version, capabilities, gateway instance, support row, generations, policy, and channel acknowledgements.

Channels move through open, ready, and closed states. Their contracts pin operation kind, direction, schema, QoS, domain, budgets, and sequencing. Service and Action operations use correlated identifiers. Graph and schema generations isolate stale state after reconnect or topology changes.

Reliable channels require contiguous delivery. Best-effort channels expose gaps and stale data through stable dispositions. Resume continues eligible reliable channel state and restarts operation-scoped streams according to the normative recovery rules.

## Channel mapping

| Semantic | WebTransport | Binary WebSocket |
|---|---|---|
| Session, graph, schema, clock, and errors | Ordered control stream | Priority control messages |
| Reliable topic | Per-channel reliable stream | Scheduled messages |
| Best-effort topic | Datagram or sample-scoped stream | Bounded latest-wins admission |
| Service | Reliable operation stream | Reliable scheduled messages |
| Action | Reliable operation streams plus QoS-driven feedback and status | Reliable scheduled messages with bounded feedback admission |
| Media | Encoded chunk stream | Scheduled binary messages |
| Recording and assets | Reliable range stream | Reliable scheduled messages |

Both transports carry the same frames and control semantics. Their head-of-line, datagram, proxy, and buffer behavior receive separate compatibility evidence.

## QoS and flow control

R2WP represents reliability, durability, history, liveliness, deadlines, lifespan, and queue limits. Channel activation returns a concrete effective profile after compatibility and policy checks.

Each channel declares sample, byte, message-size, rate, bandwidth, concurrency, deadline, and cache budgets as applicable. Implementations report admission, queue delay, eviction, expiry, cancellation, transport pressure, and delivery disposition.

## Errors and telemetry

The registry assigns stable codes to wire, schema, QoS, permission, resource, deadline, transport, generation, resume, sequence, authentication, session, and clock failures. Error detail follows the session's diagnostic permission.

Trace metadata correlates session, channel, sequence, operation, goal, schema, deployment provenance, timestamps, queue behavior, copies, payload size, and final disposition.

## Security

R2WP runs over TLS-protected WebTransport or WebSocket endpoints. Application channels open after identity and effective policy are established. The gateway validates target, operation kind, schema, size, rate, bandwidth, concurrency, and deadline. Robot private keys stay at the edge.

[Security](../security.md) owns the trust and policy model.

## Implementations and checks

| Implementation | Source |
|---|---|
| TypeScript codecs | [`sdk/typescript/src/protocol/`](../../sdk/typescript/src/protocol/) |
| Rust parser | [`rclwebd/src/protocol/`](../../rclwebd/src/protocol/) |
| MoonBit parser | [`rclmbt/protocol/`](../../rclmbt/protocol/) |

```bash
bun run protocol-check
bun run protocol-fixtures:check
bun run protocol-agree
cargo test --locked -p rclwebd
moon test --frozen --target wasm rclmbt/protocol
```

M0-04 extends coverage with the ROS-generated CDR corpus. Later phases add live transport, semantic, compatibility, security, and performance qualification.
