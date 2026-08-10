import { describe, expect, test } from "bun:test";
import {
  BOOTSTRAP_PAYLOAD_MAX_BYTES,
  BOOTSTRAP_PREFIX_LENGTH,
  BootstrapCodecError,
  type BootstrapRecord,
  type ClientHelloRecord,
  type ServerHelloRecord,
  decodeBootstrapRecord,
  encodeBootstrapRecord,
} from "./bootstrap.ts";
import { CborDecodeError, encodeDeterministicCbor } from "./cbor.ts";

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function expectReject(
  bytes: Uint8Array,
  code: BootstrapCodecError["code"],
  reason: BootstrapCodecError["reason"],
  offset?: number,
): BootstrapCodecError {
  try {
    decodeBootstrapRecord(bytes);
    throw new Error("expected decode to throw");
  } catch (e) {
    expect(e).toBeInstanceOf(BootstrapCodecError);
    expect(e).not.toBeInstanceOf(CborDecodeError);
    const err = e as BootstrapCodecError;
    expect(err.code).toBe(code);
    expect(err.reason).toBe(reason);
    if (offset !== undefined) expect(err.offset).toBe(offset);
    return err;
  }
}

function expectEncodeReject(
  record: unknown,
  code: BootstrapCodecError["code"],
  reason: BootstrapCodecError["reason"],
): BootstrapCodecError {
  try {
    encodeBootstrapRecord(record as BootstrapRecord);
    throw new Error("expected encode to throw");
  } catch (e) {
    expect(e).toBeInstanceOf(BootstrapCodecError);
    expect(e).not.toBeInstanceOf(CborDecodeError);
    const err = e as BootstrapCodecError;
    expect(err.code).toBe(code);
    expect(err.reason).toBe(reason);
    return err;
  }
}

function prefix(kind: number, payload: Uint8Array, flags = 0, version = 0): Uint8Array {
  const out = new Uint8Array(12 + payload.length);
  out[0] = 0x52;
  out[1] = 0x32;
  out[2] = 0x57;
  out[3] = 0x50;
  out[4] = version;
  out[5] = kind;
  out[6] = (flags >>> 8) & 0xff;
  out[7] = flags & 0xff;
  const len = payload.length;
  out[8] = (len >>> 24) & 0xff;
  out[9] = (len >>> 16) & 0xff;
  out[10] = (len >>> 8) & 0xff;
  out[11] = len & 0xff;
  out.set(payload, 12);
  return out;
}

const minimalClientHello: ClientHelloRecord = {
  kind: "client_hello",
  wireVersions: [0],
  transportCapabilities: {
    webtransportHttp3: true,
    binaryWss: false,
  },
  bufferCapabilities: {
    transferableArraybuffer: true,
    sharedArraybuffer: false,
  },
  requestedLimits: {},
  extensionCapabilities: [],
};

const minimalServerHello: ServerHelloRecord = {
  kind: "server_hello",
  selectedWireVersion: 0,
  transportCapabilities: {
    webtransportHttp3: true,
    binaryWss: false,
    maxDatagramSize: 1200,
  },
  bufferCapabilities: {
    transferableArraybuffer: true,
    sharedArraybuffer: false,
  },
  effectiveLimits: {
    maxChannels: 64,
    maxSessionBytes: 1_048_576,
    maxMessageBytes: 65_536,
    maxControlPayloadBytes: 4096,
  },
  extensionCapabilities: [1, 2],
};

const minimalBootstrapError: BootstrapRecord = {
  kind: "bootstrap_error",
  code: 1,
  message: "bad",
  detail: "x",
};

describe("bootstrap constants", () => {
  test("fixed v0 prefix and payload max", () => {
    expect(BOOTSTRAP_PREFIX_LENGTH).toBe(12);
    expect(BOOTSTRAP_PAYLOAD_MAX_BYTES).toBe(65535);
  });
});

describe("bootstrap golden encode/decode", () => {
  test("client_hello exact golden bytes", () => {
    const bytes = encodeBootstrapRecord(minimalClientHello);
    // Hand-verified: magic R2WP, ver 0, kind 1, flags 0, payload_len, deterministic map keys 1/2/3/4/6
    expect(hex(bytes)).toBe(
      "523257500001000000000014" +
        "a501810002a201f502f403a201f502f404a00680",
    );
    expect(decodeBootstrapRecord(bytes)).toEqual(minimalClientHello);
  });

  test("server_hello exact golden bytes", () => {
    const bytes = encodeBootstrapRecord(minimalServerHello);
    expect(hex(bytes)).toBe(
      "52325750000200000000002c" +
        "a5010002a301f502f4031904b003a201f502f404a4011840021a00100000031a000100000419100006820102",
    );
    expect(decodeBootstrapRecord(bytes)).toEqual(minimalServerHello);
  });

  test("bootstrap_error exact golden bytes", () => {
    const bytes = encodeBootstrapRecord(minimalBootstrapError);
    expect(hex(bytes)).toBe(
      "52325750000300000000000b" + "a301010263626164036178",
    );
    expect(decodeBootstrapRecord(bytes)).toEqual(minimalBootstrapError);
  });

  test("decode↔encode byte stability for three kinds", () => {
    for (const record of [minimalClientHello, minimalServerHello, minimalBootstrapError]) {
      const a = encodeBootstrapRecord(record);
      const decoded = decodeBootstrapRecord(a);
      const b = encodeBootstrapRecord(decoded);
      expect(hex(b)).toBe(hex(a));
    }
  });

  test("input and output copy ownership", () => {
    const original = encodeBootstrapRecord(minimalClientHello);
    const input = new Uint8Array(original);
    const decoded = decodeBootstrapRecord(input);
    input[0] = 0x00;
    input[12] = 0xff;
    // re-encode from decoded semantic value still matches original
    expect(hex(encodeBootstrapRecord(decoded))).toBe(hex(original));

    const out = encodeBootstrapRecord(minimalServerHello);
    const snapshot = hex(out);
    out[5] = 0xff;
    expect(hex(encodeBootstrapRecord(minimalServerHello))).toBe(snapshot);
  });
});

describe("bootstrap boundaries", () => {
  test("uint32 / uint64 requested limits and effective ceilings", () => {
    const client: ClientHelloRecord = {
      ...minimalClientHello,
      requestedLimits: {
        maxChannels: 0xffff_ffff,
        maxSessionBytes: 0xffff_ffff_ffff_ffffn,
        maxMessageBytes: 0,
        maxControlPayloadBytes: 1,
      },
    };
    const encoded = encodeBootstrapRecord(client);
    const decoded = decodeBootstrapRecord(encoded) as ClientHelloRecord;
    expect(decoded.requestedLimits.maxChannels).toBe(0xffff_ffff);
    expect(decoded.requestedLimits.maxSessionBytes).toBe(0xffff_ffff_ffff_ffffn);
    expect(decoded.requestedLimits.maxMessageBytes).toBe(0);
    expect(decoded.requestedLimits.maxControlPayloadBytes).toBe(1);

    const server: ServerHelloRecord = {
      ...minimalServerHello,
      effectiveLimits: {
        maxChannels: 65535,
        maxSessionBytes: 4294967296,
        maxMessageBytes: 67108864,
        maxControlPayloadBytes: 1048576,
      },
    };
    const sBytes = encodeBootstrapRecord(server);
    expect(decodeBootstrapRecord(sBytes)).toEqual(server);

    expectEncodeReject(
      {
        ...minimalServerHello,
        effectiveLimits: { ...minimalServerHello.effectiveLimits, maxChannels: 65536 },
      },
      "malformed_bootstrap",
      "range_violation",
    );
    expectEncodeReject(
      {
        ...minimalServerHello,
        effectiveLimits: {
          ...minimalServerHello.effectiveLimits,
          maxSessionBytes: 4294967297,
        },
      },
      "malformed_bootstrap",
      "range_violation",
    );
    expectEncodeReject(
      {
        ...minimalServerHello,
        effectiveLimits: {
          ...minimalServerHello.effectiveLimits,
          maxMessageBytes: 67108865,
        },
      },
      "malformed_bootstrap",
      "range_violation",
    );
    expectEncodeReject(
      {
        ...minimalServerHello,
        effectiveLimits: {
          ...minimalServerHello.effectiveLimits,
          maxControlPayloadBytes: 1048577,
        },
      },
      "malformed_bootstrap",
      "range_violation",
    );
  });

  test("16 wire versions and 64 capability ids", () => {
    const versions = Array.from({ length: 16 }, (_, i) => i);
    const caps = Array.from({ length: 64 }, (_, i) => i + 1);
    const record: ClientHelloRecord = {
      ...minimalClientHello,
      wireVersions: versions,
      extensionCapabilities: caps,
    };
    const round = decodeBootstrapRecord(encodeBootstrapRecord(record)) as ClientHelloRecord;
    expect(round.wireVersions).toEqual(versions);
    expect(round.extensionCapabilities).toEqual(caps);

    expectEncodeReject(
      { ...minimalClientHello, wireVersions: Array.from({ length: 17 }, (_, i) => i) },
      "malformed_bootstrap",
      "range_violation",
    );
    expectEncodeReject(
      {
        ...minimalClientHello,
        extensionCapabilities: Array.from({ length: 65 }, (_, i) => i + 1),
      },
      "malformed_bootstrap",
      "range_violation",
    );
  });

  test("UTF-8 byte length boundary 4096", () => {
    const ok = "a".repeat(4096);
    const over = "a".repeat(4097);
    // multi-byte: 水 is 3 bytes
    const waterOk = "水".repeat(1365); // 4095 bytes
    const waterOver = "水".repeat(1366); // 4098 bytes

    const errOk: BootstrapRecord = { kind: "bootstrap_error", code: 2, message: ok };
    expect(decodeBootstrapRecord(encodeBootstrapRecord(errOk))).toEqual(errOk);

    expectEncodeReject(
      { kind: "bootstrap_error", code: 2, message: over },
      "malformed_bootstrap",
      "text_too_long",
    );

    const waterRecord: BootstrapRecord = {
      kind: "bootstrap_error",
      code: 4,
      detail: waterOk,
    };
    expect((decodeBootstrapRecord(encodeBootstrapRecord(waterRecord)) as typeof waterRecord).detail).toBe(
      waterOk,
    );
    expectEncodeReject(
      { kind: "bootstrap_error", code: 4, detail: waterOver },
      "malformed_bootstrap",
      "text_too_long",
    );
  });
});

describe("bootstrap prefix validation order", () => {
  const goodPayload = encodeBootstrapRecord(minimalClientHello).slice(12);

  test("1 truncated prefix", () => {
    expectReject(new Uint8Array(11), "malformed_bootstrap", "truncated_prefix", 0);
    expectReject(new Uint8Array(0), "malformed_bootstrap", "truncated_prefix", 0);
  });

  test("2 bad magic", () => {
    const b = prefix(1, goodPayload);
    b[0] = 0x00;
    expectReject(b, "malformed_bootstrap", "bad_magic", 0);
  });

  test("3 unsupported bootstrap version", () => {
    const b = prefix(1, goodPayload, 0, 1);
    expectReject(b, "unsupported_version", "unsupported_bootstrap_version", 4);
  });

  test("4 nonzero flags", () => {
    const b = prefix(1, goodPayload, 1);
    expectReject(b, "malformed_bootstrap", "nonzero_flags", 6);
  });

  test("5 unassigned kind", () => {
    const b = prefix(0, goodPayload);
    expectReject(b, "malformed_bootstrap", "unassigned_kind", 5);
    const b2 = prefix(4, goodPayload);
    expectReject(b2, "malformed_bootstrap", "unassigned_kind", 5);
  });

  test("6 payload_len absolute limit message_too_large", () => {
    const b = new Uint8Array(12);
    b[0] = 0x52;
    b[1] = 0x32;
    b[2] = 0x57;
    b[3] = 0x50;
    b[4] = 0;
    b[5] = 1;
    b[6] = 0;
    b[7] = 0;
    // payload_len = 65536
    b[8] = 0x00;
    b[9] = 0x01;
    b[10] = 0x00;
    b[11] = 0x00;
    expectReject(b, "message_too_large", "payload_too_large", 8);
  });

  test("7 exact total length", () => {
    const exact = prefix(1, goodPayload);
    // trailing byte
    const long = new Uint8Array(exact.length + 1);
    long.set(exact);
    expectReject(long, "malformed_bootstrap", "exact_total_mismatch", 0);
    // short body
    const short = exact.slice(0, exact.length - 1);
    // fix declared payload_len still full size → mismatch
    expectReject(short, "malformed_bootstrap", "exact_total_mismatch", 0);
  });

  test("8 CBOR profile failures map to malformed_bootstrap", () => {
    // indefinite length array head 0x9f
    const b = prefix(1, new Uint8Array([0x9f]));
    const err = expectReject(b, "malformed_bootstrap", "cbor_profile");
    expect(err.offset).toBeGreaterThanOrEqual(12);
    expect(err).not.toBeInstanceOf(CborDecodeError);
  });

  test("9 kind/shape mismatch", () => {
    // kind client_hello but payload is bootstrap_error shape (only key 1)
    const errPayload = encodeDeterministicCbor(new Map<number, unknown>([[1, 1]]));
    const b = prefix(1, errPayload);
    expectReject(b, "malformed_bootstrap", "missing_key", 12);

    // kind bootstrap_error but payload is client_hello shape
    const helloPayload = encodeBootstrapRecord(minimalClientHello).slice(12);
    expectReject(prefix(3, helloPayload), "malformed_bootstrap", "unknown_key", 12);
  });
});

describe("bootstrap multi-invalid priority probes", () => {
  test("bad magic wins over wrong version and nonzero flags", () => {
    const b = new Uint8Array(12);
    b[0] = 0x00; // bad magic
    b[4] = 9; // wrong version
    b[5] = 9; // bad kind
    b[6] = 0x00;
    b[7] = 0x01; // nonzero flags
    b[8] = 0xff;
    b[9] = 0xff;
    b[10] = 0xff;
    b[11] = 0xff; // huge payload_len
    expectReject(b, "malformed_bootstrap", "bad_magic", 0);
  });

  test("version before flags and kind", () => {
    const b = new Uint8Array(12);
    b[0] = 0x52;
    b[1] = 0x32;
    b[2] = 0x57;
    b[3] = 0x50;
    b[4] = 2; // unsupported version
    b[5] = 9; // unassigned kind
    b[7] = 1; // nonzero flags
    expectReject(b, "unsupported_version", "unsupported_bootstrap_version", 4);
  });

  test("flags before kind", () => {
    const b = new Uint8Array(12);
    b[0] = 0x52;
    b[1] = 0x32;
    b[2] = 0x57;
    b[3] = 0x50;
    b[4] = 0;
    b[5] = 9;
    b[7] = 1;
    expectReject(b, "malformed_bootstrap", "nonzero_flags", 6);
  });

  test("kind before payload_len limit", () => {
    const b = new Uint8Array(12);
    b[0] = 0x52;
    b[1] = 0x32;
    b[2] = 0x57;
    b[3] = 0x50;
    b[4] = 0;
    b[5] = 9; // unassigned
    b[8] = 0x00;
    b[9] = 0x01;
    b[10] = 0x00;
    b[11] = 0x00; // 65536
    expectReject(b, "malformed_bootstrap", "unassigned_kind", 5);
  });

  test("payload limit before exact total", () => {
    const b = new Uint8Array(12);
    b[0] = 0x52;
    b[1] = 0x32;
    b[2] = 0x57;
    b[3] = 0x50;
    b[4] = 0;
    b[5] = 1;
    b[8] = 0x00;
    b[9] = 0x01;
    b[10] = 0x00;
    b[11] = 0x00; // 65536, length is only 12
    expectReject(b, "message_too_large", "payload_too_large", 8);
  });
});

describe("bootstrap shape and range rejects", () => {
  test("unknown / missing / extra keys", () => {
    // missing key 6
    const missing = encodeDeterministicCbor(
      new Map<number, unknown>([
        [1, [0]],
        [2, new Map([[1, true], [2, false]])],
        [3, new Map([[1, true], [2, false]])],
        [4, new Map()],
      ]),
    );
    expectReject(prefix(1, missing), "malformed_bootstrap", "missing_key", 12);

    // extra key 5
    const extra = encodeDeterministicCbor(
      new Map<number, unknown>([
        [1, [0]],
        [2, new Map([[1, true], [2, false]])],
        [3, new Map([[1, true], [2, false]])],
        [4, new Map()],
        [5, true],
        [6, []],
      ]),
    );
    expectReject(prefix(1, extra), "malformed_bootstrap", "unknown_key", 12);

    // bootstrap_error unknown key 4
    const errExtra = encodeDeterministicCbor(new Map<number, unknown>([[1, 1], [4, "x"]]));
    expectReject(prefix(3, errExtra), "malformed_bootstrap", "unknown_key", 12);
  });

  test("wrong scalar and container types", () => {
    const badWire = encodeDeterministicCbor(
      new Map<number, unknown>([
        [1, 0], // should be array
        [2, new Map([[1, true], [2, false]])],
        [3, new Map([[1, true], [2, false]])],
        [4, new Map()],
        [6, []],
      ]),
    );
    expectReject(prefix(1, badWire), "malformed_bootstrap", "wrong_type", 12);

    const badBool = encodeDeterministicCbor(
      new Map<number, unknown>([
        [1, [0]],
        [2, new Map([[1, 1], [2, false]])],
        [3, new Map([[1, true], [2, false]])],
        [4, new Map()],
        [6, []],
      ]),
    );
    expectReject(prefix(1, badBool), "malformed_bootstrap", "wrong_type", 12);
  });

  test("range unique order violations", () => {
    // duplicate wire version
    const dupVer = encodeDeterministicCbor(
      new Map<number, unknown>([
        [1, [0, 0]],
        [2, new Map([[1, true], [2, false]])],
        [3, new Map([[1, true], [2, false]])],
        [4, new Map()],
        [6, []],
      ]),
    );
    expectReject(prefix(1, dupVer), "malformed_bootstrap", "unique_violation", 12);

    // capability not ascending
    const order = encodeDeterministicCbor(
      new Map<number, unknown>([
        [1, [0]],
        [2, new Map([[1, true], [2, false]])],
        [3, new Map([[1, true], [2, false]])],
        [4, new Map()],
        [6, [2, 1]],
      ]),
    );
    expectReject(prefix(1, order), "malformed_bootstrap", "order_violation", 12);

    // capability 0 illegal
    const cap0 = encodeDeterministicCbor(
      new Map<number, unknown>([
        [1, [0]],
        [2, new Map([[1, true], [2, false]])],
        [3, new Map([[1, true], [2, false]])],
        [4, new Map()],
        [6, [0]],
      ]),
    );
    expectReject(prefix(1, cap0), "malformed_bootstrap", "range_violation", 12);

    // selected_wire_version != 0
    const sel = encodeDeterministicCbor(
      new Map<number, unknown>([
        [1, 1],
        [2, new Map([[1, true], [2, false]])],
        [3, new Map([[1, true], [2, false]])],
        [
          4,
          new Map([
            [1, 1],
            [2, 1],
            [3, 1],
            [4, 1],
          ]),
        ],
        [6, []],
      ]),
    );
    expectReject(prefix(2, sel), "malformed_bootstrap", "range_violation", 12);

    // bootstrap error code not allowed (3)
    const badCode = encodeDeterministicCbor(new Map<number, unknown>([[1, 3]]));
    expectReject(prefix(3, badCode), "malformed_bootstrap", "range_violation", 12);

    // effective max_channels above ceiling
    const ceil = encodeDeterministicCbor(
      new Map<number, unknown>([
        [1, 0],
        [2, new Map([[1, true], [2, false]])],
        [3, new Map([[1, true], [2, false]])],
        [
          4,
          new Map([
            [1, 65536],
            [2, 1],
            [3, 1],
            [4, 1],
          ]),
        ],
        [6, []],
      ]),
    );
    expectReject(prefix(2, ceil), "malformed_bootstrap", "range_violation", 12);
  });

  test("empty wire_versions rejected", () => {
    const empty = encodeDeterministicCbor(
      new Map<number, unknown>([
        [1, []],
        [2, new Map([[1, true], [2, false]])],
        [3, new Map([[1, true], [2, false]])],
        [4, new Map()],
        [6, []],
      ]),
    );
    expectReject(prefix(1, empty), "malformed_bootstrap", "range_violation", 12);
  });

  test("allowed bootstrap error codes 1,2,4,16,24,25", () => {
    for (const code of [1, 2, 4, 16, 24, 25] as const) {
      const rec: BootstrapRecord = { kind: "bootstrap_error", code };
      expect(decodeBootstrapRecord(encodeBootstrapRecord(rec))).toEqual(rec);
    }
  });
});

describe("bootstrap native exception normalization", () => {
  test("wrong input type does not leak native errors", () => {
    try {
      decodeBootstrapRecord("not-bytes" as unknown as Uint8Array);
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(BootstrapCodecError);
      expect(e).not.toBeInstanceOf(CborDecodeError);
      expect((e as BootstrapCodecError).code).toBe("malformed_bootstrap");
      expect((e as BootstrapCodecError).reason).toBe("wrong_input_type");
    }

    try {
      encodeBootstrapRecord(null as unknown as BootstrapRecord);
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(BootstrapCodecError);
      expect((e as BootstrapCodecError).reason).toBe("wrong_input_type");
    }
  });

  test("internal RangeError from slice normalizes to codec_failure", () => {
    const bytes = encodeBootstrapRecord(minimalClientHello);
    // Own enumerable slice that throws — exercises native exception normalization
    // on a valid Uint8Array after prefix checks pass.
    Object.defineProperty(bytes, "slice", {
      configurable: true,
      enumerable: false,
      writable: true,
      value: () => {
        throw new RangeError("forced slice failure");
      },
    });
    try {
      decodeBootstrapRecord(bytes);
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(BootstrapCodecError);
      expect(e).not.toBeInstanceOf(RangeError);
      expect(e).not.toBeInstanceOf(CborDecodeError);
      const err = e as BootstrapCodecError;
      expect(err.code).toBe("malformed_bootstrap");
      expect(err.reason).toBe("codec_failure");
    }
  });

  test("CBOR failure never surfaces CborDecodeError", () => {
    const truncated = prefix(1, new Uint8Array([0xa1, 0x01])); // map length 1 incomplete
    try {
      decodeBootstrapRecord(truncated);
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(BootstrapCodecError);
      expect(e).not.toBeInstanceOf(CborDecodeError);
      expect((e as BootstrapCodecError).code).toBe("malformed_bootstrap");
      expect((e as BootstrapCodecError).reason).toBe("cbor_profile");
    }
  });
});

describe("bootstrap encode semantic rejects", () => {
  test("top-level extra keys rejected for all three kinds", () => {
    expectEncodeReject(
      { ...minimalClientHello, unexpected: true },
      "malformed_bootstrap",
      "extra_key",
    );
    expectEncodeReject(
      { ...minimalServerHello, unexpected: true },
      "malformed_bootstrap",
      "extra_key",
    );
    expectEncodeReject(
      { kind: "bootstrap_error", code: 1, unexpected: true },
      "malformed_bootstrap",
      "extra_key",
    );
  });

  test("requested maxSessionBytes = 2^64 is range_violation", () => {
    expectEncodeReject(
      {
        ...minimalClientHello,
        requestedLimits: { maxSessionBytes: 2n ** 64n },
      },
      "malformed_bootstrap",
      "range_violation",
    );
  });

  test("duplicate versions and non-ascending caps", () => {
    expectEncodeReject(
      { ...minimalClientHello, wireVersions: [1, 1] },
      "malformed_bootstrap",
      "unique_violation",
    );
    expectEncodeReject(
      { ...minimalClientHello, extensionCapabilities: [2, 1] },
      "malformed_bootstrap",
      "order_violation",
    );
  });

  test("selectedWireVersion must be 0", () => {
    expectEncodeReject(
      { ...minimalServerHello, selectedWireVersion: 1 },
      "malformed_bootstrap",
      "range_violation",
    );
  });
});

describe("bootstrap decode nested closed-set and text bounds", () => {
  test("nested unknown keys: requested_limits key 5 and transport key 4", () => {
    const reqKey5 = encodeDeterministicCbor(
      new Map<number, unknown>([
        [1, [0]],
        [2, new Map([[1, true], [2, false]])],
        [3, new Map([[1, true], [2, false]])],
        [4, new Map([[5, 1]])],
        [6, []],
      ]),
    );
    expectReject(prefix(1, reqKey5), "malformed_bootstrap", "unknown_key", 12);

    const transportKey4 = encodeDeterministicCbor(
      new Map<number, unknown>([
        [1, [0]],
        [2, new Map([[1, true], [2, false], [4, 1]])],
        [3, new Map([[1, true], [2, false]])],
        [4, new Map()],
        [6, []],
      ]),
    );
    expectReject(prefix(1, transportKey4), "malformed_bootstrap", "unknown_key", 12);
  });

  test("decode-side UTF-8 text length 4097 is text_too_long", () => {
    const over = "a".repeat(4097);
    const payload = encodeDeterministicCbor(
      new Map<number, unknown>([
        [1, 1],
        [2, over],
      ]),
    );
    expectReject(prefix(3, payload), "malformed_bootstrap", "text_too_long", 12);
  });
});
