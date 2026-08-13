/**
 * Headless live-subscribe harness: init → Node subscribe /chatter → assert samples.
 * Gate is process exit 0. Non-J-FT lanes set `RCLWEB_SUPPORT_ROW`; the harness
 * asserts the gateway's /configz support row matches so a lane cannot silently
 * exercise the wrong row/RMW.
 */
import path from "node:path";
import { init, Node, shutdown, std_msgs } from "rclweb";

const gatewayUrl =
  process.env.RCLWEB_GATEWAY_URL ?? "ws://127.0.0.1:8794/ws";
const healthUrl =
  process.env.RCLWEB_HEALTH_URL ?? "http://127.0.0.1:8794/healthz";
const minSamples = Number(process.env.RCLWEB_MIN_SAMPLES ?? "3");
const timeoutMs = Number(process.env.RCLWEB_TIMEOUT_MS ?? "30000");
const supportRow = process.env.RCLWEB_SUPPORT_ROW ?? "J-FT";

const repoRoot = path.resolve(import.meta.dir, "../..");
const defaultWasm = path.join(repoRoot, "typescript/wasm/rclweb.wasm");
const wasmUrl = process.env.RCLWEB_WASM_URL ?? pathToFileUrl(defaultWasm);

function pathToFileUrl(p: string): string {
  return `file://${path.resolve(p)}`;
}

async function waitHealthy(url: string, deadlineMs: number): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  let last = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const text = await res.text();
        if (text.trim() === "ok") return;
        last = text;
      } else {
        last = `status ${res.status}`;
      }
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    await Bun.sleep(250);
  }
  throw new Error(`gateway not healthy at ${url}: ${last}`);
}

async function assertGatewayRow(expectedRow: string): Promise<void> {
  const configzUrl = new URL("/configz", healthUrl).toString();
  const res = await fetch(configzUrl);
  if (!res.ok) {
    throw new Error(`GET ${configzUrl} failed: status ${res.status}`);
  }
  const config = (await res.json()) as {
    support_row_id?: string;
    ros_distro?: string;
    rmw_identifier?: string;
  };
  if (config.support_row_id !== expectedRow) {
    throw new Error(
      `gateway support row is ${config.support_row_id ?? "unknown"}, expected ${expectedRow}`,
    );
  }
  console.log(
    `gateway row ok: ${config.support_row_id} (${config.ros_distro} / ${config.rmw_identifier})`,
  );
}

async function main(): Promise<void> {
  await waitHealthy(healthUrl, timeoutMs);
  await assertGatewayRow(supportRow);

  await init(gatewayUrl, {
    inline: true,
    wasmUrl,
  });
  const node = new Node("e2e_harness");
  const samples: string[] = [];
  const samplePromise = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timeout waiting for ${minSamples} samples`)),
      timeoutMs,
    );
    node.createSubscription(std_msgs.msg.String, "/chatter", 10, (msg) => {
      samples.push(msg.data);
      if (samples.length >= minSamples) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  await samplePromise;
  await shutdown();

  console.log(`e2e ok (${supportRow}): ${samples.length} samples`);
}

await main();
