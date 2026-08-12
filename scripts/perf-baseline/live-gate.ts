/**
 * Live three-way bridge comparison is docker + ROS gated.
 * Compose is opt-in via `just perf-baseline-live`; this module only records
 * whether Docker could run it. Live numbers print from that compose; they
 * are not merged from a committed JSON file.
 */

import { spawnSync } from "node:child_process";

export type LivePathStatus = {
  status: "skipped";
  reason: string;
  composeFile: string;
  command: string;
  dockerAvailable: boolean;
  note: string;
};

export function probeLiveComparison(): LivePathStatus {
  const composeFile = "docker/compose.r2-04-perf.yml";
  const command = "just perf-baseline-live";
  const dockerAvailable =
    spawnSync("docker", ["version"], { encoding: "utf8" }).status === 0;

  if (!dockerAvailable) {
    return {
      status: "skipped",
      reason: "docker_unavailable",
      composeFile,
      command,
      dockerAvailable,
      note: "Host + protocol-cost paths still form the baseline. Live Foxglove/rosbridge/rclwebd numbers: `just perf-baseline-live`.",
    };
  }

  return {
    status: "skipped",
    reason: "live_is_separate_compose",
    composeFile,
    command,
    dockerAvailable,
    note: "Live three-way comparison is `just perf-baseline-live` (prints to stdout). This host script does not merge a JSON file.",
  };
}
