# R2WP protocol

R2WP is Moonspan's versioned browser transport for ROS 2 semantics and serialized data. It carries a fixed 32-byte frame header plus CDR, encoded media, graph, schema, control, or recording payloads over WebTransport and binary WebSocket.

**Status:** design baseline. Task M0-03 freezes R2WP v0 through normative text, numeric registries, cross-language fixtures, and compatibility review.

## Design goals

- Preserve CDR bytes across the sample hot path.
- Negotiate topic names, type names, RIHS hashes, QoS, permissions, and budgets once per channel.
- Map ROS reliability and deadlines onto independent browser transport channels.
- Keep every queue bounded by sample count and bytes.
- Carry stable drop, expiry, cancellation, and policy reasons.
- Support WebTransport and WSS through one semantic envelope.
- Correlate source, gateway, browser, and application timing through trace identity.

R2WP v0 qualifies WebTransport over HTTP/3 as its primary WebTransport profile. The WebTransport API also defines an HTTP/2 mapping; each additional mapping enters Moonspan through an explicit compatibility row and evidence gate.

## Frame layout

Every data-plane frame starts with this 32-byte header:

| Offset | Field | Type | Meaning |
|---:|---|---|---|
| 0 | `version` | `u8` | Protocol version |
| 1 | `opcode` | `u8` | Sample, graph, request, response, goal, cancel, or registered extension |
| 2 | `flags` | `u16` | Reliability, keyframe, fragment, trace, and registered extension bits |
| 4 | `channel_id` | `u32` | Session-local topic, service, action, media, asset, or recording slot |
| 8 | `sequence` | `u64` | Monotonic channel sequence |
| 16 | `source_time_ns` | `i64` | Timestamp in the clock named by `clock_id` |
| 24 | `payload_len` | `u32` | Payload bytes following extensions |
| 28 | `extension_len` | `u16` | Optional metadata bytes between header and payload |
| 30 | `priority` | `u8` | Scheduler priority class |
| 31 | `clock_id` | `u8` | ROS, system, steady, simulation, or registered clock |

M0-03 assigns byte order, numeric opcode values, flag bits, clock values, extension encoding, maximum lengths, and malformed-frame behavior. The fixture manifest records every assignment.

## Payload classes

| Class | Typical payload | Schema identity |
|---|---|---|
| ROS sample | CDR1 or XCDR2 bytes | Type name plus RIHS hash from channel setup |
| Graph | Snapshot or ordered delta | Versioned graph control schema |
| Service | Request or response CDR | Service type plus request identity |
| Action | Goal, feedback, result, status, cancel | Action type plus goal identity |
| Clock and liveliness | Versioned control object | Control schema version |
| Camera | H.264 or AV1 encoded chunk | Codec parameters plus stream generation |
| Recording or asset | MCAP ranges or opaque bytes | Media type, checksum, range identity |

## Control plane

A reliable ordered control stream owns session and channel state. R2WP v0 defines these operations:

- `ClientHello` and `ServerHello`: version ranges, transport capabilities, browser buffer capabilities, limits, and session-resume material.
- `Authenticate` and `SessionReady`: short-lived credential exchange, effective identity, policy revision, and session budgets.
- `GraphSnapshot` and `GraphDelta`: node, endpoint, type, QoS, liveliness, and generation state.
- `SchemaAdvertise`, `SchemaRequest`, and `SchemaResponse`: type name, RIHS hash, recursive type description, encoding, and cache lifetime.
- `OpenChannel`, `ChannelReady`, and `CloseChannel`: operation kind, target, type, QoS, priority, queue budgets, and policy result.
- `ClockSync` and `Heartbeat`: clock mapping, skew estimate, liveliness, and round-trip samples.
- `SessionResume`: previous session identity, acknowledged channel sequences, graph generation, and resumed channel results.
- `Error`: stable code, scope, channel, operation correlation, retry class, and diagnostic detail.

Control messages receive a machine-readable schema under `protocol/` and matching Rust, MoonBit, and TypeScript fixtures.

## Channel mapping

| ROS or application semantic | WebTransport mapping | Queue policy |
|---|---|---|
| Graph, schema, authentication, clock, liveliness | One reliable control stream | Bounded and strictly ordered |
| Reliable topic | One unidirectional stream per topic channel | `KEEP_LAST` or `KEEP_ALL` within explicit byte and sample budgets |
| Small best-effort topic | Datagram | Latest-wins with deadline expiry |
| Large best-effort topic | Sample-scoped unidirectional stream | Newer samples reclaim older pending work according to channel policy |
| Service | One bidirectional stream per call | Deadline and cancellation |
| Action | Goal control stream plus feedback and result channels | Goal isolation; feedback follows negotiated QoS |
| H.264 or AV1 camera | Encoded chunk stream | Keyframe-aware eviction and generation reset |
| MCAP or asset transfer | Independent reliable stream | Bandwidth quota, ranges, checksum, and resume |

Binary WSS carries the same frames in one connection. Its internal scheduler preserves control priority, channel fairness, deadlines, and stable queue reasons.

## QoS mapping

- `RELIABLE` selects a reliable stream.
- `BEST_EFFORT` selects datagrams or sample-scoped streams according to negotiated size and capability limits.
- `KEEP_LAST(depth)` creates sample and byte budgets at gateway and browser; the tighter active limit governs admission.
- `KEEP_ALL` operates within negotiated hard resource ceilings and reports resource exhaustion explicitly.
- `TRANSIENT_LOCAL` uses a bounded gateway cache and replays retained sequences when a channel opens.
- `DEADLINE` and `LIFESPAN` feed scheduler deadlines and expiry reasons.
- `LIVELINESS` maps to control heartbeats and graph state transitions.
- `rclmbt` computes QoS compatibility from advertised endpoints before channel activation and returns a structured explanation.

## Flow control and recovery

- Each channel advertises maximum samples, bytes, message size, bandwidth, concurrency, and deadline policy.
- The browser and gateway expose queue occupancy, admitted bytes, evictions, expiries, and transport backpressure.
- Reliable streams resume from acknowledged sequence state when both peers advertise compatible resume capability.
- Datagram loss appears as sequence gaps with source and receive timing.
- Large-message cancellation releases stream, Wasm, and application buffers through a correlated lifecycle event.
- Graph and schema generations let clients discard stale channel state after reconnect or topology change.

## Errors and telemetry

The v0 registry includes semantic codes for malformed frames, unsupported versions, unsupported opcodes, unknown channels, schema mismatch, QoS incompatibility, permission denial, resource exhaustion, deadline expiry, cancellation, transport closure, and stale generation.

Every frame or control operation can carry a trace extension. Implementations correlate:

- session, channel, sequence, operation, and goal identity;
- source, gateway ingress, gateway egress, browser ingress, decode, and delivery time;
- queue admission, queue delay, copy count, payload size, and stable disposition reason.

## Security requirements

- TLS 1.3 protects WebTransport/HTTP3 and WSS endpoints.
- Session identity and effective policy arrive before application channels open.
- The gateway validates operation kind, target, schema, size, rate, bandwidth, concurrency, and deadline.
- Browser credentials are short-lived session material; robot private keys remain in the edge enclave.
- Error payloads expose scoped diagnostics according to the session's diagnostic permission.

[Security](../security.md) owns the trust model and policy semantics.

## Versioning

- The frame `version` selects a complete wire contract.
- Hello exchange advertises supported version ranges and capabilities.
- Additive control fields carry defaults defined by their schema version.
- Numeric registries remain stable within a version.
- A compatibility report accompanies each protocol revision and covers Rust, MoonBit, TypeScript, WebTransport, and WSS implementations.

## Required fixtures

R2WP v0 ships golden fixtures for:

- each header field boundary and representative flag combination;
- sample, graph, schema, request, response, goal, feedback, result, cancel, clock, media, and asset frames;
- each transport mapping and QoS class;
- extension-bearing and zero-length payloads;
- truncation, overflow, unknown registry values, stale generations, and schema mismatch;
- session open, channel open, cancellation, reconnect, resume, and terminal close sequences.

Rust, MoonBit, and TypeScript parsers consume the same bytes and produce the same semantic record or stable error code.

## Contract items assigned to M0-03

- byte order and integer encoding;
- opcode, flag, clock, priority, and error registries;
- control schema serialization;
- extension layout and trace fields;
- fragmentation and maximum frame policy;
- version negotiation and session-resume behavior;
- canonical fixture encoding and manifest format.
