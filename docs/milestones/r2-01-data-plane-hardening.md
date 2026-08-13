# R2-01: Data-plane hardening (publish, QoS subset, budgets, reconnect)

Status: Complete (implementation + automated evidence). Human review of the
existing `examples/subscribe-chatter` demo remains the open R1 gate item and is
out of scope for this note.

## Outcome

The walking skeleton gains a symmetric **publish** path and the first data-plane
contracts in the [performance contracts](../architecture.md#performance-contracts):

| Area | Behavior |
|---|---|
| Publish | SDK `session.publish` → engine OpenChannel(kind=1) → `SendSample` ROS_SAMPLE → gateway `rcl_publish_serialized` for `std_msgs/msg/String` |
| QoS subset | Reliability + KEEP_LAST depth plumb through OpenChannel; gateway `resolve_effective` unchanged |
| Budgets | ChannelReady / SessionReady carry `effective_budgets` (`max_samples`, `max_bytes`, `max_message_bytes`); gateway write queue enforces them |
| Dispositions | Stable counters: `delivered`, `sequence_gap`, `stale_sequence`, plus `reliable_queue_drop`; exposed on `/telemetryz` |
| Latest-wins | Best-effort framed samples evict oldest on over-budget admit; reliable never evicts (drop before frame) |
| Reconnect | Fresh session only (SessionResume stays parked): SDK `reconnect()` / `ConnectOptions.reconnect`; gateway teardown + new Auth/Ready proven |

Constraints preserved: single Rust core, TS SDK does not parse R2WP, no
third-party rcl binding, no `Instant` on wasm, no permessage-deflate, J-FT row.

## Delivered scope

| Surface | Location |
|---|---|
| Engine Publish / SendSample / QoS depth | [`rclweb/src/engine/`](../../rclweb/src/engine/) |
| Poll ABI cmds 6–7, app events 9–10 | [`rclweb/src/host/batch.rs`](../../rclweb/src/host/batch.rs) |
| Write queue + dispositions | [`rclwebd/src/budgets.rs`](../../rclwebd/src/budgets.rs) |
| Connection admit / flush | [`rclwebd/src/connection.rs`](../../rclwebd/src/connection.rs) |
| Telemetry dispositions | [`rclwebd/src/telemetry.rs`](../../rclwebd/src/telemetry.rs) |
| SDK publish + reconnect | [`typescript/src/`](../../typescript/src/) |

## Acceptance evidence

```bash
cargo test --locked -p rclweb
cargo test --locked -p rclwebd --test client_engine_collision --test ws_gateway
bun run scripts/build-wasm.ts
bun test typescript/test
just check && just test && just build
```

Notable tests:

- `scripted_peer_publish_sends_ros_sample` (engine)
- `client_engine_collides_with_gateway_publish_path`
- `fresh_session_reconnect_reopens_subscribe`
- `budgets::tests::best_effort_latest_wins_evicts_oldest`
- SDK `scripted peer: publish → ChannelReady → SendSample outbound`

## Ownership after completion

R2-02 owns the large-message path and the preallocated host-batch encoder —
see [R2-02](./r2-02-large-message-path.md). R2-03 owns adversarial fixture
regeneration and fuzzing. R2-04 owns the Foxglove/rosbridge baseline.
SessionResume (capability 1) remains parked until a later phase re-freezes it.
