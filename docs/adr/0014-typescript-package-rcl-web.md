# 0014: TypeScript package publishes as `rcl-web`

## Status

Accepted

## Date

2026-08-13

## Context

[ADR 0013](./0013-typescript-package-rclweb.md) named the Bun and npm
package unscoped `rclweb`, imported as `rclweb` and `rclweb/internal`.
npm rejects that name as too similar to the existing package
[`rrweb`](https://www.npmjs.com/package/rrweb) (403), even though
`GET https://registry.npmjs.org/rclweb` is 404. ADR 0013's revisit
trigger fired.

## Decision

- The TypeScript package name, import specifier, and npm publish name is
  unscoped `rcl-web` (`rcl-web/internal`).
- It still lives at `typescript/`. There is still no `sdk/` tree. It is
  not `@rclweb/sdk`.
- The Rust crate stays `rclweb`. The product and repository stay rclweb.
- This supersedes the unscoped `rclweb` publish and import name in
  ADR 0013. The `typescript/` location and the rejection of
  `@rclweb/sdk` stand.

## Rationale

Owner ruling (2026-08-13): try `rcl-web` after the npm 403 vs `rrweb`.
`GET https://registry.npmjs.org/rcl-web` is 404 (unpublished). Only a
human `npm publish` can prove npm's similarity check accepts it.

## Consequences

- Examples and scripts depend on `"rcl-web": "workspace:*"`.
- `just build` / `just check` use `--filter rcl-web`.
- The first published version remains `0.0.1`. The tarball must include
  `LICENSE` and `NOTICE`.
- If npm also 403s `rcl-web`, this ADR's revisit fires.

## Revisit triggers

- npm rejects `rcl-web` (similarity or other 403).
- The unscoped name `rclweb` becomes publishable and the owner wants to
  reclaim it.

## Source

Owner direction 2026-08-13 after npm 403 on `rclweb`.
