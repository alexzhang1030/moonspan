# Qualification environment, owners, and retention

Current conclusion: there is no separate qualification lab or measurement archive. The official environment is the digest-pinned compose already in the [support matrix](../../docs/support-matrix.md). The repository owner is the only named owner. Perf output is stdout and is not retained. Support rows stay **Qualification targets** — do not stamp **Qualified**.

This file distills existing committed pins. The human asked for that lookup and gave no independent rationale.

## Environment

Use the six live talker lanes and the ROS base digests in [support-matrix.md](../../docs/support-matrix.md):

| Distro | Image |
|---|---|
| Humble | `docker.io/library/ros:humble-ros-base-jammy@sha256:7bea3d9aa2483d3ca34c8e30d921b79273b0913bd7dc64bebf51d082b5d107e4` |
| Jazzy | `docker.io/library/ros:jazzy-ros-base-noble@sha256:da725acf8b0f9f30c683e33ffbdcd6482d077af96d6fdc7688c5f4f280b7d923` |

CI runs those lanes on `ubuntu-24.04`. Foundation is ROS-free (`just check` / `just test` / `just build`). There is no second “official” machine list and no artifact store for reports. Do not invent one.

Browser / Playwright pins in the support matrix remain **Qualification targets**. They are not a live CI lane.

## Owners

GitHub owner is [`alexzhang1030`](https://github.com/alexzhang1030/rclweb). [NOTICE](../../NOTICE) and [licensing](../../docs/licensing.md) use `Copyright 2026 Alex`. No workstream, integration, or review owners are named in the repository. Treat the repository owner as the only owner until someone else is named.

## Benchmark retention

[Performance](../../docs/performance.md) and the [measurement-JSON gotcha](./gotchas.md#do-not-commit-measurement-json) already bind this: `just perf-baseline` / `just poll-latency` / `just large-message` print to stdout. Do not commit measurement JSON. There is no retention, access, or integrity store. Promotion is a human edit of the support matrix, not a CI upload.

## Qualified stays pending

Live talker e2e covers all six rows. That is engineering evidence, not **Qualified**. The human said continue the work and did not accept the matrix. Remaining gaps that would still matter in a later review: browser runner, soak / large-cloud duration, production TLS, SessionResume (parked in v0.1), and a human stamp on the matrix. Auth / SROS2 are out of scope ([open work](../../tasks/plan.md)).

## Source

Human replies on 2026-08-14: keep `Alex`; continue qualification (do not stamp); do not do auth; draft a wide ACL; look up environment / owners / retention from existing materials. No reasons given.
