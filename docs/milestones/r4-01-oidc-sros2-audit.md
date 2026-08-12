# R4-01: OIDC identity, SROS2/ACL, audit

Status: In progress (first slice). Production OIDC tenant and SROS2
keystore remain [D-04](../../tasks/plan.md#kickoff-decision-register).
This slice makes Authenticate a real policy surface without picking a
vendor.

## Outcome (this slice)

| Area | Behavior |
|---|---|
| `off` (default) | Auth disabled. Any credential is accepted; SessionReady field 21 stays `anonymous`; no audit. Same as R1–R3. `dev` is an alias. |
| `oidc` | JWT with issuer + audience + signature (`HS256` secret or JWKS). Fail closed at process start if issuer/audience/keys are missing. Fail Authenticate with wire code 26 (`authentication_failed`) and close. |
| Audit | One JSON line per Authenticate **in `oidc` mode** (`rclwebd audit {…}`) with decision, subject, scheme, gateway/row/domain, and `ROS_SECURITY_ENABLE` if set. Off mode is silent. |
| SROS2 / ACL | Not in this slice. Enclave mapping and channel ACLs wait on D-04 plus a follow-up in this task |

## Config

```bash
RCLWEBD_AUTH_MODE=off|oidc          # default off (`dev` is an alias for off)
RCLWEBD_OIDC_ISSUER=https://…
RCLWEBD_OIDC_AUDIENCE=rclwebd
RCLWEBD_OIDC_HS_SECRET=…            # tests / local HS256
RCLWEBD_OIDC_JWKS='{"keys":[…]}'    # or RCLWEBD_OIDC_JWKS_PATH
```

D-04 still owns *which* issuer and *which* SROS2 keystore. The gateway only
consumes those values.

## Delivered scope

| Surface | Location |
|---|---|
| Verifier + audit | [`rclwebd/src/auth.rs`](../../rclwebd/src/auth.rs) |
| Authenticate gate | [`rclwebd/src/connection.rs`](../../rclwebd/src/connection.rs) |
| Env wiring | [`rclwebd/src/main.rs`](../../rclwebd/src/main.rs), [`GatewayConfig`](../../rclwebd/src/config.rs) |

## Acceptance evidence

```bash
cargo test --locked -p rclwebd --lib auth::
cargo test --locked -p rclwebd --test ws_gateway
just check && just test && just build
```

## Still open in R4-01

- Channel/operation ACLs from a reviewed policy matrix
- SROS2 enclave identity, keystore provenance, browser-to-ROS mapping
- Audit sink (integrity, retention, export) beyond stderr JSON lines
- D-04: named OIDC tenant + SROS2 reference environment record
