# R3-01: Services, actions, parameters, and graph

Status: Complete (implementation + automated evidence). Live ROS service/action
on `RclBackend` landed in [R3-04](./r3-04-adapter-abi-typesupport.md) (service
client/server + action client/server).
MockBackend remains the protocol/SDK oracle.

## Outcome

| Area | Behavior |
|---|---|
| Graph | Gateway emits `GraphSnapshot` (generation 1) after SessionReady; OpenChannel success may emit `GraphDelta`; session tracks generation; SDK `onGraph` |
| Service | `SERVICE_CLIENT` / `SERVICE_SERVER` OpenChannel; `SERVICE_REQUEST` / `SERVICE_RESPONSE` with `OPERATION_ID`; ChannelReady `effective_service_qos` |
| Action | `ACTION_CLIENT` / `ACTION_SERVER`; five action opcodes; ChannelReady `effective_action_qos` |
| Parameters | SDK sugar over `rcl_interfaces` service names + topic events (composition) |
| OPERATION_ID | Required on service/action frames; zero allowed only for `ACTION_STATUS` stream |
| Cancel | Operation-scoped CONTROL Error does not fail the session |

Constraints preserved: single Rust core, TS SDK does not parse R2WP, no
third-party rcl binding, SessionResume stays parked, J-FT row.

## Delivered scope

| Surface | Location |
|---|---|
| Session kinds / opcodes / graph generation | [`rclweb/src/session/`](../../rclweb/src/session/) |
| Engine + poll ABI cmds 8–16 / events 11–23 | [`rclweb/src/engine/`](../../rclweb/src/engine/), [`rclweb/src/host/batch.rs`](../../rclweb/src/host/batch.rs) |
| Gateway graph + service/action attach | [`rclwebd/src/connection.rs`](../../rclwebd/src/connection.rs), [`rclwebd/src/control.rs`](../../rclwebd/src/control.rs), [`rclwebd/src/backend.rs`](../../rclwebd/src/backend.rs) |
| MockBackend echo + graph view | [`rclwebd/tests/common/mod.rs`](../../rclwebd/tests/common/mod.rs) |
| SDK service/action/graph/parameters | [`typescript/src/`](../../typescript/src/) |
| Normative re-freeze | [`protocol/r2wp-v0.md`](../../protocol/r2wp-v0.md) |

## Acceptance evidence

```bash
cargo test --locked -p rclweb --lib
cargo test --locked -p rclwebd --test ws_gateway --test client_engine_collision
bun test typescript/test
just check && just test && just build
```

Notable tests:

- `service_client_request_response_direction` / `graph_snapshot_then_delta` (session)
- `scripted_peer_service_call_round_trip` / graph snapshot engine tests (engine)
- `service_client_round_trip_echoes_payload` (ws_gateway)
- Existing topic subscribe/publish paths remain green

## Ownership after completion

R3-02 owns generated types and dual-scheme schema registry. R3-03 owns H-FT +
WebTransport. R3-04 delivered the versioned adapter ABI, dlopen typesupport, and
live service/action client attachment — see [R3-04](./r3-04-adapter-abi-typesupport.md).
