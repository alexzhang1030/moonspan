import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    internal: "src/internal.ts",
    "worker/io-worker": "src/worker/io-worker.ts",
  },
  platform: "browser",
  format: "esm",
  dts: true,
  clean: true,
  outDir: "dist",
});
