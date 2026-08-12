# 0012: Align Humble scheme and corpus identifiers with rclweb

## Status

Accepted

## Date

2026-08-12

## Context

[ADR 0010](./0010-restructure-single-rust-core.md) renamed the project to rclweb and kept a freeze exception for Humble scheme, corpus, and conformance package identifier strings so committed hashes would not move. Those strings were still the live wire and corpus names. The owner rejected leaving the previous project name in the tree.

## Decision

- Live identifiers follow the rclweb project name: Humble scheme `rclweb-schema-v1`, bundle format `rclweb-schema-bundle-v1`, corpus id `rclweb-ros-cdr-v1`, ROS package `rclweb_cdr_interfaces`, generator package `rclweb_cdr_generator` (binary `rclweb_cdr_generate`), image tag `rclweb-cdr-generator`.
- [ADR 0007](./0007-humble-jazzy-schema-identity.md)'s Humble/Jazzy dual-scheme strategy is unchanged: Jazzy uses `rep2011-rihs`; Humble uses SHA-256 of the deterministic canonical bundle bytes under `rclweb-schema-v1`.
- ADR 0010's exception that froze pre-rename identifier strings is withdrawn.
- Changing those strings rehashes Humble bundle identity. CDR payload bytes stay as committed; do not Docker-regenerate the corpus for a name change.

## Rationale

The project name is rclweb. Hash stability is not a reason to keep the previous name on the wire, in the corpus id, or in ROS package paths.

## Consequences

- Committed Humble `SchemaKey.value` values and `fixtures/bundles/<digest>.json` names change. Generated-types metadata and Humble OpenChannel identities follow the new digests.
- Protocol CDDL/registry, parked SchemaRequest fixtures, and H-FT OpenChannel use `rclweb-schema-v1`.
- Historical ADRs 0001–0009 remain contemporaneous records. Where they named MoonBit as the runtime language, ADR 0010 still supersedes that choice.

## Revisit triggers

- A deployed peer still speaks the pre-rename Humble scheme string (none are known; this tree is pre-release).
- Canonical bundle hashing or fixture agreement falls outside the corpus check.

## Source

Owner, 2026-08-12, rejecting leftover live identifiers from the previous project name.
