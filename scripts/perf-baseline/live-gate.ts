/**
 * Live three-way bridge comparison is docker + ROS gated.
 * Compose is opt-in via `just perf-baseline-live`; this module only records
 * whether live evidence is present and whether Docker could run it.
 */

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

export type LivePathStatus = {
  status: "measured" | "skipped";
  reason: string;
  composeFile: string;
  command: string;
  evidencePath: string;
  evidencePresent: boolean;
  dockerAvailable: boolean;
  note: string;
};

export function probeLiveComparison(root: string): LivePathStatus {
  const composeFile = "docker/compose.r2-04-perf.yml";
  const command = "just perf-baseline-live";
  const evidencePath = "docs/evidence/r2-04-perf-live.json";
  const evidencePresent = existsSync(path.join(root, evidencePath));
  const dockerAvailable =
    spawnSync("docker", ["version"], { encoding: "utf8" }).status === 0;

  if (evidencePresent) {
    return {
      status: "measured",
      reason: "live_evidence_present",
      composeFile,
      command,
      evidencePath,
      evidencePresent,
      dockerAvailable,
      note: "Attached existing r2-04-perf-live.json from the docker compose lane.",
    };
  }

  if (!dockerAvailable) {
    return {
      status: "skipped",
      reason: "docker_unavailable",
      composeFile,
      command,
      evidencePath,
      evidencePresent,
      dockerAvailable,
      note: "Host + protocol-cost paths still form the committed baseline. Install Docker and run `just perf-baseline-live` to fill live Foxglove/rosbridge/rclwebd e2e numbers.",
    };
  }

  return {
    status: "skipped",
    reason: "live_not_run",
    composeFile,
    command,
    evidencePath,
    evidencePresent,
    dockerAvailable,
    note: "Docker is available but live evidence is absent. Run `just perf-baseline-live` (heavy image) to produce r2-04-perf-live.json, then re-run `just perf-baseline`.",
  };
}
