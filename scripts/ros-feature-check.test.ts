import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");

function uncommented(source: string): string {
  return source
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
}

const JAZZY_PIN =
  "docker.io/library/ros:jazzy-ros-base-noble@sha256:da725acf8b0f9f30c683e33ffbdcd6482d077af96d6fdc7688c5f4f280b7d923";
const CHECK_CMD = "cargo check --locked -p rclwebd --features ros --tests";
const CLIPPY_CMD = "cargo clippy --locked -p rclwebd --features ros --all-targets -- -D warnings";

describe("ros-feature compile gate", () => {
  test("Dockerfile compiles ros-feature tests and does not run cargo test", () => {
    const dockerfile = readFileSync(path.join(root, "docker/Dockerfile.ros-feature-check"), "utf8");
    const body = uncommented(dockerfile);
    expect(dockerfile).toContain(JAZZY_PIN);
    expect(body).toContain(CHECK_CMD);
    expect(body).toContain(CLIPPY_CMD);
    expect(body).not.toMatch(/cargo\s+test\b/);
  });

  test("compose build is the gate and points at the compile-only Dockerfile", () => {
    const compose = readFileSync(path.join(root, "docker/compose.ros-feature-check.yml"), "utf8");
    const body = uncommented(compose);
    expect(body).toContain("dockerfile: docker/Dockerfile.ros-feature-check");
    expect(body).not.toMatch(/cargo\s+test\b/);
  });

  test("CI job builds the compile-only compose and does not run cargo test", () => {
    const ci = readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8");
    expect(ci).toContain("ros-feature-check:");
    expect(ci).toContain("docker/compose.ros-feature-check.yml");
    const job = ci.split("ros-feature-check:")[1]?.split(/^  [a-z]/m)[0] ?? "";
    expect(job).toContain("docker compose -f docker/compose.ros-feature-check.yml build");
    expect(uncommented(job)).not.toMatch(/cargo\s+test\b/);
    expect(uncommented(job)).not.toMatch(/\bjust test\b/);
  });
});
