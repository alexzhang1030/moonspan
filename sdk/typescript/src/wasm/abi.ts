/**
 * Flat binary poll batch codec (mirrors `rclweb::host::batch`).
 * Little-endian. The SDK never parses R2WP — only this host ABI.
 */

export const BATCH_MAGIC = 0x5243_4c42; // RCLB
export const RESULT_MAGIC = 0x5243_4c52; // RCLR
export const LAYOUT_VERSION = 1;
export const FLAG_INLINE_WS_BYTES = 0x0001;

export const EVENT_WS_BYTES = 1;
export const EVENT_TIMER = 2;
export const EVENT_COMMAND = 3;
export const EVENT_RELEASE = 4;

export const CMD_START = 1;
export const CMD_AUTHENTICATE = 2;
export const CMD_SUBSCRIBE = 3;
export const CMD_UNSUBSCRIBE = 4;
export const CMD_CLOSE = 5;

export const APP_BOOTSTRAP_COMPLETE = 1;
export const APP_SESSION_READY = 2;
export const APP_SUBSCRIBED = 3;
export const APP_SUBSCRIBE_FAILED = 4;
export const APP_SAMPLE = 5;
export const APP_HEARTBEAT = 6;
export const APP_ERROR = 7;
export const APP_CLOSED = 8;

export type HostCommand =
  | { type: "start"; transferableArrayBuffer: boolean }
  | {
      type: "authenticate";
      correlation: Uint8Array;
      scheme: string;
      token: Uint8Array;
    }
  | {
      type: "subscribe";
      correlation: Uint8Array;
      channelId: number;
      topic: string;
      typeName: string;
      qosReliability: number;
      domainId: number;
    }
  | { type: "unsubscribe"; correlation: Uint8Array; channelId: number }
  | { type: "close" };

export type HostEventInput =
  | { type: "wsBytes"; bufferId: number; bytes: Uint8Array }
  | { type: "timer"; nowMs: bigint }
  | { type: "command"; command: HostCommand }
  | { type: "releaseLease"; leaseId: number };

export type AppEvent =
  | { type: "bootstrapComplete"; selectedWireVersion: number }
  | {
      type: "sessionReady";
      domainId: number;
      supportRow: string;
      gatewayInstanceId: string;
    }
  | { type: "subscribed"; channelId: number; topic: string; typeName: string }
  | {
      type: "subscribeFailed";
      channelId: number;
      code: number;
      message: string;
    }
  | {
      type: "sample";
      channelId: number;
      leaseId: number;
      sequence: bigint;
      sourceTimeNs: bigint;
      payloadPtr: number;
      payloadLen: number;
      stringData: string | null;
    }
  | { type: "heartbeat"; counter: bigint }
  | { type: "error"; code: number; message: string }
  | { type: "closed"; phase: number };

export type PollResult = {
  outbound: Array<{ bufferId: number; bytes: Uint8Array }>;
  events: AppEvent[];
  released: Array<{ bufferId: number; len: number }>;
  nextDeadlineMs: bigint | null;
};

const te = new TextEncoder();
const td = new TextDecoder();

function writeU16(out: number[], value: number): void {
  out.push(value & 0xff, (value >>> 8) & 0xff);
}
function writeU32(out: number[], value: number): void {
  out.push(
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  );
}
function writeU64(out: number[], value: bigint): void {
  const lo = Number(value & 0xffffffffn);
  const hi = Number((value >> 32n) & 0xffffffffn);
  writeU32(out, lo);
  writeU32(out, hi);
}
function writeI64(out: number[], value: bigint): void {
  writeU64(out, BigInt.asUintN(64, value));
}

function readU16(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}
function readU32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset]! |
      (bytes[offset + 1]! << 8) |
      (bytes[offset + 2]! << 16) |
      (bytes[offset + 3]! << 24)) >>>
    0
  );
}
function readU64(bytes: Uint8Array, offset: number): bigint {
  const lo = BigInt(readU32(bytes, offset));
  const hi = BigInt(readU32(bytes, offset + 4));
  return lo + (hi << 32n);
}
function readI64(bytes: Uint8Array, offset: number): bigint {
  return BigInt.asIntN(64, readU64(bytes, offset));
}
function readI32(bytes: Uint8Array, offset: number): number {
  return readU32(bytes, offset) | 0;
}

function encodeCommand(out: number[], command: HostCommand): void {
  switch (command.type) {
    case "start":
      out.push(CMD_START, 0, 0, 0);
      out.push(command.transferableArrayBuffer ? 1 : 0, 0, 0, 0);
      break;
    case "authenticate": {
      out.push(CMD_AUTHENTICATE, 0, 0, 0);
      for (let i = 0; i < 16; i++) out.push(command.correlation[i] ?? 0);
      const scheme = te.encode(command.scheme);
      writeU16(out, scheme.length);
      out.push(...scheme);
      writeU16(out, command.token.length);
      out.push(...command.token);
      break;
    }
    case "subscribe": {
      out.push(CMD_SUBSCRIBE, 0, 0, 0);
      for (let i = 0; i < 16; i++) out.push(command.correlation[i] ?? 0);
      writeU32(out, command.channelId >>> 0);
      out.push(command.qosReliability & 0xff, command.domainId & 0xff, 0, 0);
      const topic = te.encode(command.topic);
      writeU16(out, topic.length);
      out.push(...topic);
      const typeName = te.encode(command.typeName);
      writeU16(out, typeName.length);
      out.push(...typeName);
      break;
    }
    case "unsubscribe": {
      out.push(CMD_UNSUBSCRIBE, 0, 0, 0);
      for (let i = 0; i < 16; i++) out.push(command.correlation[i] ?? 0);
      writeU32(out, command.channelId >>> 0);
      break;
    }
    case "close":
      out.push(CMD_CLOSE, 0, 0, 0);
      break;
  }
}

/** Encode a host batch with inline WS payloads (bun tests + I/O Worker). */
export function encodeHostBatch(events: HostEventInput[]): Uint8Array {
  const out: number[] = [];
  writeU32(out, BATCH_MAGIC);
  writeU16(out, LAYOUT_VERSION);
  writeU16(out, FLAG_INLINE_WS_BYTES);
  writeU32(out, events.length);
  for (const event of events) {
    switch (event.type) {
      case "wsBytes":
        out.push(EVENT_WS_BYTES, 0, 0, 0);
        writeU32(out, event.bufferId >>> 0);
        writeU32(out, 0);
        writeU32(out, event.bytes.length);
        out.push(...event.bytes);
        break;
      case "timer":
        out.push(EVENT_TIMER, 0, 0, 0);
        writeU64(out, event.nowMs);
        break;
      case "command":
        out.push(EVENT_COMMAND, 0, 0, 0);
        encodeCommand(out, event.command);
        break;
      case "releaseLease":
        out.push(EVENT_RELEASE, 0, 0, 0);
        writeU32(out, event.leaseId >>> 0);
        break;
    }
  }
  return Uint8Array.from(out);
}

export function decodePollResult(bytes: Uint8Array): PollResult {
  if (bytes.length < 28) {
    throw new Error("poll result truncated");
  }
  if (readU32(bytes, 0) !== RESULT_MAGIC) {
    throw new Error("poll result bad magic");
  }
  if (readU16(bytes, 4) !== LAYOUT_VERSION) {
    throw new Error("poll result bad version");
  }
  const outboundCount = readU32(bytes, 8);
  const eventCount = readU32(bytes, 12);
  const releasedCount = readU32(bytes, 16);
  const deadlineRaw = readI64(bytes, 20);
  let offset = 28;
  const outbound: PollResult["outbound"] = [];
  for (let i = 0; i < outboundCount; i++) {
    const bufferId = readU32(bytes, offset);
    offset += 4;
    const _ptr = readU32(bytes, offset);
    offset += 4;
    const len = readU32(bytes, offset);
    offset += 4;
    const payload = bytes.subarray(offset, offset + len);
    offset += len;
    outbound.push({ bufferId, bytes: payload.slice() });
  }
  const events: AppEvent[] = [];
  for (let i = 0; i < eventCount; i++) {
    const kind = bytes[offset]!;
    offset += 4;
    switch (kind) {
      case APP_BOOTSTRAP_COMPLETE: {
        const selectedWireVersion = bytes[offset]!;
        offset += 4;
        events.push({ type: "bootstrapComplete", selectedWireVersion });
        break;
      }
      case APP_SESSION_READY: {
        const domainId = bytes[offset]!;
        offset += 4;
        const rowLen = readU16(bytes, offset);
        offset += 2;
        const supportRow = td.decode(bytes.subarray(offset, offset + rowLen));
        offset += rowLen;
        const gwLen = readU16(bytes, offset);
        offset += 2;
        const gatewayInstanceId = td.decode(
          bytes.subarray(offset, offset + gwLen),
        );
        offset += gwLen;
        events.push({
          type: "sessionReady",
          domainId,
          supportRow,
          gatewayInstanceId,
        });
        break;
      }
      case APP_SUBSCRIBED: {
        const channelId = readU32(bytes, offset);
        offset += 4;
        const topicLen = readU16(bytes, offset);
        offset += 2;
        const topic = td.decode(bytes.subarray(offset, offset + topicLen));
        offset += topicLen;
        const typeLen = readU16(bytes, offset);
        offset += 2;
        const typeName = td.decode(bytes.subarray(offset, offset + typeLen));
        offset += typeLen;
        events.push({ type: "subscribed", channelId, topic, typeName });
        break;
      }
      case APP_SUBSCRIBE_FAILED: {
        const channelId = readU32(bytes, offset);
        offset += 4;
        const code = bytes[offset]!;
        offset += 4;
        const msgLen = readU16(bytes, offset);
        offset += 2;
        const message = td.decode(bytes.subarray(offset, offset + msgLen));
        offset += msgLen;
        events.push({ type: "subscribeFailed", channelId, code, message });
        break;
      }
      case APP_SAMPLE: {
        const channelId = readU32(bytes, offset);
        offset += 4;
        const leaseId = readU32(bytes, offset);
        offset += 4;
        const sequence = readU64(bytes, offset);
        offset += 8;
        const sourceTimeNs = readI64(bytes, offset);
        offset += 8;
        const payloadPtr = readU32(bytes, offset);
        offset += 4;
        const payloadLen = readU32(bytes, offset);
        offset += 4;
        const stringLen = readI32(bytes, offset);
        offset += 4;
        let stringData: string | null = null;
        if (stringLen >= 0) {
          stringData = td.decode(bytes.subarray(offset, offset + stringLen));
          offset += stringLen;
        }
        events.push({
          type: "sample",
          channelId,
          leaseId,
          sequence,
          sourceTimeNs,
          payloadPtr,
          payloadLen,
          stringData,
        });
        break;
      }
      case APP_HEARTBEAT: {
        const counter = readU64(bytes, offset);
        offset += 8;
        events.push({ type: "heartbeat", counter });
        break;
      }
      case APP_ERROR: {
        const code = bytes[offset]!;
        offset += 4;
        const msgLen = readU16(bytes, offset);
        offset += 2;
        const message = td.decode(bytes.subarray(offset, offset + msgLen));
        offset += msgLen;
        events.push({ type: "error", code, message });
        break;
      }
      case APP_CLOSED: {
        const phase = bytes[offset]!;
        offset += 4;
        events.push({ type: "closed", phase });
        break;
      }
      default:
        throw new Error(`unknown app event kind ${kind}`);
    }
  }
  const released: PollResult["released"] = [];
  for (let i = 0; i < releasedCount; i++) {
    const bufferId = readU32(bytes, offset);
    offset += 4;
    const len = readU32(bytes, offset);
    offset += 4;
    released.push({ bufferId, len });
  }
  return {
    outbound,
    events,
    released,
    nextDeadlineMs: deadlineRaw < 0n ? null : deadlineRaw,
  };
}

export type WasmExports = {
  memory: WebAssembly.Memory;
  rclweb_alloc(len: number): number;
  rclweb_free(ptr: number, len: number): void;
  rclweb_engine_new(): number;
  rclweb_engine_free(handle: number): void;
  rclweb_poll(handle: number, batchPtr: number, batchLen: number): number;
  rclweb_last_result_ptr(handle: number): number;
  rclweb_last_result_len(handle: number): number;
};

export async function loadWasm(wasmBytes: ArrayBuffer): Promise<WasmExports> {
  const { instance } = await WebAssembly.instantiate(wasmBytes, {});
  const exports = instance.exports as unknown as WasmExports;
  for (const name of [
    "memory",
    "rclweb_alloc",
    "rclweb_free",
    "rclweb_engine_new",
    "rclweb_engine_free",
    "rclweb_poll",
    "rclweb_last_result_ptr",
    "rclweb_last_result_len",
  ] as const) {
    if (!(name in exports) || exports[name] == null) {
      throw new Error(`wasm missing export ${name}`);
    }
  }
  return exports;
}

export function pollEngine(
  wasm: WasmExports,
  handle: number,
  events: HostEventInput[],
): PollResult {
  const batch = encodeHostBatch(events);
  const ptr = wasm.rclweb_alloc(batch.length);
  if (ptr === 0 && batch.length !== 0) {
    throw new Error("rclweb_alloc failed");
  }
  try {
    new Uint8Array(wasm.memory.buffer, ptr, batch.length).set(batch);
    const len = wasm.rclweb_poll(handle, ptr, batch.length);
    if (len < 0) {
      throw new Error(`rclweb_poll failed with code ${len}`);
    }
    const resultPtr = wasm.rclweb_last_result_ptr(handle);
    const resultLen = wasm.rclweb_last_result_len(handle);
    const resultBytes = new Uint8Array(
      wasm.memory.buffer,
      resultPtr,
      resultLen,
    ).slice();
    return decodePollResult(resultBytes);
  } finally {
    if (batch.length !== 0) {
      wasm.rclweb_free(ptr, batch.length);
    }
  }
}
