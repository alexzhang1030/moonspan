# R4-02: Deployment packaging and observability

Status: In progress. Production PKI TLS, remote metrics/traces, and
orchestrator manifests remain follow-ups. The first slice made operations
endpoints and J-FT / H-FT runtime images real without picking a metrics
vendor or a cluster runtime; the second extends the runtime images to the
remaining four rows.

## Outcome (first slice)

| Area | Behavior |
|---|---|
| Liveness | `GET /livez` JSON `{"status":"ok"}`. `GET /healthz` stays plain `ok` (R1-05 harness). Both stay 200 during drain. |
| Readiness | `GET /readyz` JSON. 200 when accepting sessions; 503 `draining` after `POST /drain` or SIGTERM. |
| Config | `GET /configz` non-secret process identity (row, domain, auth mode, OIDC issuer/audience flags, budgets). Secrets never appear. |
| Metrics | `GET /metrics` Prometheus text 0.0.4 of the existing `/telemetryz` counters plus `rclwebd_sessions` / `rclwebd_draining`. `/telemetryz` JSON is unchanged. |
| Drain | `POST /drain` marks not-ready and rejects new `/ws` (503). Live sessions keep working. SIGTERM / ctrl_c drains, waits `RCLWEBD_DRAIN_TIMEOUT_SECS` (default 15), then stops. |
| Isolation | Opt-in `RCLWEBD_ISOLATION_HEADERS` adds COOP/COEP/CORP. `RCLWEBD_CORS_ORIGINS` is an allow list (`*` permitted). |
| Image | Digest-pinned multi-stage `docker/Dockerfile.rclwebd` (J-FT) and `docker/Dockerfile.rclwebd-h-ft` (H-FT, regenerates FFI): non-root `rclwebd`, `HEALTHCHECK` on `/readyz`, bind default `0.0.0.0:8794`. Host-network compose for robot-domain attach. |

The binary still defaults to `127.0.0.1:8794` so a host process does not
listen on every interface. The container entrypoint overrides that.

## Outcome (this slice — remaining-row runtime images)

The Cyclone DDS and Zenoh rows build from the same two Dockerfiles with the
row identity baked in; no new Dockerfile per row.

| Area | Behavior |
|---|---|
| Build args | `SUPPORT_ROW` / `RMW_IMPLEMENTATION` bake `RCLWEBD_SUPPORT_ROW` and the RMW env; `RMW_APT_PACKAGES` installs the row's RMW in the **runtime** stage (RMW and typesupport are dlopen). Defaults keep the J-FT / H-FT images byte-identical in behavior. |
| Rows | `rclwebd:j-cy`, `rclwebd:j-zn` from `Dockerfile.rclwebd`; `rclwebd:h-cy`, `rclwebd:h-zn` from `Dockerfile.rclwebd-h-ft` (FFI regenerated against Humble). |
| Zenoh | `*-ZN` rows need a running `rmw_zenohd`. The compose starts a router companion from the same image and sets `ZENOH_ROUTER_CHECK_ATTEMPTS` so the gateway retries while it boots. Existing robot routers are configured via standard `rmw_zenoh` env instead. |
| Guard | The adapter probe fails start-up when `RMW_IMPLEMENTATION` does not name the row's RMW (R4-03), so a mispaired image/env combination cannot come up healthy. |
| Commands | `just image-rclwebd-row <row>` builds; `just gateway-row <row>` runs the host-network compose service. |

## Config

```bash
RCLWEBD_BIND=127.0.0.1:8794          # container default 0.0.0.0:8794
RCLWEBD_GATEWAY_INSTANCE_ID=…        # stable deployment id; unset = random per process
RCLWEBD_POLICY_REVISION=r1-dev
RCLWEBD_ISOLATION_HEADERS=0|1
RCLWEBD_CORS_ORIGINS=https://app.example
RCLWEBD_DRAIN_TIMEOUT_SECS=15
```

Operator procedure: [deploy](../deploy.md).

## Delivered scope

| Surface | Location |
|---|---|
| Ops state + scrape text | [`rclwebd/src/ops.rs`](../../rclwebd/src/ops.rs) |
| HTTP routes + drain + headers | [`rclwebd/src/ws.rs`](../../rclwebd/src/ws.rs) |
| Env wiring | [`rclwebd/src/main.rs`](../../rclwebd/src/main.rs), [`GatewayConfig`](../../rclwebd/src/config.rs) |
| Jazzy image (J-FT default; J-CY / J-ZN via build args) | [`docker/Dockerfile.rclwebd`](../../docker/Dockerfile.rclwebd), [`docker/rclwebd-entrypoint.sh`](../../docker/rclwebd-entrypoint.sh) |
| Humble image (H-FT default; H-CY / H-ZN via build args) | [`docker/Dockerfile.rclwebd-h-ft`](../../docker/Dockerfile.rclwebd-h-ft) (regenerates FFI against Humble) |
| Compose | [`docker/compose.r4-02-gateway.yml`](../../docker/compose.r4-02-gateway.yml), [`docker/compose.r4-02-gateway-h-ft.yml`](../../docker/compose.r4-02-gateway-h-ft.yml), [`docker/compose.r4-02-gateway-rmw.yml`](../../docker/compose.r4-02-gateway-rmw.yml) |

## Acceptance evidence

```bash
cargo test --locked -p rclwebd --lib ops::
cargo test --locked -p rclwebd --test ws_gateway healthz_stays_plain_ok
cargo test --locked -p rclwebd --test ws_gateway drain_keeps_healthz_ok
cargo test --locked -p rclwebd --test ws_gateway isolation_headers_opt_in
just check && just test && just build
```

Image builds (`just image-rclwebd` / `just image-rclwebd-h-ft`) need Docker
and are not foundation CI jobs — same posture as `just e2e`. Tests call
`serve()` (no OS signal handler); the daemon calls `serve_with_os_signals`
so SIGTERM can drain.

## Still open in R4-02

- Production TLS / reverse-proxy profile (these images speak plaintext HTTP/WS)
- Remote metrics/trace export (OTLP or equivalent) — scrape format only here
- Kubernetes / systemd units beyond compose
- Upgrade, rollback, and soak/fault evidence
