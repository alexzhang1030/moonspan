# R2-03: Fixtures regenerated for the v0.1 subset; fuzzing

Status: Complete (implementation + automated evidence). R1 gate demo review
remains `[~]` and is out of scope for this note. R2-04 (Foxglove/rosbridge
baseline) is not started here.

## Outcome

| Area | Behavior |
|---|---|
| Fixture regenerator | One small Rust bin [`scripts/protocol-fixtures`](../../scripts/protocol-fixtures/) materializes all **55 malformed** fixtures from `hex`/`mutate` sources and the **3 valid bootstraps** via `rclweb` encoders |
| Parked valid frames | Remain frozen; regenerator verifies sha256 / byte_length so drift fails `--check` |
| v0.1 tagging | Coverage-tag filter counts normative-subset fixtures (bootstrap steps, frame steps, session/ROS_SAMPLE related) |
| Fuzz (stable CI) | Deterministic mutation smoke: [`rclweb/tests/decoder_fuzz_smoke.rs`](../../rclweb/tests/decoder_fuzz_smoke.rs) over bootstrap / frame / CBOR / CDR |
| Fuzz (optional nightly) | `fuzz/` cargo-fuzz targets + seeded corpora; **not** a workspace member (stable pin) |

Constraints preserved: single Rust core, no resurrected multi-kLOC TS generators /
agreement apparatus, fixtures remain the single oracle.

## Delivered scope

| Surface | Location |
|---|---|
| Regenerator | [`scripts/protocol-fixtures/`](../../scripts/protocol-fixtures/) |
| Manifest `generated_by` | `scripts/protocol-fixtures (R2-03)` |
| just recipes | `protocol-fixtures-check`, `protocol-fixtures-write`, `fuzz-smoke` (also wired into `just check`) |
| Optional libFuzzer | [`fuzz/`](../../fuzz/) |

## Acceptance evidence

```bash
cargo run --locked -p protocol-fixtures -- --check
cargo test --locked -p rclweb --test decoder_fuzz_smoke
just check && just test && just build
```

Optional (nightly + `cargo-fuzz`):

```bash
# see fuzz/README.md
cargo +nightly fuzz run parse_bootstrap -- -max_total_time=30
```

## Ownership after completion

R2-04 recorded the Foxglove/rosbridge performance baseline —
see [R2-04](./r2-04-perf-baseline.md). Parked protocol sections stay parked
until R3 re-freezes them; their fixture bins remain integrity-checked frozen
data until then.
