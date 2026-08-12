# Evidence

Raw measurements live as sibling JSON under this directory (`r1-04-wasm-size.json`, `r3-03-h-ft-e2e.json`, …). They are the numbers from a run.

[`reports/`](./reports/) is a thin index: each file names a gate, points at those measurements with a sha256, and records whether a human has reviewed them. `pending` is not **Qualified**.

`just evidence-check` only verifies:

- each report JSON parses;
- `gate` is R0–R4 / U0 / X0;
- every `artifacts[].path` exists and its sha256 still matches;
- `review.decision` is `pending` without a reviewer, or `accept` / `reject` / `provisional` with one.

It does not generate a JSON Schema, does not keep synthetic fixtures, and does not require identity maps, invocation bounds, or canonical pretty-print. Extra fields on a report are ignored.

```bash
just evidence-check
```

Root `bun run check` runs that after the generated-types check.
