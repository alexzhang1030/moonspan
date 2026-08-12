# R1-02: Session/channel state machine

Status: Complete. Adds a synchronous, host-agnostic session and channel state machine for the R2WP v0.1 walking-skeleton subset inside `rclweb`.

## Outcome

`rclweb::session` applies already-parsed [`BootstrapRecord`](../../rclweb/src/protocol/bootstrap.rs) and [`DecodedFrame`](../../rclweb/src/protocol/frame.rs) values to a pure connection state machine shared by client and server roles. It enforces bootstrap order, the fresh Authenticate → SessionReady path, ready-state preconditions (error code 27), channel lifecycle (unused → pending → active|failed → closed), and TOPIC_SUBSCRIBE / TOPIC_PUBLISH `ROS_SAMPLE` direction rules. SessionResume and other parked product paths are not implemented; illegal wire still fails via direction, readiness, and ordering rules.

## Delivered scope

| Surface | Location |
|---|---|
| Session API (`Session` / `Role` / `SessionPhase` / effects) | [`rclweb/src/session/`](../../rclweb/src/session/) |
| Channel table + operation kinds | [`rclweb/src/session/channel.rs`](../../rclweb/src/session/channel.rs) |
| Transitions (bootstrap + frames) | [`rclweb/src/session/transition.rs`](../../rclweb/src/session/transition.rs) |
| `session_not_ready` / `unknown_channel` helpers | [`rclweb/src/protocol/error.rs`](../../rclweb/src/protocol/error.rs) |
| Focused transition-matrix tests | [`rclweb/src/session/tests.rs`](../../rclweb/src/session/tests.rs) |

## Behavioral notes

- Callers parse first with existing protocol parsers; the SM does not decode wire bytes.
- `ingest_*` applies peer-originated messages; `record_send_*` applies locally originated messages so each peer can keep consistent channel state (for example a server recording its own `ChannelReady` before sending samples).
- Fresh ready path only. `SessionResume` / `SessionResumeResult` → `protocol_violation` (capability 1 parked).
- Data on pending channels → `protocol_violation` (step 19); failed/closed/never-opened → `unknown_channel` (step 20); wrong opcode direction on active topic channels → `protocol_violation` (step 22).

## Acceptance evidence

```bash
cargo test -p rclweb --lib session::
cargo test -p rclweb --locked
just check
just test
just build
```

## Ownership after completion

- [Normative protocol](../../protocol/r2wp-v0.md) owns state-machine and channel-lifecycle rules.
- [`rclweb` core](../runtime/core.md) owns the Rust implementation.
- Poll ABI / Worker host remain ADR 0004 / R1-04; gateway transport remains R1-03.
- [Implementation plan](../../tasks/plan.md) owns remaining R1 work.
