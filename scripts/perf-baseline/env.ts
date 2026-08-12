import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

export type EnvironmentIdentity = {
  recordedAt: string;
  hostname: string;
  platform: string;
  arch: string;
  cpus: number;
  totalMemBytes: number;
  nodeOrBun: string;
  rustc: string | null;
  supportRowTarget: string;
  dockerAvailable: boolean;
  rosSourced: boolean;
  amentPrefixPath: string | null;
  gitSha: string | null;
  githubSha: string | null;
  clockSyncMethod: string;
};

function captureVersion(cmd: string, args: string[]): string | null {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  if (r.status !== 0) return null;
  return (r.stdout || r.stderr || "").trim().split("\n")[0] ?? null;
}

function gitSha(root: string): string | null {
  const r = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  });
  if (r.status !== 0) return null;
  return r.stdout.trim() || null;
}

export function captureEnvironment(root: string): EnvironmentIdentity {
  let bunVersion = process.versions.bun ?? null;
  if (!bunVersion) {
    try {
      bunVersion = readFileSync(path.join(root, ".bun-version"), "utf8").trim();
    } catch {
      bunVersion = null;
    }
  }
  return {
    recordedAt: new Date().toISOString(),
    hostname: os.hostname(),
    platform: `${os.type()} ${os.release()}`,
    arch: os.arch(),
    cpus: os.cpus().length,
    totalMemBytes: os.totalmem(),
    nodeOrBun: bunVersion ? `bun ${bunVersion}` : `node ${process.version}`,
    rustc: captureVersion("rustc", ["--version"]),
    supportRowTarget: "J-FT",
    dockerAvailable: spawnSync("docker", ["version"], { encoding: "utf8" })
      .status === 0,
    rosSourced: Boolean(process.env.AMENT_PREFIX_PATH),
    amentPrefixPath: process.env.AMENT_PREFIX_PATH ?? null,
    gitSha: gitSha(root),
    githubSha: process.env.GITHUB_SHA ?? null,
    clockSyncMethod:
      "Same-process performance.now() for host/protocol paths; live ROS paths use message stamp vs receive time on loopback (shared OS clock, no NTP sync claim).",
  };
}
