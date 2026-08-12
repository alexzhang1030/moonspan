# Phase 1 schema metadata (embedded)

Frozen dual-scheme registry inputs for `rclweb::types::SchemaRegistry::phase1()`.
Produced by `bun run scripts/generated-types.ts --write` (and checked with `--check`).

| File | Role |
|---|---|
| `descriptors.json` | `roots[]` with `descriptor_id` → `type_name` (plus kind/deps) |
| `identities.json` | `identities[]` — 18 scheme/value rows → `descriptor_id` |
| `wire_profiles.json` | `profiles[]` — `(type_name, support_row_id, CDR_LE\|CDR_BE)` → `zero_tail_bytes` |
| `provenance.json` | `mappings[]` — Jazzy RIHS → `bundle_sha256` |
| `normalized_sources.json` | Generator-only normalized interface sources (not loaded by Rust) |

Rust loads the four registry files via `include_str!` + `serde_json`.
