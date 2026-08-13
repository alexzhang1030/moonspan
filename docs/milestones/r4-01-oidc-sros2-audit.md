# R4-01: OIDC identity, SROS2/ACL, audit

Status: In progress. Production OIDC tenant and SROS2 keystore remain
[D-04](../../tasks/plan.md#kickoff-decision-register). The first slice
made Authenticate a real policy surface without picking a vendor; the
second makes OpenChannel authorization real without picking a policy
matrix.

## Outcome (first slice — Authenticate)

| Area | Behavior |
|---|---|
| `off` (default) | Auth disabled. Any credential is accepted; SessionReady field 21 stays `anonymous`; no audit. Same as R1–R3. `dev` is an alias. |
| `oidc` | JWT with issuer + audience + signature (`HS256` secret or JWKS). Fail closed at process start if issuer/audience/keys are missing. Fail Authenticate with wire code 26 (`authentication_failed`) and close. |
| Audit | One JSON line per Authenticate **in `oidc` mode** (`rclwebd audit {…}`) with decision, subject, scheme, gateway/row/domain, and `ROS_SECURITY_ENABLE` if set. Off mode is silent. |

## Outcome (this slice — channel ACLs)

`RCLWEBD_ACL_MODE=enforce` turns OpenChannel into **default-deny**: a
channel is admitted only when an allow rule matches the authenticated
subject, the operation kind (channel class 0–5), and the ROS name. All
six operation kinds flow through OpenChannel, so subscribe, publish,
service, and action are all covered. Denials fail the channel with wire
code 12 (`permission_denied`); the session stays up.

| Area | Behavior |
|---|---|
| `off` (default) | Every OpenChannel is admitted. Same as R1–R3. |
| `enforce` | Default-deny over `{subjects, operations, names}` allow rules. `"*"` matches any subject/name; a trailing `*` on a name is a prefix glob (`/tf*`). Missing or invalid policy fails process start. |
| Identity | The subject is the Authenticate result (SessionReady field 21) — `anonymous` in `off` auth, the JWT `sub` in `oidc`. ACLs and OIDC compose but do not require each other. |
| Revision | A policy `revision` becomes the SessionReady `policy_revision`, so clients see which matrix admitted them. |
| Audit | One JSON line per OpenChannel decision (allow and deny) **in `enforce` mode**, with subject, operation, name, type, and gateway/row/domain/policy identity. |
| Ops | `/configz` reports `acl_mode` and `acl_rules` (rule count only — never the policy body). |

The *content* of the rules is the reviewed policy matrix and stays a human
input, the same split as the first slice not picking an OIDC tenant.

## Config

```bash
RCLWEBD_AUTH_MODE=off|oidc          # default off (`dev` is an alias for off)
RCLWEBD_OIDC_ISSUER=https://…
RCLWEBD_OIDC_AUDIENCE=rclwebd
RCLWEBD_OIDC_HS_SECRET=…            # tests / local HS256
RCLWEBD_OIDC_JWKS='{"keys":[…]}'    # or RCLWEBD_OIDC_JWKS_PATH
RCLWEBD_ACL_MODE=off|enforce        # default off
RCLWEBD_ACL='{"revision":"…","rules":[{"subjects":["*"],"operations":["subscribe"],"names":["/chatter"]}]}'
RCLWEBD_ACL_PATH=/etc/rclwebd/acl.json   # alternative to RCLWEBD_ACL
```

D-04 still owns *which* issuer and *which* SROS2 keystore. The gateway only
consumes those values.

## Delivered scope

| Surface | Location |
|---|---|
| Verifier + audit | [`rclwebd/src/auth.rs`](../../rclwebd/src/auth.rs) |
| ACL policy + audit | [`rclwebd/src/acl.rs`](../../rclwebd/src/acl.rs) |
| Authenticate + OpenChannel gates | [`rclwebd/src/connection.rs`](../../rclwebd/src/connection.rs) |
| Env wiring | [`rclwebd/src/main.rs`](../../rclwebd/src/main.rs), [`GatewayConfig`](../../rclwebd/src/config.rs) |

## Acceptance evidence

```bash
cargo test --locked -p rclwebd --lib auth::
cargo test --locked -p rclwebd --lib acl::
cargo test --locked -p rclwebd --test ws_gateway
just check && just test && just build
```

## Still open in R4-01

- The reviewed policy matrix itself (rule content is a human input)
- SROS2 enclave identity, keystore provenance, browser-to-ROS mapping
- Audit sink (integrity, retention, export) beyond stderr JSON lines
- D-04: named OIDC tenant + SROS2 reference environment record
