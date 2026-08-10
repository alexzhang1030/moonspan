import { describe, expect, test } from "bun:test";
import {
  CONTROL_KIND_AUTHENTICATE,
  CONTROL_KIND_SCHEMA_ADVERTISE,
  CONTROL_PAYLOAD_MAX_BYTES,
  type ControlMessage,
} from "./control.ts";
import {
  EXTENSION_AREA_MAX_BYTES,
  type R2wpExtension,
  TRACE_CONTEXT_EXTENSION_TYPE,
  TRACE_CONTEXT_VALUE_LENGTH,
  encodeExtensionArea,
} from "./extension.ts";
import {
  CLOCK_NONE,
  CLOCK_ROS,
  CLOCK_SYSTEM,
  DEFAULT_SELECTED_VERSION,
  FLAG_FRAGMENT,
  FLAG_KEYFRAME,
  FLAG_RETAINED,
  FLAG_ROS_RELIABLE,
  FLAG_TRACE_PRESENT,
  FRAME_EXTENSION_MAX_BYTES,
  FRAME_HEADER_LENGTH,
  FRAME_PAYLOAD_MAX_BYTES,
  FrameCodecError,
  OPCODE_ASSET_CHUNK,
  OPCODE_CONTROL_CBOR,
  OPCODE_MEDIA_CHUNK,
  OPCODE_RECORDING_CHUNK,
  OPCODE_ROS_SAMPLE,
  OPCODE_SERVICE_REQUEST,
  PRIORITY_CONTROL,
  PRIORITY_DEFAULT,
  decodeFrame,
  encodeFrame,
  resolveFrameOptions,
} from "./frame.ts";

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function corr(): Uint8Array {
  return new Uint8Array(16).fill(0x11);
}

function controlAuth(): ControlMessage {
  return new Map<number, unknown>([
    [1, CONTROL_KIND_AUTHENTICATE],
    [2, corr()],
    [16, "tok"],
    [17, new Uint8Array([0xab, 0xcd])],
  ]) as ControlMessage;
}

function schemaAdvertiseWithDesc(desc: Uint8Array): ControlMessage {
  return new Map<number, unknown>([
    [1, CONTROL_KIND_SCHEMA_ADVERTISE],
    [2, corr()],
    [4, "std_msgs/msg/String"],
    [
      3,
      new Map([
        [1, "moonspan-schema-v1"],
        [2, "ab".repeat(32)],
      ]),
    ],
    [5, 1],
    [6, 0],
    [26, desc],
  ]) as ControlMessage;
}

/** Build a complete frame buffer from parts (for multi-invalid precedence probes). */
function assembleFrame(fields: {
  version?: number;
  opcode: number;
  flags?: number;
  channelId: number;
  sequence?: number;
  sourceTimeNs?: number;
  priority: number;
  clockId: number;
  extension: Uint8Array;
  payload: Uint8Array;
}): Uint8Array {
  const ext = fields.extension;
  const payload = fields.payload;
  const out = new Uint8Array(FRAME_HEADER_LENGTH + ext.length + payload.length);
  out[0] = fields.version ?? 0;
  out[1] = fields.opcode;
  const flags = fields.flags ?? 0;
  out[2] = (flags >>> 8) & 0xff;
  out[3] = flags & 0xff;
  const ch = fields.channelId >>> 0;
  out[4] = (ch >>> 24) & 0xff;
  out[5] = (ch >>> 16) & 0xff;
  out[6] = (ch >>> 8) & 0xff;
  out[7] = ch & 0xff;
  // sequence / source_time left 0 unless set via low bytes
  const seq = fields.sequence ?? 0;
  out[15] = seq & 0xff;
  // source_time_ns as int64 BE low byte only for small values
  const t = fields.sourceTimeNs ?? 0;
  if (t >= 0) {
    out[23] = t & 0xff;
  } else {
    // -1 etc: write full i64
    let x = BigInt(t);
    if (x < 0n) x += 0x1_0000_0000_0000_0000n;
    for (let i = 7; i >= 0; i--) {
      out[16 + i] = Number(x & 0xffn);
      x >>= 8n;
    }
  }
  const plen = payload.length;
  out[24] = (plen >>> 24) & 0xff;
  out[25] = (plen >>> 16) & 0xff;
  out[26] = (plen >>> 8) & 0xff;
  out[27] = plen & 0xff;
  const elen = ext.length;
  out[28] = (elen >>> 8) & 0xff;
  out[29] = elen & 0xff;
  out[30] = fields.priority;
  out[31] = fields.clockId;
  out.set(ext, FRAME_HEADER_LENGTH);
  out.set(payload, FRAME_HEADER_LENGTH + elen);
  return out;
}

function traceValue(): Uint8Array {
  const v = new Uint8Array(TRACE_CONTEXT_VALUE_LENGTH);
  v[0] = 1;
  v[24] = 1;
  return v;
}

function traceExt(): R2wpExtension {
  return { type: TRACE_CONTEXT_EXTENSION_TYPE, critical: false, value: traceValue() };
}

function expectReject(
  fn: () => unknown,
  code: FrameCodecError["code"],
  reason: FrameCodecError["reason"],
  offset?: number,
): FrameCodecError {
  try {
    fn();
    throw new Error("expected throw");
  } catch (e) {
    expect(e).toBeInstanceOf(FrameCodecError);
    expect(e).not.toBeInstanceOf(RangeError);
    const err = e as FrameCodecError;
    expect(err.code).toBe(code);
    expect(err.reason).toBe(reason);
    if (offset !== undefined) expect(err.offset).toBe(offset);
    return err;
  }
}

function appFrame(overrides: Partial<Parameters<typeof encodeFrame>[0]> = {}) {
  return encodeFrame({
    opcode: OPCODE_ROS_SAMPLE,
    channelId: 1,
    sequence: 0,
    sourceTimeNs: 0,
    priority: PRIORITY_DEFAULT,
    clockId: CLOCK_NONE,
    payload: new Uint8Array([0xde, 0xad]),
    ...overrides,
  });
}

describe("frame constants and options", () => {
  test("header and absolute limits", () => {
    expect(FRAME_HEADER_LENGTH).toBe(32);
    expect(FRAME_PAYLOAD_MAX_BYTES).toBe(67_108_864);
    expect(FRAME_EXTENSION_MAX_BYTES).toBe(4096);
    expect(FRAME_EXTENSION_MAX_BYTES).toBe(EXTENSION_AREA_MAX_BYTES);
    expect(DEFAULT_SELECTED_VERSION).toBe(0);
  });

  test("resolveFrameOptions defaults", () => {
    const o = resolveFrameOptions();
    expect(o.selectedVersion).toBe(0);
    expect(o.experimentalOpcodesEnabled).toBe(false);
    expect(o.availableClockIds.has(CLOCK_NONE)).toBe(true);
    expect(o.availableClockIds.has(CLOCK_SYSTEM)).toBe(true);
  });

  test("invalid options rejected with stable FrameCodecError", () => {
    expectReject(
      () => resolveFrameOptions(null as unknown as never),
      "malformed_frame",
      "wrong_input_type",
      0,
    );
    expectReject(
      () => resolveFrameOptions([] as unknown as never),
      "malformed_frame",
      "wrong_input_type",
      0,
    );
    expectReject(
      () => resolveFrameOptions(new Uint8Array(0) as unknown as never),
      "malformed_frame",
      "wrong_input_type",
      0,
    );
    expectReject(
      () => resolveFrameOptions(new Map() as unknown as never),
      "malformed_frame",
      "wrong_input_type",
      0,
    );
    expectReject(
      () => resolveFrameOptions(new Date() as unknown as never),
      "malformed_frame",
      "wrong_input_type",
      0,
    );
    // Throwing property getter must not leak a native exception.
    const throwingOpts = {};
    Object.defineProperty(throwingOpts, "selectedVersion", {
      enumerable: true,
      get() {
        throw new TypeError("forced options getter");
      },
    });
    expectReject(
      () => resolveFrameOptions(throwingOpts as never),
      "malformed_frame",
      "codec_failure",
      0,
    );
    expectReject(
      () => resolveFrameOptions({ selectedVersion: 256 }),
      "malformed_frame",
      "range_violation",
      0,
    );
    expectReject(
      () => resolveFrameOptions({ selectedVersion: -1 }),
      "malformed_frame",
      "range_violation",
      0,
    );
    expectReject(
      () => resolveFrameOptions({ experimentalOpcodesEnabled: 1 as unknown as boolean }),
      "malformed_frame",
      "wrong_type",
      0,
    );
    expectReject(
      () => resolveFrameOptions({ availableClockIds: 1 as unknown as number[] }),
      "malformed_frame",
      "wrong_type",
      0,
    );
    expectReject(
      () => resolveFrameOptions({ availableClockIds: [5] }),
      "malformed_frame",
      "range_violation",
      0,
    );
    expectReject(
      () => resolveFrameOptions({ availableClockIds: [1, 1] }),
      "malformed_frame",
      "range_violation",
      0,
    );
    // selectedVersion 256 must not truncate through encode
    expectReject(
      () =>
        encodeFrame(
          {
            opcode: OPCODE_ROS_SAMPLE,
            channelId: 1,
            sequence: 0,
            priority: PRIORITY_DEFAULT,
            clockId: CLOCK_NONE,
            payload: new Uint8Array(0),
          },
          { selectedVersion: 256 },
        ),
      "malformed_frame",
      "range_violation",
      0,
    );
    // options copy: mutating input array after resolve does not change resolved set
    const clocks = [CLOCK_NONE, CLOCK_SYSTEM];
    const resolved = resolveFrameOptions({ availableClockIds: clocks });
    clocks.push(CLOCK_ROS);
    expect(resolved.availableClockIds.has(CLOCK_ROS)).toBe(false);
  });
});

describe("frame header golden and endianness", () => {
  test("exact header field layout big-endian", () => {
    // Minimal application frame: no ext, 2-byte payload
    const bytes = encodeFrame({
      version: 0,
      opcode: OPCODE_ROS_SAMPLE,
      flags: FLAG_ROS_RELIABLE,
      channelId: 0x01020304,
      sequence: 0x0102030405060708n,
      sourceTimeNs: -2,
      priority: PRIORITY_DEFAULT,
      clockId: CLOCK_SYSTEM,
      payload: new Uint8Array([0xaa, 0xbb]),
    });
    expect(bytes.length).toBe(34);
    expect(bytes[0]).toBe(0); // version
    expect(bytes[1]).toBe(OPCODE_ROS_SAMPLE);
    expect(bytes[2]).toBe(0x00); // flags BE
    expect(bytes[3]).toBe(0x01); // ROS_RELIABLE
    expect(bytes[4]).toBe(0x01);
    expect(bytes[5]).toBe(0x02);
    expect(bytes[6]).toBe(0x03);
    expect(bytes[7]).toBe(0x04);
    expect(hex(bytes.subarray(8, 16))).toBe("0102030405060708");
    // i64 -2 => fffffffffffffffe
    expect(hex(bytes.subarray(16, 24))).toBe("fffffffffffffffe");
    expect(hex(bytes.subarray(24, 28))).toBe("00000002"); // payload_len 2
    expect(hex(bytes.subarray(28, 30))).toBe("0000"); // extension_len 0
    expect(bytes[30]).toBe(PRIORITY_DEFAULT);
    expect(bytes[31]).toBe(CLOCK_SYSTEM);
    expect(hex(bytes.subarray(32))).toBe("aabb");
  });

  test("u64 and i64 boundaries round-trip", () => {
    const maxU = encodeFrame({
      opcode: OPCODE_ROS_SAMPLE,
      channelId: 1,
      sequence: 0xffff_ffff_ffff_ffffn,
      sourceTimeNs: 0x7fff_ffff_ffff_ffffn,
      priority: PRIORITY_DEFAULT,
      clockId: CLOCK_SYSTEM,
      payload: new Uint8Array(0),
    });
    const dMax = decodeFrame(maxU);
    expect(dMax.sequence).toBe(0xffff_ffff_ffff_ffffn);
    expect(dMax.sourceTimeNs).toBe(0x7fff_ffff_ffff_ffffn);

    const minI = encodeFrame({
      opcode: OPCODE_ROS_SAMPLE,
      channelId: 1,
      sequence: 0,
      sourceTimeNs: -0x8000_0000_0000_0000n,
      priority: PRIORITY_DEFAULT,
      clockId: CLOCK_SYSTEM,
      payload: new Uint8Array(0),
    });
    expect(decodeFrame(minI).sourceTimeNs).toBe(-0x8000_0000_0000_0000n);
  });
});

describe("frame CONTROL and application round-trips", () => {
  test("CONTROL_CBOR byte-stable with control message", () => {
    const msg = controlAuth();
    const a = encodeFrame({
      opcode: OPCODE_CONTROL_CBOR,
      channelId: 0,
      sequence: 3,
      priority: PRIORITY_CONTROL,
      clockId: CLOCK_NONE,
      payload: msg,
    });
    const decoded = decodeFrame(a);
    expect(decoded.opcode).toBe(OPCODE_CONTROL_CBOR);
    expect(decoded.channelId).toBe(0);
    expect(decoded.priority).toBe(PRIORITY_CONTROL);
    expect(decoded.payload).toBeInstanceOf(Map);
    expect((decoded.payload as ControlMessage).get(1)).toBe(CONTROL_KIND_AUTHENTICATE);
    const b = encodeFrame({
      opcode: decoded.opcode,
      channelId: decoded.channelId,
      sequence: decoded.sequence,
      sourceTimeNs: decoded.sourceTimeNs,
      priority: decoded.priority,
      clockId: decoded.clockId,
      flags: decoded.flags,
      extensions: decoded.extensions,
      payload: decoded.payload,
    });
    expect(hex(b)).toBe(hex(a));
  });

  test("application payload byte-stable", () => {
    const a = appFrame({ payload: new Uint8Array([1, 2, 3, 4]) });
    const d = decodeFrame(a);
    expect(d.payload).toBeInstanceOf(Uint8Array);
    expect(hex(d.payload as Uint8Array)).toBe("01020304");
    expect(hex(encodeFrame({
      opcode: d.opcode,
      channelId: d.channelId,
      sequence: d.sequence,
      sourceTimeNs: d.sourceTimeNs,
      priority: d.priority,
      clockId: d.clockId,
      flags: d.flags,
      payload: d.payload as Uint8Array,
    }))).toBe(hex(a));
  });
});

describe("frame opcodes and experimental gate", () => {
  test("all assigned opcodes 1..12 encode/decode", () => {
    for (let op = 1; op <= 12; op++) {
      const isControl = op === OPCODE_CONTROL_CBOR;
      const bytes = encodeFrame({
        opcode: op,
        channelId: isControl ? 0 : 1,
        sequence: 0,
        priority: isControl ? PRIORITY_CONTROL : PRIORITY_DEFAULT,
        clockId: CLOCK_NONE,
        payload: isControl ? controlAuth() : new Uint8Array([op]),
      });
      expect(decodeFrame(bytes).opcode).toBe(op);
    }
  });

  test("experimental 128 requires capability", () => {
    expectReject(
      () =>
        encodeFrame({
          opcode: 128,
          channelId: 1,
          sequence: 0,
          priority: PRIORITY_DEFAULT,
          clockId: CLOCK_NONE,
          payload: new Uint8Array(0),
        }),
      "unsupported_opcode",
      "unsupported_opcode",
      1,
    );
    const ok = encodeFrame(
      {
        opcode: 128,
        channelId: 1,
        sequence: 0,
        priority: PRIORITY_DEFAULT,
        clockId: CLOCK_NONE,
        payload: new Uint8Array([9]),
      },
      { experimentalOpcodesEnabled: true },
    );
    expect(decodeFrame(ok, { experimentalOpcodesEnabled: true }).opcode).toBe(128);
  });

  test("reserved opcode 0 and 13 rejected", () => {
    const hdr = appFrame();
    hdr[1] = 0;
    expectReject(() => decodeFrame(hdr), "unsupported_opcode", "unsupported_opcode", 1);
    hdr[1] = 13;
    expectReject(() => decodeFrame(hdr), "unsupported_opcode", "unsupported_opcode", 1);
  });
});

describe("frame flags steps 6 and 7", () => {
  test("unknown flag bits", () => {
    const b = appFrame();
    b[2] = 0x00;
    b[3] = 0x20; // bit 0x0020
    expectReject(() => decodeFrame(b), "unsupported_flags", "unknown_flag_bits", 2);
  });

  test("FRAGMENT prohibited", () => {
    expectReject(
      () => appFrame({ flags: FLAG_FRAGMENT }),
      "unsupported_flags",
      "fragment_prohibited",
      2,
    );
  });

  test("KEYFRAME only MEDIA_CHUNK", () => {
    expectReject(
      () => appFrame({ opcode: OPCODE_ROS_SAMPLE, flags: FLAG_KEYFRAME }),
      "unsupported_flags",
      "keyframe_opcode",
      2,
    );
    const ok = appFrame({
      opcode: OPCODE_MEDIA_CHUNK,
      flags: FLAG_KEYFRAME,
      payload: new Uint8Array([1]),
    });
    expect(decodeFrame(ok).flags & FLAG_KEYFRAME).toBe(FLAG_KEYFRAME);
  });

  test("ROS_RELIABLE and RETAINED only ROS_SAMPLE", () => {
    expectReject(
      () =>
        appFrame({
          opcode: OPCODE_SERVICE_REQUEST,
          flags: FLAG_ROS_RELIABLE,
        }),
      "unsupported_flags",
      "ros_flag_opcode",
      2,
    );
    expectReject(
      () =>
        appFrame({
          opcode: OPCODE_MEDIA_CHUNK,
          flags: FLAG_RETAINED,
        }),
      "unsupported_flags",
      "ros_flag_opcode",
      2,
    );
    const ok = appFrame({ flags: FLAG_ROS_RELIABLE | FLAG_RETAINED });
    expect(decodeFrame(ok).flags & FLAG_ROS_RELIABLE).toBe(FLAG_ROS_RELIABLE);
  });
});

describe("frame channel priority clock", () => {
  test("channel class control vs application", () => {
    expectReject(
      () =>
        encodeFrame({
          opcode: OPCODE_CONTROL_CBOR,
          channelId: 1,
          sequence: 0,
          priority: PRIORITY_CONTROL,
          clockId: CLOCK_NONE,
          payload: controlAuth(),
        }),
      "protocol_violation",
      "channel_class",
      4,
    );
    expectReject(
      () => appFrame({ channelId: 0 }),
      "protocol_violation",
      "channel_class",
      4,
    );
  });

  test("priority and CONTROL priority requirement", () => {
    const b = appFrame();
    b[30] = 5;
    expectReject(() => decodeFrame(b), "protocol_violation", "unassigned_priority", 30);

    expectReject(
      () =>
        encodeFrame({
          opcode: OPCODE_CONTROL_CBOR,
          channelId: 0,
          sequence: 0,
          priority: PRIORITY_DEFAULT,
          clockId: CLOCK_NONE,
          payload: controlAuth(),
        }),
      "protocol_violation",
      "control_priority",
      30,
    );
  });

  test("clock assigned NONE zero time and availability", () => {
    expectReject(
      () => appFrame({ clockId: CLOCK_NONE, sourceTimeNs: 1 }),
      "protocol_violation",
      "none_requires_zero_time",
      16,
    );
    const b = appFrame({ clockId: CLOCK_SYSTEM, sourceTimeNs: 10 });
    b[31] = 5;
    // fix source time still non-zero — clock 5 is unassigned
    expectReject(() => decodeFrame(b), "protocol_violation", "unassigned_clock", 31);

    expectReject(
      () =>
        decodeFrame(appFrame({ clockId: CLOCK_ROS, sourceTimeNs: 1 }), {
          availableClockIds: [CLOCK_NONE, CLOCK_SYSTEM],
        }),
      "clock_unavailable",
      "clock_unavailable",
      31,
    );
  });
});

describe("frame extension and TRACE consistency", () => {
  test("legal TRACE extension round-trip", () => {
    const withTrace = encodeFrame({
      opcode: OPCODE_ROS_SAMPLE,
      channelId: 1,
      sequence: 0,
      flags: FLAG_TRACE_PRESENT,
      priority: PRIORITY_DEFAULT,
      clockId: CLOCK_NONE,
      extensions: [traceExt()],
      payload: new Uint8Array([1]),
    });
    const d = decodeFrame(withTrace);
    expect(d.extensions).toHaveLength(1);
    expect(d.extensions[0]!.type).toBe(TRACE_CONTEXT_EXTENSION_TYPE);
  });

  test("malformed extension maps to extension_structural at absolute offset 32", () => {
    // type 128 noncritical, value_len 1, nonzero padding → structural at pad byte
    const area = new Uint8Array(8);
    area[0] = 128;
    area[1] = 0;
    area[2] = 0;
    area[3] = 1; // value_len 1
    area[4] = 0xaa;
    area[5] = 0x01; // nonzero padding
    const frame = assembleFrame({
      opcode: OPCODE_ROS_SAMPLE,
      channelId: 1,
      priority: PRIORITY_DEFAULT,
      clockId: CLOCK_NONE,
      extension: area,
      payload: new Uint8Array([1]),
    });
    const err = expectReject(
      () => decodeFrame(frame),
      "malformed_frame",
      "extension_structural",
    );
    expect(err.offset).toBe(FRAME_HEADER_LENGTH + 5);
  });

  test("unknown critical exact absolute offset 32", () => {
    const area = encodeExtensionArea([{ type: 99, critical: true, value: new Uint8Array(0) }]);
    const frame = assembleFrame({
      opcode: OPCODE_ROS_SAMPLE,
      channelId: 1,
      priority: PRIORITY_DEFAULT,
      clockId: CLOCK_NONE,
      extension: area,
      payload: new Uint8Array([1]),
    });
    expectReject(
      () => decodeFrame(frame),
      "unsupported_extension",
      "unknown_critical",
      FRAME_HEADER_LENGTH,
    );
  });

  test("TRACE bidirectional consistency", () => {
    expectReject(
      () =>
        encodeFrame({
          opcode: OPCODE_ROS_SAMPLE,
          channelId: 1,
          sequence: 0,
          flags: FLAG_TRACE_PRESENT,
          priority: PRIORITY_DEFAULT,
          clockId: CLOCK_NONE,
          payload: new Uint8Array(0),
        }),
      "protocol_violation",
      "trace_consistency",
      2,
    );
    expectReject(
      () =>
        encodeFrame({
          opcode: OPCODE_ROS_SAMPLE,
          channelId: 1,
          sequence: 0,
          flags: 0,
          priority: PRIORITY_DEFAULT,
          clockId: CLOCK_NONE,
          extensions: [traceExt()],
          payload: new Uint8Array(0),
        }),
      "protocol_violation",
      "trace_consistency",
      2,
    );
  });
});

describe("frame CONTROL payload and absolute offsets", () => {
  test("invalid CONTROL maps to invalid_control with absolute offset", () => {
    const frame = encodeFrame({
      opcode: OPCODE_CONTROL_CBOR,
      channelId: 0,
      sequence: 0,
      priority: PRIORITY_CONTROL,
      clockId: CLOCK_NONE,
      payload: controlAuth(),
    });
    const bad = new Uint8Array(frame);
    const payloadStart = FRAME_HEADER_LENGTH;
    bad[payloadStart] = 0x9f;
    const err = expectReject(() => decodeFrame(bad), "invalid_control", "invalid_control");
    expect(err.offset).toBe(payloadStart);

    const emptyControl = new Uint8Array(FRAME_HEADER_LENGTH);
    emptyControl[1] = OPCODE_CONTROL_CBOR;
    emptyControl[30] = PRIORITY_CONTROL;
    emptyControl[31] = CLOCK_NONE;
    expectReject(() => decodeFrame(emptyControl), "invalid_control", "invalid_control", 32);
  });

  test("TRACE extension + illegal CONTROL payload absolute offset", () => {
    const ext = encodeExtensionArea([traceExt()]);
    // invalid control CBOR (indefinite)
    const badControl = new Uint8Array([0x9f]);
    const frame = assembleFrame({
      opcode: OPCODE_CONTROL_CBOR,
      channelId: 0,
      flags: FLAG_TRACE_PRESENT,
      priority: PRIORITY_CONTROL,
      clockId: CLOCK_NONE,
      extension: ext,
      payload: badControl,
    });
    const err = expectReject(() => decodeFrame(frame), "invalid_control", "invalid_control");
    expect(err.offset).toBe(FRAME_HEADER_LENGTH + ext.length);
  });

  test("encode CONTROL payload over 1MiB maps to message_too_large offset 24", () => {
    // bytes-desc length == CONTROL_PAYLOAD_MAX_BYTES is field-legal; full CBOR exceeds 1MiB.
    const msg = schemaAdvertiseWithDesc(new Uint8Array(CONTROL_PAYLOAD_MAX_BYTES).fill(0x5a));
    expectReject(
      () =>
        encodeFrame({
          opcode: OPCODE_CONTROL_CBOR,
          channelId: 0,
          sequence: 0,
          priority: PRIORITY_CONTROL,
          clockId: CLOCK_NONE,
          payload: msg,
        }),
      "message_too_large",
      "control_payload_too_large",
      24,
    );
  });
});

describe("frame bounds and exact total", () => {
  test("declared extension over limit without large allocation", () => {
    const b = new Uint8Array(FRAME_HEADER_LENGTH);
    b[1] = OPCODE_ROS_SAMPLE;
    b[7] = 1; // channel 1
    // extension_len = 4097 at offset 28
    b[28] = 0x10;
    b[29] = 0x01; // 0x1001 = 4097
    b[30] = PRIORITY_DEFAULT;
    expectReject(() => decodeFrame(b), "message_too_large", "extension_too_large", 28);
  });

  test("declared payload over frame max without large allocation", () => {
    const b = new Uint8Array(FRAME_HEADER_LENGTH);
    b[1] = OPCODE_ROS_SAMPLE;
    b[7] = 1;
    // payload_len = 67108865
    b[24] = 0x04;
    b[25] = 0x00;
    b[26] = 0x00;
    b[27] = 0x01; // 0x04000001 = 67108865
    b[30] = PRIORITY_DEFAULT;
    expectReject(() => decodeFrame(b), "message_too_large", "payload_too_large", 24);
  });

  test("encode application payload 67108865 rejects before copy semantics", () => {
    // Oversized buffer exists only as input length evidence; encoder must fail
    // with message_too_large before relying on a full defensive re-copy path.
    const oversized = new Uint8Array(FRAME_PAYLOAD_MAX_BYTES + 1);
    expectReject(
      () =>
        encodeFrame({
          opcode: OPCODE_ROS_SAMPLE,
          channelId: 1,
          sequence: 0,
          priority: PRIORITY_DEFAULT,
          clockId: CLOCK_NONE,
          payload: oversized,
        }),
      "message_too_large",
      "payload_too_large",
      24,
    );
  });

  test("CONTROL declared payload over control max", () => {
    const b = new Uint8Array(FRAME_HEADER_LENGTH);
    b[1] = OPCODE_CONTROL_CBOR;
    // payload_len = 1048577
    b[24] = 0x00;
    b[25] = 0x10;
    b[26] = 0x00;
    b[27] = 0x01;
    b[30] = PRIORITY_CONTROL;
    expectReject(() => decodeFrame(b), "message_too_large", "control_payload_too_large", 24);
  });

  test("exact total mismatch", () => {
    const ok = appFrame();
    const long = new Uint8Array(ok.length + 1);
    long.set(ok);
    expectReject(() => decodeFrame(long), "malformed_frame", "exact_total_mismatch", 0);
    expectReject(() => decodeFrame(ok.subarray(0, ok.length - 1)), "malformed_frame", "exact_total_mismatch", 0);
  });

  test("minimum length 32", () => {
    expectReject(() => decodeFrame(new Uint8Array(31)), "malformed_frame", "truncated_header", 0);
  });
});

describe("frame multi-invalid precedence steps 1-16", () => {
  const badExtPad = (() => {
    const area = new Uint8Array(8);
    area[0] = 128;
    area[3] = 1;
    area[4] = 0xaa;
    area[5] = 0x01; // nonzero pad
    return area;
  })();
  const critExt = encodeExtensionArea([{ type: 99, critical: true, value: new Uint8Array(0) }]);
  const traceArea = encodeExtensionArea([traceExt()]);

  test("1 truncated before version", () => {
    expectReject(() => decodeFrame(new Uint8Array(10)), "malformed_frame", "truncated_header", 0);
  });

  test("2 version before bounds", () => {
    const b = new Uint8Array(FRAME_HEADER_LENGTH);
    b[0] = 1;
    b[1] = OPCODE_ROS_SAMPLE;
    b[28] = 0x10;
    b[29] = 0x01;
    expectReject(() => decodeFrame(b), "unsupported_version", "unsupported_version", 0);
  });

  test("3 bounds before exact total", () => {
    const b = new Uint8Array(FRAME_HEADER_LENGTH);
    b[1] = OPCODE_ROS_SAMPLE;
    b[7] = 1;
    b[28] = 0x10;
    b[29] = 0x01;
    expectReject(() => decodeFrame(b), "message_too_large", "extension_too_large", 28);
  });

  test("4 exact total before opcode", () => {
    // Valid bounds, wrong total length, and reserved opcode — exact total wins.
    const b = appFrame();
    const long = new Uint8Array(b.length + 1);
    long.set(b);
    long[1] = 0; // would be unsupported_opcode
    expectReject(() => decodeFrame(long), "malformed_frame", "exact_total_mismatch", 0);
  });

  test("5 opcode before flags", () => {
    const b = appFrame();
    b[1] = 0;
    b[3] = 0x20;
    expectReject(() => decodeFrame(b), "unsupported_opcode", "unsupported_opcode", 1);
  });

  test("6 unknown flags before fragment constraint", () => {
    const b = appFrame();
    b[3] = 0x20 | FLAG_FRAGMENT;
    expectReject(() => decodeFrame(b), "unsupported_flags", "unknown_flag_bits", 2);
  });

  test("7 static flag before channel", () => {
    // FRAGMENT + channel_id 0 on application opcode (hand-built; encode rejects FRAGMENT)
    const b = assembleFrame({
      opcode: OPCODE_ROS_SAMPLE,
      channelId: 0,
      flags: FLAG_FRAGMENT,
      priority: PRIORITY_DEFAULT,
      clockId: CLOCK_NONE,
      extension: new Uint8Array(0),
      payload: new Uint8Array([1]),
    });
    expectReject(() => decodeFrame(b), "unsupported_flags", "fragment_prohibited", 2);
  });

  test("8 channel before priority", () => {
    const b = appFrame();
    b[4] = 0;
    b[5] = 0;
    b[6] = 0;
    b[7] = 0;
    b[30] = 5;
    expectReject(() => decodeFrame(b), "protocol_violation", "channel_class", 4);
  });

  test("9 priority and CONTROL priority before clock", () => {
    const b = appFrame();
    b[30] = 5;
    b[31] = 5; // unassigned clock must not win
    expectReject(() => decodeFrame(b), "protocol_violation", "unassigned_priority", 30);

    const ctrl = assembleFrame({
      opcode: OPCODE_CONTROL_CBOR,
      channelId: 0,
      priority: PRIORITY_DEFAULT, // not CONTROL
      clockId: 5, // also illegal
      extension: new Uint8Array(0),
      payload: new Uint8Array(0),
    });
    expectReject(() => decodeFrame(ctrl), "protocol_violation", "control_priority", 30);
  });

  test("10 clock before extension", () => {
    const frame = assembleFrame({
      opcode: OPCODE_ROS_SAMPLE,
      channelId: 1,
      priority: PRIORITY_DEFAULT,
      clockId: 5, // unassigned
      extension: badExtPad,
      payload: new Uint8Array([1]),
    });
    expectReject(() => decodeFrame(frame), "protocol_violation", "unassigned_clock", 31);
  });

  test("11 NONE time before extension", () => {
    const frame = assembleFrame({
      opcode: OPCODE_ROS_SAMPLE,
      channelId: 1,
      priority: PRIORITY_DEFAULT,
      clockId: CLOCK_NONE,
      sourceTimeNs: 7,
      extension: badExtPad,
      payload: new Uint8Array([1]),
    });
    expectReject(() => decodeFrame(frame), "protocol_violation", "none_requires_zero_time", 16);
  });

  test("12 unavailable clock before extension", () => {
    const frame = assembleFrame({
      opcode: OPCODE_ROS_SAMPLE,
      channelId: 1,
      priority: PRIORITY_DEFAULT,
      clockId: CLOCK_ROS,
      sourceTimeNs: 1,
      extension: badExtPad,
      payload: new Uint8Array([1]),
    });
    expectReject(
      () => decodeFrame(frame, { availableClockIds: [CLOCK_NONE, CLOCK_SYSTEM] }),
      "clock_unavailable",
      "clock_unavailable",
      31,
    );
  });

  test("13 structural extension before unknown critical", () => {
    // TLV0: unknown critical type 50; TLV1: type 60 with nonzero padding
    const area = new Uint8Array(12);
    area[0] = 50;
    area[1] = 0x01; // critical
    area[4] = 60;
    area[7] = 1; // value_len 1
    area[8] = 0xaa;
    area[9] = 0x01; // nonzero pad
    const frame = assembleFrame({
      opcode: OPCODE_ROS_SAMPLE,
      channelId: 1,
      priority: PRIORITY_DEFAULT,
      clockId: CLOCK_NONE,
      extension: area,
      payload: new Uint8Array([1]),
    });
    expectReject(() => decodeFrame(frame), "malformed_frame", "extension_structural");
  });

  test("14 unknown critical before trace consistency", () => {
    // critical unknown, TRACE_PRESENT set without TRACE_CONTEXT
    const frame = assembleFrame({
      opcode: OPCODE_ROS_SAMPLE,
      channelId: 1,
      flags: FLAG_TRACE_PRESENT,
      priority: PRIORITY_DEFAULT,
      clockId: CLOCK_NONE,
      extension: critExt,
      payload: new Uint8Array([1]),
    });
    expectReject(
      () => decodeFrame(frame),
      "unsupported_extension",
      "unknown_critical",
      FRAME_HEADER_LENGTH,
    );
  });

  test("15 trace before invalid CONTROL", () => {
    // TRACE_PRESENT without TRACE_CONTEXT; payload is invalid CBOR
    const frame = assembleFrame({
      opcode: OPCODE_CONTROL_CBOR,
      channelId: 0,
      flags: FLAG_TRACE_PRESENT,
      priority: PRIORITY_CONTROL,
      clockId: CLOCK_NONE,
      extension: new Uint8Array(0),
      payload: new Uint8Array([0x9f]),
    });
    expectReject(() => decodeFrame(frame), "protocol_violation", "trace_consistency", 2);
  });

  test("16 invalid CONTROL when earlier steps pass", () => {
    const frame = assembleFrame({
      opcode: OPCODE_CONTROL_CBOR,
      channelId: 0,
      flags: FLAG_TRACE_PRESENT,
      priority: PRIORITY_CONTROL,
      clockId: CLOCK_NONE,
      extension: traceArea,
      payload: new Uint8Array([0x9f]),
    });
    const err = expectReject(() => decodeFrame(frame), "invalid_control", "invalid_control");
    expect(err.offset).toBe(FRAME_HEADER_LENGTH + traceArea.length);
  });
});

describe("frame ownership and native normalization", () => {
  test("copy ownership of payload and extensions", () => {
    const payload = new Uint8Array([1, 2, 3]);
    const ext = traceExt();
    const bytes = encodeFrame({
      opcode: OPCODE_ROS_SAMPLE,
      channelId: 1,
      sequence: 0,
      flags: FLAG_TRACE_PRESENT,
      priority: PRIORITY_DEFAULT,
      clockId: CLOCK_NONE,
      extensions: [ext],
      payload,
    });
    payload[0] = 0xff;
    ext.value[0] = 0xee;
    const d = decodeFrame(bytes);
    expect((d.payload as Uint8Array)[0]).toBe(1);
    expect(d.extensions[0]!.value[0]).toBe(1);
    (d.payload as Uint8Array)[0] = 0x00;
    d.extensions[0]!.value[0] = 0x00;
    const d2 = decodeFrame(bytes);
    expect((d2.payload as Uint8Array)[0]).toBe(1);
  });

  test("wrong input type and native exception normalization", () => {
    expectReject(
      () => decodeFrame("nope" as unknown as Uint8Array),
      "malformed_frame",
      "wrong_input_type",
      0,
    );
    const bytes = appFrame();
    Object.defineProperty(bytes, "slice", {
      configurable: true,
      value: () => {
        throw new RangeError("forced");
      },
    });
    // empty extension path may not call slice on frame for payload if extension 0
    // force extension_len > 0 so slice is used for area
    const withExt = encodeFrame({
      opcode: OPCODE_ROS_SAMPLE,
      channelId: 1,
      sequence: 0,
      flags: FLAG_TRACE_PRESENT,
      priority: PRIORITY_DEFAULT,
      clockId: CLOCK_NONE,
      extensions: [traceExt()],
      payload: new Uint8Array([1]),
    });
    Object.defineProperty(withExt, "slice", {
      configurable: true,
      value: () => {
        throw new RangeError("forced");
      },
    });
    expectReject(() => decodeFrame(withExt), "malformed_frame", "codec_failure");
  });

  test("unsupported version option", () => {
    const b = appFrame();
    expectReject(
      () => decodeFrame(b, { selectedVersion: 1 }),
      "unsupported_version",
      "unsupported_version",
      0,
    );
  });
});

describe("frame recording and asset opcodes", () => {
  test("RECORDING_CHUNK and ASSET_CHUNK", () => {
    for (const op of [OPCODE_RECORDING_CHUNK, OPCODE_ASSET_CHUNK]) {
      const b = encodeFrame({
        opcode: op,
        channelId: 2,
        sequence: 1,
        priority: PRIORITY_DEFAULT,
        clockId: CLOCK_NONE,
        payload: new Uint8Array([0x10]),
      });
      expect(decodeFrame(b).opcode).toBe(op);
    }
  });
});
