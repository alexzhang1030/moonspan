/**
 * Live bridge latency / CPU / memory probe (docker compose lane).
 * Compares loopback subscribe latency for stamped std_msgs/String on:
 * - rclwebd (R2WP / rclweb)
 * - foxglove_bridge (Foxglove WS protocol)
 * - rosbridge_suite (rosbridge JSON)
 *
 * Large PointCloud2 live e2e remains the host ingest probe
 * (`just perf-baseline`) for now; this lane owns clocked e2e p50/p99 plus
 * client-process CPU and RSS on the small-message path.
 */

import path from "node:path";
import { init, Node, shutdown, std_msgs } from "rcl-web";
import {
  cpuDeltaUs,
  cpuStart,
  snapshotMemory,
  tryGc,
} from "./resources.ts";
import { summarize } from "./stats.ts";

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
  cpuUsPerSample?: number;
  rssBytes?: number;
  heapUsedBytes?: number;
  rssDeltaBytes?: number;
  error?: string;
};

function pathToFileUrl(p: string): string {
  return `file://${path.resolve(p)}`;
}

async function measureRclweb(): Promise<PathResult> {
  const repoRoot = path.resolve(import.meta.dir, "../..");
  const wasmUrl =
    process.env.RCLWEB_WASM_URL ??
    pathToFileUrl(path.join(repoRoot, "typescript/wasm/rclweb.wasm"));
  try {
    await init(rclwebUrl, { inline: true, wasmUrl });
    const node = new Node("perf_measure");
    const samples: number[] = [];
    tryGc();
    const mem0 = snapshotMemory();
    const cpu0 = cpuStart();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("rclweb timeout")),
        timeoutMs,
      );
      node.createSubscription(std_msgs.msg.String, topic, 10, (msg) => {
        const sent = Number(msg.data);
        if (Number.isFinite(sent) && sent > 0) {
          samples.push(Date.now() - sent);
        }
        if (samples.length >= minSamples) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    const cpuUs = cpuDeltaUs(cpu0);
    const mem1 = snapshotMemory();
    await shutdown();
    return {
      system: "rclwebd",
      status: "measured",
      latencyMs: summarize(samples),
      samples: samples.length,
      cpuUsPerSample: Number((cpuUs / Math.max(1, samples.length)).toFixed(1)),
      rssBytes: mem1.rssBytes,
      heapUsedBytes: mem1.heapUsedBytes,
      rssDeltaBytes: mem1.rssBytes - mem0.rssBytes,
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
    tryGc();
    const mem0 = snapshotMemory();
    const cpu0 = cpuStart();
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
    const cpuUs = cpuDeltaUs(cpu0);
    const mem1 = snapshotMemory();
    return {
      system: "rosbridge_suite",
      status: "measured",
      latencyMs: summarize(samples),
      samples: samples.length,
      cpuUsPerSample: Number((cpuUs / Math.max(1, samples.length)).toFixed(1)),
      rssBytes: mem1.rssBytes,
      heapUsedBytes: mem1.heapUsedBytes,
      rssDeltaBytes: mem1.rssBytes - mem0.rssBytes,
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

    tryGc();
    const mem0 = snapshotMemory();
    const cpu0 = cpuStart();
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
    const cpuUs = cpuDeltaUs(cpu0);
    const mem1 = snapshotMemory();
    return {
      system: "foxglove_bridge",
      status: "measured",
      latencyMs: summarize(samples),
      samples: samples.length,
      cpuUsPerSample: Number((cpuUs / Math.max(1, samples.length)).toFixed(1)),
      rssBytes: mem1.rssBytes,
      heapUsedBytes: mem1.heapUsedBytes,
      rssDeltaBytes: mem1.rssBytes - mem0.rssBytes,
    };
  } catch (err) {
    return {
      system: "foxglove_bridge",
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

const results = [
  await measureRclweb(),
  await measureRosbridge(),
  await measureFoxglove(),
];

console.log(JSON.stringify(results, null, 2));

if (results.every((r) => r.status === "failed")) {
  process.exit(1);
}
