import { describe, expect, test } from "bun:test";
import {
  CONTROL_CDDL_RULE_COVERAGE,
  CONTROL_KIND_AUTHENTICATE,
  CONTROL_KIND_CHANNEL_READY,
  CONTROL_KIND_CLOCK_SYNC,
  CONTROL_KIND_CLOSE_CHANNEL,
  CONTROL_KIND_ERROR,
  CONTROL_KIND_GRAPH_DELTA,
  CONTROL_KIND_GRAPH_SNAPSHOT,
  CONTROL_KIND_HEARTBEAT,
  CONTROL_KIND_OPEN_CHANNEL,
  CONTROL_KIND_SCHEMA_ADVERTISE,
  CONTROL_KIND_SCHEMA_REQUEST,
  CONTROL_KIND_SCHEMA_RESPONSE,
  CONTROL_KIND_SESSION_READY,
  CONTROL_KIND_SESSION_RESUME,
  CONTROL_KIND_SESSION_RESUME_RESULT,
  CONTROL_KINDS,
  CONTROL_PAYLOAD_MAX_BYTES,
  ControlCodecError,
  type ControlMessage,
  decodeControlMessage,
  encodeControlMessage,
  validateControlMessage,
} from "./control.ts";
import { CborDecodeError } from "./cbor.ts";

function b(n: number, fill = 0x11): Uint8Array {
  return new Uint8Array(n).fill(fill);
}

function corr(seed = 1): Uint8Array {
  const out = b(16, 0);
  out[0] = seed;
  return out;
}

function sessionId(seed = 2): Uint8Array {
  const out = b(32, 0);
  out[0] = seed;
  return out;
}

function nodeId(seed: number): Uint8Array {
  const out = b(16, 0);
  out[15] = seed;
  return out;
}

function m(entries: Array<[number, unknown]>): ControlMessage {
  return new Map(entries as Array<[number, never]>);
}

function hex64(ch = "ab"): string {
  return ch.repeat(32).slice(0, 64);
}

function rihs(): string {
  return "RIHS01_" + hex64("cd");
}

function schemaRihs(): ControlMessage {
  return m([
    [1, "rep2011-rihs"],
    [2, rihs()],
  ]);
}

function schemaMoon(): ControlMessage {
  return m([
    [1, "moonspan-schema-v1"],
    [2, hex64("ef")],
  ]);
}

function qosKeepLast(): ControlMessage {
  return m([
    [1, 1],
    [2, 2],
    [3, 1],
    [4, 10],
    [7, 1],
  ]);
}

function qosNoDepth(): ControlMessage {
  return m([
    [1, 0],
    [2, 0],
    [3, 0],
  ]);
}

function effectiveQos(): ControlMessage {
  return m([
    [1, 1],
    [2, 2],
    [3, 1],
    [4, 5],
    [7, 1],
  ]);
}

function effectiveServiceQos(): ControlMessage {
  return m([
    [1, 1],
    [2, 2],
    [3, 1],
    [4, 5],
    [7, 1],
  ]);
}

function actionQos(): ControlMessage {
  return m([
    [1, qosKeepLast()],
    [2, qosKeepLast()],
    [3, qosKeepLast()],
    [4, qosNoDepth()],
    [5, qosKeepLast()],
  ]);
}

function effectiveActionQos(): ControlMessage {
  return m([
    [1, effectiveServiceQos()],
    [2, effectiveServiceQos()],
    [3, effectiveServiceQos()],
    [4, effectiveQos()],
    [5, effectiveQos()],
  ]);
}

function budgets(): ControlMessage {
  return m([
    [1, 16],
    [3, 65536],
  ]);
}

function negotiatedCaps(): ControlMessage {
  return m([
    [1, m([[1, true], [2, true], [3, 1200]])],
    [2, m([[1, true], [2, false]])],
    [3, [1, 2]],
  ]);
}

function errorBodySession(code = 1): ControlMessage {
  return m([
    [48, code],
    [49, 0],
    [51, "err"],
  ]);
}

function errorBodyChannel(code = 7): ControlMessage {
  return m([
    [48, code],
    [49, 1],
  ]);
}

function roundTrip(msg: ControlMessage): ControlMessage {
  const bytes = encodeControlMessage(msg);
  const decoded = decodeControlMessage(bytes);
  const again = encodeControlMessage(decoded);
  expect([...again]).toEqual([...bytes]);
  return decoded;
}

function expectReject(
  fn: () => unknown,
  reason: ControlCodecError["reason"],
  path?: string,
): ControlCodecError {
  try {
    fn();
    throw new Error("expected throw");
  } catch (e) {
    expect(e).toBeInstanceOf(ControlCodecError);
    expect(e).not.toBeInstanceOf(CborDecodeError);
    const err = e as ControlCodecError;
    expect(err.code).toBe("invalid_control");
    expect(err.reason).toBe(reason);
    if (path !== undefined) expect(err.path).toBe(path);
    return err;
  }
}

// ---------------------------------------------------------------------------
// Minimal legal messages for each kind
// ---------------------------------------------------------------------------

function authenticate(): ControlMessage {
  return m([
    [1, CONTROL_KIND_AUTHENTICATE],
    [2, corr(1)],
    [16, "token"],
    [17, b(8, 0xab)],
  ]);
}

function sessionReady(row: "H-FT" | "H-CY" | "J-FT" | "J-CY" = "H-FT"): ControlMessage {
  const distro = row.startsWith("H") ? "humble" : "jazzy";
  const rmw = row.endsWith("FT") ? "rmw_fastrtps_cpp" : "rmw_cyclonedds_cpp";
  return m([
    [1, CONTROL_KIND_SESSION_READY],
    [2, corr(2)],
    [7, "gateway-1"],
    [8, row],
    [10, [0, 1, 42]],
    [13, "policy-v1"],
    [12, budgets()],
    [18, distro],
    [19, rmw],
    [20, "adapter-1"],
    [21, "1.0.0"],
    [53, sessionId(9)],
    [54, negotiatedCaps()],
  ]);
}

function graphSnapshot(): ControlMessage {
  const n1 = nodeId(1);
  const n2 = nodeId(2);
  return m([
    [1, CONTROL_KIND_GRAPH_SNAPSHOT],
    [2, corr(3)],
    [14, 1],
    [7, "gw"],
    [8, "J-FT"],
    [
      22,
      [
        m([
          [55, n1],
          [1, "node_a"],
          [9, 0],
        ]),
        m([
          [55, n2],
          [1, "node_b"],
          [2, "ns"],
          [9, 1],
        ]),
      ],
    ],
    [
      23,
      [
        m([
          [56, nodeId(10)],
          [55, n1],
          [1, "/chatter"],
          [2, 0],
          [3, "std_msgs/msg/String"],
          [4, schemaRihs()],
          [5, 1],
          [6, 0],
          [7, qosKeepLast()],
          [9, 0],
        ]),
        m([
          [56, nodeId(11)],
          [55, n2],
          [1, "/act"],
          [2, 4],
          [3, "example_interfaces/action/Fibonacci"],
          [4, schemaMoon()],
          [5, 2],
          [6, 1],
          [58, actionQos()],
          [9, 1],
          [8, "J-FT"],
        ]),
      ],
    ],
  ]);
}

function graphDelta(): ControlMessage {
  return m([
    [1, CONTROL_KIND_GRAPH_DELTA],
    [2, corr(4)],
    [14, 2],
    [24, 1],
    [7, "gw"],
    [8, "H-CY"],
    [
      25,
      [
        m([
          [1, 0],
          [
            2,
            m([
              [55, nodeId(3)],
              [1, "n"],
              [9, 0],
            ]),
          ],
        ]),
        m([
          [1, 1],
          [55, nodeId(3)],
        ]),
      ],
    ],
  ]);
}

function schemaRequest(): ControlMessage {
  return m([
    [1, CONTROL_KIND_SCHEMA_REQUEST],
    [2, corr(5)],
    [4, "std_msgs/msg/String"],
    [3, schemaRihs()],
  ]);
}

function schemaAdvertise(): ControlMessage {
  return m([
    [1, CONTROL_KIND_SCHEMA_ADVERTISE],
    [2, corr(6)],
    [4, "std_msgs/msg/String"],
    [3, schemaMoon()],
    [5, 1],
    [6, 0],
    [26, b(4, 0x01)],
  ]);
}

function schemaResponseSuccess(): ControlMessage {
  return m([
    [1, CONTROL_KIND_SCHEMA_RESPONSE],
    [2, corr(7)],
    [4, "std_msgs/msg/String"],
    [3, schemaRihs()],
    [5, 2],
    [6, 0],
    [26, b(4, 0x02)],
    [
      27,
      [
        m([
          [1, "String.msg"],
          [2, 1],
          [3, b(2, 0x33)],
        ]),
      ],
    ],
  ]);
}

function schemaResponseError(): ControlMessage {
  return m([
    [1, CONTROL_KIND_SCHEMA_RESPONSE],
    [2, corr(8)],
    [4, "std_msgs/msg/String"],
    [3, schemaRihs()],
    [15, errorBodySession(8)],
  ]);
}

function openChannelTopic(): ControlMessage {
  return m([
    [1, CONTROL_KIND_OPEN_CHANNEL],
    [2, corr(9)],
    [29, 1],
    [30, 0],
    [31, "/chatter"],
    [4, "std_msgs/msg/String"],
    [3, schemaRihs()],
    [5, 1],
    [6, 0],
    [11, qosKeepLast()],
    [32, 2],
    [12, budgets()],
    [9, 0],
    [8, "H-FT"],
  ]);
}

function openChannelService(): ControlMessage {
  return m([
    [1, CONTROL_KIND_OPEN_CHANNEL],
    [2, corr(10)],
    [29, 2],
    [30, 2],
    [31, "/add"],
    [4, "example_interfaces/srv/AddTwoInts"],
    [3, schemaMoon()],
    [5, 1],
    [6, 0],
    [11, qosNoDepth()],
    [32, 1],
    [12, budgets()],
    [9, 0],
    [8, "J-CY"],
  ]);
}

function openChannelAction(): ControlMessage {
  return m([
    [1, CONTROL_KIND_OPEN_CHANNEL],
    [2, corr(11)],
    [29, 3],
    [30, 4],
    [31, "/fib"],
    [4, "example_interfaces/action/Fibonacci"],
    [3, schemaRihs()],
    [5, 1],
    [6, 0],
    [58, actionQos()],
    [32, 2],
    [12, budgets()],
    [9, 0],
    [8, "H-CY"],
  ]);
}

function openChannelMedia(): ControlMessage {
  return m([
    [1, CONTROL_KIND_OPEN_CHANNEL],
    [2, corr(12)],
    [29, 4],
    [30, 6],
    [31, "cam0"],
    [5, 3],
    [32, 3],
    [12, budgets()],
  ]);
}

function openChannelRecording(): ControlMessage {
  return m([
    [1, CONTROL_KIND_OPEN_CHANNEL],
    [2, corr(13)],
    [29, 5],
    [30, 7],
    [31, "bag0"],
    [5, 5],
    [32, 4],
    [12, budgets()],
  ]);
}

function openChannelAsset(): ControlMessage {
  return m([
    [1, CONTROL_KIND_OPEN_CHANNEL],
    [2, corr(14)],
    [29, 6],
    [30, 8],
    [31, "mesh0"],
    [5, 6],
    [32, 2],
    [12, budgets()],
  ]);
}

function channelReadyTopic(): ControlMessage {
  return m([
    [1, CONTROL_KIND_CHANNEL_READY],
    [2, corr(15)],
    [29, 1],
    [33, 0],
    [12, budgets()],
    [59, 2],
    [57, effectiveQos()],
  ]);
}

function channelReadyService(): ControlMessage {
  return m([
    [1, CONTROL_KIND_CHANNEL_READY],
    [2, corr(16)],
    [29, 2],
    [33, 2],
    [12, budgets()],
    [59, 1],
    [60, effectiveServiceQos()],
  ]);
}

function channelReadyAction(): ControlMessage {
  return m([
    [1, CONTROL_KIND_CHANNEL_READY],
    [2, corr(17)],
    [29, 3],
    [33, 0],
    [12, budgets()],
    [59, 2],
    [58, effectiveActionQos()],
  ]);
}

function channelReadyMedia(): ControlMessage {
  return m([
    [1, CONTROL_KIND_CHANNEL_READY],
    [2, corr(18)],
    [29, 4],
    [33, 0],
    [12, budgets()],
    [59, 3],
  ]);
}

function channelReadyFailure(): ControlMessage {
  return m([
    [1, CONTROL_KIND_CHANNEL_READY],
    [2, corr(19)],
    [29, 7],
    [33, 1],
    [15, errorBodyChannel(9)],
  ]);
}

function closeChannel(): ControlMessage {
  return m([
    [1, CONTROL_KIND_CLOSE_CHANNEL],
    [2, corr(20)],
    [29, 1],
    [34, 1],
    [35, 9],
  ]);
}

function clockSync(): ControlMessage {
  return m([
    [1, CONTROL_KIND_CLOCK_SYNC],
    [2, corr(21)],
    [36, 1],
    [37, -1],
    [38, 100n],
    [39, 2],
  ]);
}

function heartbeat(): ControlMessage {
  return m([
    [1, CONTROL_KIND_HEARTBEAT],
    [2, corr(22)],
    [40, 7],
    [41, [1, 2, 9]],
  ]);
}

function sessionResume(): ControlMessage {
  return m([
    [1, CONTROL_KIND_SESSION_RESUME],
    [2, corr(23)],
    [42, sessionId(3)],
    [43, 0],
    [44, negotiatedCaps()],
    [7, "gw"],
    [8, "J-FT"],
    [14, 3],
    [6, 1],
    [13, "policy"],
    [
      45,
      [
        m([
          [1, 1],
          [2, 10],
        ]),
        m([
          [1, 3],
          [2, 0],
        ]),
      ],
    ],
    [16, "cred-type"],
    [17, b(4, 0xee)],
  ]);
}

function sessionResumeAccept(): ControlMessage {
  return m([
    [1, CONTROL_KIND_SESSION_RESUME_RESULT],
    [2, corr(24)],
    [46, true],
    [
      47,
      [
        m([
          [1, 1],
          [2, 0],
          [3, 11],
        ]),
        m([
          [1, 2],
          [2, 1],
          [3, 0],
        ]),
        m([
          [1, 3],
          [2, 1],
        ]),
        m([
          [1, 4],
          [2, 2],
        ]),
        m([
          [1, 5],
          [2, 3],
          [15, errorBodyChannel(7)],
        ]),
      ],
    ],
  ]);
}

function sessionResumeReject(): ControlMessage {
  return m([
    [1, CONTROL_KIND_SESSION_RESUME_RESULT],
    [2, corr(25)],
    [46, false],
    [15, errorBodySession(16)],
  ]);
}

function errorSession(): ControlMessage {
  return m([
    [1, CONTROL_KIND_ERROR],
    [2, corr(26)],
    [48, 25],
    [49, 0],
    [50, 1],
    [51, "msg"],
  ]);
}

function errorChannel(): ControlMessage {
  return m([
    [1, CONTROL_KIND_ERROR],
    [2, corr(27)],
    [48, 7],
    [49, 1],
    [29, 9],
  ]);
}

function errorOperation(): ControlMessage {
  return m([
    [1, CONTROL_KIND_ERROR],
    [2, corr(28)],
    [48, 15],
    [49, 2],
    [29, 9],
  ]);
}

function errorTransport(): ControlMessage {
  return m([
    [1, CONTROL_KIND_ERROR],
    [2, corr(29)],
    [48, 16],
    [49, 3],
  ]);
}

const KIND_MINIMAL: Array<[number, () => ControlMessage]> = [
  [CONTROL_KIND_AUTHENTICATE, authenticate],
  [CONTROL_KIND_SESSION_READY, () => sessionReady("H-FT")],
  [CONTROL_KIND_GRAPH_SNAPSHOT, graphSnapshot],
  [CONTROL_KIND_GRAPH_DELTA, graphDelta],
  [CONTROL_KIND_SCHEMA_REQUEST, schemaRequest],
  [CONTROL_KIND_SCHEMA_ADVERTISE, schemaAdvertise],
  [CONTROL_KIND_SCHEMA_RESPONSE, schemaResponseSuccess],
  [CONTROL_KIND_OPEN_CHANNEL, openChannelTopic],
  [CONTROL_KIND_CHANNEL_READY, channelReadyTopic],
  [CONTROL_KIND_CLOSE_CHANNEL, closeChannel],
  [CONTROL_KIND_CLOCK_SYNC, clockSync],
  [CONTROL_KIND_HEARTBEAT, heartbeat],
  [CONTROL_KIND_SESSION_RESUME, sessionResume],
  [CONTROL_KIND_SESSION_RESUME_RESULT, sessionResumeAccept],
  [CONTROL_KIND_ERROR, errorSession],
];

describe("control constants", () => {
  test("payload max and 15 assigned kinds", () => {
    expect(CONTROL_PAYLOAD_MAX_BYTES).toBe(1048576);
    expect(Object.keys(CONTROL_KINDS)).toHaveLength(15);
    for (let k = 1; k <= 15; k++) {
      expect(CONTROL_KINDS[k as keyof typeof CONTROL_KINDS]).toBeDefined();
    }
  });

  test("CDDL rule coverage list is non-empty", () => {
    expect(CONTROL_CDDL_RULE_COVERAGE.length).toBeGreaterThanOrEqual(15);
  });
});

describe("control 15-kind round trips", () => {
  for (const [kind, factory] of KIND_MINIMAL) {
    test(`kind ${kind} ${CONTROL_KINDS[kind as keyof typeof CONTROL_KINDS]} byte-stable`, () => {
      const msg = factory();
      expect(msg.get(1)).toBe(kind);
      roundTrip(msg);
    });
  }
});

describe("control union variants", () => {
  test("SchemaResponse success and error", () => {
    roundTrip(schemaResponseSuccess());
    roundTrip(schemaResponseError());
  });

  test("ChannelReady success classes and failure", () => {
    roundTrip(channelReadyTopic());
    roundTrip(channelReadyService());
    roundTrip(channelReadyAction());
    roundTrip(channelReadyMedia());
    roundTrip(channelReadyFailure());
  });

  test("OpenChannel all channel classes", () => {
    roundTrip(openChannelTopic());
    roundTrip(openChannelService());
    roundTrip(openChannelAction());
    roundTrip(openChannelMedia());
    roundTrip(openChannelRecording());
    roundTrip(openChannelAsset());
  });

  test("SessionResumeResult accept/reject and channel result variants", () => {
    roundTrip(sessionResumeAccept());
    roundTrip(sessionResumeReject());
  });

  test("Error scopes session/channel/operation/transport", () => {
    roundTrip(errorSession());
    roundTrip(errorChannel());
    roundTrip(errorOperation());
    roundTrip(errorTransport());
  });

  test("QoS keep-last and no-depth", () => {
    const a = openChannelTopic();
    a.set(11, qosKeepLast());
    roundTrip(a);
    const b = openChannelTopic();
    b.set(11, qosNoDepth());
    roundTrip(b);
  });
});

describe("control SessionReady support rows and schema identity", () => {
  test("exact phase-one triples H-FT H-CY J-FT J-CY", () => {
    const expected: Record<string, { distro: string; rmw: string }> = {
      "H-FT": { distro: "humble", rmw: "rmw_fastrtps_cpp" },
      "H-CY": { distro: "humble", rmw: "rmw_cyclonedds_cpp" },
      "J-FT": { distro: "jazzy", rmw: "rmw_fastrtps_cpp" },
      "J-CY": { distro: "jazzy", rmw: "rmw_cyclonedds_cpp" },
    };
    for (const row of ["H-FT", "H-CY", "J-FT", "J-CY"] as const) {
      const msg = sessionReady(row);
      expect(msg.get(8)).toBe(row);
      expect(msg.get(18)).toBe(expected[row]!.distro);
      expect(msg.get(19)).toBe(expected[row]!.rmw);
      const decoded = roundTrip(msg);
      expect(decoded.get(8)).toBe(row);
      expect(decoded.get(18)).toBe(expected[row]!.distro);
      expect(decoded.get(19)).toBe(expected[row]!.rmw);
    }
  });

  test("support_row_id / ros_distro / rmw_identifier triple mismatch rejected", () => {
    // H-FT requires humble + rmw_fastrtps_cpp; distro mismatch
    const distroMismatch = sessionReady("H-FT");
    distroMismatch.set(18, "jazzy");
    expectReject(
      () => encodeControlMessage(distroMismatch),
      "support_row_mismatch",
      "/18",
    );

    // H-FT with wrong RMW (cyclone instead of fastrtps)
    const rmwMismatch = sessionReady("H-FT");
    rmwMismatch.set(19, "rmw_cyclonedds_cpp");
    expectReject(
      () => encodeControlMessage(rmwMismatch),
      "support_row_mismatch",
      "/19",
    );

    // J-CY requires jazzy + cyclone; distro mismatch
    const jDistro = sessionReady("J-CY");
    jDistro.set(18, "humble");
    expectReject(() => encodeControlMessage(jDistro), "support_row_mismatch", "/18");

    // J-FT with cyclone RMW
    const jRmw = sessionReady("J-FT");
    jRmw.set(19, "rmw_cyclonedds_cpp");
    expectReject(() => encodeControlMessage(jRmw), "support_row_mismatch", "/19");
  });

  test("schema identity formats accept and reject", () => {
    roundTrip(schemaRequest());
    const badPrefix = schemaRequest();
    badPrefix.set(
      3,
      m([
        [1, "rep2011-rihs"],
        [2, "RIHS02_" + hex64()],
      ]),
    );
    expectReject(() => encodeControlMessage(badPrefix), "schema_identity");

    const upper = schemaRequest();
    upper.set(
      3,
      m([
        [1, "moonspan-schema-v1"],
        [2, hex64("AB")],
      ]),
    );
    expectReject(() => encodeControlMessage(upper), "schema_identity");

    const short = schemaRequest();
    short.set(
      3,
      m([
        [1, "moonspan-schema-v1"],
        [2, "abcd"],
      ]),
    );
    expectReject(() => encodeControlMessage(short), "schema_identity");
  });
});

describe("control shape rejects", () => {
  test("unknown and missing keys", () => {
    const extra = authenticate();
    extra.set(99, true);
    expectReject(() => encodeControlMessage(extra), "unknown_key", "/99");

    const missing = authenticate();
    missing.delete(16);
    expectReject(() => encodeControlMessage(missing), "missing_key", "/16");
  });

  test("unassigned kind and wrong types", () => {
    expectReject(
      () => encodeControlMessage(m([[1, 16], [2, corr()]])),
      "unassigned_kind",
      "/1",
    );
    const wrong = authenticate();
    wrong.set(16, 1);
    expectReject(() => encodeControlMessage(wrong), "wrong_type", "/16");
  });

  test("error code 20 excluded", () => {
    const err = errorSession();
    err.set(48, 20);
    expectReject(() => encodeControlMessage(err), "enum_violation", "/48");
  });

  test("collection unique ascending", () => {
    const hb = heartbeat();
    hb.set(41, [1, 1]);
    expectReject(() => encodeControlMessage(hb), "unique_violation");

    const hb2 = heartbeat();
    hb2.set(41, [2, 1]);
    expectReject(() => encodeControlMessage(hb2), "order_violation");

    const snap = graphSnapshot();
    const nodes = snap.get(22) as ControlMessage[];
    // swap order to break ascending node ids
    snap.set(22, [nodes[1], nodes[0]]);
    expectReject(() => encodeControlMessage(snap), "order_violation");
  });

  test("array bounds and text/bstr boundaries", () => {
    const hb = heartbeat();
    hb.set(41, Array.from({ length: 65536 }, (_, i) => i + 1));
    expectReject(() => encodeControlMessage(hb), "array_bound");

    const auth = authenticate();
    auth.set(16, "");
    expectReject(() => encodeControlMessage(auth), "text_length", "/16");

    auth.set(16, "a".repeat(4097));
    expectReject(() => encodeControlMessage(auth), "text_length", "/16");

    auth.set(16, "ok");
    auth.set(17, b(0));
    expectReject(() => encodeControlMessage(auth), "bytes_length", "/17");
  });

  test("conditional QoS history_depth", () => {
    const open = openChannelTopic();
    // KEEP_LAST without depth
    open.set(
      11,
      m([
        [1, 1],
        [2, 1],
        [3, 1],
      ]),
    );
    expectReject(() => encodeControlMessage(open), "missing_key");

    // no-depth with forbidden depth key 4
    open.set(
      11,
      m([
        [1, 1],
        [2, 1],
        [3, 0],
        [4, 1],
      ]),
    );
    expectReject(() => encodeControlMessage(open), "unknown_key");
  });
});

describe("control payload limits and CBOR errors", () => {
  test("decode payload > 1MiB", () => {
    const big = new Uint8Array(CONTROL_PAYLOAD_MAX_BYTES + 1);
    expectReject(() => decodeControlMessage(big), "payload_too_large");
  });

  test("encode payload > 1MiB is payload_too_large", () => {
    // Field-level bytes-desc allows up to CONTROL_PAYLOAD_MAX_BYTES, but the
    // full deterministic CBOR map (headers + other fields + bstr) exceeds 1MiB.
    const msg = schemaAdvertise();
    msg.set(26, b(CONTROL_PAYLOAD_MAX_BYTES, 0x5a));
    expectReject(() => encodeControlMessage(msg), "payload_too_large");
  });

  test("invalid CBOR maps to invalid_control cbor_profile", () => {
    expectReject(() => decodeControlMessage(new Uint8Array([0x9f])), "cbor_profile");
  });

  test("native exception normalization", () => {
    const bytes = encodeControlMessage(authenticate());
    Object.defineProperty(bytes, "slice", {
      configurable: true,
      value: () => {
        throw new RangeError("forced");
      },
    });
    expectReject(() => decodeControlMessage(bytes), "codec_failure");
  });

  test("wrong input types", () => {
    expectReject(() => decodeControlMessage("x" as unknown as Uint8Array), "wrong_input_type");
    expectReject(() => encodeControlMessage(null as unknown as ControlMessage), "wrong_input_type");
    expectReject(() => validateControlMessage([]), "wrong_input_type");
  });

  test("copy ownership", () => {
    const msg = authenticate();
    const cred = msg.get(17) as Uint8Array;
    const encoded = encodeControlMessage(msg);
    cred[0] = 0xff;
    const decoded = decodeControlMessage(encoded);
    expect((decoded.get(17) as Uint8Array)[0]).not.toBe(0xff);
    (decoded.get(17) as Uint8Array)[0] = 0x00;
    expect((decodeControlMessage(encoded).get(17) as Uint8Array)[0]).toBe(0xab);
  });
});

describe("control per-kind closed-set mutation", () => {
  test("extra key rejected for every kind minimal map", () => {
    for (const [, factory] of KIND_MINIMAL) {
      const msg = factory();
      msg.set(127, 1);
      expectReject(() => encodeControlMessage(msg), "unknown_key");
    }
  });

  test("removing required kind key 2 fails", () => {
    for (const [, factory] of KIND_MINIMAL) {
      const msg = factory();
      msg.delete(2);
      // Closed-set still fails. Non-union kinds report missing_key at /2; multi-variant
      // kinds may surface unknown_key from a non-matching variant after key 2 is gone.
      try {
        encodeControlMessage(msg);
        throw new Error("expected throw");
      } catch (e) {
        expect(e).toBeInstanceOf(ControlCodecError);
        const err = e as ControlCodecError;
        expect(err.code).toBe("invalid_control");
        expect(["missing_key", "unknown_key"]).toContain(err.reason);
      }
    }
  });
});

describe("control validate vs encode/decode", () => {
  test("validateControlMessage accepts decoded map", () => {
    const bytes = encodeControlMessage(authenticate());
    // decodeDeterministicCbor path through decodeControlMessage already validates
    const msg = decodeControlMessage(bytes);
    const v = validateControlMessage(msg);
    expect(v.get(1)).toBe(CONTROL_KIND_AUTHENTICATE);
  });

  test("non-shortest CBOR rejected", () => {
    // Hand-crafted map{1: 1} with non-shortest uint key: a1 18 01 01
    // (compact form would be a1 01 01). Deterministic profile rejects this.
    const nonShortest = new Uint8Array([0xa1, 0x18, 0x01, 0x01]);
    expectReject(() => decodeControlMessage(nonShortest), "cbor_profile");
  });
});
