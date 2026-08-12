# R3-03: H-FT support-row gating + WebTransport bring-up

Status: Complete (implementation + automated evidence). Live Humble rcl
attachment and full Chromium WebTransport e2e remain evidence-gated follow-ups
(current `feature = "ros"` links Jazzy FFI; bun has no `WebTransport`).

## Outcome (H-FT)

| Area | Behavior |
|---|---|
| Gateway config | `SupportRow` on `GatewayConfig`; `RCLWEBD_SUPPORT_ROW` selects `J-FT` (default) or `H-FT` |
| SessionReady | Fields 8/18/19 carry row id / distro / RMW from config |
| OpenChannel | Client engine remembers SessionReady row; `H-*` → `moonspan-schema-v1`, `J-*` → `rep2011-rihs` |
| Wrong row | Gateway rejects OpenChannel with `support_row_mismatch` (wire 25) |
| Live Humble rcl | **Evidence-gated** — mock + corpus prove the row identity path |

## Outcome (WebTransport)

| Area | Behavior |
|---|---|
| Local-dev TLS | Opt-in `local_dev_tls_enabled` / `RCLWEBD_LOCAL_DEV_TLS`; ECDSA P-256 self-signed, default 7d (≤13d), remint when <24h remain |
| Advertise | `GET /local-dev/tls` JSON (SPKI sha-256 base64 + notAfter); `/healthz` includes TLS when active; **never** returns private key |
| Hello | `offer_webtransport` AND-negotiates `webtransport_http3`; active transport must remain true |
| Engine / SDK | `AppCommand::Start { webtransport }` + `ConnectOptions.transport` / `serverCertificateHashes` / optional `/local-dev/tls` fetch |
| WT accept | Behind `--features webtransport` (`wtransport`); length-prefixed bi-stream ↔ `connection::run`; stub without feature |

Evidence: [`r3-03-h-ft-row.json`](../evidence/r3-03-h-ft-row.json), [`r3-03-local-dev-tls.json`](../evidence/r3-03-local-dev-tls.json).

## Acceptance evidence

```bash
cargo test --locked -p rclweb --lib engine::
cargo test --locked -p rclwebd --test ws_gateway
cargo test --locked -p rclwebd --lib local_dev_tls
cargo test --locked -p rclwebd --lib control::hello_tests
bun test sdk/typescript/test
just check && just test && just build
```

Optional WT accept: `cargo test --locked -p rclwebd --features webtransport --lib`

Optional mock compose: `docker compose -f docker/compose.r3-03-h-ft.yml run --rm h-ft-protocol`

## Surfaces

| Surface | Location |
|---|---|
| Support row config | [`rclwebd/src/config.rs`](../../rclwebd/src/config.rs) |
| Local-dev TLS | [`rclwebd/src/local_dev_tls.rs`](../../rclwebd/src/local_dev_tls.rs) |
| WT accept / stub | [`rclwebd/src/wt.rs`](../../rclwebd/src/wt.rs) |
| HTTP advertise + WS | [`rclwebd/src/ws.rs`](../../rclwebd/src/ws.rs) |
| Engine OpenChannel / ClientHello | [`rclweb/src/engine/`](../../rclweb/src/engine/) |
| SDK ConnectOptions / host | [`sdk/typescript/src/`](../../sdk/typescript/src/) |
| Mock H-FT e2e | [`rclwebd/tests/ws_gateway.rs`](../../rclwebd/tests/ws_gateway.rs) |
| Docker scaffolding | [`docker/compose.r3-03-h-ft.yml`](../../docker/compose.r3-03-h-ft.yml) |

## Deferred

- Full browser WebTransport e2e (Playwright/Chromium lane).
- Production PKI WebTransport.
- Live Humble rcl attachment for H-FT.

## Ownership after completion

R3-04 owns versioned adapter ABI and dynamic typesupport (stronger multi-row linking and live Humble service/action schemas).
