# R4-02: Deployment packaging and observability

Status: In progress (first slice). Production PKI TLS, H-FT/other-row
images, remote metrics/traces, and orchestrator manifests remain follow-ups.
This slice makes operations endpoints and a J-FT runtime image real without
picking a metrics vendor or a cluster runtime.

## Outcome (this slice)

| Area | Behavior |
|---|---|
| Liveness | `GET /livez` JSON `{"status":"ok"}`. `GET /healthz` stays plain `ok` (R1-05 harness). Both stay 200 during drain. |
| Readiness | `GET /readyz` JSON. 200 when accepting sessions; 503 `draining` after `POST /drain` or SIGTERM. |
| Config | `GET /configz` non-secret process identity (row, domain, auth mode, OIDC issuer/audience flags, budgets). Secrets never appear. |
| Metrics | `GET /metrics` Prometheus text 0.0.4 of the existing `/telemetryz` counters plus `rclwebd_sessions` / `rclwebd_draining`. `/telemetryz` JSON is unchanged. |
| Drain | `POST /drain` marks not-ready and rejects new `/ws` (503). Live sessions keep working. SIGTERM / ctrl_c drains, waits `RCLWEBD_DRAIN_TIMEOUT_SECS` (default 15), then stops. |
| Isolation | Opt-in `RCLWEBD_ISOLATION_HEADERS` adds COOP/COEP/CORP. `RCLWEBD_CORS_ORIGINS` is an allow list (`*` permitted). |
| Image | Digest-pinned Jazzy multi-stage `docker/Dockerfile.rclwebd`: non-root `rclwebd`, `HEALTHCHECK` on `/readyz`, bind default `0.0.0.0:8794`. Host-network compose for robot-domain attach. |

The binary still defaults to `127.0.0.1:8794` so a host process does not
listen on every interface. The container entrypoint overrides that.

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
| J-FT image | [`docker/Dockerfile.rclwebd`](../../docker/Dockerfile.rclwebd), [`docker/rclwebd-entrypoint.sh`](../../docker/rclwebd-entrypoint.sh) |
| Compose | [`docker/compose.r4-02-gateway.yml`](../../docker/compose.r4-02-gateway.yml) |

## Acceptance evidence

```bash
cargo test --locked -p rclwebd --lib ops::
cargo test --locked -p rclwebd --test ws_gateway healthz_stays_plain_ok
cargo test --locked -p rclwebd --test ws_gateway drain_keeps_healthz_ok
cargo test --locked -p rclwebd --test ws_gateway isolation_headers_opt_in
just check && just test && just build
```

Image build (`just image-rclwebd`) needs Docker and is not a foundation CI
job — same posture as `just e2e`. Tests call `serve()` (no OS signal
handler); the daemon calls `serve_with_os_signals` so SIGTERM can drain.

## Still open in R4-02

- Production TLS / reverse-proxy profile (this image speaks plaintext HTTP/WS)
- H-FT and remaining-row runtime images
- Remote metrics/trace export (OTLP or equivalent) — scrape format only here
- Kubernetes / systemd units beyond compose
- Upgrade, rollback, and soak/fault evidence
