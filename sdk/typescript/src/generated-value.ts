/**
 * Packed little-endian host layout for Phase 1 generated messages.
 * Mirrors `rclweb::types::host_value`. Not CDR.
 */

import {
  Collections,
  EchoNested_Request,
  EchoNested_Response,
  MeasureSequence_Feedback,
  MeasureSequence_Goal,
  MeasureSequence_Result,
  NestedSample,
  PrimitiveScalars,
  Time,
  generatedOpTypeName,
  type GeneratedOpKind,
} from "./interfaces.ts";

const te = new TextEncoder();
const td = new TextDecoder();

export type GeneratedMsg = PrimitiveScalars | NestedSample | Collections;

export type GeneratedValue =
  | GeneratedMsg
  | EchoNested_Request
  | EchoNested_Response
  | MeasureSequence_Goal
  | MeasureSequence_Result
  | MeasureSequence_Feedback;

export function encodeGeneratedHostValue(
  typeName: string,
  message: unknown,
): Uint8Array {
  if (typeName === PrimitiveScalars.typeName) {
    return encodePrimitiveScalars(asPrimitive(message));
  }
  if (typeName === Collections.typeName) {
    return encodeCollections(asCollections(message));
  }
  if (typeName === NestedSample.typeName) {
    return encodeNestedSample(asNested(message));
  }
  if (typeName === EchoNested_Request.typeName) {
    return encodeNestedSample(asEchoRequest(message).input);
  }
  if (typeName === EchoNested_Response.typeName) {
    return encodeEchoResponse(asEchoResponse(message));
  }
  if (typeName === MeasureSequence_Goal.typeName) {
    return encodeCollections(asMeasureGoal(message).target);
  }
  if (typeName === MeasureSequence_Result.typeName) {
    return encodeNestedSample(asMeasureResult(message).result);
  }
  if (typeName === MeasureSequence_Feedback.typeName) {
    return encodeMeasureFeedback(asMeasureFeedback(message));
  }
  throw new Error(`unsupported generated type ${typeName}`);
}

export function encodeOpPayload(
  channelType: string,
  op: GeneratedOpKind,
  value: unknown,
): Uint8Array {
  const section = generatedOpTypeName(channelType, op);
  if (!section) {
    if (value instanceof Uint8Array) return value;
    throw new Error(`untyped ${op} must be Uint8Array`);
  }
  return encodeGeneratedHostValue(section, value);
}

export function decodeOpPayload(
  channelType: string,
  op: GeneratedOpKind,
  bytes: Uint8Array,
): unknown {
  const section = generatedOpTypeName(channelType, op);
  if (!section) return bytes;
  return decodeGeneratedHostValue(section, bytes);
}

export function reviveGenerated(typeName: string, value: unknown): GeneratedValue {
  if (typeName === PrimitiveScalars.typeName) {
    return Object.assign(new PrimitiveScalars(), value);
  }
  if (typeName === Collections.typeName) {
    return Object.assign(new Collections(), value);
  }
  if (typeName === NestedSample.typeName) {
    return reviveNested(value);
  }
  if (typeName === EchoNested_Request.typeName) {
    const msg = new EchoNested_Request();
    msg.input = reviveNested((value as EchoNested_Request)?.input);
    return msg;
  }
  if (typeName === EchoNested_Response.typeName) {
    const src = value as EchoNested_Response;
    const msg = new EchoNested_Response();
    msg.output = reviveNested(src?.output);
    msg.accepted = Boolean(src?.accepted);
    return msg;
  }
  if (typeName === MeasureSequence_Goal.typeName) {
    const msg = new MeasureSequence_Goal();
    Object.assign(msg.target, (value as MeasureSequence_Goal)?.target);
    return msg;
  }
  if (typeName === MeasureSequence_Result.typeName) {
    const msg = new MeasureSequence_Result();
    msg.result = reviveNested((value as MeasureSequence_Result)?.result);
    return msg;
  }
  if (typeName === MeasureSequence_Feedback.typeName) {
    const src = value as MeasureSequence_Feedback;
    const msg = new MeasureSequence_Feedback();
    msg.progress = Number(src?.progress ?? 0);
    msg.sample = reviveNested(src?.sample);
    return msg;
  }
  throw new Error(`unsupported generated type ${typeName}`);
}

function reviveNested(value: unknown): NestedSample {
  const src = value as NestedSample;
  const msg = new NestedSample();
  Object.assign(msg.stamp, src?.stamp);
  Object.assign(msg.scalars, src?.scalars);
  Object.assign(msg.collections, src?.collections);
  return msg;
}

export function samplePrimitiveScalars(): PrimitiveScalars {
  const msg = new PrimitiveScalars();
  msg.bool_value = true;
  msg.byte_value = 7;
  msg.char_value = 65;
  msg.float32_value = 1.5;
  msg.float64_value = 2.25;
  msg.int8_value = -3;
  msg.uint8_value = 9;
  msg.int16_value = -300;
  msg.uint16_value = 400;
  msg.int32_value = -50_000;
  msg.uint32_value = 60_000;
  msg.int64_value = -70_000n;
  msg.uint64_value = 80_000n;
  msg.string_value = "hello-scalars";
  msg.wstring_value = "wide";
  return msg;
}

export function sampleNestedSample(): NestedSample {
  const msg = new NestedSample();
  msg.stamp.sec = 11;
  msg.stamp.nanosec = 22;
  msg.scalars = samplePrimitiveScalars();
  msg.collections.fixed_i32 = [1, 2, 3];
  msg.collections.bounded_f64 = [1.0, 2.0];
  msg.collections.bytes_value = new Uint8Array([10, 20, 30]);
  msg.collections.bounded_string = "abc";
  msg.collections.bounded_wstring = "xyz";
  return msg;
}

export function sampleEchoNestedRequest(): EchoNested_Request {
  const msg = new EchoNested_Request();
  msg.input = sampleNestedSample();
  return msg;
}

export function sampleEchoNestedResponse(): EchoNested_Response {
  const msg = new EchoNested_Response();
  msg.output = sampleNestedSample();
  msg.accepted = true;
  return msg;
}

export function sampleMeasureSequenceGoal(): MeasureSequence_Goal {
  const msg = new MeasureSequence_Goal();
  msg.target.fixed_i32 = [1, 2, 3];
  msg.target.bounded_f64 = [1.0, 2.0];
  msg.target.bytes_value = new Uint8Array([10, 20, 30]);
  msg.target.bounded_string = "abc";
  msg.target.bounded_wstring = "xyz";
  return msg;
}

export function decodeGeneratedHostValue(
  typeName: string,
  bytes: Uint8Array,
): GeneratedValue {
  const cur = { o: 0, bytes };
  let msg: GeneratedValue;
  if (typeName === PrimitiveScalars.typeName) {
    msg = readPrimitiveScalars(cur);
  } else if (typeName === Collections.typeName) {
    msg = readCollections(cur);
  } else if (typeName === NestedSample.typeName) {
    msg = readNestedSample(cur);
  } else if (typeName === EchoNested_Request.typeName) {
    const req = new EchoNested_Request();
    req.input = readNestedSample(cur);
    msg = req;
  } else if (typeName === EchoNested_Response.typeName) {
    msg = readEchoResponse(cur);
  } else if (typeName === MeasureSequence_Goal.typeName) {
    const goal = new MeasureSequence_Goal();
    goal.target = readCollections(cur);
    msg = goal;
  } else if (typeName === MeasureSequence_Result.typeName) {
    const result = new MeasureSequence_Result();
    result.result = readNestedSample(cur);
    msg = result;
  } else if (typeName === MeasureSequence_Feedback.typeName) {
    msg = readMeasureFeedback(cur);
  } else {
    throw new Error(`unsupported generated type ${typeName}`);
  }
  if (cur.o !== bytes.length) {
    throw new Error("generated host value has trailing bytes");
  }
  return msg;
}

type Cursor = { o: number; bytes: Uint8Array };

function asPrimitive(message: unknown): PrimitiveScalars {
  const m = message as PrimitiveScalars;
  if (m == null || typeof m.string_value !== "string") {
    throw new Error("PrimitiveScalars publish requires ROS field names");
  }
  return m;
}

function asCollections(message: unknown): Collections {
  const m = message as Collections;
  if (m == null || !Array.isArray(m.fixed_i32)) {
    throw new Error("Collections publish requires ROS field names");
  }
  return m;
}

function asNested(message: unknown): NestedSample {
  const m = message as NestedSample;
  if (m == null || m.scalars == null || m.collections == null) {
    throw new Error("NestedSample publish requires ROS field names");
  }
  return m;
}

function asEchoRequest(message: unknown): EchoNested_Request {
  const m = message as EchoNested_Request;
  if (m == null || m.input == null) {
    throw new Error("EchoNested.Request requires .input");
  }
  return m;
}

function asEchoResponse(message: unknown): EchoNested_Response {
  const m = message as EchoNested_Response;
  if (m == null || m.output == null) {
    throw new Error("EchoNested.Response requires .output");
  }
  return m;
}

function asMeasureGoal(message: unknown): MeasureSequence_Goal {
  const m = message as MeasureSequence_Goal;
  if (m == null || m.target == null) {
    throw new Error("MeasureSequence.Goal requires .target");
  }
  return m;
}

function asMeasureResult(message: unknown): MeasureSequence_Result {
  const m = message as MeasureSequence_Result;
  if (m == null || m.result == null) {
    throw new Error("MeasureSequence.Result requires .result");
  }
  return m;
}

function asMeasureFeedback(message: unknown): MeasureSequence_Feedback {
  const m = message as MeasureSequence_Feedback;
  if (m == null || m.sample == null) {
    throw new Error("MeasureSequence.Feedback requires .sample");
  }
  return m;
}

function encodeEchoResponse(v: EchoNested_Response): Uint8Array {
  const nested = encodeNestedSample(v.output ?? new NestedSample());
  const out = new Uint8Array(nested.length + 1);
  out.set(nested);
  out[nested.length] = v.accepted ? 1 : 0;
  return out;
}

function readEchoResponse(cur: Cursor): EchoNested_Response {
  const msg = new EchoNested_Response();
  msg.output = readNestedSample(cur);
  need(cur, 1);
  msg.accepted = cur.bytes[cur.o]! !== 0;
  cur.o += 1;
  return msg;
}

function encodeMeasureFeedback(v: MeasureSequence_Feedback): Uint8Array {
  const nested = encodeNestedSample(v.sample ?? new NestedSample());
  const out = new Uint8Array(4 + nested.length);
  new DataView(out.buffer).setFloat32(0, Number(v.progress ?? 0), true);
  out.set(nested, 4);
  return out;
}

function readMeasureFeedback(cur: Cursor): MeasureSequence_Feedback {
  const msg = new MeasureSequence_Feedback();
  const view = new DataView(cur.bytes.buffer, cur.bytes.byteOffset, cur.bytes.byteLength);
  need(cur, 4);
  msg.progress = view.getFloat32(cur.o, true);
  cur.o += 4;
  msg.sample = readNestedSample(cur);
  return msg;
}

function encodePrimitiveScalars(v: PrimitiveScalars): Uint8Array {
  const str = te.encode(v.string_value ?? "");
  const wstr = te.encode(v.wstring_value ?? "");
  const out = new Uint8Array(45 + 2 + str.length + 2 + wstr.length);
  const view = new DataView(out.buffer);
  let o = 0;
  out[o++] = v.bool_value ? 1 : 0;
  out[o++] = (v.byte_value ?? 0) & 0xff;
  out[o++] = (v.char_value ?? 0) & 0xff;
  view.setFloat32(o, Number(v.float32_value ?? 0), true);
  o += 4;
  view.setFloat64(o, Number(v.float64_value ?? 0), true);
  o += 8;
  out[o++] = (v.int8_value ?? 0) & 0xff;
  out[o++] = (v.uint8_value ?? 0) & 0xff;
  view.setInt16(o, v.int16_value ?? 0, true);
  o += 2;
  view.setUint16(o, v.uint16_value ?? 0, true);
  o += 2;
  view.setInt32(o, v.int32_value ?? 0, true);
  o += 4;
  view.setUint32(o, v.uint32_value ?? 0, true);
  o += 4;
  view.setBigInt64(o, toBigInt(v.int64_value), true);
  o += 8;
  view.setBigUint64(o, toBigUint(v.uint64_value), true);
  o += 8;
  o = writeU16Str(out, view, o, str);
  writeU16Str(out, view, o, wstr);
  return out;
}

function readPrimitiveScalars(cur: Cursor): PrimitiveScalars {
  const msg = new PrimitiveScalars();
  const view = new DataView(cur.bytes.buffer, cur.bytes.byteOffset, cur.bytes.byteLength);
  need(cur, 45);
  msg.bool_value = cur.bytes[cur.o]! !== 0;
  cur.o += 1;
  msg.byte_value = cur.bytes[cur.o]!;
  cur.o += 1;
  msg.char_value = cur.bytes[cur.o]!;
  cur.o += 1;
  msg.float32_value = view.getFloat32(cur.o, true);
  cur.o += 4;
  msg.float64_value = view.getFloat64(cur.o, true);
  cur.o += 8;
  msg.int8_value = (cur.bytes[cur.o]! << 24) >> 24;
  cur.o += 1;
  msg.uint8_value = cur.bytes[cur.o]!;
  cur.o += 1;
  msg.int16_value = view.getInt16(cur.o, true);
  cur.o += 2;
  msg.uint16_value = view.getUint16(cur.o, true);
  cur.o += 2;
  msg.int32_value = view.getInt32(cur.o, true);
  cur.o += 4;
  msg.uint32_value = view.getUint32(cur.o, true);
  cur.o += 4;
  msg.int64_value = view.getBigInt64(cur.o, true);
  cur.o += 8;
  msg.uint64_value = view.getBigUint64(cur.o, true);
  cur.o += 8;
  msg.string_value = readU16Str(cur);
  msg.wstring_value = readU16Str(cur);
  return msg;
}

function encodeCollections(v: Collections): Uint8Array {
  const f64 = v.bounded_f64 ?? [];
  const bytes = v.bytes_value instanceof Uint8Array ? v.bytes_value : new Uint8Array();
  const str = te.encode(v.bounded_string ?? "");
  const wstr = te.encode(v.bounded_wstring ?? "");
  const out = new Uint8Array(
    12 + 4 + f64.length * 8 + 4 + bytes.length + 2 + str.length + 2 + wstr.length,
  );
  const view = new DataView(out.buffer);
  let o = 0;
  const fixed = v.fixed_i32 ?? [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    view.setInt32(o, fixed[i] ?? 0, true);
    o += 4;
  }
  view.setUint32(o, f64.length, true);
  o += 4;
  for (const x of f64) {
    view.setFloat64(o, x, true);
    o += 8;
  }
  view.setUint32(o, bytes.length, true);
  o += 4;
  out.set(bytes, o);
  o += bytes.length;
  o = writeU16Str(out, view, o, str);
  writeU16Str(out, view, o, wstr);
  return out;
}

function readCollections(cur: Cursor): Collections {
  const msg = new Collections();
  const view = new DataView(cur.bytes.buffer, cur.bytes.byteOffset, cur.bytes.byteLength);
  need(cur, 12);
  msg.fixed_i32 = [
    view.getInt32(cur.o, true),
    view.getInt32(cur.o + 4, true),
    view.getInt32(cur.o + 8, true),
  ];
  cur.o += 12;
  const f64Len = readU32(cur, view);
  need(cur, f64Len * 8);
  msg.bounded_f64 = [];
  for (let i = 0; i < f64Len; i++) {
    msg.bounded_f64.push(view.getFloat64(cur.o, true));
    cur.o += 8;
  }
  const bytesLen = readU32(cur, view);
  need(cur, bytesLen);
  msg.bytes_value = cur.bytes.slice(cur.o, cur.o + bytesLen);
  cur.o += bytesLen;
  msg.bounded_string = readU16Str(cur);
  msg.bounded_wstring = readU16Str(cur);
  return msg;
}

function encodeNestedSample(v: NestedSample): Uint8Array {
  const stamp = v.stamp ?? new Time();
  const scalars = encodePrimitiveScalars(v.scalars ?? new PrimitiveScalars());
  const collections = encodeCollections(v.collections ?? new Collections());
  const out = new Uint8Array(8 + scalars.length + collections.length);
  const view = new DataView(out.buffer);
  view.setInt32(0, stamp.sec ?? 0, true);
  view.setUint32(4, stamp.nanosec ?? 0, true);
  out.set(scalars, 8);
  out.set(collections, 8 + scalars.length);
  return out;
}

function readNestedSample(cur: Cursor): NestedSample {
  const msg = new NestedSample();
  const view = new DataView(cur.bytes.buffer, cur.bytes.byteOffset, cur.bytes.byteLength);
  need(cur, 8);
  msg.stamp.sec = view.getInt32(cur.o, true);
  msg.stamp.nanosec = view.getUint32(cur.o + 4, true);
  cur.o += 8;
  msg.scalars = readPrimitiveScalars(cur);
  msg.collections = readCollections(cur);
  return msg;
}

function toBigInt(value: bigint | number | undefined): bigint {
  if (typeof value === "bigint") return value;
  return BigInt(value ?? 0);
}

function toBigUint(value: bigint | number | undefined): bigint {
  const n = toBigInt(value);
  return n < 0n ? 0n : n;
}

function writeU16Str(
  out: Uint8Array,
  view: DataView,
  offset: number,
  bytes: Uint8Array,
): number {
  view.setUint16(offset, bytes.length, true);
  out.set(bytes, offset + 2);
  return offset + 2 + bytes.length;
}

function readU16Str(cur: Cursor): string {
  const view = new DataView(cur.bytes.buffer, cur.bytes.byteOffset, cur.bytes.byteLength);
  need(cur, 2);
  const len = view.getUint16(cur.o, true);
  cur.o += 2;
  need(cur, len);
  const s = td.decode(cur.bytes.subarray(cur.o, cur.o + len));
  cur.o += len;
  return s;
}

function readU32(cur: Cursor, view: DataView): number {
  need(cur, 4);
  const n = view.getUint32(cur.o, true);
  cur.o += 4;
  return n;
}

function need(cur: Cursor, n: number): void {
  if (cur.o + n > cur.bytes.length) {
    throw new Error("generated host value truncated");
  }
}
