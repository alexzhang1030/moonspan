# 0009: Freeze R2WP wire version 0 encoding and registries

## Status

Accepted

## Date

2026-08-11

## Context

[ADR 0005](./0005-r2wp-wire-versioning.md) selects complete negotiated wire contracts. Design baseline text in [docs/protocol/r2wp.md](../protocol/r2wp.md) describes R2WP semantics. M0-03 requires a normative contract that Rust, MoonBit, and TypeScript parsers can implement and fixture against, including sequence dispositions, opcode/channel invariants, and bounded control maps.

## Decision

Freeze **R2WP wire version 0** as the phase-one wire contract:

1. Normative package ownership: JSON registry owns numeric assignments, layouts, limits, error precedence, and direction tables; CDDL owns control shapes; prose owns semantic/state rules. Consistency across the three surfaces is mandatory.
2. Requirement language uses RFC 2119 / RFC 8174 keywords.
3. Bootstrap: 12-byte prefix plus deterministic CBOR; ClientHello first, then ServerHello or BootstrapError; ClientHello requested_limits use native uint32/uint64 wire ranges; ServerHello effective_limits are fully concrete and ceiling-capped (including max_channels and max_session_bytes) via min(client, server_hard_limit, ceiling); single extension-capability list; no duplicate resume transport boolean; bootstrap CBOR failures map to `malformed_bootstrap`.
4. Protocol state machine and control direction table: fresh Authenticate → SessionReady/Error; resume SessionResume (capability 1, with credential_type + credential) → SessionResumeResult/Error; ready-state gates; `session_not_ready` vs `protocol_violation`.
5. Channel lifecycle: unused → pending → active|failed → closed; no in-session channel_id reuse; deterministic frame rules; SERVICE_SERVER and ACTION_SERVER are valid browser OpenChannel roles; ACTION_RESULT is Get Result request+response; FEEDBACK/STATUS transport follows effective action topic QoS; graph endpoint roles remain independent.
6. Selected-version frames: 32-byte header; extension_len multiple of 4 with per-TLV zero padding and strictly ascending types; CONTROL_CBOR on channel 0; OPERATION_ID lifecycle with Service cancel via operation-scoped Error; resume/default-domain acks; best-effort gap/stale dispositions on operation streams when applicable; RETAINED history-replay marker; early vs post-channel flag checks; receiver-only validation_order with CONTROL decode before ready/Error-scope (flat and embedded); specialized embedded error_body maps.
7. Graph endpoints carry full schema-bearing fields. Graph endpoint QoS is role-specific advertised/offered-or-requested; OpenChannel carries requested/created-entity QoS. Effective ChannelReady QoS is concrete with required liveliness; Service uses effective-service-qos (RELIABLE + VOLATILE); action goal/result/cancel use that profile set; feedback/status use general effective-qos.
8. Exhaustive JSON registries including scoped field keys, non-ROS CBOR payload maps (media vs recording/asset range rules scoped), source-entry encodings, correlation pairing, validation_order, and bounds. Code 20 is out-of-band readiness/startup only and excluded from every R2WP Error payload. Post-selection control CBOR failures map to `invalid_control`; non-ROS CBOR failures map to `malformed_frame`.
9. Parameter composition, media/recording/asset contracts, and dual-transport framing are frozen for phase-one Humble/Jazzy rows. Service and Action GOAL/CANCEL/RESULT are reliable; Action FEEDBACK/STATUS follow effective topic QoS (including best-effort paths). Every Service/Action frame uses `(channel_id, OPERATION_ID, direction)`.
10. WebTransport sources remain work in progress as of 2026-08-11; binary WSS uses RFC 6455 with one frame per message, bounded latest-wins admission before write for BEST_EFFORT topic/action feedback-status traffic, sequence_gap for pre-write drops, reliable delivery once written, and head-of-line blocking as transport evidence; both transports share one semantic fixture set.

## Rationale

- A single normative package gives validators and codecs one source of numeric truth.
- Sequence dispositions preserve best-effort datagram semantics without false protocol violations on loss.
- Discriminator-aware OpenChannel CDDL and success/error control variants prevent impossible success+error states.
- Explicit bounds and CBOR failure policy protect implementations from partial objects and allocation hazards.

## Consequences

- M0-03a owns this contract surface; later sub-batches add validators, fixtures, and language parsers at exact repository paths.
- Required wire semantic changes after acceptance need a new wire version or superseding ADR.
- Overview [docs/protocol/r2wp.md](../protocol/r2wp.md) retains durable operational requirements and links here for byte-level rules.

## Revisit triggers

- Fixture or multi-language agreement evidence conflicts with a frozen assignment.
- WebTransport mapping finalization requires a compatibility row under the same wire version.
- Absolute bounds or disposition policy fail measured gate evidence.

## Source

- [protocol/r2wp-v0.md](../../protocol/r2wp-v0.md)
- [protocol/registry/r2wp-v0.json](../../protocol/registry/r2wp-v0.json)
- [protocol/schema/control-v0.cddl](../../protocol/schema/control-v0.cddl)
- [ADR 0005](./0005-r2wp-wire-versioning.md)
- [docs/protocol/r2wp.md](../protocol/r2wp.md)
- [RFC 8949](https://www.rfc-editor.org/rfc/rfc8949.html)
- [RFC 8610](https://www.rfc-editor.org/rfc/rfc8610.html)
- [RFC 9682](https://www.rfc-editor.org/rfc/rfc9682.html)
- [RFC 6455](https://www.rfc-editor.org/rfc/rfc6455.html)
- [W3C WebTransport](https://www.w3.org/TR/webtransport/)
- [IETF draft-ietf-webtrans-http3-15](https://datatracker.ietf.org/doc/draft-ietf-webtrans-http3/15/)
