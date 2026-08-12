# Gotchas

Traps already paid for in this repository, each with its why.

## One gateway process binds one support row

`rclwebd` carries a single [`SupportRow`](../../rclwebd/src/config.rs) for the process lifetime ([ADR 0008](../../docs/adr/0008-one-adapter-row-per-gateway-process.md)). `RCLWEBD_SUPPORT_ROW` selects `J-FT` (default) or `H-FT`. Mixing rows in one process is unsupported — run separate gateways and compose SDK sessions. H-FT OpenChannel uses `moonspan-schema-v1`; J-FT uses `rep2011-rihs`. Wrong-row OpenChannel fails with wire code 25 (`support_row_mismatch`). Pair the row with the linked ROS prefix (`J-FT` ↔ `/opt/ros/jazzy`, `H-FT` ↔ `/opt/ros/humble`); the H-FT live image regenerates vendored FFI against Humble before `cargo build --features ros` so layouts match that distro. Startup also probes adapter ABI `serialized-adapter-v1` against the row/distro ([R3-04](../../docs/milestones/r3-04-adapter-abi-typesupport.md)).

## Authenticate defaults to off

R4-01 can evaluate Authenticate, but `RCLWEBD_AUTH_MODE` defaults to `off`: any credential is accepted, SessionReady field 21 stays `anonymous`, and no audit line is emitted — same as R1–R3. `dev` is an alias for `off`. Opt in with `oidc` plus issuer/audience/keys; missing keys fail process start, bad JWT is wire code 26. Do not treat a green e2e lane as proof that identity is on. Tenant choice remains D-04 ([R4-01](../../docs/milestones/r4-01-oidc-sros2-audit.md)).

## Typesupport is dlopen, not link-time

R3-04 dropped the R1 static link of `std_msgs` / `sensor_msgs` typesupport from `rclwebd/build.rs`. At runtime the ROS thread `dlopen`s `lib{pkg}__rosidl_typesupport_c.so` and `lib{pkg}__rosidl_generator_c.so` under `ROS_PREFIX/lib` (or `AMENT_PREFIX_PATH`). A missing package yields wire code 10 (`schema_unavailable`) the same as the old static miss — install the interface package in the image/environment rather than adding a link line. Service/action live paths also need those packages (for example `example_interfaces` for the AddTwoInts and Fibonacci loopbacks in `just ros-test`).

## Same-thread ROS loopback must pump

`RclBackend` owns every rcl entity on one thread. A blocking service `call` or action `send_goal_result` on that thread never returns unless the matching server is pumped in the wait loop (`call_with_pump` / `send_goal_result_with_pump` drain commands and take requests). Without the pump, same-process loopback tests hang until the call timeout. Cross-process ROS clients do not need this; they wait on their own wait set while the gateway thread pumps normally.

## Action client wait-set ready is not the first client slot

`rcl_action_wait_set_add_action_client` inserts three service clients (goal, cancel, result). The returned `client_index` is only the start of that span. Treating `wait_set.clients[client_index]` as “the action client is ready” sees SendGoal responses and misses GetResult/Cancel. After `rcl_wait`, take the specific response and treat `RCL_RET_ACTION_CLIENT_TAKE_FAILED` as empty.

## Every sample lease has exactly one owner

The engine reclaims a retained inbound slab only when every lease on it is released (`sweep_released` in `rclweb/src/engine/mod.rs` frees a buffer once ingest is done and its lease refcount hits zero). Any host or SDK code path that drops a sample without delivering it MUST release the lease at the drop site — otherwise the slab is pinned forever. The original R1-04 SDK leaked on three drop paths: the Worker's non-String sample branch and the no-handler branch in both `InlineClient` and `WorkerClient`. The no-handler race is reachable in normal operation because `subscribed` and the first samples can arrive in the same poll flush, before the application has called `onMessage`. Fixed in this change, with regression coverage in `sdk/typescript/test/sdk-poll.test.ts` (no-handler sample: `leasesReleased` must equal `samplesEmitted`).

## encodeHostBatch large-frame encoder

Spread-pushing a byte array into a `number[]` (`out.push(...bytes)`) throws a RangeError on large frames — every element becomes a call argument, and hundreds of KB / ~1 MiB (R2-02 PointCloud2 scale) exceeds the engine's argument/call-stack limit. `encodeHostBatch` in `sdk/typescript/src/wasm/abi.ts` is a two-pass preallocated `Uint8Array` encoder (size, then write). Do not reintroduce `push(...bytes)` or per-byte `number[]` builders on the data path. Large WS frames (≥64 KiB) also take the external-ptr poll path so the engine can own the wasm allocation without a second deep copy.

## WebTransport local certs are ≤14 days by browser rule

`serverCertificateHashes` rejects certificates whose validity window exceeds 14 days. Local-dev TLS therefore auto-mints short-lived ECDSA P-256 certs and **rotates** (default lifetime 7 days, remint when <24h remain); it does not lengthen the cert. After notAfter, new handshakes fail closed until rotate/restart. See [ADR 0011](../../docs/adr/0011-local-dev-webtransport-tls.md).

## Reconnect is a fresh session, not SessionResume

v0.1 parks SessionResume (capability 1). R2-01 reconnect means: close the transport, allocate a new client engine, re-run ClientHello → Authenticate → SessionReady, then re-open channels. The SDK `reconnect()` / `ConnectOptions.reconnect` path implements that; do not invent resume tokens or expect `gateway_instance_id` alone to restore channel state.

## GraphSnapshot follows SessionReady on the gateway

After Authenticate succeeds, `rclwebd` pushes SessionReady and then GraphSnapshot (generation 1, zero correlation) before any OpenChannel. Clients that only drain SessionReady will see GraphSnapshot as the next control frame and mis-attribute ChannelReady. Topic OpenChannel success also emits GraphDelta (generation N+1) when the mock/backend graph gains an endpoint. Drain both before expecting samples.

## ROS_RELIABLE on Service/Action frames

R3-01 reliable operation streams (SERVICE_REQUEST/RESPONSE, ACTION_GOAL/CANCEL/RESULT) carry `FLAG_ROS_RELIABLE`. Frame step 7 still rejects that flag on media/recording/asset/control opcodes; the malformed fixture `frame-step7-ros-reliable-opcode` uses MEDIA_CHUNK for that check (not SERVICE_REQUEST).

## Service/action poll events carry payload views

App events 13–14 and 17–20 include `lease_id` plus `payload_ptr`/`payload_len` (same lease model as Sample). The abbreviated command layouts omit those ptr fields; without them the wasm host cannot copy request/response bodies. TS must release the lease after `IoHost.copyPayload`.

## Phase 1 schema metadata JSON shape

`rclweb/generated/metadata/` is produced by `scripts/generated-types.ts`. Rust embeds four files via `include_str!`:

- `descriptors.json` → top-level `roots[]` (`descriptor_id`, `type_name`, …)
- `identities.json` → `identities[]`
- `wire_profiles.json` → `profiles[]` with `cdr_representation` as `"CDR_LE"` / `"CDR_BE"`
- `provenance.json` → `mappings[]`

Do not rename those array keys without updating both the Bun generator and `rclweb/src/types/registry.rs`. `normalized_sources.json` is generator-only and is not loaded by the Rust registry.

## Sectioned corpus roots are graph endpoints without source rows

Canonical CDR bundles for `*_Request` / `*_Response` / `*_Goal` / `*_Result` / `*_Feedback` store interface text under the parent `.srv` / `.action` type, while `dependency_graph` edges use the sectioned `root_type_name` as `from`. M1-02b join validation must accept `root_type_name` as a known endpoint alongside `sources[].type_name`; requiring every `from` to appear in `sources` rejects the committed Phase 1 corpus.
