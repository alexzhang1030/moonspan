# Evidence contracts

Moonspan stores machine-readable qualification evidence under `evidence/`.

## Qualification report v1 (M0-05a)

| Path | Role |
|---|---|
| [`schema/qualification-report-v1.json`](./schema/qualification-report-v1.json) | Public JSON Schema 2020-12 for the closed report contract |
| [`testdata/valid/`](./testdata/valid/) | Committed valid report fixtures |
| [`testdata/payloads/`](./testdata/payloads/) | Small payload files referenced by valid fixtures |

The Bun checker enforces the closed contract without third-party schema runtimes. Report JSON and referenced artifacts are treated as untrusted input.

### Required fields

- identity: code revision, fixture digest, package versions, image digests, environment/toolchain
- optional provenance: support row, gateway, domain IDs, adapter profile
- invocation: commands, workload, budgets, duration, sample and warm-up counts
- artifacts: role, repository-relative path, SHA-256, byte length, media type, retention policy
- measurements: optional timestamps/queues/resources plus errors and dispositions
- review: reviewer, decision, date, known limits

### Commands

```bash
bun run evidence:check
bun run test:evidence
just evidence-check
```

Root `bun run check` runs `evidence:check` exactly once after the CDR corpus check.

Phase 1 support rows remain H-FT, H-CY, H-ZN, J-FT, J-CY, and J-ZN. Studio stays a U0 side project after M3.
