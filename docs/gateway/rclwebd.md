# `rclwebd` edge gateway

`rclwebd` is Moonspan's controlled edge boundary between browser sessions and ROS 2 domains. Rust owns transport, scheduling, sessions, schemas, policy, audit, telemetry, and recovery. A versioned C ABI adapter owns ROS distribution and RMW integration.

The R2WP v0 reference parser is complete. M1 adds serialized graph and publish/subscribe. M2 adds the remaining ROS semantics. M3 qualifies identity, policy, compatibility, deployment, and operations.

## Responsibilities

- terminate TLS-protected WebTransport and WebSocket sessions;
- authenticate clients and materialize effective policy;
- discover graph, endpoints, schemas, QoS, and liveliness;
- bridge serialized topics, Service, Action, Parameter, and Clock operations;
- schedule channels under explicit resource budgets;
- emit stable failure and disposition reasons;
- expose health, readiness, metrics, logs, audit, and compatibility state.

## Component plan

| Component | Role |
|---|---|
| Gateway | Process lifecycle, configuration, health, and readiness |
| R2WP | Protocol state and transport adapters |
| Session | Identity, resume, and channel lifecycle |
| Scheduler | Queues, fairness, priorities, deadlines, and budgets |
| Schema | Graph generations, type descriptions, and caches |
| Policy | ACLs, resource limits, command policy, and audit |
| Telemetry | Metrics, traces, and structured logs |
| ROS adapter | Versioned serialized C ABI |

## Support-row binding

One `rclwebd` process binds one Phase 1 adapter row: H-FT, H-CY, J-FT, or J-CY. The process may open multiple ROS domain IDs within that row. Applications use independent sessions across rows.

`support_row_id` is fixed for the running artifact. `gateway_instance_id` identifies the logical deployment and supports resume across ordinary restart or in-place upgrade when state is preserved. Startup validates the configured row, ROS distribution, RMW, adapter ABI, and artifact profile. A mismatch keeps readiness closed with `adapter_profile_mismatch`.

Graph, schema, channel, policy, telemetry, audit, and evidence records retain gateway, support-row, and domain provenance.

## ROS adapter ABI

The adapter exposes generic serialized operations with fixed-width, versioned structures and explicit ownership. Its surface covers:

- lifecycle and domain attachment;
- graph snapshots, deltas, endpoint QoS, and liveliness;
- serialized publish and subscribe;
- Service, Action, Parameter, and Clock operations;
- recursive type descriptions and schema identity;
- readiness polling and buffer release.

Jazzy obtains native type descriptions and uses `rep2011-rihs`. Humble combines generic serialized operations with recursive deployment bundles identified by `moonspan-schema-v1`.

## Data path

1. The adapter polls ROS and places serialized events into a bounded exchange.
2. Rust resolves graph and schema state, attaches provenance, applies policy, and admits work to channel queues.
3. The scheduler chooses control, stream, or datagram work according to reliability, priority, and deadline.
4. Transport completion releases or recycles each buffer through its recorded owner.
5. Browser operations follow the reverse path after policy and schema validation.

The first implementation targets a measurable one-copy gateway path. Further sharing requires allocator, lifetime, and safety evidence.

## Scheduler and schema state

Channels declare reliability, history, queued samples and bytes, message size, rate, bandwidth, concurrency, priority, deadlines, lifespan, and cache budgets as applicable. The scheduler gives control and cancellation bounded latency and records admission, send, eviction, expiry, and cancellation outcomes.

Graph state uses monotonic generations and ordered deltas. Schema identity is `(scheme, value)`, while cache identity also includes type name, encoding, and schema generation. Session policy filters graph and schema visibility before transmission. Channel setup pins its graph, schema, domain, and support-row context.

## Session lifecycle

```text
TLS connection
  -> version and capability negotiation
  -> identity validation
  -> effective policy and resource envelope
  -> SessionReady
  -> graph and schema synchronization
  -> channel operations
  -> close or eligible resume
```

Resume validates identity, wire version, capabilities, gateway instance, support row, channel acknowledgements, graph and schema generations, policy revision, and expiry. Replacement deployments and row changes create a fresh session.

## Security and operations

The gateway is the trust boundary for OIDC identity, SROS2, operation ACLs, resource policy, and audit. Compatibility endpoints such as Foxglove and rosbridge have independent sessions, policy, and telemetry.

Operations expose liveness, readiness, configuration validation, metrics, logs, traces, audit output, drain, restart, expiry, and bounded recovery. Deployment artifacts cover row-specific packages, proxy and TLS configuration, identity, SROS2, browser isolation headers, storage, observability, upgrade, rollback, and recovery.

## Validation

Gateway qualification covers protocol agreement, serialized ROS interoperability, schema identity, adapter profile validation, bounded memory, scheduling fairness, deadlines, reconnect and resume, policy and audit, operations, and dependency faults.

```bash
cargo test --locked -p rclwebd
bun run protocol-agree
```

[Compatibility](../compatibility.md), [security](../security.md), and [validation](../validation.md) own the release evidence.
