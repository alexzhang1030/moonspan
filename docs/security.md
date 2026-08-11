# Security model

`rclwebd` is Moonspan's robot trust boundary. Browser identity, effective permissions, resource policy, ROS enclave identity, and audit evidence converge there before an operation reaches ROS.

## Trust boundaries

| Boundary | Identity | Controls |
|---|---|---|
| Browser to gateway | Short-lived OIDC or OAuth2 identity and session material | TLS, issuer and audience checks, expiry, channel ACLs, resource envelope |
| Gateway to ROS | Dedicated SROS2 enclave | ROS access policy, namespace rules, operation limits |
| Gateway to policy services | Service identity and pinned trust | TLS, revision validation, bounded cache lifetime |
| Operator command | Authenticated subject and application context | Capability display, typed preview, confirmation, audit |

Robot private keys stay in the edge enclave.

## Authorization

Policy can scope access by subject, tenant, robot, gateway, support row, ROS domain, operation kind, ROS name, type, schema identity, QoS, resource budget, and diagnostic visibility.

The gateway derives `gateway_instance_id` and `support_row_id`; the active channel supplies `domain_id`. The SDK receives the effective capability set and policy revision so applications can present authorized operations and stable denial reasons.

## Commands and resources

Publish, Service, Action, and Parameter operations carry authenticated identity, deployment provenance, target, operation kind, type, schema, deadline, correlation, policy revision, audit identity, and terminal result.

Sessions and channels receive hard ceilings for connections, streams, channels, calls, samples, bytes, message size, rate, bandwidth, queues, caches, deadlines, traces, logs, and audit output. Admission and limit events use stable codes with bounded diagnostics.

## Transport and browser deployment

- TLS protects WebTransport and WebSocket endpoints.
- Certificate lifecycle and trust configuration receive deployment tests.
- Cross-origin isolation enables the shared-buffer path through the required browser headers.
- Transferable buffers provide the general deployment path under the same SDK behavior.
- Origin, CORS, content security, iframe, asset, and credential storage rules are explicit deployment inputs.

## SROS2

The gateway runs in a dedicated SROS2 enclave and maps browser capabilities to ROS graph and operation permissions. Qualification records enclave identity, keystore provenance, ROS rules, browser-to-ROS mapping, graph visibility, credential rotation, denials, and audit behavior.

The design follows ROS 2 [access-control policy](https://design.ros2.org/articles/ros2_access_control_policies.html) and [security enclave](https://design.ros2.org/articles/ros2_security_enclaves.html) concepts.

## Audit

Audit records identify time and clock, subject, session, robot, gateway, support row, domain, target, operation, type, schema, policy revision, decision, resource envelope, correlation, result, latency, and trace reference. Payload capture follows an explicit field and retention policy.

Audit sinks define integrity, availability, buffering, redaction, retention, export, and recovery. Sink health is visible, and outages follow a configured operation policy.

## Qualification

Security tests cover credential misuse, graph and schema disclosure, malformed or high-rate traffic, unauthorized operations, stale policy, session resume, deployment provenance, profile mismatch, parser and media pressure, dependency outages, restart behavior, browser isolation, and configuration drift.

M3 requires a threat model, reviewed policy matrix, automated authorization tests, protocol and schema fuzzing, dependency and secret scans, SROS2 deployment evidence, audit integrity tests, incident procedures, and human security approval.
