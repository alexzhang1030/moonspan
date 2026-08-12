# Gotchas

Traps already paid for in this repository, each with its why.

## Every sample lease has exactly one owner

The engine reclaims a retained inbound slab only when every lease on it is released (`sweep_released` in `rclweb/src/engine/mod.rs` frees a buffer once ingest is done and its lease refcount hits zero). Any host or SDK code path that drops a sample without delivering it MUST release the lease at the drop site — otherwise the slab is pinned forever. The original R1-04 SDK leaked on three drop paths: the Worker's non-String sample branch and the no-handler branch in both `InlineClient` and `WorkerClient`. The no-handler race is reachable in normal operation because `subscribed` and the first samples can arrive in the same poll flush, before the application has called `onMessage`. Fixed in this change, with regression coverage in `sdk/typescript/test/sdk-poll.test.ts` (no-handler sample: `leasesReleased` must equal `samplesEmitted`).

## encodeHostBatch spread-push ceiling

Spread-pushing a byte array into a `number[]` (`out.push(...bytes)`) throws a RangeError on large frames — every element becomes a call argument, and hundreds of KB (expected for R2-02 large messages) exceeds the engine's argument/call-stack limit. `encodeHostBatch` in `sdk/typescript/src/wasm/abi.ts` therefore pushes bytes in explicit loops. The per-byte `number[]` builder is acceptable for R1 control traffic plus small samples; the preallocated two-pass `Uint8Array` encoder rewrite is queued for the R2-02 large-message work.
