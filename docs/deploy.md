# Deploying `rclwebd`

Operator profile for the runtime images (all six support rows) and process
operations. The gateway remains the trust boundary ([security](./security.md));
this page covers how to run it.

## Prebuilt artifacts

The release workflow publishes every support row to GHCR and attaches
prebuilt binaries to the GitHub Release
([ADR 0018](./adr/0018-prebuilt-gateway-distribution.md), [release](./release.md)).
No clone or toolchain required:

```bash
docker run --rm --network host ghcr.io/alexzhang1030/rclwebd:jazzy
```

| Tag | Row |
|---|---|
| `<version>-j-ft` … `<version>-h-zn` | Pinned version, one tag per row |
| `j-ft` / `j-cy` / `j-zn` / `h-ft` / `h-cy` / `h-zn` | Rolling latest per row |
| `jazzy` | Rolling J-FT |
| `humble` | Rolling H-FT |
| `latest` | Rolling J-FT |

Every tag is a multi-arch manifest (`linux/amd64` + `linux/arm64`, both
built on native runners); per-arch tags (`<version>-<row>-<arch>`) also
exist for pinning one platform. Zenoh-row containers still need the
router companion described under [Artifact](#artifact).

Host binaries (`rclwebd-<version>-{jazzy,humble}-{amd64,arm64}` plus
`.sha256`) are built in the same digest-pinned builder stages and run
against a sourced matching prefix:

```bash
curl -fsSL https://raw.githubusercontent.com/alexzhang1030/rclweb/main/scripts/install-rclwebd.sh | bash
```

## Artifact

One support row per process ([ADR 0008](./adr/0008-one-adapter-row-per-gateway-process.md)).
The Fast DDS reference rows have dedicated images; the Cyclone DDS and Zenoh
rows build from the same two Dockerfiles with the row identity baked in:

```bash
just image-rclwebd          # docker build -t rclwebd:j-ft
just gateway                # host-network compose (J-FT)
just gateway-wt             # same + intranet WebTransport (rebuilds)
just image-rclwebd-h-ft     # docker build -t rclwebd:h-ft (regenerates FFI)
just gateway-h-ft           # host-network compose (H-FT)
just gateway-wt-h-ft        # H-FT + intranet WebTransport (rebuilds)
just image-rclwebd-row j-cy # rclwebd:j-cy (also j-zn, h-cy, h-zn)
just gateway-row j-zn       # host-network compose; zn rows start rmw_zenohd
```

All images are multi-stage: builder compiles `rclwebd --features ros,webtransport`, runtime
is the digest-pinned ROS base plus the binary, running as uid `10001`.
`HEALTHCHECK` probes `GET /readyz`. Extra ROS interface packages must be
installed in the image or mounted into `ROS_PREFIX` — typesupport is dlopen,
not link-time. Remaining-row images install the row's RMW apt package in the
runtime stage (`RMW_APT_PACKAGES` build arg) and bake `RCLWEBD_SUPPORT_ROW` /
`RMW_IMPLEMENTATION` (`SUPPORT_ROW` / `RMW_IMPLEMENTATION` build args); the
adapter probe refuses start-up when the pair is inconsistent.

The Humble builders regenerate vendored rcl bindings against Humble headers
before linking. Do not run an `H-*` binary against a Jazzy prefix (or the
reverse).

The entrypoint sources `$ROS_PREFIX/setup.bash` (`J-*` default
`/opt/ros/jazzy`, `H-*` `/opt/ros/humble`).

**Zenoh rows** (`J-ZN` / `H-ZN`) need a running `rmw_zenohd` router reachable
from the gateway (default `tcp/localhost:7447`; discovery is router gossip).
[`docker/compose.r4-02-gateway-rmw.yml`](../docker/compose.r4-02-gateway-rmw.yml)
starts a router companion from the same image and sets
`ZENOH_ROUTER_CHECK_ATTEMPTS` so the gateway retries while the router boots.
For an existing robot router, point the gateway at it with the standard
`rmw_zenoh` configuration (`ZENOH_CONFIG_OVERRIDE` / config URI) instead of
running the companion.

## Listen address

| Context | Default |
|---|---|
| Host binary | `RCLWEBD_BIND=127.0.0.1:8794` |
| Container entrypoint | `0.0.0.0:8794` |

Do not treat a container publish of 8794 as TLS. Put a reverse proxy in front
for production WSS / HTTPS. Local-dev WebTransport TLS stays opt-in
([ADR 0011](./adr/0011-local-dev-webtransport-tls.md)) and must not be the
default on this image. Images compile the accept loop; they do not enable it.

## Intranet WebTransport

Robot LAN / lab path. Not production PKI. Chromium only.

On the robot (host-network compose already shares UDP):

```bash
just gateway-wt
# or, on any image built from these Dockerfiles:
#   RCLWEBD_OFFER_WEBTRANSPORT=1
```

That one flag implies local-dev TLS, CORS `*` when `RCLWEBD_CORS_ORIGINS` is
unset, and a WebTransport UDP bind on the HTTP bind host at port 4433
(`0.0.0.0:8794` → `0.0.0.0:4433`). Set `RCLWEBD_WT_BIND` only to override.

On the laptop, serve the page from `http://127.0.0.1` or `http://localhost`
(those are secure contexts). Point the SDK at the robot:

```ts
await init("https://192.168.1.10:4433/", { transport: "webtransport" });
```

The package fetches `http://192.168.1.10:8794/local-dev/tls` for
`serverCertificateHashes` (default WT `4433` maps to HTTP `8794`). Custom
ports need `localDevTlsOrigin`. The subscribe-chatter demo does the same
rewrite when `RCLWEB_TRANSPORT=webtransport` or the URL is `https://`.

`http://192.168.x.x` is **not** a secure context; `WebTransport` will not
construct. Opening the page via a LAN IP needs page HTTPS (proxy / future
PKI) — that is the [production TLS](../tasks/plan.md) follow-up, not this
recipe. UDP 4433 must be reachable from the laptop.

Remaining-row compose services are not named `rclwebd`; set
`RCLWEBD_OFFER_WEBTRANSPORT=1` on that service instead of the J-FT/H-FT
overlay.

## Identity and row

Set `RCLWEBD_GATEWAY_INSTANCE_ID` to a stable deployment id if the instance
should survive ordinary restart. Unset keeps a random id (a replacement
instance every process start). Pair `RCLWEBD_SUPPORT_ROW` with the matching
prefix (`J-*` ↔ `/opt/ros/jazzy`, `H-*` ↔ `/opt/ros/humble`) and keep
`RMW_IMPLEMENTATION` on the row's RMW — the adapter probe fails start-up on a
mismatch. When `RCLWEBD_SUPPORT_ROW` is unset (host binaries; the container
entrypoint bakes the row), the process derives it from the sourced
environment: `ROS_DISTRO` plus `RMW_IMPLEMENTATION` (Fast DDS default),
falling back to J-FT without a sourced environment
([ADR 0018](./adr/0018-prebuilt-gateway-distribution.md)). `ROS_DOMAIN_ID`
selects the domain.

Authenticate stays **off**. Do not set `RCLWEBD_AUTH_MODE=oidc` until a tenant is named ([security](./security.md), [open work](../tasks/plan.md)).

Channel ACLs stay **off** unless `RCLWEBD_ACL_MODE=enforce` plus `RCLWEBD_ACL` or `RCLWEBD_ACL_PATH`. The reference matrix is [acl-reference.json](./acl-reference.json).

## Operations endpoints

| Method | Path | Role |
|---|---|---|
| GET | `/healthz` | Liveness. Plain `ok` when local-dev TLS is off. 200 during drain. The e2e harness treats that exact body as “gateway is up”. |
| GET | `/livez` | Liveness JSON. 200 during drain. |
| GET | `/readyz` | Readiness JSON. 503 after drain. Use this for load balancers. |
| GET | `/configz` | Non-secret config (row, domain, auth mode, budgets). No OIDC secrets. |
| GET | `/telemetryz` | JSON copy/disposition counters. |
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

[`docker/compose.r4-02-gateway.yml`](../docker/compose.r4-02-gateway.yml) (J-FT),
[`docker/compose.r4-02-gateway-h-ft.yml`](../docker/compose.r4-02-gateway-h-ft.yml)
(H-FT), and [`docker/compose.r4-02-gateway-rmw.yml`](../docker/compose.r4-02-gateway-rmw.yml)
(J-CY / J-ZN / H-CY / H-ZN plus zenoh router companions) use
`network_mode: host` so the RMW can see the robot domain. That is a local /
robot-edge shape, not a cloud overlay network.
[`docker/compose.webtransport.yml`](../docker/compose.webtransport.yml) overlays
`RCLWEBD_OFFER_WEBTRANSPORT=1` on the `rclwebd` service (`just gateway-wt` /
`just gateway-wt-h-ft`).

## Follow-ups

Production PKI, remote metrics/trace export, Kubernetes or systemd units,
and upgrade/rollback playbooks remain [open work](../tasks/plan.md).
SROS2 is parked while auth is out of scope.
