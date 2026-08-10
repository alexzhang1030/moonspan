# 0005: Version R2WP as complete negotiated wire contracts

## Status

Accepted

## Date

2026-08-10

## Context

R2WP carries browser sessions, graph and schema state, channels, QoS, errors, and sample payloads across WebTransport and binary WSS. Protocol consumers need a stable way to negotiate one complete wire contract per connection while SDK and package releases evolve on their own cadence.

## Decision

Version R2WP as complete negotiated wire contracts.

- R2WP wire version and SDK or package semantic versions are separate identities.
- Each connection starts with a minimal stable bootstrap schema. `ClientHello` advertises a bounded ordered set of supported wire versions plus transport and capability information.
- `ServerHello` selects exactly one common version before session, graph, schema, or channel state begins.
- The bootstrap schema is the sole pre-selection wire form.
- Every later frame uses the selected version. A connection that finds zero common versions terminates with a stable bootstrap error.
- One wire version defines frame layout, numeric registries, required control schemas, channel semantics, QoS mapping, errors, and extension rules as one contract.
- Numeric values keep their meaning for the full life of a wire version.
- Additive optional fields and extensions require declared defaults, length-safe skipping, and capability negotiation. Required semantic changes, field reinterpretation, or incompatible registry behavior receive a new wire version.
- WebTransport over HTTP/3 and binary WSS consume one semantic fixture set. A transport mapping can gain an independent compatibility row under the same wire version when semantics remain identical.
- Session resume requires the same selected wire version plus compatible capabilities, schema generation, graph generation, and policy revision.
- M0-03 owns byte-level bootstrap encoding, exact registries, fixture bytes, malformed behavior, and implementation agreement.

## Rationale

- A single selected wire version keeps every peer on one frame, registry, and control contract for the session lifetime.
- Separate SDK and package versions let application APIs ship on their own schedules after wire-contract gates pass.
- A bounded ordered version set and server selection give a deterministic bootstrap path across heterogeneous clients and gateways, including explicit non-contiguous compatibility.
- Declared defaults and length-safe extensions keep additive evolution compatible within a wire version.
- Shared semantic fixtures across transports preserve one R2WP behavior surface while transport-specific qualification rows capture deployment differences.
- Resume rules bind wire version, capabilities, and generation identity so reconnects continue from known session state.

## Consequences

- M0-03 freezes bootstrap hello encoding, registries, fixtures, and multi-language agreement under this versioning model.
- Rust, MoonBit, and TypeScript parsers consume the same wire version and produce the same semantic record or stable bootstrap error.
- Protocol revisions that change required semantics ship a new wire version with a compatibility report.
- Transport mappings under one wire version share the semantic fixture set and publish separate compatibility evidence when needed.
- Session resume implementations check wire version, capabilities, schema generation, graph generation, and policy revision together.

## Revisit triggers

- Bootstrap negotiation, resume, or multi-language fixture evidence falls outside an accepted gate.
- A required transport mapping needs semantic divergence under one wire version.
- Additive extension rules fail length-safe skipping, defaulting, or capability negotiation evidence.
- Resume needs a broader recovery model than matching wire version plus compatible generations and policy revision.

## Source

Wire framing, control plane, and versioning in [R2WP](../protocol/r2wp.md). Transport and version matrix in [compatibility](../compatibility.md). System envelope ownership in [architecture](../architecture.md) and [architecture rationale](../../.agents/docs/architecture.md).
