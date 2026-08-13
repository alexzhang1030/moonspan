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
export const CMD_OPEN_SERVICE = 8;
export const CMD_CALL_SERVICE = 9;
export const CMD_SEND_SERVICE_RESPONSE = 10;
export const CMD_OPEN_ACTION = 11;
export const CMD_SEND_ACTION_GOAL = 12;
export const CMD_CANCEL_ACTION = 13;
export const CMD_SEND_ACTION_FEEDBACK = 14;
export const CMD_SEND_ACTION_RESULT = 15;
export const CMD_SEND_ACTION_STATUS = 16;
export const CMD_SEND_POINT_CLOUD2 = 17;
export const CMD_SEND_GENERATED = 18;

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
export const APP_SERVICE_READY = 11;
export const APP_SERVICE_FAILED = 12;
export const APP_SERVICE_REQUEST = 13;
export const APP_SERVICE_RESPONSE = 14;
export const APP_ACTION_READY = 15;
export const APP_ACTION_FAILED = 16;
export const APP_ACTION_GOAL = 17;
export const APP_ACTION_FEEDBACK = 18;
export const APP_ACTION_RESULT = 19;
export const APP_ACTION_STATUS = 20;
export const APP_GRAPH_SNAPSHOT = 21;
export const APP_GRAPH_DELTA = 22;
export const APP_OPERATION_CANCELLED = 23;

export type HostCommand =
  | { type: "start"; transferableArrayBuffer: boolean; webtransport?: boolean }
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
  | {
      type: "sendPointCloud2";
      channelId: number;
      stampSec: number;
      stampNanosec: number;
      frameId: string;
      height: number;
      width: number;
      pointStep: number;
      rowStep: number;
      isBigendian: boolean;
      isDense: boolean;
      fields: Array<{
        name: string;
        offset: number;
        datatype: number;
        count: number;
      }>;
      data: Uint8Array;
    }
  | { type: "sendGenerated"; channelId: number; typeName: string; value: Uint8Array }
  | {
      type: "openService";
      correlation: Uint8Array;
      channelId: number;
      name: string;
      typeName: string;
      domainId: number;
      client: boolean;
    }
  | {
      type: "callService";
      channelId: number;
      operationId: Uint8Array;
      request: Uint8Array;
    }
  | {
      type: "sendServiceResponse";
      channelId: number;
      operationId: Uint8Array;
      response: Uint8Array;
    }
  | {
      type: "openAction";
      correlation: Uint8Array;
      channelId: number;
      name: string;
      typeName: string;
      domainId: number;
      client: boolean;
    }
  | {
      type: "sendActionGoal";
      channelId: number;
      operationId: Uint8Array;
      goal: Uint8Array;
    }
  | { type: "cancelAction"; channelId: number; operationId: Uint8Array }
  | {
      type: "sendActionFeedback";
      channelId: number;
      operationId: Uint8Array;
      feedback: Uint8Array;
    }
  | {
      type: "sendActionResult";
      channelId: number;
      operationId: Uint8Array;
      result: Uint8Array;
    }
  | {
      type: "sendActionStatus";
      channelId: number;
      operationId: Uint8Array;
      status: Uint8Array;
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
  | { type: "closed"; phase: number }
  | {
      type: "serviceReady";
      channelId: number;
      name: string;
      typeName: string;
      client: boolean;
    }
  | {
      type: "serviceFailed";
      channelId: number;
      code: number;
      message: string;
    }
  | {
      type: "serviceRequest";
      channelId: number;
      operationId: Uint8Array;
      leaseId: number;
      sequence: bigint;
      payloadPtr: number;
      payloadLen: number;
    }
  | {
      type: "serviceResponse";
      channelId: number;
      operationId: Uint8Array;
      leaseId: number;
      sequence: bigint;
      payloadPtr: number;
      payloadLen: number;
    }
  | {
      type: "actionReady";
      channelId: number;
      name: string;
      typeName: string;
      client: boolean;
    }
  | {
      type: "actionFailed";
      channelId: number;
      code: number;
      message: string;
    }
  | {
      type: "actionGoal";
      channelId: number;
      operationId: Uint8Array;
      leaseId: number;
      sequence: bigint;
      payloadPtr: number;
      payloadLen: number;
    }
  | {
      type: "actionFeedback";
      channelId: number;
      operationId: Uint8Array;
      leaseId: number;
      sequence: bigint;
      payloadPtr: number;
      payloadLen: number;
    }
  | {
      type: "actionResult";
      channelId: number;
      operationId: Uint8Array;
      leaseId: number;
      sequence: bigint;
      payloadPtr: number;
      payloadLen: number;
    }
  | {
      type: "actionStatus";
      channelId: number;
      operationId: Uint8Array;
      leaseId: number;
      sequence: bigint;
      payloadPtr: number;
      payloadLen: number;
    }
  | {
      type: "graphSnapshot";
      generation: bigint;
      nodesJson: string;
      endpointsJson: string;
    }
  | { type: "graphDelta"; generation: bigint }
  | {
      type: "operationCancelled";
      channelId: number;
      code: number;
      message: string;
    };

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
function writeI32Into(out: Uint8Array, offset: number, value: number): number {
  return writeU32Into(out, offset, value | 0);
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
  name?: Uint8Array;
  payload?: Uint8Array;
  frameId?: Uint8Array;
  fieldNames?: Uint8Array[];
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
    case "sendPointCloud2":
      return {
        cmd: command,
        payload: command.data,
        frameId: te.encode(command.frameId),
        fieldNames: command.fields.map((field) => te.encode(field.name)),
      };
    case "sendGenerated":
      return {
        cmd: command,
        typeName: te.encode(command.typeName),
        payload: command.value,
      };
    case "openService":
    case "openAction":
      return {
        cmd: command,
        name: te.encode(command.name),
        typeName: te.encode(command.typeName),
      };
    case "callService":
      return { cmd: command, payload: command.request };
    case "sendServiceResponse":
      return { cmd: command, payload: command.response };
    case "sendActionGoal":
      return { cmd: command, payload: command.goal };
    case "sendActionFeedback":
      return { cmd: command, payload: command.feedback };
    case "sendActionResult":
      return { cmd: command, payload: command.result };
    case "sendActionStatus":
      return { cmd: command, payload: command.status };
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
    case "sendPointCloud2": {
      const names = prepared.fieldNames!;
      let fieldsSize = 0;
      for (const name of names) {
        fieldsSize += 11 + name.length;
      }
      // cmd(4) + channel..stamp_nanosec(32) + frame_id_len(2) + frame_id +
      // field_count(4) + fields + data_len(4) + data
      return 4 + 32 + 2 + prepared.frameId!.length + 4 + fieldsSize + 4 + prepared.payload!.length;
    }
    case "sendGenerated":
      // cmd(4) + channel_id(4) + type_len(2) + type + value_len(4) + value
      return 4 + 4 + 2 + prepared.typeName!.length + 4 + prepared.payload!.length;
    case "openService":
    case "openAction":
      return 4 + 16 + 4 + 4 + 2 + prepared.name!.length + 2 + prepared.typeName!.length;
    case "callService":
    case "sendServiceResponse":
    case "sendActionGoal":
    case "sendActionFeedback":
    case "sendActionResult":
    case "sendActionStatus":
      return 4 + 4 + 16 + 4 + prepared.payload!.length;
    case "cancelAction":
      return 4 + 4 + 16;
    case "unsubscribe":
      return 4 + 16 + 4;
    case "close":
      return 4;
  }
}

function writeOpidPayload(
  out: Uint8Array,
  offset: number,
  cmdId: number,
  channelId: number,
  operationId: Uint8Array,
  payload: Uint8Array,
): number {
  out[offset++] = cmdId;
  out[offset++] = 0;
  out[offset++] = 0;
  out[offset++] = 0;
  offset = writeU32Into(out, offset, channelId >>> 0);
  out.set(operationId.subarray(0, 16), offset);
  for (let i = operationId.length; i < 16; i++) out[offset + i] = 0;
  offset += 16;
  offset = writeU32Into(out, offset, payload.length);
  out.set(payload, offset);
  return offset + payload.length;
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
      out[offset++] = command.webtransport ? 1 : 0;
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
    case "sendPointCloud2": {
      out[offset++] = CMD_SEND_POINT_CLOUD2;
      out[offset++] = 0;
      out[offset++] = 0;
      out[offset++] = 0;
      offset = writeU32Into(out, offset, command.channelId >>> 0);
      offset = writeU32Into(out, offset, command.height >>> 0);
      offset = writeU32Into(out, offset, command.width >>> 0);
      offset = writeU32Into(out, offset, command.pointStep >>> 0);
      offset = writeU32Into(out, offset, command.rowStep >>> 0);
      out[offset++] = command.isBigendian ? 1 : 0;
      out[offset++] = command.isDense ? 1 : 0;
      out[offset++] = 0;
      out[offset++] = 0;
      offset = writeI32Into(out, offset, command.stampSec);
      offset = writeU32Into(out, offset, command.stampNanosec >>> 0);
      const frameId = prepared.frameId!;
      offset = writeU16Into(out, offset, frameId.length);
      out.set(frameId, offset);
      offset += frameId.length;
      offset = writeU32Into(out, offset, command.fields.length);
      const names = prepared.fieldNames!;
      for (let i = 0; i < command.fields.length; i++) {
        const field = command.fields[i]!;
        const name = names[i]!;
        offset = writeU16Into(out, offset, name.length);
        out.set(name, offset);
        offset += name.length;
        offset = writeU32Into(out, offset, field.offset >>> 0);
        out[offset++] = field.datatype & 0xff;
        offset = writeU32Into(out, offset, field.count >>> 0);
      }
      const data = prepared.payload!;
      offset = writeU32Into(out, offset, data.length);
      out.set(data, offset);
      return offset + data.length;
    }
    case "sendGenerated": {
      out[offset++] = CMD_SEND_GENERATED;
      out[offset++] = 0;
      out[offset++] = 0;
      out[offset++] = 0;
      offset = writeU32Into(out, offset, command.channelId >>> 0);
      const typeName = prepared.typeName!;
      offset = writeU16Into(out, offset, typeName.length);
      out.set(typeName, offset);
      offset += typeName.length;
      const value = prepared.payload!;
      offset = writeU32Into(out, offset, value.length);
      out.set(value, offset);
      return offset + value.length;
    }
    case "openService":
    case "openAction": {
      out[offset++] =
        command.type === "openService" ? CMD_OPEN_SERVICE : CMD_OPEN_ACTION;
      out[offset++] = 0;
      out[offset++] = 0;
      out[offset++] = 0;
      out.set(command.correlation.subarray(0, 16), offset);
      for (let i = command.correlation.length; i < 16; i++) out[offset + i] = 0;
      offset += 16;
      offset = writeU32Into(out, offset, command.channelId >>> 0);
      out[offset++] = command.client ? 1 : 0;
      out[offset++] = command.domainId & 0xff;
      out[offset++] = 0;
      out[offset++] = 0;
      offset = writeU16Into(out, offset, prepared.name!.length);
      out.set(prepared.name!, offset);
      offset += prepared.name!.length;
      offset = writeU16Into(out, offset, prepared.typeName!.length);
      out.set(prepared.typeName!, offset);
      return offset + prepared.typeName!.length;
    }
    case "callService":
      return writeOpidPayload(
        out,
        offset,
        CMD_CALL_SERVICE,
        command.channelId,
        command.operationId,
        prepared.payload!,
      );
    case "sendServiceResponse":
      return writeOpidPayload(
        out,
        offset,
        CMD_SEND_SERVICE_RESPONSE,
        command.channelId,
        command.operationId,
        prepared.payload!,
      );
    case "sendActionGoal":
      return writeOpidPayload(
        out,
        offset,
        CMD_SEND_ACTION_GOAL,
        command.channelId,
        command.operationId,
        prepared.payload!,
      );
    case "cancelAction": {
      out[offset++] = CMD_CANCEL_ACTION;
      out[offset++] = 0;
      out[offset++] = 0;
      out[offset++] = 0;
      offset = writeU32Into(out, offset, command.channelId >>> 0);
      out.set(command.operationId.subarray(0, 16), offset);
      for (let i = command.operationId.length; i < 16; i++) out[offset + i] = 0;
      return offset + 16;
    }
    case "sendActionFeedback":
      return writeOpidPayload(
        out,
        offset,
        CMD_SEND_ACTION_FEEDBACK,
        command.channelId,
        command.operationId,
        prepared.payload!,
      );
    case "sendActionResult":
      return writeOpidPayload(
        out,
        offset,
        CMD_SEND_ACTION_RESULT,
        command.channelId,
        command.operationId,
        prepared.payload!,
      );
    case "sendActionStatus":
      return writeOpidPayload(
        out,
        offset,
        CMD_SEND_ACTION_STATUS,
        command.channelId,
        command.operationId,
        prepared.payload!,
      );
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
 * Encode a host batch with inline WS payloads (command-only live batches,
 * bun tests, native-style hosts).
 *
 * Two-pass preallocated `Uint8Array`: size first, then write. Large frames
 * must never use `push(...bytes)` / per-byte `number[]` builders (RangeError).
 * Live WS ingest uses {@link encodeHostBatchExternalWs} so the payload is
 * copied into wasm once.
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
 * memory (`ptr`/`len` form, no inline trailer). Live ingest uses this for
 * every `wsBytes` event so the engine can take ownership of the allocation
 * (copy-budget slot 2) without a second deep copy.
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

/**
 * 64 KiB — size used by large-message tests and host baselines.
 * Poll uses the external-ptr path for every WS payload; this is not a
 * behavioral threshold.
 */
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
  // Sample ingest: empty outbound, one Sample, no string body, no released.
  if (
    outboundCount === 0 &&
    eventCount === 1 &&
    releasedCount === 0 &&
    bytes.length === 68 &&
    bytes[28] === APP_SAMPLE &&
    readI32(bytes, 64) < 0
  ) {
    const deadlineRaw = readI64(bytes, 20);
    return {
      outbound: [],
      events: [
        {
          type: "sample",
          channelId: readU32(bytes, 32),
          leaseId: readU32(bytes, 36),
          sequence: readU64(bytes, 40),
          sourceTimeNs: readI64(bytes, 48),
          payloadPtr: readU32(bytes, 56),
          payloadLen: readU32(bytes, 60),
          stringData: null,
        },
      ],
      released: [],
      nextDeadlineMs: deadlineRaw < 0n ? null : deadlineRaw,
    };
  }
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
    // `bytes` is already sliced out of wasm; keep a view so send does not
    // copy the frame again.
    outbound.push({ bufferId, bytes: payload });
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
      case APP_SERVICE_READY:
      case APP_ACTION_READY: {
        const channelId = readU32(bytes, offset);
        offset += 4;
        const client = bytes[offset]! !== 0;
        offset += 4;
        const nameLen = readU16(bytes, offset);
        offset += 2;
        const name = td.decode(bytes.subarray(offset, offset + nameLen));
        offset += nameLen;
        const typeLen = readU16(bytes, offset);
        offset += 2;
        const typeName = td.decode(bytes.subarray(offset, offset + typeLen));
        offset += typeLen;
        events.push({
          type: kind === APP_SERVICE_READY ? "serviceReady" : "actionReady",
          channelId,
          name,
          typeName,
          client,
        });
        break;
      }
      case APP_SERVICE_FAILED:
      case APP_ACTION_FAILED:
      case APP_OPERATION_CANCELLED: {
        const channelId = readU32(bytes, offset);
        offset += 4;
        const code = bytes[offset]!;
        offset += 4;
        const msgLen = readU16(bytes, offset);
        offset += 2;
        const message = td.decode(bytes.subarray(offset, offset + msgLen));
        offset += msgLen;
        const type =
          kind === APP_SERVICE_FAILED
            ? "serviceFailed"
            : kind === APP_ACTION_FAILED
              ? "actionFailed"
              : "operationCancelled";
        events.push({ type, channelId, code, message });
        break;
      }
      case APP_SERVICE_REQUEST:
      case APP_SERVICE_RESPONSE:
      case APP_ACTION_GOAL:
      case APP_ACTION_FEEDBACK:
      case APP_ACTION_RESULT:
      case APP_ACTION_STATUS: {
        const channelId = readU32(bytes, offset);
        offset += 4;
        const operationId = bytes.subarray(offset, offset + 16).slice();
        offset += 16;
        const leaseId = readU32(bytes, offset);
        offset += 4;
        const sequence = readU64(bytes, offset);
        offset += 8;
        const payloadPtr = readU32(bytes, offset);
        offset += 4;
        const payloadLen = readU32(bytes, offset);
        offset += 4;
        const type =
          kind === APP_SERVICE_REQUEST
            ? "serviceRequest"
            : kind === APP_SERVICE_RESPONSE
              ? "serviceResponse"
              : kind === APP_ACTION_GOAL
                ? "actionGoal"
                : kind === APP_ACTION_FEEDBACK
                  ? "actionFeedback"
                  : kind === APP_ACTION_RESULT
                    ? "actionResult"
                    : "actionStatus";
        events.push({
          type,
          channelId,
          operationId,
          leaseId,
          sequence,
          payloadPtr,
          payloadLen,
        });
        break;
      }
      case APP_GRAPH_SNAPSHOT: {
        const generation = readU64(bytes, offset);
        offset += 8;
        const nodesLen = readU32(bytes, offset);
        offset += 4;
        const nodesJson = td.decode(bytes.subarray(offset, offset + nodesLen));
        offset += nodesLen;
        const endpointsLen = readU32(bytes, offset);
        offset += 4;
        const endpointsJson = td.decode(
          bytes.subarray(offset, offset + endpointsLen),
        );
        offset += endpointsLen;
        events.push({ type: "graphSnapshot", generation, nodesJson, endpointsJson });
        break;
      }
      case APP_GRAPH_DELTA: {
        const generation = readU64(bytes, offset);
        offset += 8;
        events.push({ type: "graphDelta", generation });
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
  rclweb_poll_ws(handle: number, bufferId: number, ptr: number, len: number): number;
  rclweb_last_result_ptr(handle: number): number;
  rclweb_last_result_len(handle: number): number;
  rclweb_telemetry(handle: number, outPtr: number): number;
  rclweb_point_cloud2_meta?(
    payloadPtr: number,
    payloadLen: number,
    outPtr: number,
    outLen: number,
  ): number;
  rclweb_decode_generated?(
    typePtr: number,
    typeLen: number,
    payloadPtr: number,
    payloadLen: number,
    outPtr: number,
    outLen: number,
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
  stampSec: number;
  stampNanosec: number;
  frameId: string;
  fields: Array<{
    name: string;
    offset: number;
    datatype: number;
    count: number;
  }>;
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
    "rclweb_poll_ws",
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

export function readTelemetryAt(
  wasm: WasmExports,
  handle: number,
  outPtr: number,
): EngineTelemetrySnapshot {
  const rc = wasm.rclweb_telemetry(handle, outPtr);
  if (rc !== 0) {
    throw new Error(`rclweb_telemetry failed with code ${rc}`);
  }
  const view = new DataView(wasm.memory.buffer, outPtr, 56);
  return {
    copiesIntoEngine: Number(view.getBigUint64(0, true)),
    bytesCopiedIntoEngine: Number(view.getBigUint64(8, true)),
    pollTurns: Number(view.getBigUint64(16, true)),
    pollNanosTotal: Number(view.getBigUint64(24, true)),
    samplesEmitted: Number(view.getBigUint64(32, true)),
    leasesReleased: Number(view.getBigUint64(40, true)),
    samplesSent: Number(view.getBigUint64(48, true)),
  };
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
    return readTelemetryAt(wasm, handle, ptr);
  } finally {
    wasm.rclweb_free(ptr, 56);
  }
}

/**
 * Decode PointCloud2 metadata from a leased CDR payload in wasm memory.
 * Point `data` stays as an offset/len into the payload — never copied.
 * Header stamp/`frame_id` and PointField entries are copied (small).
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
  let cap = 4096;
  let outPtr = wasm.rclweb_alloc(cap);
  if (outPtr === 0) {
    throw new Error("rclweb_alloc failed for point_cloud2 meta");
  }
  try {
    let rc = decode(payloadPtr, payloadLen, outPtr, cap);
    if (rc === -4) {
      const need = new DataView(wasm.memory.buffer, outPtr, 4).getUint32(0, true);
      wasm.rclweb_free(outPtr, cap);
      cap = need;
      outPtr = wasm.rclweb_alloc(cap);
      if (outPtr === 0) {
        throw new Error("rclweb_alloc failed for point_cloud2 meta retry");
      }
      rc = decode(payloadPtr, payloadLen, outPtr, cap);
    }
    if (rc < 42) {
      throw new Error(`rclweb_point_cloud2_meta failed with code ${rc}`);
    }
    const view = new DataView(wasm.memory.buffer, outPtr, rc);
    const fieldCount = view.getUint32(28, true);
    let o = 40;
    const frameIdLen = view.getUint16(o, true);
    o += 2;
    const frameId = td.decode(new Uint8Array(wasm.memory.buffer, outPtr + o, frameIdLen));
    o += frameIdLen;
    const fields: PointCloud2Meta["fields"] = [];
    for (let i = 0; i < fieldCount; i++) {
      const nameLen = view.getUint16(o, true);
      o += 2;
      const name = td.decode(new Uint8Array(wasm.memory.buffer, outPtr + o, nameLen));
      o += nameLen;
      const offset = view.getUint32(o, true);
      o += 4;
      const datatype = view.getUint8(o);
      o += 1;
      const count = view.getUint32(o, true);
      o += 4;
      fields.push({ name, offset, datatype, count });
    }
    return {
      height: view.getUint32(0, true),
      width: view.getUint32(4, true),
      pointStep: view.getUint32(8, true),
      rowStep: view.getUint32(12, true),
      dataOffset: view.getUint32(16, true),
      dataLen: view.getUint32(20, true),
      isBigendian: view.getUint8(24) !== 0,
      isDense: view.getUint8(25) !== 0,
      stampSec: view.getInt32(32, true),
      stampNanosec: view.getUint32(36, true),
      frameId,
      fields,
    };
  } finally {
    if (outPtr !== 0) {
      wasm.rclweb_free(outPtr, cap);
    }
  }
}

/**
 * Decode a Phase 1 generated message from leased CDR into packed host-value
 * bytes. The TypeScript field decoder lives in `generated-value.ts`.
 */
export function decodeGeneratedBytes(
  wasm: WasmExports,
  typeName: string,
  payloadPtr: number,
  payloadLen: number,
): Uint8Array {
  const decode = wasm.rclweb_decode_generated;
  if (!decode) {
    throw new Error("wasm missing export rclweb_decode_generated");
  }
  const typeBytes = te.encode(typeName);
  const typePtr = wasm.rclweb_alloc(typeBytes.length);
  if (typePtr === 0) {
    throw new Error("rclweb_alloc failed for generated type name");
  }
  try {
    new Uint8Array(wasm.memory.buffer, typePtr, typeBytes.length).set(typeBytes);
    let cap = 4096;
    let outPtr = wasm.rclweb_alloc(cap);
    if (outPtr === 0) {
      throw new Error("rclweb_alloc failed for generated decode");
    }
    try {
      let rc = decode(
        typePtr,
        typeBytes.length,
        payloadPtr,
        payloadLen,
        outPtr,
        cap,
      );
      if (rc === -4) {
        const need = new DataView(wasm.memory.buffer, outPtr, 4).getUint32(0, true);
        wasm.rclweb_free(outPtr, cap);
        cap = need;
        outPtr = wasm.rclweb_alloc(cap);
        if (outPtr === 0) {
          throw new Error("rclweb_alloc failed for generated decode retry");
        }
        rc = decode(
          typePtr,
          typeBytes.length,
          payloadPtr,
          payloadLen,
          outPtr,
          cap,
        );
      }
      if (rc < 0) {
        throw new Error(`rclweb_decode_generated failed with code ${rc}`);
      }
      return new Uint8Array(wasm.memory.buffer, outPtr, rc).slice();
    } finally {
      if (outPtr !== 0) {
        wasm.rclweb_free(outPtr, cap);
      }
    }
  } finally {
    wasm.rclweb_free(typePtr, typeBytes.length);
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

/**
 * Decode `std_msgs/msg/String` from a leased CDR view in wasm memory.
 * Returns null when the payload is not little-endian CDR string.
 */
export function decodeStdMsgsStringAt(
  wasm: WasmExports,
  payloadPtr: number,
  payloadLen: number,
): string | null {
  if (payloadLen < 8) return null;
  const bytes = new Uint8Array(wasm.memory.buffer, payloadPtr, payloadLen);
  if (bytes[1] !== 1) return null;
  const n = new DataView(wasm.memory.buffer, payloadPtr, payloadLen).getUint32(
    4,
    true,
  );
  if (n === 0 || 8 + n > payloadLen) return null;
  if (bytes[8 + n - 1] !== 0) return null;
  return td.decode(bytes.subarray(8, 8 + n - 1));
}

function batchHasWsBytes(events: HostEventInput[]): boolean {
  for (const event of events) {
    if (event.type === "wsBytes") {
      return true;
    }
  }
  return false;
}

function takePollResult(wasm: WasmExports, handle: number): PollResult {
  const resultPtr = wasm.rclweb_last_result_ptr(handle);
  const resultLen = wasm.rclweb_last_result_len(handle);
  const view = new Uint8Array(wasm.memory.buffer, resultPtr, resultLen);
  // Outbound frames are subarrays of the result. Copy when present so they
  // survive the batch-buffer free. Sample ingest is outbound-empty and skips
  // the extra copy.
  if (resultLen >= 12 && readU32(view, 8) !== 0) {
    return decodePollResult(view.slice());
  }
  return decodePollResult(view);
}

/**
 * Poll the engine. Any `wsBytes` event uses the external-ptr path so the
 * host copies payload bytes into wasm once and the engine takes ownership
 * (copy-budget slot 2). Command-only batches keep the inline encoder.
 */
export function pollEngine(
  wasm: WasmExports,
  handle: number,
  events: HostEventInput[],
): PollResult {
  if (batchHasWsBytes(events)) {
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
    return takePollResult(wasm, handle);
  } finally {
    if (batch.length !== 0) {
      wasm.rclweb_free(ptr, batch.length);
    }
  }
}

function pollOneExternalWs(
  wasm: WasmExports,
  handle: number,
  event: Extract<HostEventInput, { type: "wsBytes" }>,
): PollResult {
  const len = event.bytes.length;
  const ptr = len === 0 ? 0 : wasm.rclweb_alloc(len);
  if (len !== 0 && ptr === 0) {
    throw new Error("rclweb_alloc failed for wsBytes");
  }
  let transferred = false;
  try {
    if (len !== 0) {
      new Uint8Array(wasm.memory.buffer, ptr, len).set(event.bytes);
    }
    // poll_ws takes the region even when it returns an error (other than
    // never-called). Do not rclweb_free after this point.
    transferred = true;
    const pollLen = wasm.rclweb_poll_ws(handle, event.bufferId, ptr, len);
    if (pollLen < 0) {
      throw new Error(`rclweb_poll_ws failed with code ${pollLen}`);
    }
    return takePollResult(wasm, handle);
  } finally {
    if (!transferred && len !== 0) {
      wasm.rclweb_free(ptr, len);
    }
  }
}

function pollEngineExternalWs(
  wasm: WasmExports,
  handle: number,
  events: HostEventInput[],
): PollResult {
  if (events.length === 1 && events[0]!.type === "wsBytes") {
    return pollOneExternalWs(wasm, handle, events[0]!);
  }
  const wsPtrs = new Map<number, { ptr: number; len: number }>();
  const owned: Array<{ ptr: number; len: number }> = [];
  let wsIndex = 0;
  try {
    for (const event of events) {
      if (event.type !== "wsBytes") continue;
      const len = event.bytes.length;
      const ptr = len === 0 ? 0 : wasm.rclweb_alloc(len);
      if (len !== 0 && ptr === 0) {
        throw new Error("rclweb_alloc failed for wsBytes");
      }
      if (len !== 0) {
        new Uint8Array(wasm.memory.buffer, ptr, len).set(event.bytes);
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
      owned.length = 0;
      return takePollResult(wasm, handle);
    } finally {
      if (batch.length !== 0) {
        wasm.rclweb_free(batchPtr, batch.length);
      }
    }
  } finally {
    for (const { ptr, len } of owned) {
      if (len !== 0) wasm.rclweb_free(ptr, len);
    }
  }
}
