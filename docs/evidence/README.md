# Evidence contracts

rclweb stores raw measurements under `docs/evidence/*.json` and machine-readable qualification reports under `docs/evidence/reports/`. Raw files are not reports; a report wraps them with identity, provenance, invocation, integrity, and review.

## Qualification report v1 (R4-03)

Recycles the pre-restructure M0-05a contract (tag `pre-restructure`) with R0–R4 gates and `report_id` `rclweb-qualification-report-v1`.

| Path | Role |
|---|---|
| [`schema/qualification-report-v1.json`](./schema/qualification-report-v1.json) | Public JSON Schema 2020-12 generated from `scripts/evidence-schema.ts` |
| [`reports/`](./reports/) | Real gate reports (must reference committed artifacts) |
| [`testdata/valid/`](./testdata/valid/) | Closed valid report fixtures |
| [`testdata/payloads/`](./testdata/payloads/) | Payload files referenced by valid fixtures |

**Module split:** `scripts/evidence-model.ts` holds pure enums, bounds, key arrays, regexes, and helpers; `scripts/evidence-contract.ts` runs document validation; `scripts/evidence-schema.ts` builds the public schema from the model; `scripts/evidence-check.ts` owns filesystem I/O and the CLI (re-exports the stable test-facing API).

The public schema carries expressible structure and semantics (gate/level mapping, N1/N2 provenance, scalar anyOf bounds, path segment pattern, date format). The Bun checker adds canonical ordering, real calendar dates, path confinement, symlink rejection, closed corpus checks, and artifact integrity.

Report JSON and referenced payloads are untrusted input. `docs-check` skips a directory named `reports`; keep this folder JSON-only and put prose here.

### Required fields

- identity: code revision, sorted `fixture_manifests`, package versions, image digests (may be empty), environment with required `environment_id`
- optional provenance: support row (required for N1/N2), gateway, domain IDs, adapter profile
- invocation: commands, workload, budgets, duration, sample and warm-up counts
- artifacts: role, repository-relative path, SHA-256, byte length (max 16 MiB), media type, retention policy
- measurements: optional timestamps/queues/resources plus errors and dispositions
- review: `pending` without reviewer/date, or human `accept`/`reject`/`provisional` with reviewer and calendar date

### Gate and evidence level mapping

| Gate | Allowed evidence levels |
|---|---|
| R0 | foundation |
| R1 | foundation, N1 |
| R2 | N1 |
| R3 | N1, N2 |
| R4 | operations, security |
| U0 | prototype |
| X0 | N3 |

R1 allows `foundation` for host measurements (wasm size, poll latency) that do not claim a support row. Live row evidence is `N1`/`N2` and must name `provenance.support_row_id`.

A row becomes **Qualified** only after human `review.decision = accept`. Committed reports in this slice are `pending`. Remaining Phase 1 rows (H-CY, H-ZN, J-CY, J-ZN) have no live gateway e2e lane here.

### Commands

```bash
bun run evidence:write    # regenerate public schema from contract constants
bun run evidence:check    # schema identity + fixtures + gate reports + artifact integrity
bun run test:evidence
just evidence-write
just evidence-check
```

Root `bun run check` runs `evidence:check` after the generated-types check.
