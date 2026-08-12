# Gotchas

Traps already paid for in this repository, each with its why.

## Every sample lease has exactly one owner

The engine reclaims a retained inbound slab only when every lease on it is released (`sweep_released` in `rclweb/src/engine/mod.rs` frees a buffer once ingest is done and its lease refcount hits zero). Any host or SDK code path that drops a sample without delivering it MUST release the lease at the drop site — otherwise the slab is pinned forever. The original R1-04 SDK leaked on three drop paths: the Worker's non-String sample branch and the no-handler branch in both `InlineClient` and `WorkerClient`. The no-handler race is reachable in normal operation because `subscribed` and the first samples can arrive in the same poll flush, before the application has called `onMessage`. Fixed in this change, with regression coverage in `sdk/typescript/test/sdk-poll.test.ts` (no-handler sample: `leasesReleased` must equal `samplesEmitted`).

## encodeHostBatch large-frame encoder

Spread-pushing a byte array into a `number[]` (`out.push(...bytes)`) throws a RangeError on large frames — every element becomes a call argument, and hundreds of KB / ~1 MiB (R2-02 PointCloud2 scale) exceeds the engine's argument/call-stack limit. `encodeHostBatch` in `sdk/typescript/src/wasm/abi.ts` is a two-pass preallocated `Uint8Array` encoder (size, then write). Do not reintroduce `push(...bytes)` or per-byte `number[]` builders on the data path. Large WS frames (≥64 KiB) also take the external-ptr poll path so the engine can own the wasm allocation without a second deep copy.

## WebTransport local certs are ≤14 days by browser rule

`serverCertificateHashes` rejects certificates whose validity window exceeds 14 days. Local-dev TLS therefore auto-mints short-lived ECDSA P-256 certs and **rotates** (default lifetime 7 days, remint when <24h remain); it does not lengthen the cert. After notAfter, new handshakes fail closed until rotate/restart. See [ADR 0011](../../docs/adr/0011-local-dev-webtransport-tls.md).

## Reconnect is a fresh session, not SessionResume

v0.1 parks SessionResume (capability 1). R2-01 reconnect means: close the transport, allocate a new client engine, re-run ClientHello → Authenticate → SessionReady, then re-open channels. The SDK `reconnect()` / `ConnectOptions.reconnect` path implements that; do not invent resume tokens or expect `gateway_instance_id` alone to restore channel state.
