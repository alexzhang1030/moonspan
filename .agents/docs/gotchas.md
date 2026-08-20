# Gotchas

Traps already paid for in this repository, each with its why.

## One gateway process binds one support row

`rclwebd` carries a single [`SupportRow`](../../rclwebd/src/config.rs) for the process lifetime ([ADR 0008](../../docs/adr/0008-one-adapter-row-per-gateway-process.md)). `RCLWEBD_SUPPORT_ROW` selects any of the six rows (`J-FT` default; `J-CY`, `J-ZN`, `H-FT`, `H-CY`, `H-ZN`). Mixing rows in one process is unsupported — run separate gateways and compose TypeScript sessions. `H-*` OpenChannel uses `rclweb-schema-v1`; `J-*` uses `rep2011-rihs`. Wrong-row OpenChannel fails with wire code 25 (`support_row_mismatch`). Pair the row with the linked ROS prefix (`J-*` ↔ `/opt/ros/jazzy`, `H-*` ↔ `/opt/ros/humble`); the Humble live images regenerate vendored FFI against Humble before `cargo build --features ros` so layouts match that distro. Startup probes adapter ABI `serialized-adapter-v1` against the row/distro **and** requires `RMW_IMPLEMENTATION` to name the row's RMW — unset means the shim loads Fast DDS, so a `*-CY` / `*-ZN` row without the env fails start-up instead of silently running Fast DDS. Zenoh rows additionally need `ros2 run rmw_zenoh_cpp rmw_zenohd` running before any node (router-gossip discovery); the e2e entrypoints start it and wait for tcp/7447.

## Authenticate defaults to off

`RCLWEBD_AUTH_MODE` defaults to `off`: any credential is accepted, SessionReady field 21 stays `anonymous`, and no audit line is emitted. `dev` is an alias for `off`. Opt in with `oidc` plus issuer/audience/keys; missing keys fail process start, bad JWT is wire code 26. Do not treat a green e2e lane as proof that identity is on. A named OIDC tenant and SROS2 keystore are out of scope ([open work](../../tasks/plan.md)); leave auth `off`. Landed in [`301c987`](https://github.com/alexzhang1030/rclweb/commit/301c987) (#18).

## ACLs default to off; enforce is default-deny

`RCLWEBD_ACL_MODE` defaults to `off`: every OpenChannel is admitted — a green e2e lane proves nothing about authorization. `enforce` flips to **default-deny**: only `{subjects, operations, names}` allow rules admit a channel (wire code 12 `permission_denied` otherwise), and a missing/invalid policy fails process start. There are no deny rules — express policy as allows. The subject is whatever Authenticate produced (`anonymous` when auth is off), so ACLs work without OIDC but only distinguish users with it. The policy body never appears on `/configz` (rule count only). The reference matrix is [`docs/acl-reference.json`](../../docs/acl-reference.json) (wide client surface; still default-deny on unlisted publish/server names). Default process mode stays `off`. [security](../../docs/security.md).

## `/healthz` is liveness, not readiness

`GET /healthz` must stay HTTP 200 with body `ok` (when local-dev TLS is off) even while the process is draining. The e2e harness treats that exact body as “gateway is up”. Load balancers and deploy hooks must probe `GET /readyz` (503 after `POST /drain` / SIGTERM) and must not treat `/healthz` as admission. `/livez` is the JSON liveness twin. [Deploy](../../docs/deploy.md).

## Gateway tests must not install ctrl_c on `serve`

`axum::serve(...).with_graceful_shutdown(ctrl_c)` inside the test helper made raw HTTP/1.1 GETs (`/healthz`, `/readyz`) complete the TCP handshake and then read zero bytes. WebSocket upgrades on the same listener still worked, so protocol tests stayed green. `serve()` now runs until the task is dropped; the daemon calls `serve_with_os_signals` for SIGTERM drain. Reproduce with `cargo test --locked -p rclwebd --test ws_gateway healthz_stays_plain_ok`.

## Pixi ros-test must pin ROS_PREFIX over a host /opt/ros

`just ros-test-pixi` exists for machines without apt ROS, but a host `/opt/ros/jazzy` on `PATH` / `LD_LIBRARY_PATH` makes link, dlopen, and `ros2 topic pub` silently use the apt prefix — mixed apt + RoboStack FastDDS then hangs the live talker e2e (GraphSnapshot / discovery) instead of failing cleanly. `scripts/pixi-ros-activate.sh` pins `ROS_PREFIX` / `AMENT_PREFIX_PATH` to `$CONDA_PREFIX`, sets `LD_LIBRARY_PATH` to that `lib` only, and forces `ROS_AUTOMATIC_DISCOVERY_RANGE=LOCALHOST` (RoboStack's activate.d defaults to `SUBNET`). The pixi env includes `ros2cli` / `ros2topic` so the talker is the same prefix. `docs-check` skips `.pixi/` so a local install does not poison `just check`. RoboStack Jazzy is still not a substitute for digest-pinned Docker e2e (`just e2e` / `just e2e-h-ft`). Landed in [`25fb42f`](https://github.com/alexzhang1030/rclweb/commit/25fb42f) (#20); reproduce with `just ros-test-pixi`.

## Typesupport is dlopen, not link-time

`rclwebd/build.rs` does not statically link `std_msgs` / `sensor_msgs` typesupport. At runtime the ROS thread `dlopen`s `lib{pkg}__rosidl_typesupport_c.so` and `lib{pkg}__rosidl_generator_c.so` under `ROS_PREFIX/lib` (or `AMENT_PREFIX_PATH`). A missing package yields wire code 10 (`schema_unavailable`) — install the interface package in the image/environment rather than adding a link line. Service/action live paths also need those packages (for example `example_interfaces` for the AddTwoInts and Fibonacci loopbacks in `just ros-test`).

## Same-thread ROS loopback must pump

`RclBackend` owns every rcl entity on one thread. A blocking service `call` or action `send_goal_result` on that thread never returns unless the matching server is pumped in the wait loop (`call_with_pump` / `send_goal_result_with_pump` drain commands and take requests). Without the pump, same-process loopback tests hang until the call timeout. Cross-process ROS clients do not need this; they wait on their own wait set while the gateway thread pumps normally.

## Action client wait-set ready is not the first client slot

`rcl_action_wait_set_add_action_client` inserts three service clients (goal, cancel, result). The returned `client_index` is only the start of that span. Treating `wait_set.clients[client_index]` as “the action client is ready” sees SendGoal responses and misses GetResult/Cancel. After `rcl_wait`, take the specific response and treat `RCL_RET_ACTION_CLIENT_TAKE_FAILED` as empty.

## Every sample lease has exactly one owner

The engine reclaims a retained inbound slab only when every lease on it is released (`sweep_released` in `rclweb/src/engine/mod.rs` frees a buffer once ingest is done and its lease refcount hits zero). ROS_SAMPLE with no extension never enters wasm: the host pins the WebSocket `Uint8Array` in `hostLeases` until `lease.release()` (high-bit lease ids), and `telemetry()` overlays those host counts onto the wasm snapshot so `leasesReleased` still equals `samplesEmitted`. Any host or package code path that drops a sample without delivering it MUST release the lease at the drop site — otherwise the slab or host buffer is pinned forever. An earlier host leaked on three drop paths: the Worker's non-String sample branch and the no-handler branch in both `InlineClient` and `WorkerClient`. The no-handler race is reachable in normal operation because `subscribed` and the first samples can arrive in the same poll flush, before the application has called `onMessage`. Fixed, with regression coverage in `typescript/test/sdk-poll.test.ts` (no-handler sample: `leasesReleased` must equal `samplesEmitted`). PointCloud2 delivery on the Worker copies `data` and releases at that copy site. Generated corpus messages are copied as host-value objects and released the same way. Unknown non-String types still drop-and-release. The public `Node` API releases after the user callback ([Public Node releases leases](#public-node-releases-leases)); `rcl-web/internal` `connect` still requires an explicit `lease.release()`.

## Public Node releases leases

`rcl-web` is rclcpp-shaped (`init` / `Node` / `createSubscription`). Message types are `std_msgs.msg.String` / `sensor_msgs.msg.PointCloud2` / `rclweb_cdr_interfaces.msg.*`, not all-caps constants. The callback receives an owned message; `Node` copies PointCloud2 `data` and calls `lease.release()` after the callback returns. Applications must not import `rcl-web/internal` `connect` unless they are hosting the poll ABI — that path still requires an explicit release. [How to](../../docs/typescript.md), [API](../../docs/api.md).

## hostRetainPrefixLen peeks the R2WP header only

`hostRetainPrefixLen` in `typescript/src/wasm/abi.ts` reads version, opcode, big-endian `payload_len`, and `extension_len` to decide whether a frame is a complete application payload. ROS_SAMPLE with no extension never enters wasm — the host pins the WebSocket buffer until `lease.release()` (high-bit lease ids). When the host queue is idle, that pin-and-emit skips enqueue / `pollEngine` / `PollResult`; a sample that arrives while control is already queued stays ordered behind that flush. Do not grow this peek into a full JS R2WP codec, and do not route idle-queue samples back through the generic poll batch. Control, bootstrap, experimental opcodes, and samples with extensions still go through wasm. Landed with [ADR 0017](../../docs/adr/0017-host-retain-inbound-sample-payload.md).

## parse_frame must not build default FrameOptions on the sample path

`parse_frame` used to construct `FrameOptions::default()` (a `BTreeSet` of clock ids) on every call, then `unwrap_or`. The engine always passes `Some(&self.frame_options)`, but `Default` still ran, so every ROS_SAMPLE ingest paid that allocation. Build the fallback only in the `None` branch.

## encodeHostBatch large-frame encoder

Spread-pushing a byte array into a `number[]` (`out.push(...bytes)`) throws a RangeError on large frames — every element becomes a call argument, and hundreds of KB / ~1 MiB (PointCloud2 scale) exceeds the engine's argument/call-stack limit. `encodeHostBatch` in `typescript/src/wasm/abi.ts` is a two-pass preallocated `Uint8Array` encoder (size, then write). Do not reintroduce `push(...bytes)` or per-byte `number[]` builders on the data path. Live WS ingest uses `rclweb_poll_ws` (header prefix for application frames). `encodeHostBatch` stays for command-only batches and tests.

## Intranet WebTransport is one env, not production TLS

Runtime images compile `--features ros,webtransport` so
`RCLWEBD_OFFER_WEBTRANSPORT=1` can start the accept loop. E2e images stay
`--features ros` only. The flag implies local-dev TLS, CORS `*` when
`RCLWEBD_CORS_ORIGINS` is unset (a localhost page fetching
`http://robot:8794/local-dev/tls` is cross-origin), and a WT UDP bind on
the HTTP bind host at port 4433. Setting the env on an older image that
was built `ros`-only logs “WT accept deferred”.

The hash fetch is HTTP, not UDP: `httpOriginFromWebTransportUrl` maps
default WT `4433` to HTTP `8794`. Custom ports need `localDevTlsOrigin`.
`init("192.168.1.10")` (or the default `:8794` WS URL) upgrades to
WebTransport when the page is a secure context and `WebTransport`
exists; otherwise it uses WebSocket. Do not put the page on self-signed
HTTPS and do not ask operators to install mkcert — that is more trouble
than the fallback. `serverCertificateHashes` cannot trust a document in
the address bar. Production TLS stays open. Chromium only for WT; UDP
4433 must be reachable when WT is used. The WT hash check does not need
a LAN IP in the cert SAN. Recipe:
[Intranet WebTransport](../../docs/deploy.md#intranet-webtransport),
[Intranet certificates](../../docs/deploy.md#intranet-certificates).

## WebTransport local certs are ≤14 days by browser rule

`serverCertificateHashes` rejects certificates whose validity window exceeds 14 days. Local-dev TLS therefore auto-mints short-lived ECDSA P-256 certs and **rotates** (default lifetime 7 days, remint when <24h remain); it does not lengthen the cert. After notAfter, new handshakes fail closed until rotate/restart. See [ADR 0011](../../docs/adr/0011-local-dev-webtransport-tls.md).

## Reconnect is a fresh session, not SessionResume

v0.1 parks SessionResume (capability 1). Reconnect means: close the transport, allocate a new client engine, re-run ClientHello → Authenticate → SessionReady, then re-open channels **with the same client-assigned channel IDs**. Subscribe, publish, service, and action objects keep working; in-flight service calls and action results reject with `"session reconnected"`. The package `reconnect()` / `ConnectOptions.reconnect` path implements that on both the I/O Worker and the inline host. Do not invent resume tokens, allocate new channel IDs, or expect `gateway_instance_id` alone to restore channel state.

## Worker telemetry is the last poll snapshot

`WorkerClient.telemetry()` used to return `null` because engine counters lived only inside the Worker. `IoHost` posts a telemetry message at the end of each poll when `onPollEnd` is set (the Worker always sets it), before sample/op events, and main caches the latest snapshot. Inline hosts skip that read unless `onPollEnd` is set; `telemetry()` still reads wasm on demand. The API stays synchronous. Do not block delivery on a telemetry round-trip, and do not read wasm counters from the main thread.

## GraphSnapshot follows SessionReady on the gateway

After Authenticate succeeds, `rclwebd` pushes SessionReady and then GraphSnapshot (generation 1, zero correlation) before any OpenChannel. Clients that only drain SessionReady will see GraphSnapshot as the next control frame and mis-attribute ChannelReady. Topic OpenChannel success also emits GraphDelta (generation N+1) when the mock/backend graph gains an endpoint. Drain both before expecting samples.

## Public Node graph hides GraphSnapshot JSON

`GraphView` (`generation`, `domain_id`, numeric endpoint `kind`) is `rcl-web/internal`. Applications use rclcpp names on `Node`: `getNodeNames`, `getTopicNamesAndTypes`, `getServiceNamesAndTypes`, `getActionNamesAndTypes`, `countPublishers`, `countSubscribers`, and `onGraphChange`. Do not export GraphSnapshot field numbers or `session.onGraph` on `rcl-web`.

## Scripted GraphSnapshot endpoints must be complete control maps

An empty GraphSnapshot endpoint array is valid. A partial endpoint (name/kind/type only) fails control validation (`missing_key` on schema identity, QoS, and encoding), so the engine never emits the app event and graph tests hang. Scripted peers must use the same endpoint map as the gateway: id, node id, name, kind, type name, schema identity, CDR encoding, QoS (kinds 0–3), domain, optional row. Endpoints are sorted by id bytes. Reproduce with `cargo run --locked -p r1_04_fixture_gen`.

## ROS_RELIABLE on Service/Action frames

Reliable operation streams (SERVICE_REQUEST/RESPONSE, ACTION_GOAL/CANCEL/RESULT) carry `FLAG_ROS_RELIABLE`. Frame step 7 still rejects that flag on media/recording/asset/control opcodes; the malformed fixture `frame-step7-ros-reliable-opcode` uses MEDIA_CHUNK for that check (not SERVICE_REQUEST).

## Service/action poll events carry payload views

App events 13–14 and 17–20 include `lease_id` plus `payload_ptr`/`payload_len` (same lease model as Sample). The abbreviated command layouts omit those ptr fields; without them the wasm host cannot copy request/response bodies. TS must release the lease after `IoHost.copyPayload`. The I/O Worker copies those bytes and releases the lease before `postMessage` so main never holds a wasm pointer.

## Worker PointCloud2 copies `data`, inline borrows the WS buffer

Inbound PointCloud2 `data` is a view of the host-retained WebSocket buffer ([ADR 0017](../../docs/adr/0017-host-retain-inbound-sample-payload.md)). On `options.inline: true` that view is valid until `lease.release()`. The I/O Worker cannot share that buffer with main without SAB, so it copies only the `data` field, releases the lease, and transfers the ArrayBuffer — same class of boundary copy as service/action CDR. The public `Node` callback always owns a copy and never sees the lease. Do not copy the whole CDR payload, and do not keep the lease outstanding after a Worker copy (a 1 MiB cloud would then pin the WS buffer *and* hold a JS copy). [Architecture](../../docs/architecture.md#performance-contracts).

## PointCloud2 header and fields travel on the host command

`CMD_SEND_POINT_CLOUD2` carries stamp, `frame_id`, and the PointField list with the point `data`. Do not reintroduce XYZ synthesis from `field_count == 3` — that dropped `frame_id` and made republish lie. Inbound `rclweb_point_cloud2_meta` writes the same header/fields after the numeric prefix; point `data` stays an offset/len view.

## Generated corpus messages use a packed host layout

Generated msg roots (`PrimitiveScalars`, `Collections`, `NestedSample`) and the sectioned service/action types (`EchoNested_{Request,Response}`, `MeasureSequence_{Goal,Result,Feedback}`) cross the poll ABI as packed little-endian host-value bytes, not CDR and not JSON. Topics use `CMD_SEND_GENERATED` / `rclweb_decode_generated`. Service and action poll cmds stay opaque payload bytes: if the OpenChannel parent is generated, the engine converts host-value ↔ CDR with the generated codecs; otherwise the payload stays CDR (`AddTwoInts`, Fibonacci). Do not put that layout, CMD 18, or `rclweb_decode_generated` on `rcl-web`. Applications use `rclweb_cdr_interfaces.msg.*` / `.srv.EchoNested` / `.action.MeasureSequence`. `int64` / `uint64` are `bigint`. The I/O Worker must key inbound samples **and** service/action channels by `typeName` — guessing PointCloud2 for every non-String sample drops generated CDR, and guessing CDR for EchoNested breaks `Node` decode.

## Schema metadata JSON shape

`rclweb/generated/metadata/` is produced by `scripts/generated-types.ts`. Rust embeds four files via `include_str!`:

- `descriptors.json` → top-level `roots[]` (`descriptor_id`, `type_name`, …)
- `identities.json` → `identities[]`
- `wire_profiles.json` → `profiles[]` with `cdr_representation` as `"CDR_LE"` / `"CDR_BE"`
- `provenance.json` → `mappings[]`

Do not rename those array keys without updating both the Bun generator and `rclweb/src/types/registry.rs`. `normalized_sources.json` is generator-only and is not loaded by the Rust registry.

## Sectioned corpus roots are graph endpoints without source rows

Canonical CDR bundles for `*_Request` / `*_Response` / `*_Goal` / `*_Result` / `*_Feedback` store interface text under the parent `.srv` / `.action` type, while `dependency_graph` edges use the sectioned `root_type_name` as `from`. Join validation must accept `root_type_name` as a known endpoint alongside `sources[].type_name`; requiring every `from` to appear in `sources` rejects the committed corpus.

## GitHub Releases downloads need retries

Foundation CI installs Bun with SHA-pinned `oven-sh/setup-bun` (`.bun-version`) and just with SHA-pinned `extractions/setup-just` (`.just-version`); a failed just step waits 15s and retries once. `dtolnay/rust-toolchain` installs the channel in `rust-toolchain.toml`. E2e images copy `/usr/local/bin/bun` from digest-pinned `oven/bun` (must match `.bun-version`); do not pipe `bun.sh/install`. Cloud-agent setup has no Actions, so it uses [`scripts/install-pinned-bun.sh`](../../scripts/install-pinned-bun.sh) and [`scripts/github-release-curl.sh`](../../scripts/github-release-curl.sh). Paid flakes were GitHub Releases 503/curl 56, not a broken setup-just. Landed in [`45cacd5`](https://github.com/alexzhang1030/rclweb/commit/45cacd5) (#19).

## release-wasm inherits native release settings

`[profile.release-wasm] inherits = "release"`. Adding `strip`, `lto`, or panic settings to native release also applies to the wasm ship profile unless that key is set again on `release-wasm`. Putting `strip = "symbols"` on native release dropped staged `rclweb.wasm` from 593631 bytes to 376519. Keep fat LTO, `panic = abort`, `opt-level = "z"`, and `strip` explicit on `release-wasm`. Reproduce with `just build` (it prints the staged size).

## Worker URL follows the script extension

`new Worker(new URL("./worker/io-worker.ts", import.meta.url))` is correct for Bun workspace source and wrong after tsdown writes `dist/`. The sibling under `dist/` is `worker/io-worker.js`. `resolveIoWorkerUrl` picks `.ts` vs `.js` from the loading script. Do not hardcode `.ts`.

## Bundle files are named by type

Canonical bundles live at `conformance/cdr/fixtures/bundles/<type with / → .>.json` (for example `rclweb_cdr_interfaces.msg.PrimitiveScalars.json`). Humble `SchemaKey.value` is still the SHA-256 of those bytes — that digest is a wire field, not a filename. Renaming scheme/package strings inside the JSON changes the digest; do not Docker `--write` the corpus for a name change. [ADR 0012](../../docs/adr/0012-rclweb-schema-identifiers.md).

## Unscoped `rclweb` is blocked on npm as too similar to `rrweb`

The exact name `rclweb` is unpublished (`GET https://registry.npmjs.org/rclweb` → 404; search total 0). A logged-in `npm publish` still returns **403**: npm's confusion / typo-squatting rule rejects it as too similar to [`rrweb`](https://www.npmjs.com/package/rrweb) (session replay; ~2.7M weekly downloads). The first attempt looked like a 404 because npm hides unauthorized PUTs; after `npm login` the real reason is the similarity check. Do not retry unscoped `rclweb`. The publish and import name is `rcl-web` ([ADR 0014](../../docs/adr/0014-typescript-package-rcl-web.md)). `rcl-web@0.0.1` is on the registry (TypeScript source). The first tsdown ship is `0.0.2`; current is `0.0.5`. npm will not overwrite a published version.

## License inventory looks in the declaring workspace first

`just license-inventory-check` used to read only `node_modules/<name>/package.json` at the repo root. A dirty local tree can hoist `tsdown` / `typescript` there after they were briefly added on the root package. A clean `bun install --frozen-lockfile` (CI) can leave them only under `typescript/node_modules/`. The inventory then recorded license `""` and `just check` failed (`tsdown@0.22.14: disallowed or missing license ""`). Look in the declaring workspace first, then the root hoist. Reproduce: remove the root copies and run `just license-inventory-check`.

## npm pack ships the tsdown dist, not TypeScript source

The published `rcl-web` tarball is tsdown ESM + `.d.ts` under `dist/`, plus `wasm/rclweb.wasm`. `files` must not include `src/`. `just npm-pack-check` fails if the tarball contains `package/src/`. Run tsdown through Bun (`bun --bun tsdown`) so the config loader does not require the optional `unrun` peer. Workspace `import from "rcl-web"` resolves to that `dist/` — live e2e/perf images must run `bun run --filter rcl-web build` after staging wasm; they used to load `src/` through the export map. [ADR 0015](../../docs/adr/0015-tsdown-ship-bundle.md).

## npm pack copies LICENSE and NOTICE; do not commit them

npm `files` cannot include `../LICENSE`. `scripts/npm-pack.ts --stage` (also the package `prepack` script) copies the repository `LICENSE` and `NOTICE` into `typescript/`. Those copies are gitignored. `just npm-pack-check` requires them in the tarball for `rcl-web@0.0.5`. Do not commit `typescript/LICENSE` or `typescript/NOTICE`.

## Crate LICENSE/NOTICE copies are committed

Cargo omits gitignored files from the package. npm can ship staged copies via `files`; crates.io cannot. `rclweb/LICENSE`, `rclweb/NOTICE`, `rclwebd/LICENSE`, and `rclwebd/NOTICE` are committed and must match the root files. `just cargo-publish-check` fails on drift. After editing the root license files, run `just cargo-publish` and commit the copies.

## crates.io OIDC cannot create the first crate

Trusted publishing on crates.io requires the crate to already exist. `rclweb` / `rclwebd` first land with a human `cargo publish` after `scripts/cargo-publish.ts --stage`. Then add the trusted publisher (`release.yml`, environment blank). The release workflow refuses the crates job with a short error while `GET /api/v1/crates/rclweb` is 404. [release](../../docs/release.md).

## Publishing rclwebd waits for the sparse index

`rclwebd` depends on `rclweb` with `path` + `version`. `cargo publish -p rclwebd` rewrites that to a crates.io dep and reads the **sparse index**, not the HTTP “crate is published” wait that finishes the first upload. Publishing both in one breath fails with `no matching package named rclweb` / `failed to prepare local package for uploading`. Wait until `https://index.crates.io/rc/lw/rclweb` lists the new `vers`, then publish `rclwebd`. A local `[source.crates-io] replace-with` (mirror) also requires `--registry crates-io`, and the mirror may lag further — disable replace-with for that one publish if the official index already has the crate. Paid on the 0.0.1 bootstrap (2026-08-13): `rclweb` uploaded at 11:02:42Z; immediate `rclwebd` pack failed. [release](../../docs/release.md).

## npm OIDC identity is the workflow file

npm trusted publishing matches owner + repo + workflow **filename**. A GitHub `environment:` is optional and must stay off the npm job unless the npmjs.com Environment field is the same string. The first draft put `environment: release` on the job and `--provenance` on `npm publish` — that is the old token/deploy model. Official publish is `id-token: write` + `actions/setup-node@v6` + `npm publish`. Provenance is automatic. First automatic cut (`v0.0.3`) published `rcl-web@0.0.3` with a Sigstore provenance statement. Pushing the tag does not create a GitHub Release; that is a separate API/UI step ([v0.0.4](https://github.com/alexzhang1030/rclweb/releases/tag/v0.0.4), [v0.0.3](https://github.com/alexzhang1030/rclweb/releases/tag/v0.0.3)). [ADR 0016](../../docs/adr/0016-oidc-trusted-publish.md).

## Do not put NODE_AUTH_TOKEN on the npm OIDC job

`npm publish` with trusted publishing uses the GitHub OIDC token. Setting `NODE_AUTH_TOKEN` / `NPM_TOKEN` forces the legacy token path. `actions/setup-node` `registry-url` also writes `_authToken=${NODE_AUTH_TOKEN}`; an empty token line makes the CLI skip OIDC (ENEEDAUTH / E404). The release job must not set those tokens and must delete the `_authToken` line before `npm publish`. CLI ≥ 11.5.1 (`npm install -g npm@latest`). [ADR 0016](../../docs/adr/0016-oidc-trusted-publish.md).

## Do not commit measurement JSON

The owner deleted `docs/evidence/*.json`. Nothing in CI read those files. `just build` used to rewrite `recordedAt` on a wasm-size file, dirtying the tree. Qualification is a human edit of the [support matrix](../../docs/support-matrix.md). Measurement recipes (`just poll-latency`, `just large-message`, `just perf-baseline`) print to stdout. `just perf-baseline` leads with latency / CPU / RSS. Do not add an evidence-check job.

## perf-baseline hops must pair by work

`just perf-baseline` used to put `rclweb.ingest` (subscribe + flush + lease + `onMessage`) next to `foxglove.cdrDecode` (13-byte skip + our own CDR). The Foxglove row was not a Foxglove client. Paid when the owner called that comparison non-corresponding (2026-08-13). Decode hops are header skip + CDR on both sides. Deliver hops are framed bytes → callback (`rclweb.ingest` with `foxglove.deliver`). Do not mix the classes in one comparison. The first timed hop of a new payload size also pays heap growth if hops run sequentially with `tryGc` between them — decode hops are interleaved in one loop so that is not reported as a codec loss. [performance](../../docs/performance.md).

## process.memoryUsage can return EINTR

Bun on Linux can throw `SystemError: Failed to get memory usage` with errno 4 (`EINTR`), especially right after `Bun.gc(true)`. The perf-baseline harness retries (`scripts/perf-baseline/resources.ts`). Do not treat one failed snapshot as a leak, and do not skip RSS because of it.

## No CI lane compiles the ros-feature tests

`just test` builds default (ROS-free) features, and the Docker e2e lanes
build only the `rclwebd` binary with `--features ros`. CI
`ros-feature-check` / `just ros-check-docker` compile
`cargo check --locked -p rclwebd --features ros --tests` (and Clippy)
inside the digest-pinned Jazzy image — the gate that would have caught
the ADR 0017 `Vec<u8>` → `Bytes` drift in `rclwebd/tests/ros_rcl.rs`
(`just ros-test` stayed broken on `main` until
[ADR 0018](../../docs/adr/0018-prebuilt-gateway-distribution.md)
verification). Host `just ros-check` is the same compile without Docker
(sourced Jazzy). Do not replace this with `cargo test` inside Docker —
foundation already runs ROS-free tests, and live talker remains
`just e2e`. `just ros-test` still *runs* the ros-feature tests. The live
service/action loopbacks additionally need `example_interfaces`
installed, as the [gateway doc](../../docs/gateway/rclwebd.md#environment-contract)
says.

## Do not wrap cargo tests in a Docker mock lane

`docker/compose.r3-03-h-ft.yml` once existed whose image only re-ran `cargo test` inside `rust:1.97.1`. Foundation already runs those tests via `just test`. The CI job was `workflow_dispatch`-only, so it never gated. Live Humble remains [`docker/compose.r3-03-h-ft-e2e.yml`](../../docker/compose.r3-03-h-ft-e2e.yml). Do not add a compose file whose only command is cargo tests the workspace already runs. The ros-feature compile image ([`docker/compose.ros-feature-check.yml`](../../docker/compose.ros-feature-check.yml)) is not that anti-pattern: it runs `cargo check --tests`, not `cargo test`.
