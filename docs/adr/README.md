# Architecture decision records

ADRs capture accepted decisions that carry significant reversal cost. Technical proposals remain design baselines until an ADR and its named evidence gate accept them.

## Register

| ADR | Status | Decision |
|---|---|---|
| [0001](./0001-mainline-before-common-prototype.md) | Accepted | Complete the platform mainline before starting the common Studio prototype. |
| [0002](./0002-use-bun-for-javascript-tooling.md) | Accepted | Use Bun for JavaScript workspaces, dependencies, lockfile, scripts, tests, and builds. |

## Convention

- Files use four-digit sequence numbers and lowercase hyphenated names.
- Each record states status, date, context, decision, rationale, consequences, revisit triggers, and source.
- A changed decision receives a new ADR that names the superseded record.
- M0-01 continues the sequence for runtime, protocol, edge, support-profile, and licensing decisions.
