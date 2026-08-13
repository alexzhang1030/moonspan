# Gotchas

Traps already paid for in this repository, each with its why.

## One gateway process binds one support row

`rclwebd` carries a single [`SupportRow`](../../rclwebd/src/config.rs) for the process lifetime ([ADR 0008](../../docs/adr/0008-one-adapter-row-per-gateway-process.md)). `RCLWEBD_SUPPORT_ROW` selects `J-FT` (default) or `H-FT`. Mixing rows in one process is unsupported — run separate gateways and compose SDK sessions. H-FT OpenChannel uses `rclweb-schema-v1`; J-FT uses `rep2011-rihs`. Wrong-row OpenChannel fails with wire code 25 (`support_row_mismatch`). Pair the row with the linked ROS prefix (`J-FT` ↔ `/opt/ros/jazzy`, `H-FT` ↔ `/opt/ros/humble`); the H-FT live image regenerates vendored FFI against Humble before `cargo build --features ros` so layouts match that distro. Startup also probes adapter ABI `serialized-adapter-v1` against the row/distro ([R3-04](../../docs/milestones/r3-04-adapter-abi-typesupport.md)).

## Authenticate defaults to off

R4-01 can evaluate Authenticate, but `RCLWEBD_AUTH_MODE` defaults to `off`: any credential is accepted, SessionReady field 21 stays `anonymous`, and no audit line is emitted — same as R1–R3. `dev` is an alias for `off`. Opt in with `oidc` plus issuer/audience/keys; missing keys fail process start, bad JWT is wire code 26. Do not treat a green e2e lane as proof that identity is on. Tenant choice remains D-04 ([R4-01](../../docs/milestones/r4-01-oidc-sros2-audit.md)). Landed in [`301c987`](https://github.com/alexzhang1030/rclweb/commit/301c987) (#18).

## `/healthz` is liveness, not readiness

`GET /healthz` must stay HTTP 200 with body `ok` (when local-dev TLS is off) even while the process is draining. The R1-05 e2e harness treats that exact body as “gateway is up”. Load balancers and deploy hooks must probe `GET /readyz` (503 after `POST /drain` / SIGTERM) and must not treat `/healthz` as admission. `/livez` is the JSON liveness twin. [R4-02](../../docs/milestones/r4-02-deployment-observability.md).

## Gateway tests must not install ctrl_c on `serve`

`axum::serve(...).with_graceful_shutdown(ctrl_c)` inside the test helper made raw HTTP/1.1 GETs (`/healthz`, `/readyz`) complete the TCP handshake and then read zero bytes. WebSocket upgrades on the same listener still worked, so protocol tests stayed green. `serve()` now runs until the task is dropped; the daemon calls `serve_with_os_signals` for SIGTERM drain. Reproduce with `cargo test --locked -p rclwebd --test ws_gateway healthz_stays_plain_ok`.

## Pixi ros-test must pin ROS_PREFIX over a host /opt/ros

`just ros-test-pixi` exists for machines without apt ROS, but a host `/opt/ros/jazzy` on `PATH` / `LD_LIBRARY_PATH` makes link, dlopen, and `ros2 topic pub` silently use the apt prefix — mixed apt + RoboStack FastDDS then hangs the live talker e2e (GraphSnapshot / discovery) instead of failing cleanly. `scripts/pixi-ros-activate.sh` pins `ROS_PREFIX` / `AMENT_PREFIX_PATH` to `$CONDA_PREFIX`, sets `LD_LIBRARY_PATH` to that `lib` only, and forces `ROS_AUTOMATIC_DISCOVERY_RANGE=LOCALHOST` (RoboStack's activate.d defaults to `SUBNET`). The pixi env includes `ros2cli` / `ros2topic` so the talker is the same prefix. `docs-check` skips `.pixi/` so a local install does not poison `just check`. RoboStack Jazzy is still not a substitute for digest-pinned Docker e2e (`just e2e` / `just e2e-h-ft`). Landed in [`25fb42f`](https://github.com/alexzhang1030/rclweb/commit/25fb42f) (#20); reproduce with `just ros-test-pixi`.

## Typesupport is dlopen, not link-time

R3-04 dropped the R1 static link of `std_msgs` / `sensor_msgs` typesupport from `rclwebd/build.rs`. At runtime the ROS thread `dlopen`s `lib{pkg}__rosidl_typesupport_c.so` and `lib{pkg}__rosidl_generator_c.so` under `ROS_PREFIX/lib` (or `AMENT_PREFIX_PATH`). A missing package yields wire code 10 (`schema_unavailable`) the same as the old static miss — install the interface package in the image/environment rather than adding a link line. Service/action live paths also need those packages (for example `example_interfaces` for the AddTwoInts and Fibonacci loopbacks in `just ros-test`).

## Same-thread ROS loopback must pump

`RclBackend` owns every rcl entity on one thread. A blocking service `call` or action `send_goal_result` on that thread never returns unless the matching server is pumped in the wait loop (`call_with_pump` / `send_goal_result_with_pump` drain commands and take requests). Without the pump, same-process loopback tests hang until the call timeout. Cross-process ROS clients do not need this; they wait on their own wait set while the gateway thread pumps normally.

## Action client wait-set ready is not the first client slot

`rcl_action_wait_set_add_action_client` inserts three service clients (goal, cancel, result). The returned `client_index` is only the start of that span. Treating `wait_set.clients[client_index]` as “the action client is ready” sees SendGoal responses and misses GetResult/Cancel. After `rcl_wait`, take the specific response and treat `RCL_RET_ACTION_CLIENT_TAKE_FAILED` as empty.

## Every sample lease has exactly one owner

The engine reclaims a retained inbound slab only when every lease on it is released (`sweep_released` in `rclweb/src/engine/mod.rs` frees a buffer once ingest is done and its lease refcount hits zero). Any host or SDK code path that drops a sample without delivering it MUST release the lease at the drop site — otherwise the slab is pinned forever. The original R1-04 SDK leaked on three drop paths: the Worker's non-String sample branch and the no-handler branch in both `InlineClient` and `WorkerClient`. The no-handler race is reachable in normal operation because `subscribed` and the first samples can arrive in the same poll flush, before the application has called `onMessage`. Fixed in this change, with regression coverage in `sdk/typescript/test/sdk-poll.test.ts` (no-handler sample: `leasesReleased` must equal `samplesEmitted`). PointCloud2 delivery on the Worker copies `data` and releases at that copy site. Generated corpus messages are copied as host-value objects and released the same way. Unknown non-String types still drop-and-release. The public `Node` API releases after the user callback ([Public Node releases leases](#public-node-releases-leases)); `@rclweb/sdk/internal` `connect` still requires an explicit `lease.release()`.

## Public Node releases leases

`@rclweb/sdk` is rclcpp-shaped (`init` / `Node` / `createSubscription`). Message types are `std_msgs.msg.String` / `sensor_msgs.msg.PointCloud2` / `rclweb_cdr_interfaces.msg.*`, not all-caps constants. The callback receives an owned message; `Node` copies PointCloud2 `data` and calls `lease.release()` after the callback returns. Applications must not import `@rclweb/sdk/internal` `connect` unless they are hosting the poll ABI — that path still requires an explicit release. [R4-04](../../docs/milestones/r4-04-sdk.md).

## encodeHostBatch large-frame encoder

Spread-pushing a byte array into a `number[]` (`out.push(...bytes)`) throws a RangeError on large frames — every element becomes a call argument, and hundreds of KB / ~1 MiB (R2-02 PointCloud2 scale) exceeds the engine's argument/call-stack limit. `encodeHostBatch` in `sdk/typescript/src/wasm/abi.ts` is a two-pass preallocated `Uint8Array` encoder (size, then write). Do not reintroduce `push(...bytes)` or per-byte `number[]` builders on the data path. Large WS frames (≥64 KiB) also take the external-ptr poll path so the engine can own the wasm allocation without a second deep copy.

## WebTransport local certs are ≤14 days by browser rule

`serverCertificateHashes` rejects certificates whose validity window exceeds 14 days. Local-dev TLS therefore auto-mints short-lived ECDSA P-256 certs and **rotates** (default lifetime 7 days, remint when <24h remain); it does not lengthen the cert. After notAfter, new handshakes fail closed until rotate/restart. See [ADR 0011](../../docs/adr/0011-local-dev-webtransport-tls.md).

## Reconnect is a fresh session, not SessionResume

v0.1 parks SessionResume (capability 1). R2-01 reconnect means: close the transport, allocate a new client engine, re-run ClientHello → Authenticate → SessionReady, then re-open channels **with the same client-assigned channel IDs**. Subscribe, publish, service, and action objects keep working; in-flight service calls and action results reject with `"session reconnected"`. The SDK `reconnect()` / `ConnectOptions.reconnect` path implements that on both the I/O Worker and the inline host. Do not invent resume tokens, allocate new channel IDs, or expect `gateway_instance_id` alone to restore channel state.

## Worker telemetry is the last poll snapshot

`WorkerClient.telemetry()` used to return `null` because engine counters lived only inside the Worker. `IoHost` now posts a telemetry message at the end of each poll, before sample/op events, and main caches the latest snapshot. The API stays synchronous. Do not block delivery on a telemetry round-trip, and do not read wasm counters from the main thread. [R4-04](../../docs/milestones/r4-04-sdk.md).

## GraphSnapshot follows SessionReady on the gateway

After Authenticate succeeds, `rclwebd` pushes SessionReady and then GraphSnapshot (generation 1, zero correlation) before any OpenChannel. Clients that only drain SessionReady will see GraphSnapshot as the next control frame and mis-attribute ChannelReady. Topic OpenChannel success also emits GraphDelta (generation N+1) when the mock/backend graph gains an endpoint. Drain both before expecting samples.

## Public Node graph hides GraphSnapshot JSON

`GraphView` (`generation`, `domain_id`, numeric endpoint `kind`) is `@rclweb/sdk/internal`. Applications use rclcpp names on `Node`: `getNodeNames`, `getTopicNamesAndTypes`, `getServiceNamesAndTypes`, `getActionNamesAndTypes`, `countPublishers`, `countSubscribers`, and `onGraphChange`. Do not export GraphSnapshot field numbers or `session.onGraph` on `@rclweb/sdk`. [R4-04](../../docs/milestones/r4-04-sdk.md).

## Scripted GraphSnapshot endpoints must be complete control maps

An empty GraphSnapshot endpoint array is valid. A partial endpoint (name/kind/type only) fails control validation (`missing_key` on schema identity, QoS, and encoding), so the engine never emits the app event and SDK graph tests hang. Scripted peers must use the same endpoint map as the gateway: id, node id, name, kind, type name, schema identity, CDR encoding, QoS (kinds 0–3), domain, optional row. Endpoints are sorted by id bytes. Reproduce with `cargo run --locked -p r1_04_fixture_gen`.

## ROS_RELIABLE on Service/Action frames

R3-01 reliable operation streams (SERVICE_REQUEST/RESPONSE, ACTION_GOAL/CANCEL/RESULT) carry `FLAG_ROS_RELIABLE`. Frame step 7 still rejects that flag on media/recording/asset/control opcodes; the malformed fixture `frame-step7-ros-reliable-opcode` uses MEDIA_CHUNK for that check (not SERVICE_REQUEST).

## Service/action poll events carry payload views

App events 13–14 and 17–20 include `lease_id` plus `payload_ptr`/`payload_len` (same lease model as Sample). The abbreviated command layouts omit those ptr fields; without them the wasm host cannot copy request/response bodies. TS must release the lease after `IoHost.copyPayload`. The I/O Worker copies those bytes and releases the lease before `postMessage` so main never holds a wasm pointer ([R4-04](../../docs/milestones/r4-04-sdk.md)).

## Worker PointCloud2 copies `data`, inline borrows it

`rclweb_point_cloud2_meta` returns metadata plus an offset/len into the leased CDR. On `options.inline: true` the host hands a TypedArray into wasm memory (copy-budget 0 wasm→application; valid until `lease.release()`). The I/O Worker cannot share that memory with main without SAB, so it copies only the `data` field, releases the lease, and transfers the ArrayBuffer — same class of boundary copy as service/action CDR. The public `Node` callback always owns a copy and never sees the lease. Do not copy the whole CDR payload, and do not keep the lease outstanding after a Worker copy (a 1 MiB cloud would then pin wasm *and* hold a JS copy). [R4-04](../../docs/milestones/r4-04-sdk.md), [architecture](../../docs/architecture.md#performance-contracts).

## PointCloud2 header and fields travel on the host command

`CMD_SEND_POINT_CLOUD2` carries stamp, `frame_id`, and the PointField list with the point `data`. Do not reintroduce XYZ synthesis from `field_count == 3` — that dropped `frame_id` and made republish lie. Inbound `rclweb_point_cloud2_meta` writes the same header/fields after the numeric prefix; point `data` stays an offset/len view. [R4-04](../../docs/milestones/r4-04-sdk.md).

## Generated corpus messages use a packed host layout

Phase 1 msg roots (`PrimitiveScalars`, `Collections`, `NestedSample`) and the sectioned service/action types (`EchoNested_{Request,Response}`, `MeasureSequence_{Goal,Result,Feedback}`) cross the poll ABI as packed little-endian host-value bytes, not CDR and not JSON. Topics use `CMD_SEND_GENERATED` / `rclweb_decode_generated`. Service and action poll cmds stay opaque payload bytes: if the OpenChannel parent is generated, the engine converts host-value ↔ CDR with the generated codecs; otherwise the payload stays CDR (`AddTwoInts`, Fibonacci). Do not put that layout, CMD 18, or `rclweb_decode_generated` on `@rclweb/sdk`. Applications use `rclweb_cdr_interfaces.msg.*` / `.srv.EchoNested` / `.action.MeasureSequence`. `int64` / `uint64` are `bigint`. The I/O Worker must key inbound samples **and** service/action channels by `typeName` — guessing PointCloud2 for every non-String sample drops generated CDR, and guessing CDR for EchoNested breaks `Node` decode. [R4-04](../../docs/milestones/r4-04-sdk.md).

## Phase 1 schema metadata JSON shape

`rclweb/generated/metadata/` is produced by `scripts/generated-types.ts`. Rust embeds four files via `include_str!`:

- `descriptors.json` → top-level `roots[]` (`descriptor_id`, `type_name`, …)
- `identities.json` → `identities[]`
- `wire_profiles.json` → `profiles[]` with `cdr_representation` as `"CDR_LE"` / `"CDR_BE"`
- `provenance.json` → `mappings[]`

Do not rename those array keys without updating both the Bun generator and `rclweb/src/types/registry.rs`. `normalized_sources.json` is generator-only and is not loaded by the Rust registry.

## Sectioned corpus roots are graph endpoints without source rows

Canonical CDR bundles for `*_Request` / `*_Response` / `*_Goal` / `*_Result` / `*_Feedback` store interface text under the parent `.srv` / `.action` type, while `dependency_graph` edges use the sectioned `root_type_name` as `from`. M1-02b join validation must accept `root_type_name` as a known endpoint alongside `sources[].type_name`; requiring every `from` to appear in `sources` rejects the committed Phase 1 corpus.

## GitHub Releases downloads need retries

Foundation CI installs Bun with SHA-pinned `oven-sh/setup-bun` (`.bun-version`) and just with SHA-pinned `extractions/setup-just` (`.just-version`); a failed just step waits 15s and retries once. `dtolnay/rust-toolchain` installs the channel in `rust-toolchain.toml`. E2e images copy `/usr/local/bin/bun` from digest-pinned `oven/bun` (must match `.bun-version`); do not pipe `bun.sh/install`. Cloud-agent setup has no Actions, so it uses [`scripts/install-pinned-bun.sh`](../../scripts/install-pinned-bun.sh) and [`scripts/github-release-curl.sh`](../../scripts/github-release-curl.sh). Paid flakes were GitHub Releases 503/curl 56, not a broken setup-just. Landed in [`45cacd5`](https://github.com/alexzhang1030/rclweb/commit/45cacd5) (#19).

## release-wasm inherits native release settings

`[profile.release-wasm] inherits = "release"`. Adding `strip`, `lto`, or panic settings to native release also applies to the wasm ship profile unless that key is set again on `release-wasm`. Putting `strip = "symbols"` on native release dropped staged `rclweb.wasm` from 593631 bytes to 376519. Keep fat LTO, `panic = abort`, `opt-level = "z"`, and `strip` explicit on `release-wasm`. Reproduce with `just build` (it prints the staged size).

## SDK Worker URL follows the script extension

`new Worker(new URL("./worker/io-worker.ts", import.meta.url))` is correct for Bun workspace source and wrong after `bun build` writes `dist/index.js`. The sibling in `dist/` is `io-worker.js`. `resolveIoWorkerUrl` picks `.ts` vs `.js` from the loading script. Do not hardcode `.ts`. [R4-04](../../docs/milestones/r4-04-sdk.md).

## Bundle files are named by type

Canonical bundles live at `conformance/cdr/fixtures/bundles/<type with / → .>.json` (for example `rclweb_cdr_interfaces.msg.PrimitiveScalars.json`). Humble `SchemaKey.value` is still the SHA-256 of those bytes — that digest is a wire field, not a filename. Renaming scheme/package strings inside the JSON changes the digest; do not Docker `--write` the corpus for a name change. [ADR 0012](../../docs/adr/0012-rclweb-schema-identifiers.md).

## Do not commit measurement JSON

The owner deleted `docs/evidence/*.json`. Nothing in CI read those files. `just build` used to rewrite `recordedAt` on a wasm-size file, dirtying the tree. Qualification is a human edit of the [support matrix](../../docs/support-matrix.md). Measurement recipes (`just poll-latency`, `just large-message`, `just perf-baseline`) print to stdout. Do not add an evidence-check job. [R4-03](../../docs/milestones/r4-03-support-matrix.md).

## Do not wrap cargo tests in a Docker mock lane

R3-03 added `docker/compose.r3-03-h-ft.yml` whose image only re-ran `cargo test` inside `rust:1.97.1`. Foundation already runs those tests via `just test`. The CI job was `workflow_dispatch`-only, so it never gated. Live Humble remains [`docker/compose.r3-03-h-ft-e2e.yml`](../../docker/compose.r3-03-h-ft-e2e.yml). Do not add a compose file whose only command is cargo tests the workspace already runs.
