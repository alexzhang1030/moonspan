# R2WP protocol

R2WP is Moonspan's versioned browser transport for ROS 2 semantics and serialized data. It carries bootstrap negotiation, a fixed 32-byte selected-version frame header, deterministic CBOR control maps, and CDR or media payloads over WebTransport and binary WebSocket.

**Status:** wire version **0** accepted normative freeze ([ADR 0009](../adr/0009-r2wp-v0-wire-encoding.md)); M0-03b contract validator complete; M0-03c–h implement codecs, fixtures, and language parsers against this contract.

| Surface | File |
|---|---|
| Normative wire version 0 | [protocol/r2wp-v0.md](../../protocol/r2wp-v0.md) |
| Numeric registries and layouts | [protocol/registry/r2wp-v0.json](../../protocol/registry/r2wp-v0.json) |
| Control CDDL | [protocol/schema/control-v0.cddl](../../protocol/schema/control-v0.cddl) |
| Contract validator (implementation) | [scripts/protocol-check.ts](../../scripts/protocol-check.ts) (`bun run protocol-check`, `just protocol-check`) |
| Encoding ADR | [ADR 0009](../adr/0009-r2wp-v0-wire-encoding.md) |
| Versioning model | [ADR 0005](../adr/0005-r2wp-wire-versioning.md) |

This page is the design overview and documentation entry. Byte-level rules, registries, absolute limits, dispositions, and transport length rules are normative in the protocol package above. The validator enforces those rules. Normative authority remains the three-file protocol package.

Schema identity follows [ADR 0007](../adr/0007-humble-jazzy-schema-identity.md). Gateway process and support-row binding follows [ADR 0008](../adr/0008-one-adapter-row-per-gateway-process.md). First-stage pins live in the [support matrix](../support-matrix.md).

## Design goals

- Preserve CDR bytes across the sample hot path.
- Negotiate topic names, type names, schema identity `(scheme, value)`, QoS, permissions, and budgets once per channel.
- Map ROS reliability and deadlines onto independent browser transport channels.
- Keep every queue bounded by sample count and bytes.
- Carry stable drop, expiry, cancellation, disposition, and policy reasons.
- Support WebTransport and WSS through one semantic envelope.
- Correlate source, gateway, browser, and application timing through trace identity.

R2WP v0 qualifies WebTransport over HTTP/3 as its primary WebTransport profile. As of 2026-08-11 the W3C WebTransport API and the IETF HTTP/3 mapping remain work-in-progress sources; see [protocol/r2wp-v0.md](../../protocol/r2wp-v0.md). Binary WSS follows RFC 6455. Both transports share one semantic fixture set.

## Schema identity

Every schema-bearing control, channel, and **graph endpoint** contract carries `scheme`, `value`, type name, payload encoding, schema generation, and QoS profile data ([ADR 0007](../adr/0007-humble-jazzy-schema-identity.md)).

| Scheme | Value rule |
|---|---|
| `rep2011-rihs` | 71-byte `RIHS01_` + 64 lowercase hex |
| `moonspan-schema-v1` | 64 lowercase hex SHA-256 |

Graph endpoints use CDR1 or XCDR2 encodings only. Action endpoints carry five-profile `action_qos` (goal/result/cancel services and feedback/status topics). Every graph node and endpoint includes `domain_id`. Missing required Humble bundle yields `schema_unavailable` (code 10). Jazzy+ is later expansion.

## Gateway process and support-row binding

- One connection binds one gateway instance and one support row (H-FT, H-CY, J-FT, J-CY) with matching ros_distro/rmw profile.
- Multiple ROS domain IDs (`0..232`) may open under that row; `domain_ids` are nonempty and unique.
- Cross-row composition uses independent sessions.
- `SessionReady` is emitted only by a ready gateway and includes `session_id`, negotiated capabilities, provenance trio fields, policy revision, and budgets.
- `adapter_profile_mismatch` (code 20) is out-of-band readiness/startup status and is excluded from every R2WP Error payload.

## Bootstrap and frame summary

Bootstrap: 12-byte prefix + deterministic CBOR; client sends exactly one ClientHello first; server replies with exactly one ServerHello or BootstrapError; deterministic version selection (first client preference the server supports); capability ID intersection on ServerHello. Effective limits are fully concrete; absolute ceilings cover max_channels and max_session_bytes as well as message and control payload fields.

Selected-version frame: 32-byte big-endian header; total length `32 + extension_len + payload_len`; `extension_len` multiple of 4 with per-TLV zero padding; channel 0 = control; application channels `1..2^32-1`.

Sequence: sender assigns contiguous sequences from 0 without wrap; reliable receivers require exact next; best-effort receivers allow gaps (`sequence_gap`) and drop stale sequences (`stale_sequence`); success disposition is `delivered`.

Application fragmentation is prohibited; reserved fragment bit yields `unsupported_flags`. CONTROL_CBOR requires channel 0, priority CONTROL, reliable control stream, and control payload ceiling. Service frames and Action GOAL/CANCEL/RESULT use reliable streams with OPERATION_ID; Action FEEDBACK/STATUS select reliable stream or best-effort datagram/sample-scoped stream from their effective topic QoS, still with `(channel_id, OPERATION_ID, direction)`. KEYFRAME is MEDIA_CHUNK-only; RETAINED marks retained-history ROS_SAMPLE replay; ROS_RELIABLE matches negotiated QoS.

## Session state machine (summary)

Fresh path: Authenticate → SessionReady/Error. Resume path (capability 1): SessionResume with `credential_type` + `credential` → SessionResumeResult/Error. Entry messages are mutually exclusive; repeat or wrong order yields `protocol_violation`. Ready state begins only after SessionReady or accepted SessionResumeResult. `previous_session_id` is not a bearer secret.

Ready-required control kinds (before ready → `session_not_ready`): GraphSnapshot, GraphDelta, SchemaRequest, SchemaResponse, SchemaAdvertise, OpenChannel, ChannelReady, CloseChannel, ClockSync, Heartbeat. Error remains legal after selection by scope.

Channel lifecycle: client allocates a previously unused `channel_id` (no reuse in-session); OpenChannel pending → ChannelReady active or failed → CloseChannel terminal. **SERVICE_SERVER** and **ACTION_SERVER** are valid browser OpenChannel roles (inverse directions from CLIENT roles); graph endpoint roles remain independent. Opcode and direction MUST match the active `operation_kind`.

Session resume acks and `CloseChannel.final_sequence` cover **default** `(channel_id, direction)` domains only. Service/Action operation streams reset or close on resume and never byte-resume. `next_sequence` is the next sequence of the channel’s active data sender (side from `operation_kind`: gateway→browser for subscribe/media/recording/asset; browser→gateway for publish). Reliable resume uses contiguous default-domain acks; best-effort acks report the highest accepted sequence.

OPERATION_ID lifecycle: Service initiator allocates unique nonzero per-call IDs (response echoes); terminates on response or operation-scoped Error (`cancelled` for cancel). Action GOAL allocates a goal-lifecycle ID; multi-goal cancel uses its own ID; ACTION_STATUS all-zero lasts for the channel. ROS goal UUID stays in CDR; adapter maps to wire ID.

Extension TLVs are strictly ascending by type. RETAINED marks retained-history replay (requires TRANSIENT_LOCAL; live samples may clear). ROS_RELIABLE remains iff reliability.

Validation order is receiver/input only and single-valued. CONTROL_CBOR decode precedes ready-state and flat/embedded Error-scope checks. Early static flags split from post-channel QoS flag checks. Sender-local u64 exhaustion is outside that list.

## Control plane

Opcode `CONTROL_CBOR` carries Authenticate, SessionReady, GraphSnapshot, GraphDelta, SchemaRequest, SchemaAdvertise, SchemaResponse, OpenChannel, ChannelReady, CloseChannel, ClockSync, Heartbeat, SessionResume, SessionResumeResult, and Error. CDDL shapes are normative in [control-v0.cddl](../../protocol/schema/control-v0.cddl). Direction tables live in the registry and [protocol/r2wp-v0.md](../../protocol/r2wp-v0.md).

`SessionResume` matches wire version, capabilities, `previous_session_id`, gateway instance, support row, generations, policy revision, per-channel acks, and revalidates with `credential_type` + `credential`. Distinct codes cover gateway instance vs support row mismatch.

Request/response control echoes `correlation_id`; unsolicited events use 16 zero bytes. Graph nodes/endpoints use session-stable identifiers for deltas.

## Channel mapping

| ROS or application semantic | WebTransport mapping | Queue policy |
|---|---|---|
| Graph, schema, authentication, clock, liveliness | One reliable control stream | Bounded and strictly ordered |
| Reliable topic | One unidirectional stream per topic channel | `KEEP_LAST` or `KEEP_ALL` within budgets |
| Small best-effort topic | Datagram (ROS_SAMPLE only) | Latest-wins; gap/stale dispositions |
| Large best-effort topic | Sample-scoped unidirectional stream | Newer samples reclaim older pending work; gap/stale dispositions |
| Parameter get/set/list | Service client/server channels | Reliable stream; policy/audit classify parameter operations |
| Parameter events | Topic subscribe (`ROS_SAMPLE`) | As negotiated topic QoS |
| Service client or server | Reliable stream per call | Browser may open SERVICE_CLIENT or SERVICE_SERVER; request/response directions invert by role; OPERATION_ID; stream sequence per operation |
| Action client or server | Goal, cancel, get-result, feedback, status | Browser may open ACTION_CLIENT or ACTION_SERVER; GOAL/CANCEL/RESULT reliable request+response; FEEDBACK/STATUS one-way with transport from effective feedback/status topic QoS (reliable stream or best-effort datagram/sample stream); OPERATION_ID lifecycle; sequences per operation stream |
| H.264 or AV1 camera | Encoded chunk stream | Keyframe-aware eviction; stream_generation reset |
| MCAP or asset transfer | Independent reliable stream | Range/offset identity, checksum, resume metadata |

Binary WSS carries the same frames in one connection with control priority and channel fairness: one complete frame per message. BEST_EFFORT topic samples and Action FEEDBACK/STATUS use bounded latest-wins admission/eviction before write (no datagram plane); dropped pre-write frames surface as `sequence_gap`; bytes are reliable once written; head-of-line blocking is a recorded transport limitation. Normative payload layouts for media/recording/asset live in [protocol/r2wp-v0.md](../../protocol/r2wp-v0.md) and the registry `non_ros_payloads` / `source_entry_encodings` maps.

## QoS mapping

Moonspan wire QoS integers include SYSTEM_DEFAULT, RELIABLE/BEST_EFFORT, TRANSIENT_LOCAL/VOLATILE, KEEP_LAST/KEEP_ALL, and liveliness **SYSTEM_DEFAULT / AUTOMATIC / MANUAL_BY_TOPIC**. Optional durations absent mean ROS unspecified/default. Graph endpoint QoS is the role-specific advertised/offered-or-requested profile; OpenChannel carries requested/created-entity QoS. Effective ChannelReady QoS is fully concrete with required liveliness. Service channels and action goal/result/cancel use effective-service-qos (RELIABLE + VOLATILE); action feedback/status use general effective-qos. Compatibility is computed before channel activation.

## Flow control and recovery

- Each channel advertises maximum samples, bytes, message size, bandwidth, concurrency, and deadline policy under absolute v0 ceilings.
- Peers expose queue occupancy, admitted bytes, evictions, expiries, dispositions, and transport backpressure.
- Reliable default-domain streams resume from contiguous acknowledged sequence state when capabilities match; `next_sequence` tracks the active data sender for that `operation_kind`. Service/Action operation streams reset or close rather than byte-resume.
- Datagram loss appears as sequence gaps with source and receive timing and `sequence_gap` disposition.
- Large-message cancellation releases stream, Wasm, and application buffers through a correlated lifecycle event.
- Graph and schema generations let clients discard stale channel state after reconnect or topology change.

## Errors and telemetry

The v0 registry freezes semantic codes for malformed bootstrap/frames, unsupported version/opcode/flags, unknown channels, schema failures including `schema_unavailable`, QoS and permission failures, resource and deadline outcomes, transport closure, stale generation, resume mismatches, sequence exhaustion, extensions, invalid control, message size, protocol violation, authentication, session readiness, and clock unavailability. Code 20 (`adapter_profile_mismatch`) is out-of-band readiness/startup status and is excluded from every R2WP Error payload.

Every frame or control operation can carry a trace extension. Implementations correlate:

- session, channel, sequence, operation, and goal identity;
- `gateway_instance_id`, `support_row_id`, and `domain_id` where applicable;
- schema identity `(scheme, value)`, type name, encoding, and schema generation where applicable;
- source, gateway ingress, gateway egress, browser ingress, decode, and delivery time;
- queue admission, queue delay, copy count, payload size, and stable disposition reason.

Error payloads expose scoped diagnostics according to the session's diagnostic permission.

## Security requirements

- TLS 1.3 protects WebTransport/HTTP3 and WSS endpoints.
- Session identity and effective policy arrive before application channels open.
- The gateway validates operation kind, target, schema identity, size, rate, bandwidth, concurrency, and deadline.
- Browser credentials are short-lived session material; robot private keys remain in the edge enclave.

[Security](../security.md) owns the trust model and policy semantics.

## Versioning

Wire versioning follows [ADR 0005](../adr/0005-r2wp-wire-versioning.md). Wire version 0 freezes assignments in [ADR 0009](../adr/0009-r2wp-v0-wire-encoding.md). Additive fields require deterministic defaults and capability gates; unknown core fields are `invalid_control`.

## Required fixtures

R2WP v0 ships golden fixtures for:

- each header field boundary and representative flag combination;
- sample, graph, schema, request, response, goal, feedback, result, cancel, clock, media, and asset frames;
- each transport mapping and QoS class;
- extension-bearing and zero-length payloads;
- schema identity for `rep2011-rihs` and `moonspan-schema-v1`;
- Jazzy provenance mapping between `rep2011-rihs` and a bundle digest;
- identity mismatch and missing required Humble bundle (`schema_unavailable`);
- gateway profile identity in `SessionReady` from a ready gateway;
- multi-domain same-row sessions under one support row;
- cross-row independent sessions;
- resume mismatch on gateway instance or support row;
- sequence gap and stale_sequence dispositions on best-effort paths;
- truncation, overflow, unknown registry values, stale generations, and schema mismatch;
- session open, channel open, cancellation, reconnect, resume, and terminal close sequences.

Rust, MoonBit, and TypeScript parsers consume the same bytes and produce the same semantic record or stable error code. WebTransport and WSS share the semantic fixture set.

## Related documents

- [Normative R2WP v0](../../protocol/r2wp-v0.md)
- [Architecture](../architecture.md)
- [Compatibility](../compatibility.md)
- [Support matrix](../support-matrix.md)
- [Validation](../validation.md)
