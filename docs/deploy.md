# Deploying `rclwebd`

Operator profile for the J-FT runtime image and process operations. The
gateway remains the trust boundary ([security](./security.md)); this page
covers how to run it. Milestone evidence: [R4-02](./milestones/r4-02-deployment-observability.md).

## Artifact

One support row per process ([ADR 0008](./adr/0008-one-adapter-row-per-gateway-process.md)).
This slice ships **J-FT** (Jazzy + Fast DDS):

```bash
just image-rclwebd          # docker build -t rclwebd:j-ft
just gateway                # host-network compose
```

The image is multi-stage: builder compiles `rclwebd --features ros`, runtime
is digest-pinned `ros:jazzy-ros-base-noble` plus the binary, running as uid
`10001`. `HEALTHCHECK` probes `GET /readyz`. Extra ROS interface packages
must be installed in the image or mounted into `ROS_PREFIX` — typesupport is
dlopen, not link-time.

H-FT still uses the Humble e2e image path (`just e2e-h-ft`). A Humble runtime
image is a follow-up.

## Listen address

| Context | Default |
|---|---|
| Host binary | `RCLWEBD_BIND=127.0.0.1:8794` |
| Container entrypoint | `0.0.0.0:8794` |

Do not treat a container publish of 8794 as TLS. Put a reverse proxy in front
for production WSS / HTTPS. Local-dev WebTransport TLS stays opt-in
([ADR 0011](./adr/0011-local-dev-webtransport-tls.md)) and must not be the
default on this image.

## Identity and row

Set `RCLWEBD_GATEWAY_INSTANCE_ID` to a stable deployment id if the instance
should survive ordinary restart. Unset keeps a random id (a replacement
instance every process start). Pair `RCLWEBD_SUPPORT_ROW=J-FT` with Jazzy
`ROS_PREFIX`. `ROS_DOMAIN_ID` selects the domain.

Authenticate stays **off** unless `RCLWEBD_AUTH_MODE=oidc` ([R4-01](./milestones/r4-01-oidc-sros2-audit.md)).

## Operations endpoints

| Method | Path | Role |
|---|---|---|
| GET | `/healthz` | Liveness. Plain `ok` when local-dev TLS is off (R1-05 harness). 200 during drain. |
| GET | `/livez` | Liveness JSON. 200 during drain. |
| GET | `/readyz` | Readiness JSON. 503 after drain. Use this for load balancers. |
| GET | `/configz` | Non-secret config (row, domain, auth mode, budgets). No OIDC secrets. |
| GET | `/telemetryz` | JSON copy/disposition counters (unchanged). |
| GET | `/metrics` | Prometheus text 0.0.4 of those counters plus session gauges. |
| POST | `/drain` | Mark not-ready; reject new `/ws`. Existing sessions continue. |
| GET | `/ws` | R2WP binary WebSocket. 503 while draining. |
| GET | `/local-dev/tls` | ADR 0011 advertisement when local-dev TLS is on. |

Browser isolation headers (COOP/COEP/CORP) are opt-in via
`RCLWEBD_ISOLATION_HEADERS=1`. CORS is an allow list
(`RCLWEBD_CORS_ORIGINS`, comma-separated; `*` allowed). Empty means no CORS
headers.

## Drain

1. `POST /drain` (preStop / deploy hook) so the load balancer sees `/readyz` 503.
2. Wait until `sessions` in `/readyz` is 0, or until the drain timeout.
3. SIGTERM. The process also drains on SIGTERM / ctrl_c and waits
   `RCLWEBD_DRAIN_TIMEOUT_SECS` (default 15) before exit.

## Compose shape

[`docker/compose.r4-02-gateway.yml`](../docker/compose.r4-02-gateway.yml) uses
`network_mode: host` so Fast DDS can see the robot domain. That is a local /
robot-edge shape, not a cloud overlay network.

## Not in this slice

Production PKI, H-FT runtime image, remote metrics/trace export, Kubernetes
or systemd units, upgrade/rollback playbooks, SROS2 keystore (D-04).
