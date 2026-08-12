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
export const CMD_PUBLISH = 6;
export const CMD_SEND_SAMPLE = 7;

export const APP_BOOTSTRAP_COMPLETE = 1;
export const APP_SESSION_READY = 2;
export const APP_SUBSCRIBED = 3;
export const APP_SUBSCRIBE_FAILED = 4;
export const APP_SAMPLE = 5;
export const APP_HEARTBEAT = 6;
export const APP_ERROR = 7;
export const APP_CLOSED = 8;
export const APP_PUBLISHED = 9;
export const APP_PUBLISH_FAILED = 10;

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
      qosDepth: number;
      domainId: number;
    }
  | {
      type: "publish";
      correlation: Uint8Array;
      channelId: number;
      topic: string;
      typeName: string;
      qosReliability: number;
      qosDepth: number;
      domainId: number;
    }
  | { type: "sendSample"; channelId: number; stringData: string }
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
      type: "published";
      channelId: number;
      topic: string;
      typeName: string;
      qosReliability: number;
    }
  | {
      type: "publishFailed";
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

function writeU16Into(out: Uint8Array, offset: number, value: number): number {
  out[offset] = value & 0xff;
  out[offset + 1] = (value >>> 8) & 0xff;
  return offset + 2;
}
function writeU32Into(out: Uint8Array, offset: number, value: number): number {
  out[offset] = value & 0xff;
  out[offset + 1] = (value >>> 8) & 0xff;
  out[offset + 2] = (value >>> 16) & 0xff;
  out[offset + 3] = (value >>> 24) & 0xff;
  return offset + 4;
}
function writeU64Into(out: Uint8Array, offset: number, value: bigint): number {
  const lo = Number(value & 0xffffffffn);
  const hi = Number((value >> 32n) & 0xffffffffn);
  offset = writeU32Into(out, offset, lo);
  return writeU32Into(out, offset, hi);
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

type PreparedCommand = {
  cmd: HostCommand;
  scheme?: Uint8Array;
  token?: Uint8Array;
  topic?: Uint8Array;
  typeName?: Uint8Array;
  stringData?: Uint8Array;
};

function prepareCommand(command: HostCommand): PreparedCommand {
  switch (command.type) {
    case "authenticate":
      return {
        cmd: command,
        scheme: te.encode(command.scheme),
        token: command.token,
      };
    case "subscribe":
    case "publish":
      return {
        cmd: command,
        topic: te.encode(command.topic),
        typeName: te.encode(command.typeName),
      };
    case "sendSample":
      return { cmd: command, stringData: te.encode(command.stringData) };
    default:
      return { cmd: command };
  }
}

function commandEncodedSize(prepared: PreparedCommand): number {
  switch (prepared.cmd.type) {
    case "start":
      return 4 + 4;
    case "authenticate":
      return 4 + 16 + 2 + prepared.scheme!.length + 2 + prepared.token!.length;
    case "subscribe":
    case "publish":
      return 4 + 16 + 4 + 4 + 2 + prepared.topic!.length + 2 + prepared.typeName!.length;
    case "sendSample":
      return 4 + 4 + 4 + prepared.stringData!.length;
    case "unsubscribe":
      return 4 + 16 + 4;
    case "close":
      return 4;
  }
}

function writeCommand(out: Uint8Array, offset: number, prepared: PreparedCommand): number {
  const command = prepared.cmd;
  switch (command.type) {
    case "start":
      out[offset++] = CMD_START;
      out[offset++] = 0;
      out[offset++] = 0;
      out[offset++] = 0;
      out[offset++] = command.transferableArrayBuffer ? 1 : 0;
      out[offset++] = 0;
      out[offset++] = 0;
      out[offset++] = 0;
      return offset;
    case "authenticate": {
      out[offset++] = CMD_AUTHENTICATE;
      out[offset++] = 0;
      out[offset++] = 0;
      out[offset++] = 0;
      out.set(command.correlation.subarray(0, 16), offset);
      for (let i = command.correlation.length; i < 16; i++) out[offset + i] = 0;
      offset += 16;
      offset = writeU16Into(out, offset, prepared.scheme!.length);
      out.set(prepared.scheme!, offset);
      offset += prepared.scheme!.length;
      offset = writeU16Into(out, offset, prepared.token!.length);
      out.set(prepared.token!, offset);
      return offset + prepared.token!.length;
    }
    case "subscribe":
    case "publish": {
      out[offset++] = command.type === "subscribe" ? CMD_SUBSCRIBE : CMD_PUBLISH;
      out[offset++] = 0;
      out[offset++] = 0;
      out[offset++] = 0;
      out.set(command.correlation.subarray(0, 16), offset);
      for (let i = command.correlation.length; i < 16; i++) out[offset + i] = 0;
      offset += 16;
      offset = writeU32Into(out, offset, command.channelId >>> 0);
      out[offset++] = command.qosReliability & 0xff;
      out[offset++] = command.domainId & 0xff;
      offset = writeU16Into(out, offset, command.qosDepth & 0xffff);
      offset = writeU16Into(out, offset, prepared.topic!.length);
      out.set(prepared.topic!, offset);
      offset += prepared.topic!.length;
      offset = writeU16Into(out, offset, prepared.typeName!.length);
      out.set(prepared.typeName!, offset);
      return offset + prepared.typeName!.length;
    }
    case "sendSample": {
      out[offset++] = CMD_SEND_SAMPLE;
      out[offset++] = 0;
      out[offset++] = 0;
      out[offset++] = 0;
      offset = writeU32Into(out, offset, command.channelId >>> 0);
      offset = writeU32Into(out, offset, prepared.stringData!.length);
      out.set(prepared.stringData!, offset);
      return offset + prepared.stringData!.length;
    }
    case "unsubscribe": {
      out[offset++] = CMD_UNSUBSCRIBE;
      out[offset++] = 0;
      out[offset++] = 0;
      out[offset++] = 0;
      out.set(command.correlation.subarray(0, 16), offset);
      for (let i = command.correlation.length; i < 16; i++) out[offset + i] = 0;
      offset += 16;
      return writeU32Into(out, offset, command.channelId >>> 0);
    }
    case "close":
      out[offset++] = CMD_CLOSE;
      out[offset++] = 0;
      out[offset++] = 0;
      out[offset++] = 0;
      return offset;
  }
}

/**
 * Encode a host batch with inline WS payloads (bun tests + I/O Worker).
 *
 * Two-pass preallocated `Uint8Array`: size first, then write. Large frames
 * must never use `push(...bytes)` / per-byte `number[]` builders (RangeError).
 */
export function encodeHostBatch(events: HostEventInput[]): Uint8Array {
  const preparedCommands: Array<PreparedCommand | null> = new Array(events.length);
  let size = 12; // magic + version + flags + count
  for (let i = 0; i < events.length; i++) {
    const event = events[i]!;
    size += 4; // kind + pad
    switch (event.type) {
      case "wsBytes":
        size += 12 + event.bytes.length;
        preparedCommands[i] = null;
        break;
      case "timer":
        size += 8;
        preparedCommands[i] = null;
        break;
      case "command": {
        const prepared = prepareCommand(event.command);
        preparedCommands[i] = prepared;
        size += commandEncodedSize(prepared);
        break;
      }
      case "releaseLease":
        size += 4;
        preparedCommands[i] = null;
        break;
    }
  }

  const out = new Uint8Array(size);
  let offset = 0;
  offset = writeU32Into(out, offset, BATCH_MAGIC);
  offset = writeU16Into(out, offset, LAYOUT_VERSION);
  offset = writeU16Into(out, offset, FLAG_INLINE_WS_BYTES);
  offset = writeU32Into(out, offset, events.length);
  for (let i = 0; i < events.length; i++) {
    const event = events[i]!;
    switch (event.type) {
      case "wsBytes":
        out[offset++] = EVENT_WS_BYTES;
        out[offset++] = 0;
        out[offset++] = 0;
        out[offset++] = 0;
        offset = writeU32Into(out, offset, event.bufferId >>> 0);
        offset = writeU32Into(out, offset, 0);
        offset = writeU32Into(out, offset, event.bytes.length);
        out.set(event.bytes, offset);
        offset += event.bytes.length;
        break;
      case "timer":
        out[offset++] = EVENT_TIMER;
        out[offset++] = 0;
        out[offset++] = 0;
        out[offset++] = 0;
        offset = writeU64Into(out, offset, event.nowMs);
        break;
      case "command":
        out[offset++] = EVENT_COMMAND;
        out[offset++] = 0;
        out[offset++] = 0;
        out[offset++] = 0;
        offset = writeCommand(out, offset, preparedCommands[i]!);
        break;
      case "releaseLease":
        out[offset++] = EVENT_RELEASE;
        out[offset++] = 0;
        out[offset++] = 0;
        out[offset++] = 0;
        offset = writeU32Into(out, offset, event.leaseId >>> 0);
        break;
    }
  }
  if (offset !== size) {
    throw new Error(`encodeHostBatch size mismatch: wrote ${offset}, expected ${size}`);
  }
  return out;
}

/**
 * Encode a host batch that references pre-copied WS payloads in wasm linear
 * memory (`ptr`/`len` form, no inline trailer). Used by the large-message
 * transferable path so the engine can take ownership of the allocation.
 */
export function encodeHostBatchExternalWs(
  events: HostEventInput[],
  wsPtrs: Map<number, { ptr: number; len: number }>,
): Uint8Array {
  const preparedCommands: Array<PreparedCommand | null> = new Array(events.length);
  let size = 12;
  for (let i = 0; i < events.length; i++) {
    const event = events[i]!;
    size += 4;
    switch (event.type) {
      case "wsBytes":
        size += 12;
        preparedCommands[i] = null;
        break;
      case "timer":
        size += 8;
        preparedCommands[i] = null;
        break;
      case "command": {
        const prepared = prepareCommand(event.command);
        preparedCommands[i] = prepared;
        size += commandEncodedSize(prepared);
        break;
      }
      case "releaseLease":
        size += 4;
        preparedCommands[i] = null;
        break;
    }
  }
  const out = new Uint8Array(size);
  let offset = 0;
  offset = writeU32Into(out, offset, BATCH_MAGIC);
  offset = writeU16Into(out, offset, LAYOUT_VERSION);
  offset = writeU16Into(out, offset, 0); // no inline flag
  offset = writeU32Into(out, offset, events.length);
  let wsIndex = 0;
  for (let i = 0; i < events.length; i++) {
    const event = events[i]!;
    switch (event.type) {
      case "wsBytes": {
        const loc = wsPtrs.get(wsIndex);
        if (!loc) {
          throw new Error(`missing wasm ptr for wsBytes index ${wsIndex}`);
        }
        wsIndex += 1;
        out[offset++] = EVENT_WS_BYTES;
        out[offset++] = 0;
        out[offset++] = 0;
        out[offset++] = 0;
        offset = writeU32Into(out, offset, event.bufferId >>> 0);
        offset = writeU32Into(out, offset, loc.ptr >>> 0);
        offset = writeU32Into(out, offset, loc.len >>> 0);
        break;
      }
      case "timer":
        out[offset++] = EVENT_TIMER;
        out[offset++] = 0;
        out[offset++] = 0;
        out[offset++] = 0;
        offset = writeU64Into(out, offset, event.nowMs);
        break;
      case "command":
        out[offset++] = EVENT_COMMAND;
        out[offset++] = 0;
        out[offset++] = 0;
        out[offset++] = 0;
        offset = writeCommand(out, offset, preparedCommands[i]!);
        break;
      case "releaseLease":
        out[offset++] = EVENT_RELEASE;
        out[offset++] = 0;
        out[offset++] = 0;
        out[offset++] = 0;
        offset = writeU32Into(out, offset, event.leaseId >>> 0);
        break;
    }
  }
  return out;
}

/** Frames at or above this size use the external-ptr poll path (one controllable copy). */
export const LARGE_FRAME_INLINE_THRESHOLD = 64 * 1024;

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
      case APP_PUBLISHED: {
        const channelId = readU32(bytes, offset);
        offset += 4;
        const qosReliability = bytes[offset]!;
        offset += 4;
        const topicLen = readU16(bytes, offset);
        offset += 2;
        const topic = td.decode(bytes.subarray(offset, offset + topicLen));
        offset += topicLen;
        const typeLen = readU16(bytes, offset);
        offset += 2;
        const typeName = td.decode(bytes.subarray(offset, offset + typeLen));
        offset += typeLen;
        events.push({
          type: "published",
          channelId,
          topic,
          typeName,
          qosReliability,
        });
        break;
      }
      case APP_PUBLISH_FAILED: {
        const channelId = readU32(bytes, offset);
        offset += 4;
        const code = bytes[offset]!;
        offset += 4;
        const msgLen = readU16(bytes, offset);
        offset += 2;
        const message = td.decode(bytes.subarray(offset, offset + msgLen));
        offset += msgLen;
        events.push({ type: "publishFailed", channelId, code, message });
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
  rclweb_telemetry(handle: number, outPtr: number): number;
  rclweb_point_cloud2_meta?(
    payloadPtr: number,
    payloadLen: number,
    outPtr: number,
  ): number;
};

export type EngineTelemetrySnapshot = {
  copiesIntoEngine: number;
  bytesCopiedIntoEngine: number;
  pollTurns: number;
  pollNanosTotal: number;
  samplesEmitted: number;
  leasesReleased: number;
  samplesSent: number;
};

export type PointCloud2Meta = {
  height: number;
  width: number;
  pointStep: number;
  rowStep: number;
  dataOffset: number;
  dataLen: number;
  isBigendian: boolean;
  isDense: boolean;
  fieldCount: number;
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
    "rclweb_telemetry",
  ] as const) {
    if (!(name in exports) || exports[name] == null) {
      throw new Error(`wasm missing export ${name}`);
    }
  }
  return exports;
}

export function readTelemetry(
  wasm: WasmExports,
  handle: number,
): EngineTelemetrySnapshot {
  const ptr = wasm.rclweb_alloc(56);
  if (ptr === 0) {
    throw new Error("rclweb_alloc failed for telemetry");
  }
  try {
    const rc = wasm.rclweb_telemetry(handle, ptr);
    if (rc !== 0) {
      throw new Error(`rclweb_telemetry failed with code ${rc}`);
    }
    const view = new DataView(wasm.memory.buffer, ptr, 56);
    return {
      copiesIntoEngine: Number(view.getBigUint64(0, true)),
      bytesCopiedIntoEngine: Number(view.getBigUint64(8, true)),
      pollTurns: Number(view.getBigUint64(16, true)),
      pollNanosTotal: Number(view.getBigUint64(24, true)),
      samplesEmitted: Number(view.getBigUint64(32, true)),
      leasesReleased: Number(view.getBigUint64(40, true)),
      samplesSent: Number(view.getBigUint64(48, true)),
    };
  } finally {
    wasm.rclweb_free(ptr, 56);
  }
}

/**
 * Decode PointCloud2 metadata from a leased CDR payload in wasm memory.
 * Point `data` stays as an offset/len into the payload — never copied.
 */
export function decodePointCloud2Meta(
  wasm: WasmExports,
  payloadPtr: number,
  payloadLen: number,
): PointCloud2Meta {
  const decode = wasm.rclweb_point_cloud2_meta;
  if (!decode) {
    throw new Error("wasm missing export rclweb_point_cloud2_meta");
  }
  const outPtr = wasm.rclweb_alloc(40);
  if (outPtr === 0) {
    throw new Error("rclweb_alloc failed for point_cloud2 meta");
  }
  try {
    const rc = decode(payloadPtr, payloadLen, outPtr);
    if (rc !== 0) {
      throw new Error(`rclweb_point_cloud2_meta failed with code ${rc}`);
    }
    const view = new DataView(wasm.memory.buffer, outPtr, 40);
    return {
      height: view.getUint32(0, true),
      width: view.getUint32(4, true),
      pointStep: view.getUint32(8, true),
      rowStep: view.getUint32(12, true),
      dataOffset: view.getUint32(16, true),
      dataLen: view.getUint32(20, true),
      isBigendian: view.getUint8(24) !== 0,
      isDense: view.getUint8(25) !== 0,
      fieldCount: view.getUint32(28, true),
    };
  } finally {
    wasm.rclweb_free(outPtr, 40);
  }
}

/**
 * Borrowed TypedArray view of PointCloud2 `data` inside wasm memory.
 * Valid while the sample lease is outstanding.
 */
export function pointCloud2DataView(
  wasm: WasmExports,
  payloadPtr: number,
  meta: PointCloud2Meta,
): Uint8Array {
  return new Uint8Array(
    wasm.memory.buffer,
    payloadPtr + meta.dataOffset,
    meta.dataLen,
  );
}

function batchHasLargeWs(events: HostEventInput[]): boolean {
  for (const event of events) {
    if (
      event.type === "wsBytes" &&
      event.bytes.length >= LARGE_FRAME_INLINE_THRESHOLD
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Poll the engine. Large WS frames use the external-ptr path so the host
 * copies payload bytes into wasm once and the engine takes ownership
 * (copy-budget slot 2). Small/control batches keep the inline encoder.
 */
export function pollEngine(
  wasm: WasmExports,
  handle: number,
  events: HostEventInput[],
): PollResult {
  if (batchHasLargeWs(events)) {
    return pollEngineExternalWs(wasm, handle, events);
  }
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

function pollEngineExternalWs(
  wasm: WasmExports,
  handle: number,
  events: HostEventInput[],
): PollResult {
  const wsPtrs = new Map<number, { ptr: number; len: number }>();
  const owned: Array<{ ptr: number; len: number }> = [];
  let wsIndex = 0;
  try {
    for (const event of events) {
      if (event.type !== "wsBytes") continue;
      const len = event.bytes.length;
      const ptr = len === 0 ? 0 : wasm.rclweb_alloc(len);
      if (len !== 0 && ptr === 0) {
        throw new Error("rclweb_alloc failed for large wsBytes");
      }
      if (len !== 0) {
        new Uint8Array(wasm.memory.buffer, ptr, len).set(event.bytes);
        // Ownership transfers into the engine on poll — do not free.
        owned.push({ ptr, len });
      }
      wsPtrs.set(wsIndex, { ptr, len });
      wsIndex += 1;
    }
    const batch = encodeHostBatchExternalWs(events, wsPtrs);
    const batchPtr = wasm.rclweb_alloc(batch.length);
    if (batchPtr === 0 && batch.length !== 0) {
      throw new Error("rclweb_alloc failed for external batch");
    }
    try {
      new Uint8Array(wasm.memory.buffer, batchPtr, batch.length).set(batch);
      const len = wasm.rclweb_poll(handle, batchPtr, batch.length);
      if (len < 0) {
        throw new Error(`rclweb_poll failed with code ${len}`);
      }
      // Engine took ownership of payload allocs on success.
      owned.length = 0;
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
        wasm.rclweb_free(batchPtr, batch.length);
      }
    }
  } finally {
    // Free only if poll failed before ownership transfer.
    for (const { ptr, len } of owned) {
      if (len !== 0) wasm.rclweb_free(ptr, len);
    }
  }
}
