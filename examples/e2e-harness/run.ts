/**
 * Headless live-subscribe harness: connect (inline) → subscribe /chatter → assert samples.
 * Gate is process exit 0. H-FT live e2e sets `RCLWEB_SUPPORT_ROW`.
 */
import path from "node:path";
import { connect, STD_MSGS_STRING } from "@rclweb/sdk";

const gatewayUrl =
  process.env.RCLWEB_GATEWAY_URL ?? "ws://127.0.0.1:8794/ws";
const healthUrl =
  process.env.RCLWEB_HEALTH_URL ?? "http://127.0.0.1:8794/healthz";
const minSamples = Number(process.env.RCLWEB_MIN_SAMPLES ?? "3");
const timeoutMs = Number(process.env.RCLWEB_TIMEOUT_MS ?? "30000");
const supportRow = process.env.RCLWEB_SUPPORT_ROW ?? "J-FT";

const repoRoot = path.resolve(import.meta.dir, "../..");
const defaultWasm = path.join(repoRoot, "sdk/typescript/wasm/rclweb.wasm");
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

async function main(): Promise<void> {
  await waitHealthy(healthUrl, timeoutMs);

  const client = await connect(gatewayUrl, {
    inline: true,
    wasmUrl,
  });

  const sub = await client.session.subscribe("/chatter", STD_MSGS_STRING);
  const samples: string[] = [];
  const samplePromise = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timeout waiting for ${minSamples} samples`)),
      timeoutMs,
    );
    sub.onMessage((msg, lease) => {
      samples.push(msg.data);
      lease.release();
      if (samples.length >= minSamples) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  await samplePromise;

  const engineTelemetry = client.telemetry();
  await client.close();

  console.log(`e2e ok (${supportRow}): ${samples.length} samples`);
  if (
    engineTelemetry &&
    engineTelemetry.copiesIntoEngine > 0 &&
    engineTelemetry.samplesEmitted < minSamples
  ) {
    throw new Error("telemetry samples_emitted below minSamples");
  }
}

await main();
