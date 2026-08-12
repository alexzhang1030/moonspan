/**
 * Headless live-subscribe harness: connect (inline) → subscribe /chatter → assert samples.
 * Default evidence path is R1-05 / J-FT; H-FT live e2e overrides via env
 * (`RCLWEB_SUPPORT_ROW`, `RCLWEB_EVIDENCE_FILE`, `RCLWEB_TASK`).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { connect, STD_MSGS_STRING } from "@rclweb/sdk";

const gatewayUrl =
  process.env.RCLWEB_GATEWAY_URL ?? "ws://127.0.0.1:8794/ws";
const healthUrl =
  process.env.RCLWEB_HEALTH_URL ?? "http://127.0.0.1:8794/healthz";
const telemetryUrl =
  process.env.RCLWEB_TELEMETRY_URL ?? "http://127.0.0.1:8794/telemetryz";
const minSamples = Number(process.env.RCLWEB_MIN_SAMPLES ?? "3");
const timeoutMs = Number(process.env.RCLWEB_TIMEOUT_MS ?? "30000");
const supportRow = process.env.RCLWEB_SUPPORT_ROW ?? "J-FT";
const evidenceFile = process.env.RCLWEB_EVIDENCE_FILE ?? "r1-05-e2e.json";
const task = process.env.RCLWEB_TASK ?? "R1-05";
const evidenceDir =
  process.env.RCLWEB_EVIDENCE_DIR ??
  path.resolve(import.meta.dir, "../../docs/evidence");

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
  const startedAt = new Date().toISOString();
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
  let gatewayTelemetry: Record<string, number> | null = null;
  try {
    const res = await fetch(telemetryUrl);
    if (res.ok) {
      gatewayTelemetry = (await res.json()) as Record<string, number>;
    }
  } catch {
    gatewayTelemetry = null;
  }

  await client.close();

  const evidence = {
    task,
    kind: "e2e-live-subscribe",
    startedAt,
    finishedAt: new Date().toISOString(),
    supportRow,
    gatewayUrl,
    topic: "/chatter",
    typeName: STD_MSGS_STRING,
    samplesReceived: samples.length,
    samplePreview: samples.slice(0, 3),
    engineTelemetry,
    gatewayTelemetry,
    copyBudget: {
      targetControllableCopies: 2,
      gatewayControllableCopiesPerSample:
        gatewayTelemetry?.controllable_copies_per_sample ?? 1,
      browserControllableCopy: "Worker/host → engine retained memory (copiesIntoEngine)",
      applicationDelivery: "borrowed view / decoded string_data (0 controllable)",
    },
    revision: {
      note: "filled by CI when available",
      githubSha: process.env.GITHUB_SHA ?? null,
    },
  };

  mkdirSync(evidenceDir, { recursive: true });
  const outPath = path.join(evidenceDir, evidenceFile);
  writeFileSync(outPath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(
    `e2e ok (${supportRow}): ${samples.length} samples; evidence → ${outPath}`,
  );
  if (
    engineTelemetry &&
    engineTelemetry.copiesIntoEngine > 0 &&
    engineTelemetry.samplesEmitted < minSamples
  ) {
    throw new Error("telemetry samples_emitted below minSamples");
  }
}

await main();
