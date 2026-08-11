# R2WP v0 cross-language agreement

TypeScript, Rust, and MoonBit read the same R2WP v0 fixtures and produce matching canonical outcomes. The agreement runner checks this contract and records the result.

| Artifact | Role |
|---|---|
| [`expected.json`](./expected.json) | Expected outcomes produced from the committed fixtures |
| [`report.json`](./report.json) | Agreement result for all three implementations |

The corpus covers valid messages, boundary values, receiver sequences, malformed input, transport parity, and the Phase 1 Humble and Jazzy support rows.

## Commands

```bash
bun run protocol-agree          # reconstruct expected results, run emitters, verify report
bun run protocol-agree:write    # regenerate protocol/testdata/agreement/report.json
bun run test:protocol-agree     # focused orchestrator suite
just protocol-agree
just protocol-agree-write
```

## Components

- [`scripts/protocol-agree.ts`](../../../scripts/protocol-agree.ts): TypeScript outcome projection and diagnostics
- [`scripts/protocol-agree-run.ts`](../../../scripts/protocol-agree-run.ts): agreement orchestrator
- [`rclwebd/tests/protocol_agreement.rs`](../../../rclwebd/tests/protocol_agreement.rs): Rust emitter
- [`rclmbt/cmd/agree/`](../../../rclmbt/cmd/agree/): MoonBit emitter

## Result format

- Each outcome has a stable fixture identity, parser kind, input length, and digest.
- Successful parses contain a compact semantic projection.
- Rejected inputs contain the registry error code, location, plane, and validation step.
- Transport parity binds WebTransport and binary WebSocket inputs to the same semantic result.
- Source digests and Phase 1 support rows provide provenance.

Detailed counts, digests, and source identities live in [`report.json`](./report.json). Git history records delivery revisions.
