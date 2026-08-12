# 0011: Local-dev WebTransport TLS via auto-minted short-lived certificates

## Status

Accepted

## Date

2026-08-12

## Context

R3 adds WebTransport (HTTP/3 streams + datagrams) as the second transport to remove WebSocket head-of-line blocking. The WebTransport API requires an `https://` URL and a secure context. Public-CA HTTPS is fine in production and painful on a robot LAN or laptop loopback.

Browsers also expose a deliberate escape hatch: `WebTransport` constructor option `serverCertificateHashes`. The presented certificate must be X.509v3, use an allowed public key (interoperable default: ECDSA P-256), have a **validity period of at most 14 days**, and the current time must fall inside that window. WebGPU needs a secure context too, but `http://localhost` / `http://127.0.0.1` already qualify — the sharper local pain is LAN origins and WebTransport's HTTPS scheme, not WebGPU itself.

Raw browser UDP sockets are not available to ordinary web pages; R2WP's unreliable path remains WebTransport datagrams (or parked alternatives), not a custom UDP client.

## Decision

- **Production** WebTransport and WSS continue to use normal PKI TLS (deployment-managed certificates). No change to the security model in [`docs/security.md`](../security.md).
- **Local / edge-lab WebTransport** uses an explicit `rclwebd` **local-dev TLS** profile that:
  1. **Auto-generates** an ECDSA P-256 keypair and self-signed X.509v3 certificate on first need (no openssl manual steps, no mkcert required for the WT path).
  2. Caps notAfter−notBefore at **≤13 days** (strictly under the browser's 14-day `serverCertificateHashes` ceiling, with margin for clock skew).
  3. Exposes the certificate's **SHA-256 SPKI hash** (and notAfter) to the SDK through a documented local-only side channel (e.g. `GET /healthz` / a dedicated `GET /local-dev/tls` JSON field, and/or printed once at gateway startup). Secrets (private key) never leave the gateway process or its local keystore path.
  4. The SDK `ConnectOptions` accepts `serverCertificateHashes` (and optional notAfter) and passes them into `new WebTransport(url, { serverCertificateHashes })`.
- **14-day expiry is handled by rotation, not by longer certs** (browsers will reject >14-day certs on this path):
  - Default local-dev lifetime: **7 days**.
  - Gateway **re-mints before expiry** (target: when less than **24 hours** remain, or on a configurable interval ≤7 days).
  - During a short **overlap window**, the gateway may present the new cert while still advertising both the previous and current SPKI hashes so already-connected documentation/tools can refresh; live sessions that cannot re-handshake MUST **reconnect** with the new hash (fresh session — SessionResume stays parked in v0.1).
  - If a process somehow runs past notAfter without rotation, new WebTransport handshakes fail closed; operators restart or hit the rotate endpoint. That failure is preferred over silently falling back to an unbound trust model.
- **WebGPU local**: prefer serving the application origin from `http://localhost` (already a secure context). LAN IP origins that need WebGPU use the same local-dev TLS terminator (or a reverse proxy) so the **page** is HTTPS; WT cert-hash and page TLS may share the auto-minted material when convenient.
- **R1/R2** keep binary WebSocket as the default local path (`ws://localhost` allowed for loopback lab use per existing walking-skeleton practice). This ADR does not force WebTransport before R3.
- Local-dev TLS profile is **opt-in** (config/flag). It must not be the default on production-shaped deployments; readiness should surface when the profile is active.

## Rationale

- Auto-mint + `serverCertificateHashes` removes CA/mkcert friction while staying inside the WebTransport specification instead of inventing browser UDP.
- A ≤14-day ceiling is a browser rule, not a project preference; rotation is the only compliant way to run longer than two weeks.
- Keeping production on PKI preserves the existing trust boundary; local-dev is an explicitly labeled exception with fail-closed expiry.
- WebGPU's localhost secure-context rule means most Studio/lab UI work does not need HTTPS until someone opens the app via a LAN IP.

## Consequences

- R3 WebTransport work implements the local-dev TLS mint/rotate/advertise path and SDK hash plumbing as part of transport bring-up, not as a later afterthought.
- Deployment docs gain a short “local WebTransport” section: flag, hash fetch, reconnect-on-rotate.
- Evidence for the local profile records: cert algorithm, lifetime, hash advertisement, rotate-before-expiry, failed handshake after notAfter, and that private keys never appear on `/local-dev` responses.
- Chromium-only quirks (if any) stay in compatibility evidence; the contract itself stays spec-shaped.

## Revisit triggers

- Browsers change `serverCertificateHashes` lifetime or algorithm requirements.
- A supported browser adds a loopback WebTransport exception that removes the need for cert-hash locally.
- Production-shaped fleets misuse local-dev TLS; then defaults, readiness gates, or packaging must tighten.
- WebGPU-on-LAN deployment needs a different page-TLS story than the WT local-dev cert.

## Source

WebTransport secure-context and `serverCertificateHashes` custom-certificate requirements in the [W3C WebTransport API](https://www.w3.org/TR/webtransport/) and [MDN `WebTransport()`](https://developer.mozilla.org/en-US/docs/Web/API/WebTransport/WebTransport); transport ceiling and R3 WebTransport timing in the [restructure performance plan](../proposals/architecture-restructure.md#performance-plan); TLS expectations in [security](../security.md).
