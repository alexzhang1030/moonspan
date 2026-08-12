# Evidence

Raw measurements from gated runs live here as sibling JSON (`r1-04-wasm-size.json`, `r3-03-h-ft-e2e.json`, …). They are the numbers from a run, not a qualification decision.

A row becomes **Qualified** only when a human updates the [support matrix](../support-matrix.md). There is no `evidence-check` CI job: git already versions these files, and `just build` rewrites timestamps on some of them.

The pre-restructure closed report contract (tag `pre-restructure`) stays parked.
