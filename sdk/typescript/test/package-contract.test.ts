import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const packageJsonPath = path.join(import.meta.dir, "..", "package.json");
const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
  name: string;
  version: string;
  private: boolean;
  type: string;
};

test("sdk package identity and privacy", () => {
  expect(pkg.name).toBe("@rclweb/sdk");
  expect(pkg.version).toBe("0.0.0");
  expect(pkg.private).toBe(true);
  expect(pkg.type).toBe("module");
});
