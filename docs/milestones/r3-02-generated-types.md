# R3-02: Generated types and dual-scheme schema registry

Status: Complete (implementation + automated evidence).

## Outcome

| Area | Behavior |
|---|---|
| Bun generator | `scripts/generated-types.ts` `--write` / `--check`; joins corpus bundles, manifest, tail-slack, RIHS provenance |
| Metadata | Committed under `rclweb/generated/metadata/` (9 descriptors, 18 identities, 56 wire profiles, provenance) |
| Codecs | Production Rust models + CDR1 codecs for the nine Phase 1 roots (+ shared `Time`); PointCloud2 keeps borrowed `data` |
| Registry | Bounded builder → freeze → immutable `SchemaRegistry::phase1()`; dual-scheme lookup with representation-aware zero-tail |
| Channel activation | Engine OpenChannel for Phase 1 roots embeds real J-FT RIHS; lookup miss → wire code 10 (`schema_unavailable`) |
| `std_msgs/String` | Demo path keeps placeholder RIHS (not a Phase 1 root) |

Wire `SchemaRequest` / `SchemaAdvertise` / `SchemaResponse` exchange stays parked (local registry is the R3-02 surface; remote advertise/cache waits on gateway follow-up / R3-04).

## Delivered scope

| Surface | Location |
|---|---|
| Generator | [`scripts/generated-types.ts`](../../scripts/generated-types.ts) |
| Metadata artifacts | [`rclweb/generated/metadata/`](../../rclweb/generated/metadata/) |
| Codecs + registry | [`rclweb/src/types/`](../../rclweb/src/types/) |
| Engine identity + lookup | [`rclweb/src/engine/`](../../rclweb/src/engine/) |
| Contract | [`docs/runtime/generated-types.md`](../runtime/generated-types.md) |

## Acceptance evidence

```bash
bun run generated-types:check
bun test scripts/generated-types.test.ts
cargo test --locked -p rclweb --lib types::
cargo test --locked -p rclweb --test generated_types_registry --test cdr_corpus
just check && just test && just build
```

Notable: 18 identities → 9 descriptors; H-FT/J-FT `PrimitiveScalars` LE tail 4 vs BE tail 0; one fixture decode+exact-encode per root.

## Ownership after completion

R3-03 owns H-FT gating and WebTransport. R3-04 delivered dynamic typesupport / adapter ABI ([milestone](./r3-04-adapter-abi-typesupport.md)); wire schema exchange stays parked for a follow-up against a gateway schema cache.
