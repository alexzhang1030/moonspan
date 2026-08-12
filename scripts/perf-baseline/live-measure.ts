/**
 * Live bridge latency probe (docker compose lane).
 * Compares loopback subscribe latency for stamped std_msgs/String on:
 * - rclwebd (R2WP / @rclweb/sdk)
 * - foxglove_bridge (Foxglove WS protocol)
 * - rosbridge_suite (rosbridge JSON)
 *
 * Large PointCloud2 live e2e remains protocol-cost + rclweb-host for now;
 * this lane owns clocked e2e p50/p99 on the small-message path.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { connect, STD_MSGS_STRING } from "@rclweb/sdk";
import { summarize } from "./stats.ts";

const evidenceDir =
  process.env.RCLWEB_EVIDENCE_DIR ??
  path.resolve(import.meta.dir, "../../docs/evidence");
const topic = process.env.RCLWEB_PERF_TOPIC ?? "/bench/stamp";
const minSamples = Number(process.env.RCLWEB_PERF_SAMPLES ?? "50");
const timeoutMs = Number(process.env.RCLWEB_PERF_TIMEOUT_MS ?? "60000");

const rclwebUrl = process.env.RCLWEB_GATEWAY_URL ?? "ws://127.0.0.1:8794/ws";
const foxgloveUrl = process.env.FOXGLOVE_URL ?? "ws://127.0.0.1:8765";
const rosbridgeUrl = process.env.ROSBRIDGE_URL ?? "ws://127.0.0.1:9090";

type PathResult = {
  system: string;
  status: "measured" | "failed";
  latencyMs?: ReturnType<typeof summarize>;
  samples?: number;
  error?: string;
};

function pathToFileUrl(p: string): string {
  return `file://${path.resolve(p)}`;
}

async function measureRclweb(): Promise<PathResult> {
  const repoRoot = path.resolve(import.meta.dir, "../..");
  const wasmUrl =
    process.env.RCLWEB_WASM_URL ??
    pathToFileUrl(path.join(repoRoot, "sdk/typescript/wasm/rclweb.wasm"));
  try {
    const client = await connect(rclwebUrl, { inline: true, wasmUrl });
    const sub = await client.session.subscribe(topic, STD_MSGS_STRING);
    const samples: number[] = [];
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("rclweb timeout")),
        timeoutMs,
      );
      sub.onMessage((msg, lease) => {
        const sent = Number(msg.data);
        if (Number.isFinite(sent) && sent > 0) {
          samples.push(Date.now() - sent);
        }
        lease.release();
        if (samples.length >= minSamples) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    await client.close();
    return {
      system: "rclwebd",
      status: "measured",
      latencyMs: summarize(samples),
      samples: samples.length,
    };
  } catch (err) {
    return {
      system: "rclwebd",
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function measureRosbridge(): Promise<PathResult> {
  try {
    const samples: number[] = [];
    const ws = new WebSocket(rosbridgeUrl);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("rosbridge open timeout")), 10_000);
      ws.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      });
      ws.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("rosbridge ws error"));
      });
    });
    ws.send(
      JSON.stringify({
        op: "subscribe",
        topic,
        type: "std_msgs/msg/String",
      }),
    );
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("rosbridge timeout")),
        timeoutMs,
      );
      ws.addEventListener("message", (ev) => {
        const text = typeof ev.data === "string" ? ev.data : String(ev.data);
        let msg: { op?: string; msg?: { data?: string } };
        try {
          msg = JSON.parse(text) as typeof msg;
        } catch {
          return;
        }
        if (msg.op !== "publish" || !msg.msg?.data) return;
        const sent = Number(msg.msg.data);
        if (Number.isFinite(sent) && sent > 0) {
          samples.push(Date.now() - sent);
        }
        if (samples.length >= minSamples) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    ws.close();
    return {
      system: "rosbridge_suite",
      status: "measured",
      latencyMs: summarize(samples),
      samples: samples.length,
    };
  } catch (err) {
    return {
      system: "rosbridge_suite",
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function measureFoxglove(): Promise<PathResult> {
  try {
    const samples: number[] = [];
    const ws = new WebSocket(foxgloveUrl, ["foxglove.websocket.v1"]);
    let channelId: number | null = null;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("foxglove open timeout")), 10_000);
      ws.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      });
      ws.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("foxglove ws error"));
      });
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("foxglove timeout")),
        timeoutMs,
      );
      ws.addEventListener("message", (ev) => {
        if (typeof ev.data === "string") {
          const msg = JSON.parse(ev.data) as {
            op: string;
            channels?: Array<{ id: number; topic: string; encoding: string }>;
          };
          if (msg.op === "advertise" && msg.channels) {
            const ch = msg.channels.find((c) => c.topic === topic);
            if (ch && channelId == null) {
              channelId = ch.id;
              ws.send(
                JSON.stringify({
                  op: "subscribe",
                  subscriptions: [{ id: 1, channelId: ch.id }],
                }),
              );
            }
          }
          return;
        }
        const buf = ev.data instanceof ArrayBuffer
          ? new Uint8Array(ev.data)
          : new Uint8Array(ev.data as ArrayBuffer);
        if (buf.byteLength < 13 || buf[0] !== 0x01) return;
        // CDR std_msgs/String: encapsulation + length + string bytes.
        // For this lane the publisher embeds performance.now() as decimal text;
        // Foxglove delivers CDR — decode a simple CDR string when possible.
        // Fallback: skip if we cannot parse.
        try {
          // ROS 2 CDR encapsulation header 4 bytes, then ulength + string.
          const view = new DataView(buf.buffer, buf.byteOffset + 13, buf.byteLength - 13);
          // encapsulation
          const enc = 13;
          const cdr = buf.subarray(enc);
          if (cdr.byteLength < 8) return;
          // little-endian CDR: 4 byte header, then u32 length, then chars
          const strLen = new DataView(
            cdr.buffer,
            cdr.byteOffset + 4,
            4,
          ).getUint32(0, true);
          const strBytes = cdr.subarray(8, 8 + Math.max(0, strLen - 1));
          const text = new TextDecoder().decode(strBytes);
          const sent = Number(text);
          if (Number.isFinite(sent) && sent > 0) {
            samples.push(Date.now() - sent);
          }
          void view;
        } catch {
          return;
        }
        if (samples.length >= minSamples) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    ws.close();
    return {
      system: "foxglove_bridge",
      status: "measured",
      latencyMs: summarize(samples),
      samples: samples.length,
    };
  } catch (err) {
    return {
      system: "foxglove_bridge",
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

const startedAt = new Date().toISOString();
const results = [
  await measureRclweb(),
  await measureRosbridge(),
  await measureFoxglove(),
];

const evidence = {
  task: "R2-04",
  kind: "perf-baseline-live",
  startedAt,
  finishedAt: new Date().toISOString(),
  supportRow: "J-FT",
  topic,
  typeName: STD_MSGS_STRING,
  workload:
    "Stamped std_msgs/String @ ~10 Hz on loopback; latency = Date.now() - wall-clock millis in msg.data (same machine clock).",
  pointCloud2Live:
    "Not measured in this lane; see host path + protocol-cost models in r2-04-perf-baseline.json.",
  paths: results,
  revision: {
    githubSha: process.env.GITHUB_SHA ?? null,
  },
};

mkdirSync(evidenceDir, { recursive: true });
const outPath = path.join(evidenceDir, "r2-04-perf-live.json");
writeFileSync(outPath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`live evidence → ${outPath}`);
console.log(JSON.stringify(results, null, 2));

if (results.every((r) => r.status === "failed")) {
  process.exit(1);
}
