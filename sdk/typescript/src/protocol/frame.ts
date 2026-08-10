/**
 * R2WP v0 selected-version frame / header codec (M0-03d slice 4).
 *
 * Normative sources:
 * - protocol/r2wp-v0.md Selected-version frame; selected-frame validation steps 1–16
 * - protocol/registry/r2wp-v0.json selected_version_frame, opcodes, flags, priorities,
 *   clocks, absolute_limits, validation_order.selected_frame
 *
 * Extension area: extension.ts. CONTROL_CBOR payload: control.ts.
 * Steps 17+ (ready-state, channel state, QoS flags, sequences) are out of scope.
 */

import {
  CONTROL_PAYLOAD_MAX_BYTES,
  ControlCodecError,
  type ControlMessage,
  decodeControlMessage,
  encodeControlMessage,
} from "./control.ts";
import {
  EXTENSION_AREA_MAX_BYTES,
  ExtensionCodecError,
  type R2wpExtension,
  TRACE_CONTEXT_EXTENSION_TYPE,
  decodeExtensionArea,
  encodeExtensionArea,
} from "./extension.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Fixed v0 contract: selected_version_frame.header_len */
export const FRAME_HEADER_LENGTH = 32;

/** Fixed v0 contract: absolute_limits.frame_payload_max_bytes */
export const FRAME_PAYLOAD_MAX_BYTES = 67_108_864;

/** Fixed v0 contract: absolute_limits.extension_area_max_bytes */
export const FRAME_EXTENSION_MAX_BYTES = EXTENSION_AREA_MAX_BYTES;

/** Default selected wire version for v0. */
export const DEFAULT_SELECTED_VERSION = 0;

// Opcodes (registry opcodes.assigned; 0 reserved, 13–127 reserved, 128–255 experimental)
export const OPCODE_CONTROL_CBOR = 1;
export const OPCODE_ROS_SAMPLE = 2;
export const OPCODE_SERVICE_REQUEST = 3;
export const OPCODE_SERVICE_RESPONSE = 4;
export const OPCODE_ACTION_GOAL = 5;
export const OPCODE_ACTION_FEEDBACK = 6;
export const OPCODE_ACTION_RESULT = 7;
export const OPCODE_ACTION_STATUS = 8;
export const OPCODE_ACTION_CANCEL = 9;
export const OPCODE_MEDIA_CHUNK = 10;
export const OPCODE_RECORDING_CHUNK = 11;
export const OPCODE_ASSET_CHUNK = 12;

export const ASSIGNED_OPCODES = [
  OPCODE_CONTROL_CBOR,
  OPCODE_ROS_SAMPLE,
  OPCODE_SERVICE_REQUEST,
  OPCODE_SERVICE_RESPONSE,
  OPCODE_ACTION_GOAL,
  OPCODE_ACTION_FEEDBACK,
  OPCODE_ACTION_RESULT,
  OPCODE_ACTION_STATUS,
  OPCODE_ACTION_CANCEL,
  OPCODE_MEDIA_CHUNK,
  OPCODE_RECORDING_CHUNK,
  OPCODE_ASSET_CHUNK,
] as const;

// Flags (registry flags.assigned)
export const FLAG_ROS_RELIABLE = 0x0001;
export const FLAG_KEYFRAME = 0x0002;
export const FLAG_TRACE_PRESENT = 0x0004;
export const FLAG_RETAINED = 0x0008;
export const FLAG_FRAGMENT = 0x0010;
/** Bits that may be set in v0; any other bit is unknown. */
export const FLAG_ASSIGNED_MASK = 0x001f;

// Priorities
export const PRIORITY_CONTROL = 0;
export const PRIORITY_INTERACTIVE = 1;
export const PRIORITY_DEFAULT = 2;
export const PRIORITY_SENSOR = 3;
export const PRIORITY_BULK = 4;

// Clocks
export const CLOCK_NONE = 0;
export const CLOCK_SYSTEM = 1;
export const CLOCK_STEADY = 2;
export const CLOCK_ROS = 3;
export const CLOCK_SIMULATION = 4;

const UINT32_MAX = 0xffff_ffff;
const UINT64_MAX = 0xffff_ffff_ffff_ffffn;
const INT64_MIN = -0x8000_0000_0000_0000n;
const INT64_MAX = 0x7fff_ffff_ffff_ffffn;
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE = BigInt(Number.MIN_SAFE_INTEGER);

const DEFAULT_AVAILABLE_CLOCKS: readonly number[] = [
  CLOCK_NONE,
  CLOCK_SYSTEM,
  CLOCK_STEADY,
  CLOCK_ROS,
  CLOCK_SIMULATION,
];

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type FrameCodecErrorCode =
  | "malformed_frame"
  | "unsupported_version"
  | "message_too_large"
  | "unsupported_opcode"
  | "unsupported_flags"
  | "protocol_violation"
  | "clock_unavailable"
  | "unsupported_extension"
  | "invalid_control";

export type FrameCodecErrorReason =
  | "wrong_input_type"
  | "truncated_header"
  | "unsupported_version"
  | "payload_too_large"
  | "extension_too_large"
  | "control_payload_too_large"
  | "exact_total_mismatch"
  | "unsupported_opcode"
  | "unknown_flag_bits"
  | "fragment_prohibited"
  | "keyframe_opcode"
  | "ros_flag_opcode"
  | "channel_class"
  | "unassigned_priority"
  | "control_priority"
  | "unassigned_clock"
  | "none_requires_zero_time"
  | "clock_unavailable"
  | "extension_structural"
  | "unknown_critical"
  | "trace_consistency"
  | "invalid_control"
  | "range_violation"
  | "wrong_type"
  | "codec_failure";

export class FrameCodecError extends Error {
  readonly code: FrameCodecErrorCode;
  readonly reason: FrameCodecErrorReason;
  /** Absolute offset into the full selected-version frame. */
  readonly offset: number;

  constructor(
    code: FrameCodecErrorCode,
    reason: FrameCodecErrorReason,
    offset: number,
    message: string,
  ) {
    super(message);
    this.name = "FrameCodecError";
    this.code = code;
    this.reason = reason;
    this.offset = offset;
  }
}

function fail(
  code: FrameCodecErrorCode,
  reason: FrameCodecErrorReason,
  offset: number,
  message: string,
): never {
  throw new FrameCodecError(code, reason, offset, message);
}

function wrapNative(e: unknown, offset: number): never {
  if (e instanceof FrameCodecError) throw e;
  const msg = e instanceof Error ? e.message : String(e);
  fail("malformed_frame", "codec_failure", offset, `frame codec failure: ${msg}`);
}

function mapExtensionError(e: ExtensionCodecError, areaBase: number): never {
  const offset = areaBase + e.offset;
  if (e.code === "message_too_large") {
    fail("message_too_large", "extension_too_large", offset, e.message);
  }
  if (e.code === "unsupported_extension") {
    fail("unsupported_extension", "unknown_critical", offset, e.message);
  }
  fail("malformed_frame", "extension_structural", offset, e.message);
}

/**
 * Map control-codec failures onto the full-frame error surface.
 * - reason payload_too_large → message_too_large / control_payload_too_large / offset 24
 *   (declared/encoded CONTROL size is a frame absolute-limit concern, step 3 surface)
 * - all other ControlCodecError → invalid_control at payloadBase + relative offset
 */
function mapControlError(e: ControlCodecError, payloadBase: number): never {
  if (e.reason === "payload_too_large") {
    fail(
      "message_too_large",
      "control_payload_too_large",
      24,
      `CONTROL_CBOR payload exceeds ${CONTROL_PAYLOAD_MAX_BYTES}: ${e.message}`,
    );
  }
  fail(
    "invalid_control",
    "invalid_control",
    payloadBase + e.offset,
    `CONTROL_CBOR: ${e.reason}${e.path ? ` at ${e.path}` : ""}: ${e.message}`,
  );
}

// ---------------------------------------------------------------------------
// Options / semantic types
// ---------------------------------------------------------------------------

/**
 * Receiver options for selected-frame validation.
 *
 * Defaults (safe for isolated codec tests; session layer should pass negotiated values):
 * - selectedVersion: 0
 * - experimentalOpcodesEnabled: false
 * - availableClockIds: all assigned clocks 0..4
 */
export type FrameCodecOptions = {
  selectedVersion?: number;
  experimentalOpcodesEnabled?: boolean;
  availableClockIds?: readonly number[];
};

export type ResolvedFrameOptions = {
  selectedVersion: number;
  experimentalOpcodesEnabled: boolean;
  availableClockIds: ReadonlySet<number>;
};

/** True for plain Object records (`{}` / `Object.create(null)`); rejects Map/Uint8Array/Date/arrays. */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Resolve and validate frame options. Copies inputs into a new Set.
 * Rejects non-plain records, non-u8 selectedVersion, non-boolean experimental flag,
 * and availableClockIds that are not arrays of unique assigned clocks 0..4.
 * Native exceptions from getters/Proxies normalize to FrameCodecError.
 */
export function resolveFrameOptions(options?: FrameCodecOptions): ResolvedFrameOptions {
  try {
    if (options === undefined) {
      return {
        selectedVersion: DEFAULT_SELECTED_VERSION,
        experimentalOpcodesEnabled: false,
        availableClockIds: new Set(DEFAULT_AVAILABLE_CLOCKS),
      };
    }
    if (!isPlainRecord(options)) {
      fail(
        "malformed_frame",
        "wrong_input_type",
        0,
        "FrameCodecOptions must be a plain object",
      );
    }

    let selectedVersion = DEFAULT_SELECTED_VERSION;
    if (options.selectedVersion !== undefined) {
      const v = options.selectedVersion;
      if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0 || v > 255) {
        fail(
          "malformed_frame",
          "range_violation",
          0,
          `selectedVersion must be a u8 integer 0..255; got ${String(v)}`,
        );
      }
      selectedVersion = v;
    }

    let experimentalOpcodesEnabled = false;
    if (options.experimentalOpcodesEnabled !== undefined) {
      if (typeof options.experimentalOpcodesEnabled !== "boolean") {
        fail(
          "malformed_frame",
          "wrong_type",
          0,
          "experimentalOpcodesEnabled must be a boolean",
        );
      }
      experimentalOpcodesEnabled = options.experimentalOpcodesEnabled;
    }

    let availableClockIds: Set<number>;
    if (options.availableClockIds !== undefined) {
      const arr = options.availableClockIds;
      if (!Array.isArray(arr)) {
        fail(
          "malformed_frame",
          "wrong_type",
          0,
          "availableClockIds must be an array",
        );
      }
      availableClockIds = new Set();
      for (const id of arr) {
        if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 0 || id > 4) {
          fail(
            "malformed_frame",
            "range_violation",
            0,
            `availableClockIds elements must be assigned clock integers 0..4; got ${String(id)}`,
          );
        }
        if (availableClockIds.has(id)) {
          fail(
            "malformed_frame",
            "range_violation",
            0,
            `availableClockIds must be unique; duplicate ${id}`,
          );
        }
        availableClockIds.add(id);
      }
    } else {
      availableClockIds = new Set(DEFAULT_AVAILABLE_CLOCKS);
    }

    return {
      selectedVersion,
      experimentalOpcodesEnabled,
      availableClockIds,
    };
  } catch (e) {
    if (e instanceof FrameCodecError) throw e;
    wrapNative(e, 0);
  }
}

/** Header fields supplied by the encoder; payload_len / extension_len are derived. */
export type FrameEncodeInput = {
  version?: number;
  opcode: number;
  flags?: number;
  channelId: number;
  sequence: number | bigint;
  sourceTimeNs?: number | bigint;
  priority: number;
  clockId: number;
  extensions?: readonly R2wpExtension[];
  /**
   * Application opcodes: Uint8Array (copied).
   * CONTROL_CBOR (opcode 1): ControlMessage map (encoded via control codec).
   */
  payload: Uint8Array | ControlMessage;
};

/** Ownership-isolated decoded frame. */
export type DecodedFrame = {
  version: number;
  opcode: number;
  flags: number;
  channelId: number;
  sequence: number | bigint;
  sourceTimeNs: number | bigint;
  payloadLen: number;
  extensionLen: number;
  priority: number;
  clockId: number;
  extensions: R2wpExtension[];
  /**
   * Application: copied Uint8Array.
   * CONTROL_CBOR: ControlMessage from control codec (ownership-isolated).
   */
  payload: Uint8Array | ControlMessage;
};

// ---------------------------------------------------------------------------
// Binary helpers
// ---------------------------------------------------------------------------

function readU16BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset]! << 8) | bytes[offset + 1]!) >>> 0;
}

function readU32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset]! << 24) |
      (bytes[offset + 1]! << 16) |
      (bytes[offset + 2]! << 8) |
      bytes[offset + 3]!) >>>
    0
  );
}

function readU64BE(bytes: Uint8Array, offset: number): number | bigint {
  let n = 0n;
  for (let i = 0; i < 8; i++) {
    n = (n << 8n) | BigInt(bytes[offset + i]!);
  }
  return n <= MAX_SAFE ? Number(n) : n;
}

function readI64BE(bytes: Uint8Array, offset: number): number | bigint {
  let n = 0n;
  for (let i = 0; i < 8; i++) {
    n = (n << 8n) | BigInt(bytes[offset + i]!);
  }
  // sign-extend from 64-bit two's complement
  if (n & 0x8000_0000_0000_0000n) {
    n -= 0x1_0000_0000_0000_0000n;
  }
  if (n >= MIN_SAFE && n <= MAX_SAFE) return Number(n);
  return n;
}

function writeU16BE(out: Uint8Array, offset: number, value: number): void {
  out[offset] = (value >>> 8) & 0xff;
  out[offset + 1] = value & 0xff;
}

function writeU32BE(out: Uint8Array, offset: number, value: number): void {
  out[offset] = (value >>> 24) & 0xff;
  out[offset + 1] = (value >>> 16) & 0xff;
  out[offset + 2] = (value >>> 8) & 0xff;
  out[offset + 3] = value & 0xff;
}

function writeU64BE(out: Uint8Array, offset: number, value: bigint): void {
  let x = value;
  for (let i = 7; i >= 0; i--) {
    out[offset + i] = Number(x & 0xffn);
    x >>= 8n;
  }
}

function writeI64BE(out: Uint8Array, offset: number, value: bigint): void {
  let x = value;
  if (x < 0n) {
    x += 0x1_0000_0000_0000_0000n;
  }
  writeU64BE(out, offset, x);
}

function asUint64(value: number | bigint, label: string, offset: number): bigint {
  let n: bigint;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      fail("malformed_frame", "range_violation", offset, `${label} must be a non-negative safe integer or bigint`);
    }
    n = BigInt(value);
  } else if (typeof value === "bigint") {
    n = value;
  } else {
    fail("malformed_frame", "wrong_type", offset, `${label} must be number or bigint`);
  }
  if (n < 0n || n > UINT64_MAX) {
    fail("malformed_frame", "range_violation", offset, `${label} out of uint64 range`);
  }
  return n;
}

function asInt64(value: number | bigint, label: string, offset: number): bigint {
  let n: bigint;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      fail("malformed_frame", "range_violation", offset, `${label} must be a safe integer or bigint`);
    }
    n = BigInt(value);
  } else if (typeof value === "bigint") {
    n = value;
  } else {
    fail("malformed_frame", "wrong_type", offset, `${label} must be number or bigint`);
  }
  if (n < INT64_MIN || n > INT64_MAX) {
    fail("malformed_frame", "range_violation", offset, `${label} out of int64 range`);
  }
  return n;
}

function checkedAdd(a: number, b: number, offset: number): number {
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || a < 0 || b < 0) {
    fail("malformed_frame", "range_violation", offset, "length arithmetic requires non-negative safe integers");
  }
  const sum = a + b;
  if (!Number.isSafeInteger(sum) || sum < a) {
    fail("message_too_large", "payload_too_large", offset, "length addition overflow");
  }
  return sum;
}

function isAssignedOpcode(opcode: number): boolean {
  return opcode >= OPCODE_CONTROL_CBOR && opcode <= OPCODE_ASSET_CHUNK;
}

function isExperimentalOpcode(opcode: number): boolean {
  return opcode >= 128 && opcode <= 255;
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/**
 * Decode a complete selected-version frame.
 * Executes receiver validation steps 1–16 in frozen order; stops at first failure.
 */
export function decodeFrame(bytes: Uint8Array, options?: FrameCodecOptions): DecodedFrame {
  try {
    if (!(bytes instanceof Uint8Array)) {
      fail("malformed_frame", "wrong_input_type", 0, "decodeFrame requires a Uint8Array");
    }
    const opts = resolveFrameOptions(options);

    // Step 1: minimum length 32
    if (bytes.length < FRAME_HEADER_LENGTH) {
      fail(
        "malformed_frame",
        "truncated_header",
        0,
        `frame shorter than ${FRAME_HEADER_LENGTH} bytes`,
      );
    }

    const version = bytes[0]!;
    const opcode = bytes[1]!;
    const flags = readU16BE(bytes, 2);
    const channelId = readU32BE(bytes, 4);
    const sequence = readU64BE(bytes, 8);
    const sourceTimeNs = readI64BE(bytes, 16);
    const payloadLen = readU32BE(bytes, 24);
    const extensionLen = readU16BE(bytes, 28);
    const priority = bytes[30]!;
    const clockId = bytes[31]!;

    // Step 2: version equals selected
    if (version !== opts.selectedVersion) {
      fail(
        "unsupported_version",
        "unsupported_version",
        0,
        `frame version ${version} != selected ${opts.selectedVersion}`,
      );
    }

    // Step 3: checked declared bounds vs absolute limits
    if (extensionLen > FRAME_EXTENSION_MAX_BYTES) {
      fail(
        "message_too_large",
        "extension_too_large",
        28,
        `extension_len ${extensionLen} exceeds ${FRAME_EXTENSION_MAX_BYTES}`,
      );
    }
    if (payloadLen > FRAME_PAYLOAD_MAX_BYTES) {
      fail(
        "message_too_large",
        "payload_too_large",
        24,
        `payload_len ${payloadLen} exceeds ${FRAME_PAYLOAD_MAX_BYTES}`,
      );
    }
    if (opcode === OPCODE_CONTROL_CBOR && payloadLen > CONTROL_PAYLOAD_MAX_BYTES) {
      fail(
        "message_too_large",
        "control_payload_too_large",
        24,
        `CONTROL_CBOR payload_len ${payloadLen} exceeds ${CONTROL_PAYLOAD_MAX_BYTES}`,
      );
    }

    // Step 4: exact total length 32 + extension_len + payload_len
    const afterHeader = checkedAdd(FRAME_HEADER_LENGTH, extensionLen, 0);
    const expectedTotal = checkedAdd(afterHeader, payloadLen, 0);
    if (bytes.length !== expectedTotal) {
      fail(
        "malformed_frame",
        "exact_total_mismatch",
        0,
        `frame length ${bytes.length} != 32 + extension_len ${extensionLen} + payload_len ${payloadLen}`,
      );
    }

    // Step 5: opcode assigned or capability-gated
    if (isAssignedOpcode(opcode)) {
      // ok
    } else if (isExperimentalOpcode(opcode)) {
      if (!opts.experimentalOpcodesEnabled) {
        fail(
          "unsupported_opcode",
          "unsupported_opcode",
          1,
          `experimental opcode ${opcode} requires experimental_opcodes capability`,
        );
      }
    } else {
      fail("unsupported_opcode", "unsupported_opcode", 1, `unsupported opcode ${opcode}`);
    }

    // Step 6: unknown flag bits
    if ((flags & ~FLAG_ASSIGNED_MASK) !== 0) {
      fail(
        "unsupported_flags",
        "unknown_flag_bits",
        2,
        `unknown flag bits 0x${(flags & ~FLAG_ASSIGNED_MASK).toString(16)}`,
      );
    }

    // Step 7: early static flag/opcode constraints
    if ((flags & FLAG_FRAGMENT) !== 0) {
      fail("unsupported_flags", "fragment_prohibited", 2, "FRAGMENT flag is prohibited in v0");
    }
    if ((flags & FLAG_KEYFRAME) !== 0 && opcode !== OPCODE_MEDIA_CHUNK) {
      fail(
        "unsupported_flags",
        "keyframe_opcode",
        2,
        "KEYFRAME is legal only on MEDIA_CHUNK",
      );
    }
    if (
      ((flags & FLAG_ROS_RELIABLE) !== 0 || (flags & FLAG_RETAINED) !== 0) &&
      opcode !== OPCODE_ROS_SAMPLE
    ) {
      fail(
        "unsupported_flags",
        "ros_flag_opcode",
        2,
        "ROS_RELIABLE and RETAINED are legal only on ROS_SAMPLE",
      );
    }

    // Step 8: channel 0 control / nonzero application (incl. experimental)
    if (opcode === OPCODE_CONTROL_CBOR) {
      if (channelId !== 0) {
        fail(
          "protocol_violation",
          "channel_class",
          4,
          "CONTROL_CBOR requires channel_id 0",
        );
      }
    } else if (channelId === 0) {
      fail(
        "protocol_violation",
        "channel_class",
        4,
        "application/experimental opcodes require channel_id 1..2^32-1",
      );
    }

    // Step 9: numeric priority assigned 0..4, then CONTROL opcode priority enforcement.
    // Internal order within step 9:
    //   (a) reject unassigned numeric priority (>4) → unassigned_priority
    //   (b) if opcode is CONTROL_CBOR, require priority CONTROL (0) → control_priority
    // Registry/prose wording for (b) will be synced in a later protocol-doc batch.
    if (priority > 4) {
      fail(
        "protocol_violation",
        "unassigned_priority",
        30,
        `unassigned priority ${priority}`,
      );
    }
    if (opcode === OPCODE_CONTROL_CBOR && priority !== PRIORITY_CONTROL) {
      fail(
        "protocol_violation",
        "control_priority",
        30,
        "CONTROL_CBOR requires priority CONTROL (0)",
      );
    }

    // Step 10: numeric clock assigned 0..4
    if (clockId > 4) {
      fail("protocol_violation", "unassigned_clock", 31, `unassigned clock_id ${clockId}`);
    }

    // Step 11: clock NONE requires source_time_ns 0
    if (clockId === CLOCK_NONE) {
      const t =
        typeof sourceTimeNs === "bigint" ? sourceTimeNs : BigInt(sourceTimeNs);
      if (t !== 0n) {
        fail(
          "protocol_violation",
          "none_requires_zero_time",
          16,
          "clock NONE requires source_time_ns 0",
        );
      }
    }

    // Step 12: assigned clock availability (NONE is always available)
    if (clockId !== CLOCK_NONE && !opts.availableClockIds.has(clockId)) {
      fail(
        "clock_unavailable",
        "clock_unavailable",
        31,
        `clock_id ${clockId} is not available`,
      );
    }

    const extStart = FRAME_HEADER_LENGTH;
    const extEnd = extStart + extensionLen;
    const payloadStart = extEnd;
    const payloadEnd = payloadStart + payloadLen;

    // Step 13–14: extension structural + unknown critical (via extension codec)
    let extensions: R2wpExtension[] = [];
    if (extensionLen > 0) {
      const area = bytes.slice(extStart, extEnd);
      try {
        extensions = decodeExtensionArea(area);
      } catch (e) {
        if (e instanceof ExtensionCodecError) mapExtensionError(e, extStart);
        wrapNative(e, extStart);
      }
    } else {
      // empty area is valid
      extensions = [];
    }

    // Step 15: TRACE_PRESENT / TRACE_CONTEXT bidirectional consistency
    const traceFlag = (flags & FLAG_TRACE_PRESENT) !== 0;
    const hasTraceCtx = extensions.some((e) => e.type === TRACE_CONTEXT_EXTENSION_TYPE);
    if (traceFlag !== hasTraceCtx) {
      fail(
        "protocol_violation",
        "trace_consistency",
        traceFlag ? 2 : extStart,
        traceFlag
          ? "TRACE_PRESENT set but TRACE_CONTEXT extension missing"
          : "TRACE_CONTEXT present but TRACE_PRESENT flag clear",
      );
    }

    // Step 16: CONTROL_CBOR decode and CDDL shape
    let payload: Uint8Array | ControlMessage;
    if (opcode === OPCODE_CONTROL_CBOR) {
      const rawPayload = bytes.slice(payloadStart, payloadEnd);
      try {
        payload = decodeControlMessage(rawPayload);
      } catch (e) {
        if (e instanceof ControlCodecError) mapControlError(e, payloadStart);
        wrapNative(e, payloadStart);
      }
    } else {
      payload = bytes.slice(payloadStart, payloadEnd);
    }

    // Deep-copy extensions values already isolated by extension codec; re-copy for frame boundary.
    const extOut = extensions.map((e) => ({
      type: e.type,
      critical: e.critical,
      value: new Uint8Array(e.value),
    }));

    return {
      version,
      opcode,
      flags,
      channelId,
      sequence,
      sourceTimeNs,
      payloadLen,
      extensionLen,
      priority,
      clockId,
      extensions: extOut,
      payload:
        payload instanceof Uint8Array
          ? new Uint8Array(payload)
          : payload /* ControlMessage already isolated */,
    };
  } catch (e) {
    if (e instanceof FrameCodecError) throw e;
    wrapNative(e, 0);
  }
}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

/**
 * Encode a selected-version frame.
 * Derives payload_len and extension_len; validates the same static contract as decode
 * (steps 2–12, 15, and CONTROL shape) so illegal inputs fail before producing bytes.
 */
export function encodeFrame(input: FrameEncodeInput, options?: FrameCodecOptions): Uint8Array {
  try {
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      fail("malformed_frame", "wrong_input_type", 0, "encodeFrame requires a FrameEncodeInput object");
    }
    const opts = resolveFrameOptions(options);

    const version = input.version ?? opts.selectedVersion;
    if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 0 || version > 255) {
      fail(
        "malformed_frame",
        "range_violation",
        0,
        `frame version must be a u8 integer 0..255; got ${String(version)}`,
      );
    }
    const opcode = input.opcode;
    const flags = input.flags ?? 0;
    const channelId = input.channelId;
    const priority = input.priority;
    const clockId = input.clockId;
    const sequence = asUint64(input.sequence, "sequence", 8);
    const sourceTimeNs = asInt64(input.sourceTimeNs ?? 0, "sourceTimeNs", 16);

    if (typeof opcode !== "number" || !Number.isSafeInteger(opcode) || opcode < 0 || opcode > 255) {
      fail("unsupported_opcode", "unsupported_opcode", 1, `opcode out of u8 range: ${String(opcode)}`);
    }
    if (typeof flags !== "number" || !Number.isSafeInteger(flags) || flags < 0 || flags > 0xffff) {
      fail("unsupported_flags", "unknown_flag_bits", 2, `flags out of u16 range`);
    }
    if (
      typeof channelId !== "number" ||
      !Number.isSafeInteger(channelId) ||
      channelId < 0 ||
      channelId > UINT32_MAX
    ) {
      fail("protocol_violation", "channel_class", 4, `channelId out of u32 range`);
    }
    if (typeof priority !== "number" || !Number.isSafeInteger(priority) || priority < 0 || priority > 255) {
      fail("protocol_violation", "unassigned_priority", 30, `priority out of u8 range`);
    }
    if (typeof clockId !== "number" || !Number.isSafeInteger(clockId) || clockId < 0 || clockId > 255) {
      fail("protocol_violation", "unassigned_clock", 31, `clockId out of u8 range`);
    }

    // Mirror decode steps 2, 5–12, control priority (same codes/reasons).
    if (version !== opts.selectedVersion) {
      fail(
        "unsupported_version",
        "unsupported_version",
        0,
        `frame version ${version} != selected ${opts.selectedVersion}`,
      );
    }
    if (isAssignedOpcode(opcode)) {
      // ok
    } else if (isExperimentalOpcode(opcode)) {
      if (!opts.experimentalOpcodesEnabled) {
        fail(
          "unsupported_opcode",
          "unsupported_opcode",
          1,
          `experimental opcode ${opcode} requires experimental_opcodes capability`,
        );
      }
    } else {
      fail("unsupported_opcode", "unsupported_opcode", 1, `unsupported opcode ${opcode}`);
    }
    if ((flags & ~FLAG_ASSIGNED_MASK) !== 0) {
      fail(
        "unsupported_flags",
        "unknown_flag_bits",
        2,
        `unknown flag bits 0x${(flags & ~FLAG_ASSIGNED_MASK).toString(16)}`,
      );
    }
    if ((flags & FLAG_FRAGMENT) !== 0) {
      fail("unsupported_flags", "fragment_prohibited", 2, "FRAGMENT flag is prohibited in v0");
    }
    if ((flags & FLAG_KEYFRAME) !== 0 && opcode !== OPCODE_MEDIA_CHUNK) {
      fail("unsupported_flags", "keyframe_opcode", 2, "KEYFRAME is legal only on MEDIA_CHUNK");
    }
    if (
      ((flags & FLAG_ROS_RELIABLE) !== 0 || (flags & FLAG_RETAINED) !== 0) &&
      opcode !== OPCODE_ROS_SAMPLE
    ) {
      fail(
        "unsupported_flags",
        "ros_flag_opcode",
        2,
        "ROS_RELIABLE and RETAINED are legal only on ROS_SAMPLE",
      );
    }
    if (opcode === OPCODE_CONTROL_CBOR) {
      if (channelId !== 0) {
        fail("protocol_violation", "channel_class", 4, "CONTROL_CBOR requires channel_id 0");
      }
    } else if (channelId === 0) {
      fail(
        "protocol_violation",
        "channel_class",
        4,
        "application/experimental opcodes require channel_id 1..2^32-1",
      );
    }
    // Step 9 internal: assigned numeric priority, then CONTROL priority=0.
    if (priority > 4) {
      fail("protocol_violation", "unassigned_priority", 30, `unassigned priority ${priority}`);
    }
    if (opcode === OPCODE_CONTROL_CBOR && priority !== PRIORITY_CONTROL) {
      fail(
        "protocol_violation",
        "control_priority",
        30,
        "CONTROL_CBOR requires priority CONTROL (0)",
      );
    }
    if (clockId > 4) {
      fail("protocol_violation", "unassigned_clock", 31, `unassigned clock_id ${clockId}`);
    }
    if (clockId === CLOCK_NONE && sourceTimeNs !== 0n) {
      fail(
        "protocol_violation",
        "none_requires_zero_time",
        16,
        "clock NONE requires source_time_ns 0",
      );
    }
    if (clockId !== CLOCK_NONE && !opts.availableClockIds.has(clockId)) {
      fail("clock_unavailable", "clock_unavailable", 31, `clock_id ${clockId} is not available`);
    }

    // Encode extension area
    const extensions = input.extensions ?? [];
    let extBytes: Uint8Array;
    try {
      extBytes = encodeExtensionArea(extensions);
    } catch (e) {
      if (e instanceof ExtensionCodecError) mapExtensionError(e, FRAME_HEADER_LENGTH);
      wrapNative(e, FRAME_HEADER_LENGTH);
    }
    const extensionLen = extBytes.length;
    if (extensionLen > FRAME_EXTENSION_MAX_BYTES) {
      fail(
        "message_too_large",
        "extension_too_large",
        28,
        `extension area length ${extensionLen} exceeds ${FRAME_EXTENSION_MAX_BYTES}`,
      );
    }

    // Encode payload
    let payloadBytes: Uint8Array;
    if (opcode === OPCODE_CONTROL_CBOR) {
      if (!(input.payload instanceof Map)) {
        fail(
          "invalid_control",
          "invalid_control",
          FRAME_HEADER_LENGTH + extensionLen,
          "CONTROL_CBOR payload must be a ControlMessage Map",
        );
      }
      try {
        payloadBytes = encodeControlMessage(input.payload);
      } catch (e) {
        if (e instanceof ControlCodecError) {
          mapControlError(e, FRAME_HEADER_LENGTH + extensionLen);
        }
        wrapNative(e, FRAME_HEADER_LENGTH + extensionLen);
      }
    } else {
      if (!(input.payload instanceof Uint8Array)) {
        fail(
          "malformed_frame",
          "wrong_type",
          FRAME_HEADER_LENGTH + extensionLen,
          "application payload must be Uint8Array",
        );
      }
      // Check declared application payload length before allocating a copy.
      const declaredLen = input.payload.length;
      if (declaredLen > FRAME_PAYLOAD_MAX_BYTES) {
        fail(
          "message_too_large",
          "payload_too_large",
          24,
          `payload length ${declaredLen} exceeds ${FRAME_PAYLOAD_MAX_BYTES}`,
        );
      }
      payloadBytes = new Uint8Array(input.payload);
    }

    const payloadLen = payloadBytes.length;
    // Defensive post-copy bound (CONTROL path and application path).
    if (payloadLen > FRAME_PAYLOAD_MAX_BYTES) {
      fail(
        "message_too_large",
        "payload_too_large",
        24,
        `payload length ${payloadLen} exceeds ${FRAME_PAYLOAD_MAX_BYTES}`,
      );
    }
    if (opcode === OPCODE_CONTROL_CBOR && payloadLen > CONTROL_PAYLOAD_MAX_BYTES) {
      fail(
        "message_too_large",
        "control_payload_too_large",
        24,
        `CONTROL_CBOR payload length ${payloadLen} exceeds ${CONTROL_PAYLOAD_MAX_BYTES}`,
      );
    }

    // Step 15 on encode: TRACE consistency
    const traceFlag = (flags & FLAG_TRACE_PRESENT) !== 0;
    const hasTraceCtx = extensions.some((e) => e.type === TRACE_CONTEXT_EXTENSION_TYPE);
    if (traceFlag !== hasTraceCtx) {
      fail(
        "protocol_violation",
        "trace_consistency",
        2,
        "TRACE_PRESENT and TRACE_CONTEXT must be bidirectionally consistent",
      );
    }

    const total = checkedAdd(
      checkedAdd(FRAME_HEADER_LENGTH, extensionLen, 0),
      payloadLen,
      0,
    );
    const out = new Uint8Array(total);
    out[0] = version;
    out[1] = opcode;
    writeU16BE(out, 2, flags);
    writeU32BE(out, 4, channelId);
    writeU64BE(out, 8, sequence);
    writeI64BE(out, 16, sourceTimeNs);
    writeU32BE(out, 24, payloadLen);
    writeU16BE(out, 28, extensionLen);
    out[30] = priority;
    out[31] = clockId;
    out.set(extBytes, FRAME_HEADER_LENGTH);
    out.set(payloadBytes, FRAME_HEADER_LENGTH + extensionLen);
    return out;
  } catch (e) {
    if (e instanceof FrameCodecError) throw e;
    wrapNative(e, 0);
  }
}
