# Security model

`rclwebd` is rclweb's robot trust boundary. Browser identity, effective permissions, resource policy, ROS enclave identity, and audit evidence converge there before an operation reaches ROS.

## Trust boundaries

| Boundary | Identity | Controls |
|---|---|---|
| Browser to gateway | Short-lived OIDC or OAuth2 identity and session material | TLS, issuer and audience checks, expiry, channel ACLs, resource envelope |
| Gateway to ROS | Dedicated SROS2 enclave | ROS access policy, namespace rules, operation limits |
| Gateway to policy services | Service identity and pinned trust | TLS, revision validation, bounded cache lifetime |
| Operator command | Authenticated subject and application context | Capability display, typed preview, confirmation, audit |

Robot private keys stay in the edge enclave.

Authenticate is evaluated at the gateway. Default `off` accepts any credential and keeps SessionReady field 21 as `anonymous` (no audit). `oidc` mode verifies JWT issuer, audience, expiry, and signature (HS256 secret or JWKS) and fails with wire code 26. A named OIDC tenant and SROS2 keystore are out of scope ([open work](../tasks/plan.md)); leave `RCLWEBD_AUTH_MODE` off. This process does not embed a vendor.

## Authorization

Policy can scope access by subject, tenant, robot, gateway, support row, ROS domain, operation kind, ROS name, type, schema identity, QoS, resource budget, and diagnostic visibility.

Channel ACLs are enforced at OpenChannel. Default `off` admits every channel. `RCLWEBD_ACL_MODE=enforce` is default-deny over `{subjects, operations, names}` allow rules (`RCLWEBD_ACL` / `RCLWEBD_ACL_PATH`); denials fail the channel with wire code 12 (`permission_denied`) and emit an audit line. The reference matrix is [acl-reference.json](./acl-reference.json): subscribe / service_client / action_client are open, publish and *server* stay on listed names. Point `RCLWEBD_ACL_PATH` at that file to opt in. Auth is off, so the subject is `anonymous` and `"*"` matches it.

The gateway derives `gateway_instance_id` and `support_row_id`; the active channel supplies `domain_id`. The TypeScript package receives the effective capability set and policy revision so applications can present authorized operations and stable denial reasons.

## Commands and resources

Publish, Service, Action, and Parameter operations carry authenticated identity, deployment provenance, target, operation kind, type, schema, deadline, correlation, policy revision, audit identity, and terminal result.

Sessions and channels receive hard ceilings for connections, streams, channels, calls, samples, bytes, message size, rate, bandwidth, queues, caches, deadlines, traces, logs, and audit output. Admission and limit events use stable codes with bounded diagnostics.

## Transport and browser deployment

- TLS protects WebTransport and WebSocket endpoints.
- Certificate lifecycle and trust configuration receive deployment tests.
- **Local-dev WebTransport** (opt-in) auto-mints short-lived ECDSA P-256 certificates and trusts them via `serverCertificateHashes`, with rotation before the browser's 14-day validity ceiling — see [ADR 0011](./adr/0011-local-dev-webtransport-tls.md). Intranet recipe: [deploy](./deploy.md#intranet-webtransport). Production keeps normal PKI.
- Cross-origin isolation enables the shared-buffer path through the required browser headers. `rclwebd` adds COOP/COEP/CORP only when `RCLWEBD_ISOLATION_HEADERS` is on.
- Transferable buffers provide the general deployment path under the same package behavior.
- Origin, CORS, content security, iframe, asset, and credential storage rules are explicit deployment inputs.
- WebGPU needs a secure context: `http://localhost` / `http://127.0.0.1` already qualify; LAN IP page origins need HTTPS (local-dev TLS or proxy).

## SROS2

SROS2 enclave wiring is parked ([open work](../tasks/plan.md)). The design still follows ROS 2 [access-control policy](https://design.ros2.org/articles/ros2_access_control_policies.html) and [security enclave](https://design.ros2.org/articles/ros2_security_enclaves.html) concepts; this process does not ship a keystore.

## Audit

Audit records identify time and clock, subject, session, robot, gateway, support row, domain, target, operation, type, schema, policy revision, decision, resource envelope, correlation, result, latency, and trace reference. Payload capture follows an explicit field and retention policy.

Audit sinks define integrity, availability, buffering, redaction, retention, export, and recovery. Sink health is visible, and outages follow a configured operation policy. The current sink is stderr JSON lines; a file sink with integrity and export remains [open work](../tasks/plan.md).

## Qualification

Security tests cover credential misuse, graph and schema disclosure, malformed or high-rate traffic, unauthorized operations, stale policy, session resume, deployment provenance, profile mismatch, parser and media pressure, dependency outages, restart behavior, browser isolation, and configuration drift.

A release review needs a threat model, the reference [policy matrix](./acl-reference.json), automated authorization tests, protocol and schema fuzzing, dependency and secret scans, audit integrity tests, incident procedures, and human security approval. SROS2 deployment evidence is parked with auth.
