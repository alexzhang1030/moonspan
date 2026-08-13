import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  LARGE_FRAME_INLINE_THRESHOLD,
  SharedArrayBufferRingStrategy,
  TransferableArrayBufferStrategy,
  createBufferStrategy,
  encodeHostBatch,
  loadWasm,
  pollEngine,
  readTelemetry,
  sharedArrayBufferConstructible,
} from "../src/internal.ts";

const wasmPath = path.join(import.meta.dir, "..", "wasm", "rclweb.wasm");

function loadWasmBytes(): ArrayBuffer {
  const bytes = readFileSync(wasmPath);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

test("encodeHostBatch two-pass handles ~1 MiB frame without RangeError", () => {
  const payload = new Uint8Array(1024 * 1024);
  for (let i = 0; i < payload.length; i += 4096) payload[i] = i & 0xff;
  const batch = encodeHostBatch([
    { type: "wsBytes", bufferId: 0, bytes: payload },
  ]);
  expect(batch.length).toBe(12 + 4 + 12 + payload.length);
  // Spot-check magic + inline payload tail byte.
  expect(batch[0]).toBe(0x42); // 'B' of RCLB little-endian 0x52434c42
  expect(batch[batch.length - 1]).toBe(payload[payload.length - 1]!);
});

test("transferable strategy drains owned frames", () => {
  const strategy = new TransferableArrayBufferStrategy();
  const frame = new Uint8Array(128);
  frame[0] = 7;
  expect(strategy.write(frame)).toBe(true);
  frame[0] = 0; // mutate source — drained copy must stay stable
  const drained = strategy.drain();
  expect(drained.length).toBe(1);
  expect(drained[0]![0]).toBe(7);
  const stats = strategy.stats();
  expect(stats.hostCopies).toBe(1);
  expect(stats.strategy).toBe("transferable-arraybuffer");
});

test("shared-arraybuffer ring round-trips a large frame when SAB is available", () => {
  if (!sharedArrayBufferConstructible()) {
    // Evidence gate: environment cannot construct SAB.
    expect(sharedArrayBufferConstructible()).toBe(false);
    return;
  }
  const strategy = new SharedArrayBufferRingStrategy(2 * 1024 * 1024);
  const frame = new Uint8Array(256 * 1024);
  for (let i = 0; i < frame.length; i++) frame[i] = i & 0xff;
  expect(strategy.write(frame)).toBe(true);
  const drained = strategy.drain();
  expect(drained.length).toBe(1);
  expect(drained[0]!.length).toBe(frame.length);
  expect(drained[0]![0]).toBe(0);
  expect(drained[0]![255]).toBe(255);
  const stats = strategy.stats();
  expect(stats.strategy).toBe("shared-arraybuffer-ring");
  expect(stats.sabAvailable).toBe(true);
  expect(stats.isolationRequired).toBe(true);
  expect(stats.dropCount).toBe(0);
  // write + drain = 2 host copies for this strategy's accounting
  expect(stats.hostCopies).toBe(2);
});

test("createBufferStrategy factory", () => {
  expect(createBufferStrategy("transferable-arraybuffer").name).toBe(
    "transferable-arraybuffer",
  );
  if (sharedArrayBufferConstructible()) {
    expect(createBufferStrategy("shared-arraybuffer-ring").name).toBe(
      "shared-arraybuffer-ring",
    );
  }
});

test("wsBytes poll uses external path and records one engine copy", async () => {
  const wasm = await loadWasm(loadWasmBytes());
  const handle = wasm.rclweb_engine_new();
  expect(handle).toBeGreaterThan(0);
  try {
    // Bootstrap start so engine is alive; garbage WS bytes will fail
    // bootstrap parse but still count as a retained copy.
    pollEngine(wasm, handle, [
      {
        type: "command",
        command: { type: "start", transferableArrayBuffer: true },
      },
    ]);
    // 32 KiB is the medium-message validation target; 64 KiB was the
    // old inline/external split. Both must take the one-copy path.
    for (const size of [128, 32 * 1024, LARGE_FRAME_INLINE_THRESHOLD]) {
      const frame = new Uint8Array(size);
      frame[0] = 0x00;
      frame[1] = 0x01;
      const before = readTelemetry(wasm, handle);
      pollEngine(wasm, handle, [
        { type: "wsBytes", bufferId: 0, bytes: frame },
      ]);
      const after = readTelemetry(wasm, handle);
      expect(after.copiesIntoEngine - before.copiesIntoEngine).toBe(1);
      expect(after.bytesCopiedIntoEngine - before.bytesCopiedIntoEngine).toBe(
        frame.length,
      );
    }
  } finally {
    wasm.rclweb_engine_free(handle);
  }
});
