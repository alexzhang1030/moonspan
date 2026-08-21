/**
 * Application CLI: `npx rcl-web gen --package ./pkg --out src/generated.ts`.
 * Bundled as dist/cli.js (Node). Not imported by the browser package.
 */
import { runUserCli } from "../../scripts/rosidl-dts.ts";

const code = await runUserCli(process.argv.slice(2));
process.exit(code);
