# R2WP protocol

R2WP is Moonspan's versioned browser transport for ROS 2 semantics and serialized data. It carries a fixed 32-byte frame header plus CDR, encoded media, graph, schema, control, or recording payloads over WebTransport and binary WebSocket.

**Status:** design baseline. Task M0-03 freezes R2WP v0 through normative text, numeric registries, cross-language fixtures, and compatibility review.

Schema identity follows [ADR 0007](../adr/0007-humble-jazzy-schema-identity.md). Gateway process and support-row binding follows [ADR 0008](../adr/0008-one-adapter-row-per-gateway-process.md). First-stage distro, RMW, and image pins live in the [support matrix](../support-matrix.md). Wire versioning follows [ADR 0005](../adr/0005-r2wp-wire-versioning.md).

## Design goals

- Preserve CDR bytes across the sample hot path.
- Negotiate topic names, type names, schema identity `(scheme, value)`, QoS, permissions, and budgets once per channel.
- Map ROS reliability and deadlines onto independent browser transport channels.
- Keep every queue bounded by sample count and bytes.
- Carry stable drop, expiry, cancellation, and policy reasons.
- Support WebTransport and WSS through one semantic envelope.
- Correlate source, gateway, browser, and application timing through trace identity.

R2WP v0 qualifies WebTransport over HTTP/3 as its primary WebTransport profile. The WebTransport API also defines an HTTP/2 mapping; each additional mapping enters Moonspan through an explicit compatibility row and evidence gate.

## Schema identity

Every schema-bearing control and channel contract carries:

- `scheme` and `value` as the unified schema identity pair;
- type name;
- encoding;
- schema generation.

First-stage schemes:

| Scheme | Distro role | Value |
|---|---|---|
| `rep2011-rihs` | Jazzy native type hash | REP-2011 RIHS string |
| `moonspan-schema-v1` | Humble recursive deployment bundle | SHA-256 of deterministic canonical bundle bytes |

Jazzy deployments may also record a provenance mapping from `rep2011-rihs` to a `moonspan-schema-v1` digest. The schemes remain independent identities.

When a required Humble deployment bundle is absent, channel open returns the stable error `schema_unavailable`. M0-03 assigns its numeric registry value.

## Gateway process and support-row binding

- One R2WP connection binds one gateway instance and one adapter support row (H-FT, H-CY, J-FT, or J-CY).
- That session may expose multiple ROS domain IDs under the bound support row.
- Cross-row fleet views use independent R2WP sessions and retain gateway, support-row, and domain provenance in the application layer.
- `gateway_instance_id` is a deployment-provided stable identifier for one logical gateway instance. It persists across ordinary process restart and in-place upgrade when resumable state is preserved. A replacement deployment or intentionally fresh instance receives a new identifier. Matching `gateway_instance_id` supports restart resume; a replacement instance drives a clean session.
- `support_row_id` is immutable for the running artifact and profile.
- `SessionReady` is emitted only by a ready gateway and carries the validated profile.

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
| ROS sample | CDR1 or XCDR2 bytes | Type name plus `(scheme, value)`, encoding, and schema generation from channel setup |
| Graph | Snapshot or ordered delta | Versioned graph control schema |
| Service | Request or response CDR | Service type plus request identity and schema identity |
| Action | Goal, feedback, result, status, cancel | Action type plus goal identity and schema identity |
| Clock and liveliness | Versioned control object | Control schema version |
| Camera | H.264 or AV1 encoded chunk | Codec parameters plus stream generation |
| Recording or asset | MCAP ranges or opaque bytes | Media type, checksum, range identity |

## Control plane

A reliable ordered control stream owns session and channel state. R2WP v0 defines these operations:

- `ClientHello` and `ServerHello`: bounded ordered supported wire-version set, transport capabilities, browser buffer capabilities, limits, and session-resume material. `ServerHello` selects exactly one common wire version before session, graph, schema, or channel state begins.
- `Authenticate` and `SessionReady`: short-lived credential exchange, effective identity, policy revision, and session budgets. After policy and auth context is established on a ready gateway, `SessionReady` carries the validated profile: `gateway_instance_id`, `support_row_id`, ROS distro, RMW identifier, and adapter ABI version.
- `GraphSnapshot` and `GraphDelta`: node, endpoint, type name, schema identity `(scheme, value)`, QoS, liveliness, generation state, `domain_id`, and support-row provenance where applicable.
- `SchemaRequest`: requested type name and schema identity `(scheme, value)`.
- `SchemaAdvertise` and `SchemaResponse`: type name, schema identity `(scheme, value)`, normalized recursive type description, applicable source-bundle entries, encoding, schema generation, cache lifetime, and support-row provenance where applicable.
- `OpenChannel`, `ChannelReady`, and `CloseChannel`: operation kind, target, type name, schema identity `(scheme, value)`, encoding, schema generation, QoS, priority, queue budgets, policy result, `domain_id`, and support-row provenance where applicable.
- `ClockSync` and `Heartbeat`: clock mapping, skew estimate, liveliness, and round-trip samples.
- `SessionResume`: previous session identity, selected wire version, compatible capabilities, matching `gateway_instance_id` and `support_row_id`, acknowledged channel sequences, graph generation, schema generation, policy revision, and resumed channel results. Resume mismatch on gateway instance or support row is an R2WP semantic result; M0-03 freezes the exact code.
- `Error`: stable code, scope, channel, operation correlation, retry class, and diagnostic detail. Codes include `schema_unavailable` for a missing required Humble bundle.

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

The v0 registry includes semantic codes for malformed frames, unsupported versions, unsupported opcodes, unknown channels, schema mismatch, schema identity mismatch, `schema_unavailable`, QoS incompatibility, permission denial, resource exhaustion, deadline expiry, cancellation, transport closure, stale generation, and resume mismatch on gateway instance or support row. M0-03 freezes numeric values, including `schema_unavailable` and the resume-mismatch code. Only a ready gateway emits `SessionReady`.

Every frame or control operation can carry a trace extension. Implementations correlate:

- session, channel, sequence, operation, and goal identity;
- `gateway_instance_id`, `support_row_id`, and `domain_id` where applicable;
- schema identity `(scheme, value)`, type name, encoding, and schema generation where applicable;
- source, gateway ingress, gateway egress, browser ingress, decode, and delivery time;
- queue admission, queue delay, copy count, payload size, and stable disposition reason.

## Security requirements

- TLS 1.3 protects WebTransport/HTTP3 and WSS endpoints.
- Session identity and effective policy arrive before application channels open.
- The gateway validates operation kind, target, schema identity, size, rate, bandwidth, concurrency, and deadline.
- Browser credentials are short-lived session material; robot private keys remain in the edge enclave.
- Error payloads expose scoped diagnostics according to the session's diagnostic permission.

[Security](../security.md) owns the trust model and policy semantics.

## Versioning

- The frame `version` selects a complete wire contract per [ADR 0005](../adr/0005-r2wp-wire-versioning.md).
- `ClientHello` advertises a bounded ordered set of supported wire versions plus transport and capability information.
- `ServerHello` selects exactly one common wire version before session, graph, schema, or channel state begins.
- Every later frame uses the selected version.
- Additive control fields carry defaults defined by their schema version and length-safe extension rules.
- Numeric registries remain stable within a version.
- A compatibility report accompanies each protocol revision and covers Rust, MoonBit, TypeScript, WebTransport, and WSS implementations.

## Required fixtures

R2WP v0 ships golden fixtures for:

- each header field boundary and representative flag combination;
- sample, graph, schema, request, response, goal, feedback, result, cancel, clock, media, and asset frames;
- each transport mapping and QoS class;
- extension-bearing and zero-length payloads;
- schema identity for `rep2011-rihs` and `moonspan-schema-v1`;
- Jazzy provenance mapping between `rep2011-rihs` and a bundle digest;
- identity mismatch and missing required Humble bundle (`schema_unavailable`);
- gateway profile identity in `SessionReady` (`gateway_instance_id`, `support_row_id`, distro, RMW, adapter ABI) from a ready gateway;
- multi-domain same-row sessions under one support row;
- cross-row independent sessions;
- resume mismatch on gateway instance or support row;
- truncation, overflow, unknown registry values, stale generations, and schema mismatch;
- session open, channel open, cancellation, reconnect, resume, and terminal close sequences.

Rust, MoonBit, and TypeScript parsers consume the same bytes and produce the same semantic record or stable error code.

## Contract items assigned to M0-03

- byte order and integer encoding;
- opcode, flag, clock, priority, and error registries, including `schema_unavailable` and resume-mismatch on gateway instance or support row;
- control schema serialization for `(scheme, value)` identity fields and gateway/support-row provenance;
- extension layout and trace fields;
- fragmentation and maximum frame policy;
- version negotiation and session-resume behavior, including gateway instance and support-row matching;
- canonical fixture encoding and manifest format.
