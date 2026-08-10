# Security model

Moonspan places the robot trust boundary at `rclwebd`. Browser identity, effective permissions, resource budgets, command policy, ROS enclave identity, and audit evidence converge there before an operation reaches the ROS domain.

## Trust boundaries

| Boundary | Credential or identity | Enforced controls |
|---|---|---|
| Browser to gateway | OIDC or OAuth2 short-lived token, then short-lived session credential | TLS, audience and expiry, session policy, channel ACLs, resource envelope |
| Gateway to ROS 2 | Dedicated SROS2 enclave and ROS graph identity | ROS access-control policy, namespace and operation constraints |
| Gateway to identity/policy services | Service identity and pinned trust configuration | TLS, issuer and policy revision validation, bounded cache lifetime |
| Operator to command workflow | Authenticated subject plus application context | Capability display, typed preview, confirmation mode, audit identity |

Robot private keys stay in the edge enclave. Browser sessions receive scoped, short-lived material.

## Authorization model

Policy uses explicit allow rules over:

- subject, group, tenant, robot, fleet, and ROS domain;
- operation kind: graph, subscribe, publish, service, action, parameter, recording, asset, diagnostics;
- ROS name pattern, type name, and schema identity `(scheme, value)`;
- QoS and durability class;
- rate, sample size, bandwidth, concurrency, queue bytes, and deadline;
- command confirmation and audit requirements;
- diagnostic detail and graph visibility.

The gateway returns the effective capability set and policy revision to the SDK. Applications can render authorized operations and scoped denial reasons from that contract.

## Command safety

Publish, Service, Action, and Parameter mutations carry:

- authenticated subject and session;
- target name, operation kind, type name, schema identity `(scheme, value)`, and payload summary;
- deadline, concurrency key, and idempotency or correlation identity where supported;
- capability decision and policy revision;
- audit identity and end-to-end trace identity;
- terminal ROS result, cancellation, timeout, or failure reason.

The common Studio prototype adds explicit command mode, typed parameter preview, permission display, hold-to-send for configured operations, and durable result presentation.

## Resource controls

Every session and channel receives hard ceilings for:

- connections, streams, channels, and in-flight calls;
- samples, bytes, message size, and schema size;
- ingress and egress rate and bandwidth;
- transient-local cache and recording transfer;
- command concurrency and deadline;
- trace, log, and audit volume.

Admission decisions and limit events use stable codes and bounded diagnostic payloads. Aggregate limits protect the process, robot domain, and shared network.

## Transport and browser deployment

- TLS 1.3 protects WebTransport/HTTP3 and WSS.
- Certificate rotation, expiry, trust roots, and revocation behavior receive deployment tests.
- Cross-origin-isolated deployments send `Cross-Origin-Opener-Policy: same-origin` plus a compatible `Cross-Origin-Embedder-Policy` to enable the `SharedArrayBuffer` fast path.
- General CDN and embedding deployments use transferable buffers through the same SDK behavior.
- Origin, CORS, content security policy, iframe, and asset rules are explicit deployment inputs.
- Session cookies or tokens use scoped storage and lifetime rules defined by the chosen client integration.

[Cross-origin isolation](https://developer.mozilla.org/en-US/docs/Web/API/WorkerGlobalScope/crossOriginIsolated) and [transferable objects](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects) define the two browser buffer deployment paths.

## SROS2 alignment

`rclwebd` runs in a dedicated SROS2 enclave. Gateway policy maps browser capabilities to ROS graph and operation permissions and produces a reviewable information-flow boundary. The design follows ROS 2 [access-control policy](https://design.ros2.org/articles/ros2_access_control_policies.html) and [security enclave](https://design.ros2.org/articles/ros2_security_enclaves.html) concepts.

Deployment qualification records:

- enclave identity and mounted keystore provenance;
- ROS namespace and operation rules;
- browser-to-ROS policy mapping;
- discovery and graph visibility behavior;
- certificate and governance artifact rotation;
- effective-denial and audit tests.

## Audit contract

Audit records include timestamp and clock identity, subject, session, robot, domain, target, operation, type name, schema identity `(scheme, value)`, policy revision, decision, resource envelope, correlation identity, result, latency, and trace reference. Sensitive payload capture follows an explicit field policy and retention class.

Audit sinks define integrity, availability, buffering, redaction, retention, export, and recovery behavior. A sink outage follows a configured operation policy with a visible health state.

## Threat scenarios

Security qualification covers:

- stolen, expired, replayed, wrong-audience, and wrong-issuer credentials;
- graph enumeration and schema disclosure pressure;
- oversized, malformed, high-rate, and high-concurrency traffic;
- unauthorized publish, Service, Action, Parameter, recording, and asset operations;
- channel identity reuse, stale policy generations, and session resume after policy change;
- decompression, media, schema, and parser resource pressure;
- gateway restart, audit sink failure, identity provider outage, and ROS enclave failure;
- cross-origin and embedding configuration drift.

## Release evidence

M3 requires a threat model, policy matrix, automated authorization suite, fuzzing results for protocol and schema inputs, secret and dependency scans, SROS2 deployment evidence, audit integrity tests, incident runbook, and human security review.
