# Evidence contracts

Moonspan stores machine-readable qualification evidence under `evidence/`.

## Qualification report v1 (M0-05a)

| Path | Role |
|---|---|
| [`schema/qualification-report-v1.json`](./schema/qualification-report-v1.json) | Public JSON Schema 2020-12 generated from `scripts/evidence-contract.ts` |
| [`testdata/valid/`](./testdata/valid/) | Committed valid report fixtures only (closed corpus) |
| [`testdata/payloads/`](./testdata/payloads/) | Small payload files referenced by valid fixtures |

The Bun checker and the committed JSON Schema share one TypeScript contract source. Report JSON and referenced payloads are untrusted input.

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
| M0 | foundation |
| M1 | N1 |
| M2 | N2 |
| M3 | operations, security |
| U0 | prototype |
| X0 | N3 |

### Commands

```bash
bun run evidence:write    # regenerate public schema from contract constants
bun run evidence:check    # schema identity + valid corpus + artifact integrity
bun run test:evidence
just evidence-write
just evidence-check
```

Root `bun run check` runs `evidence:check` exactly once after the CDR corpus check.

Phase 1 support rows remain H-FT, H-CY, H-ZN, J-FT, J-CY, and J-ZN. Studio stays a U0 side project after M3.
