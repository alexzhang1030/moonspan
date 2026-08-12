# R2-02: Large-message path (both buffer strategies)

Status: Complete (implementation + automated evidence). SharedArrayBuffer
**wire** negotiation (capability 2) and browser COOP/COEP production isolation
remain evidence-gated — measured here when SAB is constructible, not claimed
as a shipped cross-origin-isolated deployment profile. Full Foxglove/rosbridge
baseline remains R2-04. R1 gate demo review stays `[~]` and does not block
this item.

## Outcome

| Area | Behavior |
|---|---|
| PointCloud2 CDR | Public `rclweb::cdr::point_cloud2` borrowed view: metadata + `data` offset/len; never materializes payload `Vec<u8>` or iterates points |
| Large-frame retain | Engine retains with `bytes::Bytes`; `poll` takes owned events so WS payloads move; wasm ABI takes alloc ownership (`from_raw_parts`) on the external-ptr path |
| `encodeHostBatch` | Two-pass preallocated `Uint8Array` — no `push(...bytes)` / per-byte `number[]` (fixes the gotchas RangeError on ~1 MiB frames) |
| Transferable AB | Existing main path; large frames (≥64 KiB) use external-ptr poll (one controllable copy into engine) |
| SAB ring | Host-side `SharedArrayBufferRingStrategy` with reproducible measure/compare; COOP/COEP gate recorded in evidence |
| Measurement | `just large-message` — ~1 MiB @ 10 Hz direction (30 frames), encode + both strategies + retain-copy probe (stdout) |

Constraints preserved: single Rust core, TS SDK does not parse R2WP, no
third-party rcl binding, no `Instant` on wasm, no permessage-deflate, J-FT row,
inbound controllable copy budget ≤ 2.

## Delivered scope

| Surface | Location |
|---|---|
| PointCloud2 borrowed codec | [`rclweb/src/cdr/point_cloud2.rs`](../../rclweb/src/cdr/point_cloud2.rs) |
| Engine retain / lease PC2 view | [`rclweb/src/engine/`](../../rclweb/src/engine/) |
| Wasm `rclweb_point_cloud2_meta` | [`rclweb/src/host/abi.rs`](../../rclweb/src/host/abi.rs) |
| Two-pass host batch + large poll | [`sdk/typescript/src/wasm/abi.ts`](../../sdk/typescript/src/wasm/abi.ts) |
| Buffer strategies | [`sdk/typescript/src/buffer/strategies.ts`](../../sdk/typescript/src/buffer/strategies.ts) |
| Evidence script | [`scripts/measure-large-message.ts`](../../scripts/measure-large-message.ts) (`just large-message`) |

## Acceptance evidence

```bash
cargo test --locked -p rclweb
bun run scripts/build-wasm.ts
bun test sdk/typescript/test
bun run scripts/measure-large-message.ts
just check && just test && just build
```

Notable tests:

- `cdr::point_cloud2::tests::large_cloud_decode_is_o1_under_tiny_temp_budget`
- `engine::tests::large_point_cloud2_sample_borrowed_view_and_single_retain_copy`
- SDK `encodeHostBatch two-pass handles ~1 MiB frame without RangeError`
- SDK `shared-arraybuffer ring round-trips a large frame when SAB is available`
- SDK `large-frame poll uses external path and records one engine copy`

## Ownership after completion

R2-03 owns adversarial fixture regeneration and fuzzing —
see [R2-03](./r2-03-fixtures-fuzzing.md). R2-04 recorded the Foxglove/rosbridge
baseline on the shared workload identities —
see [R2-04](./r2-04-perf-baseline.md). Browser COOP/COEP qualification for SAB
production remains a support-matrix row, not a silent ship.
