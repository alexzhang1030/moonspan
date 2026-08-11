#!/usr/bin/env bun
/**
 * R2WP v0 dual-transport parity corpus (M0-03e3).
 *
 * --write  regenerates protocol/testdata/parity.json from source manifests + rule matrix
 * --check  disk-first closed validation of parity.json with independent source/registry cross-bind
 *
 * Standalone module: imports hardened I/O helpers from sequence tooling only.
 * Aggregate ownership lives in scripts/protocol-fixtures.ts. Offline deterministic generation and checking.
 */
import path from "node:path";
import {
  asciiCompare,
  ensureRealDirectoryChain,
  readArtifactBytes,
  resolveUnderRoot,
  sha256Hex,
  sortAscii,
  stableJson,
  writeArtifactBytes,
  REGISTRY_REL,
  REGISTRY_MAX_BYTES,
} from "./protocol-sequence-fixtures.ts";

export { sha256Hex, stableJson, sortAscii, asciiCompare };
import { open } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const PARITY_REL = "protocol/testdata/parity.json";
export const GENERATED_BY = "scripts/protocol-parity-fixtures.ts";
export const SCHEMA_VERSION = 1;
export const PROTOCOL_ID = "r2wp-v0";
export const PARITY_MAX_BYTES = 2 * 1024 * 1024;
export const SOURCE_MANIFEST_MAX_BYTES = 2 * 1024 * 1024;
export const VALID_MANIFEST_REL = "protocol/testdata/manifest.json";
export const SEQUENCES_MANIFEST_REL = "protocol/testdata/sequences/manifest.json";
export const VALID_COUNT = 22;
export const SEQUENCE_EVENT_COUNT = 28;
export const SHARED_ARTIFACT_COUNT = VALID_COUNT + SEQUENCE_EVENT_COUNT; // 50
/** Parity document / shared artifact ids (corpus prefix + source tokens). */
export const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{0,191}$/;
/** Valid/boundary source fixture ids (uppercase support-row tokens allowed). */
export const VALID_SOURCE_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/;
/** Sequence event ids (lowercase canonical). */
export const SEQ_EVENT_ID_PATTERN = /^[a-z][a-z0-9_-]{0,127}$/;
/** Sole valid/boundary entry allowed path=null (segment recipe; no on-disk .bin). */
export const MANIFEST_ONLY_RECIPE_ID = "frame-app-payload-64mib-recipe";
export const VALID_BINARY_MAX_BYTES = 2 * 1024 * 1024;
export const SEQ_EVENT_MAX_BYTES = 64 * 1024;
/** Frame payload ceiling (64 MiB application payload + framing headroom). */
export const RECIPE_MAX_BYTE_LENGTH = 67_108_896 + 4096;
export const STRING_FIELD_MAX = 256;
export const RULE_COUNT_MAX = 64;
export const ARTIFACT_COUNT_MAX = 128;

export type SourceCorpusId = "valid_boundary" | "sequences";

export const SOURCE_CORPUS_ORDER: SourceCorpusId[] = ["valid_boundary", "sequences"];

export const SOURCE_MANIFEST_PATHS: Record<SourceCorpusId, string> = {
  valid_boundary: VALID_MANIFEST_REL,
  sequences: SEQUENCES_MANIFEST_REL,
};

/** Required transport rule ids (sorted ASCII). Exhaustive semantic matrix. */
export const REQUIRED_TRANSPORT_RULE_IDS = [
  "action_cancel_reliable_stream",
  "action_feedback_be_datagram_negotiated_sizefit",
  "action_feedback_be_sample_scoped_oversize",
  "action_feedback_be_sample_scoped_unavailable",
  "action_feedback_reliable_stream",
  "action_goal_reliable_stream",
  "action_result_reliable_stream",
  "action_status_be_datagram_negotiated_sizefit",
  "action_status_be_sample_scoped_oversize",
  "action_status_be_sample_scoped_unavailable",
  "action_status_reliable_stream",
  "binary_wss_one_complete_frame_per_message",
  "service_request_reliable_stream",
  "service_response_reliable_stream",
  "topic_be_wt_datagram_negotiated_sizefit",
  "topic_be_wt_sample_scoped_oversize",
  "topic_be_wt_sample_scoped_unavailable",
  "topic_reliable_wss_one_frame_reliable_delivery",
  "topic_reliable_wt_reliable_stream",
  "wss_be_latest_wins_prewrite_gap_postwrite_reliable_hol",
] as const;

export type TransportRuleId = (typeof REQUIRED_TRANSPORT_RULE_IDS)[number];

const PARITY_ROOT_KEYS = [
  "schema_version",
  "protocol",
  "generated_by",
  "source_manifests",
  "shared_artifacts",
  "transport_rules",
] as const;

const SOURCE_MANIFEST_KEYS = ["id", "path", "byte_length", "sha256"] as const;
const ARTIFACT_KEYS = [
  "id",
  "source_corpus",
  "source_id",
  "byte_length",
  "sha256",
  "webtransport",
  "binary_wss",
] as const;
const TRANSPORT_REF_KEYS = ["semantic_identity", "byte_length", "sha256"] as const;
const RULE_KEYS = [
  "id",
  "plane",
  "semantic",
  "opcode",
  "reliability",
  "wt_transport",
  "wss_message_rule",
  "negotiation",
  "max_datagram_size",
  "frame_size",
  "fallback_reason",
  "wss_admission",
  "wss_prewrite_drop",
  "wss_after_write",
  "wss_hol",
  "registry_bind",
] as const;
const REGISTRY_BIND_KEYS = ["opcodes", "payload_mappings", "transport"] as const;
const REGISTRY_OPCODE_BIND_KEYS = ["name", "require"] as const;
const REGISTRY_PAYLOAD_BIND_KEYS = ["semantic", "require"] as const;
const REGISTRY_TRANSPORT_BIND_KEYS = ["path", "equals"] as const;
const REGISTRY_REQUIRE_KEYS = ["path", "equals"] as const;

// Exact registry prose (must match protocol/registry/r2wp-v0.json byte-for-byte).
export const REG_WT_DATAGRAM_RULE =
  "Exactly one complete selected-version best-effort frame matching channel QoS and opcode transport rules (ROS_SAMPLE when topic BEST_EFFORT; ACTION_FEEDBACK/ACTION_STATUS when the respective effective topic reliability is BEST_EFFORT). Size MUST fit negotiated maxDatagramSize.";
export const REG_WSS_MESSAGE_RULE =
  "Exactly one complete bootstrap record or selected-version frame per WebSocket message.";
export const REG_WSS_ADMISSION =
  "Bounded latest-wins admission and eviction BEFORE write to the WebSocket.";
export const REG_WSS_DROPPED_BEFORE_WRITE =
  "Receiver observes sequence_gap for frames dropped by admission/eviction.";
export const REG_WSS_AFTER_WRITE =
  "Once frame bytes are written to the WebSocket, delivery is reliable under RFC 6455 (no post-write best-effort drop).";
export const REG_WSS_HOL_STATUS = "transport_evidence";
export const REG_OP_SERVICE =
  "SERVICE_REQUEST and SERVICE_RESPONSE always use reliable_stream";
export const REG_OP_ACTION_GCR =
  "ACTION_GOAL, ACTION_CANCEL, ACTION_RESULT always use reliable_stream";
export const REG_OP_ACTION_FS =
  "ACTION_FEEDBACK uses effective_action_qos.feedback_topic.reliability; ACTION_STATUS uses effective_action_qos.status_topic.reliability; RELIABLE -> reliable_stream; BEST_EFFORT -> datagram (WebTransport when negotiated and size-fit) or sample_scoped_stream / WSS best-effort path";
export const REG_BE_DATAGRAM = "when negotiated and frame fits maxDatagramSize";
export const REG_BE_SAMPLE_SCOPED =
  "when datagram unavailable or frame exceeds maxDatagramSize";
export const REG_SERVICE_OPCODES = ["SERVICE_REQUEST", "SERVICE_RESPONSE"] as const;
export const REG_ACTION_OPCODES = [
  "ACTION_GOAL",
  "ACTION_FEEDBACK",
  "ACTION_RESULT",
  "ACTION_STATUS",
  "ACTION_CANCEL",
] as const;
export const REG_WSS_APPLIES_TO = [
  "ROS_SAMPLE when effective reliability is BEST_EFFORT",
  "ACTION_FEEDBACK when effective_action_qos.feedback_topic reliability is BEST_EFFORT",
  "ACTION_STATUS when effective_action_qos.status_topic reliability is BEST_EFFORT",
] as const;
export const REG_FEEDBACK_SOURCE = "effective_action_qos.feedback_topic.reliability";
export const REG_STATUS_SOURCE = "effective_action_qos.status_topic.reliability";
export const REG_FEEDBACK_FROM = "effective_action_qos.feedback_topic";
export const REG_STATUS_FROM = "effective_action_qos.status_topic";
export const REG_SUBSCRIBE_SELECTION = "from_effective_qos_reliability";
export const REG_ACTION_BE_PAYLOAD =
  "datagram_if_negotiated_and_size_fit_else_sample_scoped_stream";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TransportRef = {
  semantic_identity: string;
  byte_length: number;
  sha256: string;
};

export type SharedArtifact = {
  id: string;
  source_corpus: SourceCorpusId;
  source_id: string;
  byte_length: number;
  sha256: string;
  webtransport: TransportRef;
  binary_wss: TransportRef;
};

export type SourceManifestEntry = {
  id: SourceCorpusId;
  path: string;
  byte_length: number;
  sha256: string;
};

/** Scalar or closed exact string-array equality fact. */
export type RegistryEquals = string | boolean | number | readonly string[];

/** One exact equality fact relative to an opcode row, payload row, or transport root. */
export type RegistryFact = {
  path: string[];
  equals: RegistryEquals;
};

export type RegistryOpcodeBind = {
  name: string;
  require: RegistryFact[];
};

export type RegistryPayloadBind = {
  semantic: string;
  require: RegistryFact[];
};

export type RegistryTransportBind = {
  path: string[];
  equals: RegistryEquals;
};

/**
 * Closed typed registry binding: every parity rule lists resolvable on-disk registry
 * facts with exact expected values (opcodes, payload_channel_mapping, transport).
 */
export type RegistryBind = {
  opcodes: RegistryOpcodeBind[];
  payload_mappings: RegistryPayloadBind[];
  transport: RegistryTransportBind[];
};

export type TransportRule = {
  id: string;
  plane: "webtransport" | "binary_wss" | "both";
  semantic: string;
  opcode: string | null;
  reliability: "reliable" | "best_effort" | null;
  wt_transport: "reliable_stream" | "datagram" | "sample_scoped_stream" | "reliable_control_stream" | null;
  wss_message_rule: "one_complete_frame_per_message" | null;
  negotiation: boolean | null;
  max_datagram_size: number | null;
  frame_size: number | null;
  fallback_reason: "datagram_unavailable" | "frame_exceeds_max_datagram_size" | null;
  wss_admission: "bounded_latest_wins_prewrite" | null;
  wss_prewrite_drop: "sequence_gap" | null;
  wss_after_write: "reliable" | null;
  wss_hol: "transport_evidence" | null;
  registry_bind: RegistryBind;
};

export type ParityDocument = {
  schema_version: number;
  protocol: string;
  generated_by: string;
  source_manifests: SourceManifestEntry[];
  shared_artifacts: SharedArtifact[];
  transport_rules: TransportRule[];
};

export type CheckResult = { diags: string[]; document: ParityDocument | null };

// ---------------------------------------------------------------------------
// Local bounded I/O (no-follow), independent of fixtures aggregate
// ---------------------------------------------------------------------------

async function lstatRegularFile(
  absPath: string,
  maxBytes: number,
): Promise<{ ok: true; size: number } | { ok: false; error: string }> {
  try {
    const { lstat } = await import("node:fs/promises");
    const st = await lstat(absPath);
    if (st.isSymbolicLink()) return { ok: false, error: "symlink file rejected" };
    if (!st.isFile()) return { ok: false, error: "not a regular file" };
    if (st.size > maxBytes) return { ok: false, error: `file size ${st.size} exceeds max ${maxBytes}` };
    return { ok: true, size: st.size };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function readBoundedFile(
  absPath: string,
  maxBytes: number,
): Promise<{ ok: true; text: string; bytes: Uint8Array } | { ok: false; error: string }> {
  const meta = await lstatRegularFile(absPath, maxBytes);
  if (!meta.ok) return meta;
  try {
    const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
    const fh = await open(absPath, flags);
    try {
      const st2 = await fh.stat();
      if (!st2.isFile() || st2.size > maxBytes) return { ok: false, error: "opened handle invalid" };
      const buf = await fh.readFile();
      if (buf.byteLength > maxBytes) return { ok: false, error: `read size exceeds max ${maxBytes}` };
      const bytes = new Uint8Array(buf);
      return { ok: true, text: buf.toString("utf8"), bytes };
    } finally {
      await fh.close();
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function exactKeys(obj: Record<string, unknown>, allowed: readonly string[], p: string, diags: string[]): void {
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) diags.push(`${p}: unknown key "${k}"`);
}
function requireKeys(obj: Record<string, unknown>, required: readonly string[], p: string, diags: string[]): void {
  for (const k of required) if (!Object.prototype.hasOwnProperty.call(obj, k)) diags.push(`${p}: missing key "${k}"`);
}
function isSha256(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
}
function isSafePosInt(v: unknown, max = Number.MAX_SAFE_INTEGER): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v > 0 && v <= max;
}
function isSafeNonNegInt(v: unknown, max = Number.MAX_SAFE_INTEGER): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= max;
}

export function artifactId(corpus: SourceCorpusId, sourceId: string): string {
  return `${corpus}:${sourceId}`;
}

export function semanticIdentity(corpus: SourceCorpusId, sourceId: string): string {
  return `${corpus}/${sourceId}`;
}

// ---------------------------------------------------------------------------
// Transport rule matrix (hard-coded, registry-cross-bound with exact facts)
// ---------------------------------------------------------------------------

function fact(path: string[], equals: RegistryEquals): RegistryFact {
  return { path, equals: Array.isArray(equals) ? [...equals] : equals };
}

/** Exact closed equality: scalars by ===; string arrays by length and ordered element ===. */
export function valuesEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }
  return a === b;
}

function isRegistryEquals(v: unknown): v is RegistryEquals {
  if (typeof v === "string" || typeof v === "boolean" || typeof v === "number") return true;
  if (Array.isArray(v)) return v.every((x) => typeof x === "string");
  return false;
}

function rb(partial: {
  opcodes?: RegistryOpcodeBind[];
  payload_mappings?: RegistryPayloadBind[];
  transport?: RegistryTransportBind[];
}): RegistryBind {
  return {
    opcodes: partial.opcodes ?? [],
    payload_mappings: partial.payload_mappings ?? [],
    transport: partial.transport ?? [],
  };
}

function baseRule(
  partial: Omit<TransportRule, "registry_bind"> & { registry_bind: RegistryBind },
): TransportRule {
  return partial;
}

/** Deterministic exhaustive transport rule matrix for Phase 1 dual-transport parity. */
export function buildTransportRules(): TransportRule[] {
  const sharedSemantic: RegistryTransportBind = {
    path: ["shared_semantic_fixtures"],
    equals: true,
  };
  const wssMessage: RegistryTransportBind = {
    path: ["binary_wss", "message_rule"],
    equals: REG_WSS_MESSAGE_RULE,
  };
  const rosSampleFlags: RegistryOpcodeBind = {
    name: "ROS_SAMPLE",
    require: [
      fact(["datagram_ok_if_best_effort"], true),
      fact(["sample_scoped_stream_ok_if_best_effort"], true),
    ],
  };
  const topicPublishReliable: RegistryPayloadBind = {
    semantic: "topic_publish",
    require: [
      fact(["opcode"], "ROS_SAMPLE"),
      fact(["transport", "when_effective_reliability_RELIABLE"], "reliable_stream"),
    ],
  };
  const topicSubscribeReliable: RegistryPayloadBind = {
    semantic: "topic_subscribe",
    require: [
      fact(["opcode"], "ROS_SAMPLE"),
      fact(["transport", "selection"], REG_SUBSCRIBE_SELECTION),
      fact(["transport", "RELIABLE"], "reliable_stream"),
    ],
  };
  const topicPublishBeSmall: RegistryPayloadBind = {
    semantic: "topic_publish",
    require: [
      fact(["opcode"], "ROS_SAMPLE"),
      fact(["transport", "when_effective_reliability_BEST_EFFORT_small"], "datagram"),
    ],
  };
  const topicPublishBeLarge: RegistryPayloadBind = {
    semantic: "topic_publish",
    require: [
      fact(["opcode"], "ROS_SAMPLE"),
      fact(["transport", "when_effective_reliability_BEST_EFFORT_large"], "sample_scoped_stream"),
    ],
  };
  const topicSubscribeBe: RegistryPayloadBind = {
    semantic: "topic_subscribe",
    require: [
      fact(["opcode"], "ROS_SAMPLE"),
      fact(["transport", "selection"], REG_SUBSCRIBE_SELECTION),
      fact(["transport", "BEST_EFFORT"], "datagram_or_sample_scoped_stream_by_size"),
    ],
  };
  const serviceClient: RegistryPayloadBind = {
    semantic: "service_client",
    require: [
      fact(["opcodes"], REG_SERVICE_OPCODES),
      fact(["transport"], "reliable_stream"),
    ],
  };
  const serviceServer: RegistryPayloadBind = {
    semantic: "service_server",
    require: [
      fact(["opcodes"], REG_SERVICE_OPCODES),
      fact(["transport"], "reliable_stream"),
    ],
  };
  const actionClientGoal = (op: string): RegistryPayloadBind => ({
    semantic: "action_client",
    require: [
      fact(["opcodes"], REG_ACTION_OPCODES),
      fact(["transport", op], "reliable_stream"),
    ],
  });
  const actionServerGoal = (op: string): RegistryPayloadBind => ({
    semantic: "action_server",
    require: [
      fact(["opcodes"], REG_ACTION_OPCODES),
      fact(["transport", op], "reliable_stream"),
    ],
  });
  const actionClientFeedbackRel: RegistryPayloadBind = {
    semantic: "action_client",
    require: [
      fact(["opcodes"], REG_ACTION_OPCODES),
      fact(["transport", "ACTION_FEEDBACK", "from"], REG_FEEDBACK_FROM),
      fact(["transport", "ACTION_FEEDBACK", "RELIABLE"], "reliable_stream"),
    ],
  };
  const actionServerFeedbackRel: RegistryPayloadBind = {
    semantic: "action_server",
    require: [
      fact(["opcodes"], REG_ACTION_OPCODES),
      fact(["transport", "ACTION_FEEDBACK", "from"], REG_FEEDBACK_FROM),
      fact(["transport", "ACTION_FEEDBACK", "RELIABLE"], "reliable_stream"),
    ],
  };
  const actionClientStatusRel: RegistryPayloadBind = {
    semantic: "action_client",
    require: [
      fact(["opcodes"], REG_ACTION_OPCODES),
      fact(["transport", "ACTION_STATUS", "from"], REG_STATUS_FROM),
      fact(["transport", "ACTION_STATUS", "RELIABLE"], "reliable_stream"),
    ],
  };
  const actionServerStatusRel: RegistryPayloadBind = {
    semantic: "action_server",
    require: [
      fact(["opcodes"], REG_ACTION_OPCODES),
      fact(["transport", "ACTION_STATUS", "from"], REG_STATUS_FROM),
      fact(["transport", "ACTION_STATUS", "RELIABLE"], "reliable_stream"),
    ],
  };
  const actionClientFeedbackBe: RegistryPayloadBind = {
    semantic: "action_client",
    require: [
      fact(["opcodes"], REG_ACTION_OPCODES),
      fact(["transport", "ACTION_FEEDBACK", "from"], REG_FEEDBACK_FROM),
      fact(["transport", "ACTION_FEEDBACK", "BEST_EFFORT"], REG_ACTION_BE_PAYLOAD),
    ],
  };
  const actionServerFeedbackBe: RegistryPayloadBind = {
    semantic: "action_server",
    require: [
      fact(["opcodes"], REG_ACTION_OPCODES),
      fact(["transport", "ACTION_FEEDBACK", "from"], REG_FEEDBACK_FROM),
      fact(["transport", "ACTION_FEEDBACK", "BEST_EFFORT"], REG_ACTION_BE_PAYLOAD),
    ],
  };
  const actionClientStatusBe: RegistryPayloadBind = {
    semantic: "action_client",
    require: [
      fact(["opcodes"], REG_ACTION_OPCODES),
      fact(["transport", "ACTION_STATUS", "from"], REG_STATUS_FROM),
      fact(["transport", "ACTION_STATUS", "BEST_EFFORT"], REG_ACTION_BE_PAYLOAD),
    ],
  };
  const actionServerStatusBe: RegistryPayloadBind = {
    semantic: "action_server",
    require: [
      fact(["opcodes"], REG_ACTION_OPCODES),
      fact(["transport", "ACTION_STATUS", "from"], REG_STATUS_FROM),
      fact(["transport", "ACTION_STATUS", "BEST_EFFORT"], REG_ACTION_BE_PAYLOAD),
    ],
  };
  const feedbackOpcodeSource: RegistryOpcodeBind = {
    name: "ACTION_FEEDBACK",
    require: [
      fact(["transport", "source"], REG_FEEDBACK_SOURCE),
      fact(["transport", "RELIABLE"], "reliable_stream"),
      fact(["transport", "BEST_EFFORT", "datagram"], REG_BE_DATAGRAM),
      fact(["transport", "BEST_EFFORT", "sample_scoped_stream"], REG_BE_SAMPLE_SCOPED),
    ],
  };
  const statusOpcodeSource: RegistryOpcodeBind = {
    name: "ACTION_STATUS",
    require: [
      fact(["transport", "source"], REG_STATUS_SOURCE),
      fact(["transport", "RELIABLE"], "reliable_stream"),
      fact(["transport", "BEST_EFFORT", "datagram"], REG_BE_DATAGRAM),
      fact(["transport", "BEST_EFFORT", "sample_scoped_stream"], REG_BE_SAMPLE_SCOPED),
    ],
  };
  const wssAppliesTo: RegistryTransportBind = {
    path: ["binary_wss", "best_effort_topic_and_action_feedback_status", "applies_to"],
    equals: REG_WSS_APPLIES_TO,
  };

  const rules: TransportRule[] = [
    baseRule({
      id: "topic_reliable_wt_reliable_stream",
      plane: "webtransport",
      semantic: "topic",
      opcode: "ROS_SAMPLE",
      reliability: "reliable",
      wt_transport: "reliable_stream",
      wss_message_rule: null,
      negotiation: null,
      max_datagram_size: null,
      frame_size: null,
      fallback_reason: null,
      wss_admission: null,
      wss_prewrite_drop: null,
      wss_after_write: null,
      wss_hol: null,
      registry_bind: rb({
        opcodes: [rosSampleFlags],
        payload_mappings: [topicPublishReliable, topicSubscribeReliable],
        transport: [sharedSemantic],
      }),
    }),
    baseRule({
      id: "topic_reliable_wss_one_frame_reliable_delivery",
      plane: "binary_wss",
      semantic: "topic",
      opcode: "ROS_SAMPLE",
      reliability: "reliable",
      wt_transport: null,
      wss_message_rule: "one_complete_frame_per_message",
      negotiation: null,
      max_datagram_size: null,
      frame_size: null,
      fallback_reason: null,
      wss_admission: null,
      wss_prewrite_drop: null,
      wss_after_write: "reliable",
      wss_hol: null,
      registry_bind: rb({
        opcodes: [rosSampleFlags],
        payload_mappings: [topicPublishReliable, topicSubscribeReliable],
        transport: [wssMessage, sharedSemantic],
      }),
    }),
    baseRule({
      id: "topic_be_wt_datagram_negotiated_sizefit",
      plane: "webtransport",
      semantic: "topic",
      opcode: "ROS_SAMPLE",
      reliability: "best_effort",
      wt_transport: "datagram",
      wss_message_rule: null,
      negotiation: true,
      max_datagram_size: 1200,
      frame_size: 512,
      fallback_reason: null,
      wss_admission: null,
      wss_prewrite_drop: null,
      wss_after_write: null,
      wss_hol: null,
      registry_bind: rb({
        opcodes: [rosSampleFlags],
        payload_mappings: [topicPublishBeSmall, topicSubscribeBe],
        transport: [
          { path: ["webtransport", "datagram_rule"], equals: REG_WT_DATAGRAM_RULE },
          sharedSemantic,
        ],
      }),
    }),
    baseRule({
      id: "topic_be_wt_sample_scoped_unavailable",
      plane: "webtransport",
      semantic: "topic",
      opcode: "ROS_SAMPLE",
      reliability: "best_effort",
      wt_transport: "sample_scoped_stream",
      wss_message_rule: null,
      negotiation: false,
      max_datagram_size: null,
      frame_size: 512,
      fallback_reason: "datagram_unavailable",
      wss_admission: null,
      wss_prewrite_drop: null,
      wss_after_write: null,
      wss_hol: null,
      registry_bind: rb({
        opcodes: [rosSampleFlags],
        payload_mappings: [topicPublishBeLarge, topicSubscribeBe],
        transport: [
          { path: ["webtransport", "datagram_rule"], equals: REG_WT_DATAGRAM_RULE },
          sharedSemantic,
        ],
      }),
    }),
    baseRule({
      id: "topic_be_wt_sample_scoped_oversize",
      plane: "webtransport",
      semantic: "topic",
      opcode: "ROS_SAMPLE",
      reliability: "best_effort",
      wt_transport: "sample_scoped_stream",
      wss_message_rule: null,
      negotiation: true,
      max_datagram_size: 1200,
      frame_size: 2048,
      fallback_reason: "frame_exceeds_max_datagram_size",
      wss_admission: null,
      wss_prewrite_drop: null,
      wss_after_write: null,
      wss_hol: null,
      registry_bind: rb({
        opcodes: [rosSampleFlags],
        payload_mappings: [topicPublishBeLarge, topicSubscribeBe],
        transport: [
          { path: ["webtransport", "datagram_rule"], equals: REG_WT_DATAGRAM_RULE },
          sharedSemantic,
        ],
      }),
    }),
    baseRule({
      id: "service_request_reliable_stream",
      plane: "both",
      semantic: "service_request",
      opcode: "SERVICE_REQUEST",
      reliability: "reliable",
      wt_transport: "reliable_stream",
      wss_message_rule: "one_complete_frame_per_message",
      negotiation: null,
      max_datagram_size: null,
      frame_size: null,
      fallback_reason: null,
      wss_admission: null,
      wss_prewrite_drop: null,
      wss_after_write: "reliable",
      wss_hol: null,
      registry_bind: rb({
        opcodes: [{ name: "SERVICE_REQUEST", require: [fact(["transport"], "reliable_stream")] }],
        payload_mappings: [serviceClient, serviceServer],
        transport: [
          { path: ["operation_frame_transport_rule", "service"], equals: REG_OP_SERVICE },
          wssMessage,
          sharedSemantic,
        ],
      }),
    }),
    baseRule({
      id: "service_response_reliable_stream",
      plane: "both",
      semantic: "service_response",
      opcode: "SERVICE_RESPONSE",
      reliability: "reliable",
      wt_transport: "reliable_stream",
      wss_message_rule: "one_complete_frame_per_message",
      negotiation: null,
      max_datagram_size: null,
      frame_size: null,
      fallback_reason: null,
      wss_admission: null,
      wss_prewrite_drop: null,
      wss_after_write: "reliable",
      wss_hol: null,
      registry_bind: rb({
        opcodes: [{ name: "SERVICE_RESPONSE", require: [fact(["transport"], "reliable_stream")] }],
        payload_mappings: [serviceClient, serviceServer],
        transport: [
          { path: ["operation_frame_transport_rule", "service"], equals: REG_OP_SERVICE },
          wssMessage,
          sharedSemantic,
        ],
      }),
    }),
    baseRule({
      id: "action_goal_reliable_stream",
      plane: "both",
      semantic: "action_goal",
      opcode: "ACTION_GOAL",
      reliability: "reliable",
      wt_transport: "reliable_stream",
      wss_message_rule: "one_complete_frame_per_message",
      negotiation: null,
      max_datagram_size: null,
      frame_size: null,
      fallback_reason: null,
      wss_admission: null,
      wss_prewrite_drop: null,
      wss_after_write: "reliable",
      wss_hol: null,
      registry_bind: rb({
        opcodes: [{ name: "ACTION_GOAL", require: [fact(["transport"], "reliable_stream")] }],
        payload_mappings: [actionClientGoal("ACTION_GOAL"), actionServerGoal("ACTION_GOAL")],
        transport: [
          {
            path: ["operation_frame_transport_rule", "action_goal_cancel_result"],
            equals: REG_OP_ACTION_GCR,
          },
          wssMessage,
          sharedSemantic,
        ],
      }),
    }),
    baseRule({
      id: "action_cancel_reliable_stream",
      plane: "both",
      semantic: "action_cancel",
      opcode: "ACTION_CANCEL",
      reliability: "reliable",
      wt_transport: "reliable_stream",
      wss_message_rule: "one_complete_frame_per_message",
      negotiation: null,
      max_datagram_size: null,
      frame_size: null,
      fallback_reason: null,
      wss_admission: null,
      wss_prewrite_drop: null,
      wss_after_write: "reliable",
      wss_hol: null,
      registry_bind: rb({
        opcodes: [{ name: "ACTION_CANCEL", require: [fact(["transport"], "reliable_stream")] }],
        payload_mappings: [actionClientGoal("ACTION_CANCEL"), actionServerGoal("ACTION_CANCEL")],
        transport: [
          {
            path: ["operation_frame_transport_rule", "action_goal_cancel_result"],
            equals: REG_OP_ACTION_GCR,
          },
          wssMessage,
          sharedSemantic,
        ],
      }),
    }),
    baseRule({
      id: "action_result_reliable_stream",
      plane: "both",
      semantic: "action_result",
      opcode: "ACTION_RESULT",
      reliability: "reliable",
      wt_transport: "reliable_stream",
      wss_message_rule: "one_complete_frame_per_message",
      negotiation: null,
      max_datagram_size: null,
      frame_size: null,
      fallback_reason: null,
      wss_admission: null,
      wss_prewrite_drop: null,
      wss_after_write: "reliable",
      wss_hol: null,
      registry_bind: rb({
        opcodes: [{ name: "ACTION_RESULT", require: [fact(["transport"], "reliable_stream")] }],
        payload_mappings: [actionClientGoal("ACTION_RESULT"), actionServerGoal("ACTION_RESULT")],
        transport: [
          {
            path: ["operation_frame_transport_rule", "action_goal_cancel_result"],
            equals: REG_OP_ACTION_GCR,
          },
          wssMessage,
          sharedSemantic,
        ],
      }),
    }),
    baseRule({
      id: "action_feedback_reliable_stream",
      plane: "both",
      semantic: "action_feedback",
      opcode: "ACTION_FEEDBACK",
      reliability: "reliable",
      wt_transport: "reliable_stream",
      wss_message_rule: "one_complete_frame_per_message",
      negotiation: null,
      max_datagram_size: null,
      frame_size: null,
      fallback_reason: null,
      wss_admission: null,
      wss_prewrite_drop: null,
      wss_after_write: "reliable",
      wss_hol: null,
      registry_bind: rb({
        opcodes: [feedbackOpcodeSource],
        payload_mappings: [actionClientFeedbackRel, actionServerFeedbackRel],
        transport: [
          {
            path: ["operation_frame_transport_rule", "action_feedback_status"],
            equals: REG_OP_ACTION_FS,
          },
          wssMessage,
          sharedSemantic,
        ],
      }),
    }),
    baseRule({
      id: "action_feedback_be_datagram_negotiated_sizefit",
      plane: "webtransport",
      semantic: "action_feedback",
      opcode: "ACTION_FEEDBACK",
      reliability: "best_effort",
      wt_transport: "datagram",
      wss_message_rule: null,
      negotiation: true,
      max_datagram_size: 1200,
      frame_size: 400,
      fallback_reason: null,
      wss_admission: null,
      wss_prewrite_drop: null,
      wss_after_write: null,
      wss_hol: null,
      registry_bind: rb({
        opcodes: [feedbackOpcodeSource],
        payload_mappings: [actionClientFeedbackBe, actionServerFeedbackBe],
        transport: [
          { path: ["webtransport", "datagram_rule"], equals: REG_WT_DATAGRAM_RULE },
          {
            path: ["operation_frame_transport_rule", "action_feedback_status"],
            equals: REG_OP_ACTION_FS,
          },
          sharedSemantic,
        ],
      }),
    }),
    baseRule({
      id: "action_feedback_be_sample_scoped_unavailable",
      plane: "webtransport",
      semantic: "action_feedback",
      opcode: "ACTION_FEEDBACK",
      reliability: "best_effort",
      wt_transport: "sample_scoped_stream",
      wss_message_rule: null,
      negotiation: false,
      max_datagram_size: null,
      frame_size: 400,
      fallback_reason: "datagram_unavailable",
      wss_admission: null,
      wss_prewrite_drop: null,
      wss_after_write: null,
      wss_hol: null,
      registry_bind: rb({
        opcodes: [feedbackOpcodeSource],
        payload_mappings: [actionClientFeedbackBe, actionServerFeedbackBe],
        transport: [
          {
            path: ["operation_frame_transport_rule", "action_feedback_status"],
            equals: REG_OP_ACTION_FS,
          },
          sharedSemantic,
        ],
      }),
    }),
    baseRule({
      id: "action_feedback_be_sample_scoped_oversize",
      plane: "webtransport",
      semantic: "action_feedback",
      opcode: "ACTION_FEEDBACK",
      reliability: "best_effort",
      wt_transport: "sample_scoped_stream",
      wss_message_rule: null,
      negotiation: true,
      max_datagram_size: 1200,
      frame_size: 2400,
      fallback_reason: "frame_exceeds_max_datagram_size",
      wss_admission: null,
      wss_prewrite_drop: null,
      wss_after_write: null,
      wss_hol: null,
      registry_bind: rb({
        opcodes: [feedbackOpcodeSource],
        payload_mappings: [actionClientFeedbackBe, actionServerFeedbackBe],
        transport: [
          {
            path: ["operation_frame_transport_rule", "action_feedback_status"],
            equals: REG_OP_ACTION_FS,
          },
          sharedSemantic,
        ],
      }),
    }),
    baseRule({
      id: "action_status_reliable_stream",
      plane: "both",
      semantic: "action_status",
      opcode: "ACTION_STATUS",
      reliability: "reliable",
      wt_transport: "reliable_stream",
      wss_message_rule: "one_complete_frame_per_message",
      negotiation: null,
      max_datagram_size: null,
      frame_size: null,
      fallback_reason: null,
      wss_admission: null,
      wss_prewrite_drop: null,
      wss_after_write: "reliable",
      wss_hol: null,
      registry_bind: rb({
        opcodes: [statusOpcodeSource],
        payload_mappings: [actionClientStatusRel, actionServerStatusRel],
        transport: [
          {
            path: ["operation_frame_transport_rule", "action_feedback_status"],
            equals: REG_OP_ACTION_FS,
          },
          wssMessage,
          sharedSemantic,
        ],
      }),
    }),
    baseRule({
      id: "action_status_be_datagram_negotiated_sizefit",
      plane: "webtransport",
      semantic: "action_status",
      opcode: "ACTION_STATUS",
      reliability: "best_effort",
      wt_transport: "datagram",
      wss_message_rule: null,
      negotiation: true,
      max_datagram_size: 1200,
      frame_size: 300,
      fallback_reason: null,
      wss_admission: null,
      wss_prewrite_drop: null,
      wss_after_write: null,
      wss_hol: null,
      registry_bind: rb({
        opcodes: [statusOpcodeSource],
        payload_mappings: [actionClientStatusBe, actionServerStatusBe],
        transport: [
          { path: ["webtransport", "datagram_rule"], equals: REG_WT_DATAGRAM_RULE },
          {
            path: ["operation_frame_transport_rule", "action_feedback_status"],
            equals: REG_OP_ACTION_FS,
          },
          sharedSemantic,
        ],
      }),
    }),
    baseRule({
      id: "action_status_be_sample_scoped_unavailable",
      plane: "webtransport",
      semantic: "action_status",
      opcode: "ACTION_STATUS",
      reliability: "best_effort",
      wt_transport: "sample_scoped_stream",
      wss_message_rule: null,
      negotiation: false,
      max_datagram_size: null,
      frame_size: 300,
      fallback_reason: "datagram_unavailable",
      wss_admission: null,
      wss_prewrite_drop: null,
      wss_after_write: null,
      wss_hol: null,
      registry_bind: rb({
        opcodes: [statusOpcodeSource],
        payload_mappings: [actionClientStatusBe, actionServerStatusBe],
        transport: [
          {
            path: ["operation_frame_transport_rule", "action_feedback_status"],
            equals: REG_OP_ACTION_FS,
          },
          sharedSemantic,
        ],
      }),
    }),
    baseRule({
      id: "action_status_be_sample_scoped_oversize",
      plane: "webtransport",
      semantic: "action_status",
      opcode: "ACTION_STATUS",
      reliability: "best_effort",
      wt_transport: "sample_scoped_stream",
      wss_message_rule: null,
      negotiation: true,
      max_datagram_size: 1200,
      frame_size: 4096,
      fallback_reason: "frame_exceeds_max_datagram_size",
      wss_admission: null,
      wss_prewrite_drop: null,
      wss_after_write: null,
      wss_hol: null,
      registry_bind: rb({
        opcodes: [statusOpcodeSource],
        payload_mappings: [actionClientStatusBe, actionServerStatusBe],
        transport: [
          {
            path: ["operation_frame_transport_rule", "action_feedback_status"],
            equals: REG_OP_ACTION_FS,
          },
          sharedSemantic,
        ],
      }),
    }),
    baseRule({
      id: "binary_wss_one_complete_frame_per_message",
      plane: "binary_wss",
      semantic: "selected_version_frame",
      opcode: null,
      reliability: null,
      wt_transport: null,
      wss_message_rule: "one_complete_frame_per_message",
      negotiation: null,
      max_datagram_size: null,
      frame_size: null,
      fallback_reason: null,
      wss_admission: null,
      wss_prewrite_drop: null,
      wss_after_write: "reliable",
      wss_hol: null,
      registry_bind: rb({
        transport: [wssMessage, sharedSemantic],
      }),
    }),
    baseRule({
      id: "wss_be_latest_wins_prewrite_gap_postwrite_reliable_hol",
      plane: "binary_wss",
      semantic: "topic_or_action_feedback_status_best_effort",
      opcode: null,
      reliability: "best_effort",
      wt_transport: null,
      wss_message_rule: "one_complete_frame_per_message",
      negotiation: null,
      max_datagram_size: null,
      frame_size: null,
      fallback_reason: null,
      wss_admission: "bounded_latest_wins_prewrite",
      wss_prewrite_drop: "sequence_gap",
      wss_after_write: "reliable",
      wss_hol: "transport_evidence",
      registry_bind: rb({
        opcodes: [rosSampleFlags, feedbackOpcodeSource, statusOpcodeSource],
        payload_mappings: [
          topicPublishBeSmall,
          topicPublishBeLarge,
          topicSubscribeBe,
          actionClientFeedbackBe,
          actionServerFeedbackBe,
          actionClientStatusBe,
          actionServerStatusBe,
        ],
        transport: [
          wssMessage,
          wssAppliesTo,
          {
            path: ["binary_wss", "best_effort_topic_and_action_feedback_status", "admission"],
            equals: REG_WSS_ADMISSION,
          },
          {
            path: [
              "binary_wss",
              "best_effort_topic_and_action_feedback_status",
              "dropped_before_write",
            ],
            equals: REG_WSS_DROPPED_BEFORE_WRITE,
          },
          {
            path: ["binary_wss", "best_effort_topic_and_action_feedback_status", "after_write"],
            equals: REG_WSS_AFTER_WRITE,
          },
          {
            path: [
              "binary_wss",
              "best_effort_topic_and_action_feedback_status",
              "head_of_line",
              "status",
            ],
            equals: REG_WSS_HOL_STATUS,
          },
          {
            path: [
              "binary_wss",
              "best_effort_topic_and_action_feedback_status",
              "no_datagram_plane",
            ],
            equals: true,
          },
          {
            path: [
              "binary_wss",
              "best_effort_topic_and_action_feedback_status",
              "one_complete_frame_per_message",
            ],
            equals: true,
          },
          sharedSemantic,
        ],
      }),
    }),
  ];
  return rules.sort((a, b) => asciiCompare(a.id, b.id));
}

// ---------------------------------------------------------------------------
// Build from source manifests
// ---------------------------------------------------------------------------

type ValidFixtureEntry = {
  id: string;
  path: string | null;
  byte_length: number;
  sha256: string;
};
type SeqEventEntry = {
  id: string;
  path: string;
  byte_length: number;
  sha256: string;
};

function isLowerSha256(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
}

/** Canonical valid/boundary artifact path confinement. */
export function isCanonicalValidArtifactPath(id: string, path: string | null): boolean {
  if (id === MANIFEST_ONLY_RECIPE_ID) return path === null;
  if (path === null) return false;
  return path === `valid/${id}.bin`;
}

/** Canonical sequence event path confinement: exactly events/<id>.bin. */
export function isCanonicalSequenceEventPath(id: string, path: string): boolean {
  return path === `events/${id}.bin`;
}

/**
 * Parse valid/boundary source manifest with closed typed fields and corpus confinement.
 * Requires unique safe ids and canonical paths (valid/<id>.bin or recipe null) prior to artifact reads.
 */
export function parseValidManifest(raw: unknown): ValidFixtureEntry[] {
  if (!isPlainObject(raw) || !Array.isArray(raw.fixtures)) {
    throw new Error("valid manifest: fixtures array required");
  }
  const out: ValidFixtureEntry[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < raw.fixtures.length; i++) {
    const f = raw.fixtures[i];
    const p = `valid manifest.fixtures/${i}`;
    if (!isPlainObject(f)) throw new Error(`${p}: must be object`);
    if (typeof f.id !== "string" || !VALID_SOURCE_ID_PATTERN.test(f.id)) {
      throw new Error(`${p}: bad id`);
    }
    if (seen.has(f.id)) throw new Error(`${p}: duplicate id ${f.id}`);
    seen.add(f.id);
    if (!isSafePosInt(f.byte_length, RECIPE_MAX_BYTE_LENGTH)) {
      throw new Error(`${p}: bad byte_length`);
    }
    if (!isLowerSha256(f.sha256)) throw new Error(`${p}: bad sha256`);
    const pathVal = f.path === null ? null : typeof f.path === "string" ? f.path : undefined;
    if (pathVal === undefined) throw new Error(`${p}: path must be string or null`);
    if (!isCanonicalValidArtifactPath(f.id, pathVal)) {
      throw new Error(
        `${p}: path must be valid/${f.id}.bin` +
          (f.id === MANIFEST_ONLY_RECIPE_ID ? " or null for segment recipe" : " (null path rejected)"),
      );
    }
    if (pathVal !== null && f.byte_length > VALID_BINARY_MAX_BYTES) {
      throw new Error(`${p}: binary byte_length exceeds ${VALID_BINARY_MAX_BYTES}`);
    }
    out.push({
      id: f.id,
      path: pathVal,
      byte_length: f.byte_length as number,
      sha256: f.sha256 as string,
    });
  }
  out.sort((a, b) => asciiCompare(a.id, b.id));
  // Output is sorted unique by id for deterministic shared_artifacts construction.
  return out;
}

/**
 * Parse sequences source manifest events with closed typed fields and path confinement.
 * Requires unique safe ids and exact events/<id>.bin paths prior to artifact reads.
 */
export function parseSeqManifest(raw: unknown): SeqEventEntry[] {
  if (!isPlainObject(raw) || !Array.isArray(raw.events)) {
    throw new Error("sequences manifest: events array required");
  }
  const out: SeqEventEntry[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < raw.events.length; i++) {
    const e = raw.events[i];
    const p = `sequences manifest.events/${i}`;
    if (!isPlainObject(e)) throw new Error(`${p}: must be object`);
    if (typeof e.id !== "string" || !SEQ_EVENT_ID_PATTERN.test(e.id)) {
      throw new Error(`${p}: bad id`);
    }
    if (seen.has(e.id)) throw new Error(`${p}: duplicate id ${e.id}`);
    seen.add(e.id);
    if (typeof e.path !== "string") throw new Error(`${p}: path must be string`);
    if (!isCanonicalSequenceEventPath(e.id, e.path)) {
      throw new Error(`${p}: path must be exactly events/${e.id}.bin`);
    }
    if (!isSafePosInt(e.byte_length, SEQ_EVENT_MAX_BYTES)) {
      throw new Error(`${p}: bad byte_length`);
    }
    if (!isLowerSha256(e.sha256)) throw new Error(`${p}: bad sha256`);
    out.push({
      id: e.id,
      path: e.path,
      byte_length: e.byte_length as number,
      sha256: e.sha256 as string,
    });
  }
  out.sort((a, b) => asciiCompare(a.id, b.id));
  return out;
}

function makeArtifact(corpus: SourceCorpusId, sourceId: string, byte_length: number, sha256: string): SharedArtifact {
  const id = artifactId(corpus, sourceId);
  const semantic_identity = semanticIdentity(corpus, sourceId);
  const ref: TransportRef = { semantic_identity, byte_length, sha256 };
  return {
    id,
    source_corpus: corpus,
    source_id: sourceId,
    byte_length,
    sha256,
    webtransport: { ...ref },
    binary_wss: { ...ref },
  };
}

export async function buildParityDocument(root: string): Promise<ParityDocument> {
  const source_manifests: SourceManifestEntry[] = [];
  const shared_artifacts: SharedArtifact[] = [];

  // valid_boundary
  {
    const rel = VALID_MANIFEST_REL;
    const abs = resolveUnderRoot(root, rel);
    const read = await readBoundedFile(abs, SOURCE_MANIFEST_MAX_BYTES);
    if (!read.ok) throw new Error(`source valid manifest: ${read.error}`);
    source_manifests.push({
      id: "valid_boundary",
      path: rel,
      byte_length: read.bytes.length,
      sha256: sha256Hex(read.bytes),
    });
    const fixtures = parseValidManifest(JSON.parse(read.text));
    if (fixtures.length !== VALID_COUNT) {
      throw new Error(`valid fixtures count ${fixtures.length} != ${VALID_COUNT}`);
    }
    for (const f of fixtures) {
      shared_artifacts.push(makeArtifact("valid_boundary", f.id, f.byte_length, f.sha256));
    }
  }

  // sequences events only
  {
    const rel = SEQUENCES_MANIFEST_REL;
    const abs = resolveUnderRoot(root, rel);
    const read = await readBoundedFile(abs, SOURCE_MANIFEST_MAX_BYTES);
    if (!read.ok) throw new Error(`source sequences manifest: ${read.error}`);
    source_manifests.push({
      id: "sequences",
      path: rel,
      byte_length: read.bytes.length,
      sha256: sha256Hex(read.bytes),
    });
    const events = parseSeqManifest(JSON.parse(read.text));
    if (events.length !== SEQUENCE_EVENT_COUNT) {
      throw new Error(`sequence events count ${events.length} != ${SEQUENCE_EVENT_COUNT}`);
    }
    for (const e of events) {
      shared_artifacts.push(makeArtifact("sequences", e.id, e.byte_length, e.sha256));
    }
  }

  shared_artifacts.sort((a, b) => asciiCompare(a.id, b.id));
  source_manifests.sort((a, b) => asciiCompare(a.id, b.id));

  const transport_rules = buildTransportRules();
  if (transport_rules.length !== REQUIRED_TRANSPORT_RULE_IDS.length) {
    throw new Error(
      `rule count ${transport_rules.length} != required ${REQUIRED_TRANSPORT_RULE_IDS.length}`,
    );
  }
  for (let i = 0; i < REQUIRED_TRANSPORT_RULE_IDS.length; i++) {
    if (transport_rules[i]!.id !== REQUIRED_TRANSPORT_RULE_IDS[i]) {
      throw new Error(`rule order/id mismatch at ${i}: ${transport_rules[i]!.id}`);
    }
  }

  return {
    schema_version: SCHEMA_VERSION,
    protocol: PROTOCOL_ID,
    generated_by: GENERATED_BY,
    source_manifests,
    shared_artifacts,
    transport_rules,
  };
}

// ---------------------------------------------------------------------------
// Schema diagnosis
// ---------------------------------------------------------------------------

export function diagnoseParityValue(value: unknown): string[] {
  const diags: string[] = [];
  if (value === null) return ["parity: root is null"];
  if (Array.isArray(value)) return ["parity: root must be object not array"];
  if (!isPlainObject(value)) return ["parity: root must be object"];
  exactKeys(value, PARITY_ROOT_KEYS, "parity", diags);
  requireKeys(value, PARITY_ROOT_KEYS, "parity", diags);
  if (value.schema_version !== SCHEMA_VERSION) diags.push("parity: bad schema_version");
  if (value.protocol !== PROTOCOL_ID) diags.push("parity: bad protocol");
  if (value.generated_by !== GENERATED_BY) diags.push("parity: bad generated_by");

  // source_manifests
  if (!Array.isArray(value.source_manifests) || value.source_manifests.length !== 2) {
    diags.push("parity: source_manifests must be length-2 array");
  } else {
    let prev = "";
    const ids = new Set<string>();
    for (let i = 0; i < value.source_manifests.length; i++) {
      const s = value.source_manifests[i];
      const p = `parity.source_manifests/${i}`;
      if (!isPlainObject(s)) {
        diags.push(`${p}: must be object`);
        continue;
      }
      exactKeys(s, SOURCE_MANIFEST_KEYS, p, diags);
      requireKeys(s, SOURCE_MANIFEST_KEYS, p, diags);
      if (s.id !== "valid_boundary" && s.id !== "sequences") diags.push(`${p}: bad id`);
      else {
        if (ids.has(s.id as string)) diags.push(`${p}: duplicate id`);
        ids.add(s.id as string);
        if (prev && asciiCompare(prev, s.id as string) >= 0) diags.push(`${p}: not sorted`);
        prev = s.id as string;
      }
      if (typeof s.path !== "string" || !s.path || s.path.includes("..") || s.path.startsWith("/")) {
        diags.push(`${p}: bad path`);
      } else if (s.id === "valid_boundary" && s.path !== VALID_MANIFEST_REL) {
        diags.push(`${p}: path must be ${VALID_MANIFEST_REL}`);
      } else if (s.id === "sequences" && s.path !== SEQUENCES_MANIFEST_REL) {
        diags.push(`${p}: path must be ${SEQUENCES_MANIFEST_REL}`);
      }
      if (!isSafePosInt(s.byte_length, SOURCE_MANIFEST_MAX_BYTES)) diags.push(`${p}: bad byte_length`);
      if (!isSha256(s.sha256)) diags.push(`${p}: bad sha256`);
    }
  }

  // shared_artifacts
  if (
    !Array.isArray(value.shared_artifacts) ||
    value.shared_artifacts.length === 0 ||
    value.shared_artifacts.length > ARTIFACT_COUNT_MAX
  ) {
    diags.push("parity: shared_artifacts invalid count");
  } else {
    let prev = "";
    const ids = new Set<string>();
    let validN = 0;
    let seqN = 0;
    for (let i = 0; i < value.shared_artifacts.length; i++) {
      const a = value.shared_artifacts[i];
      const p = `parity.shared_artifacts/${i}`;
      if (!isPlainObject(a)) {
        diags.push(`${p}: must be object`);
        continue;
      }
      exactKeys(a, ARTIFACT_KEYS, p, diags);
      requireKeys(a, ARTIFACT_KEYS, p, diags);
      if (typeof a.id !== "string" || !ID_PATTERN.test(a.id)) diags.push(`${p}: bad id`);
      else {
        if (ids.has(a.id)) diags.push(`${p}: duplicate id`);
        ids.add(a.id);
        if (prev && asciiCompare(prev, a.id) >= 0) diags.push(`${p}: not sorted`);
        prev = a.id;
      }
      if (a.source_corpus !== "valid_boundary" && a.source_corpus !== "sequences") {
        diags.push(`${p}: bad source_corpus`);
      } else if (a.source_corpus === "valid_boundary") validN++;
      else seqN++;
      if (typeof a.source_id !== "string" || !a.source_id || a.source_id.length > STRING_FIELD_MAX) {
        diags.push(`${p}: bad source_id`);
      }
      if (
        typeof a.source_corpus === "string" &&
        typeof a.source_id === "string" &&
        a.id !== artifactId(a.source_corpus as SourceCorpusId, a.source_id)
      ) {
        diags.push(`${p}: id must equal source_corpus:source_id`);
      }
      if (!isSafePosInt(a.byte_length, 100 * 1024 * 1024)) diags.push(`${p}: bad byte_length`);
      if (!isSha256(a.sha256)) diags.push(`${p}: bad sha256`);
      for (const side of ["webtransport", "binary_wss"] as const) {
        const ref = a[side];
        const rp = `${p}.${side}`;
        if (!isPlainObject(ref)) {
          diags.push(`${rp}: must be object`);
          continue;
        }
        exactKeys(ref, TRANSPORT_REF_KEYS, rp, diags);
        requireKeys(ref, TRANSPORT_REF_KEYS, rp, diags);
        if (typeof ref.semantic_identity !== "string" || !ref.semantic_identity) {
          diags.push(`${rp}: bad semantic_identity`);
        }
        if (!isSafePosInt(ref.byte_length, 100 * 1024 * 1024)) diags.push(`${rp}: bad byte_length`);
        if (!isSha256(ref.sha256)) diags.push(`${rp}: bad sha256`);
        // Identity equality across transports and parent.
        if (isSafePosInt(a.byte_length) && ref.byte_length !== a.byte_length) {
          diags.push(`${rp}: byte_length must equal parent`);
        }
        if (isSha256(a.sha256) && ref.sha256 !== a.sha256) {
          diags.push(`${rp}: sha256 must equal parent`);
        }
        if (
          typeof a.source_corpus === "string" &&
          typeof a.source_id === "string" &&
          ref.semantic_identity !== semanticIdentity(a.source_corpus as SourceCorpusId, a.source_id)
        ) {
          diags.push(`${rp}: semantic_identity mismatch`);
        }
      }
      // WT/WSS mutual equality
      if (isPlainObject(a.webtransport) && isPlainObject(a.binary_wss)) {
        if (a.webtransport.semantic_identity !== a.binary_wss.semantic_identity) {
          diags.push(`${p}: WT/WSS semantic_identity mismatch`);
        }
        if (a.webtransport.byte_length !== a.binary_wss.byte_length) {
          diags.push(`${p}: WT/WSS byte_length mismatch`);
        }
        if (a.webtransport.sha256 !== a.binary_wss.sha256) {
          diags.push(`${p}: WT/WSS sha256 mismatch`);
        }
      }
    }
    if (validN !== VALID_COUNT) diags.push(`parity: valid_boundary artifact count ${validN} != ${VALID_COUNT}`);
    if (seqN !== SEQUENCE_EVENT_COUNT) {
      diags.push(`parity: sequences artifact count ${seqN} != ${SEQUENCE_EVENT_COUNT}`);
    }
  }

  // transport_rules
  if (
    !Array.isArray(value.transport_rules) ||
    value.transport_rules.length === 0 ||
    value.transport_rules.length > RULE_COUNT_MAX
  ) {
    diags.push("parity: transport_rules invalid count");
  } else {
    let prev = "";
    const ids = new Set<string>();
    for (let i = 0; i < value.transport_rules.length; i++) {
      const r = value.transport_rules[i];
      const p = `parity.transport_rules/${i}`;
      if (!isPlainObject(r)) {
        diags.push(`${p}: must be object`);
        continue;
      }
      exactKeys(r, RULE_KEYS, p, diags);
      requireKeys(r, RULE_KEYS, p, diags);
      if (typeof r.id !== "string" || !ID_PATTERN.test(r.id)) diags.push(`${p}: bad id`);
      else {
        if (ids.has(r.id)) diags.push(`${p}: duplicate id`);
        ids.add(r.id);
        if (prev && asciiCompare(prev, r.id) >= 0) diags.push(`${p}: not sorted`);
        prev = r.id;
      }
      if (r.plane !== "webtransport" && r.plane !== "binary_wss" && r.plane !== "both") {
        diags.push(`${p}: bad plane`);
      }
      if (typeof r.semantic !== "string" || !r.semantic || r.semantic.length > STRING_FIELD_MAX) {
        diags.push(`${p}: bad semantic`);
      }
      if (r.opcode !== null && (typeof r.opcode !== "string" || !r.opcode)) diags.push(`${p}: bad opcode`);
      if (r.reliability !== null && r.reliability !== "reliable" && r.reliability !== "best_effort") {
        diags.push(`${p}: bad reliability`);
      }
      const wtOk = [
        null,
        "reliable_stream",
        "datagram",
        "sample_scoped_stream",
        "reliable_control_stream",
      ];
      if (!wtOk.includes(r.wt_transport as never)) diags.push(`${p}: bad wt_transport`);
      if (
        r.wss_message_rule !== null &&
        r.wss_message_rule !== "one_complete_frame_per_message"
      ) {
        diags.push(`${p}: bad wss_message_rule`);
      }
      if (r.negotiation !== null && typeof r.negotiation !== "boolean") diags.push(`${p}: bad negotiation`);
      if (r.max_datagram_size !== null && !isSafePosInt(r.max_datagram_size, 16 * 1024 * 1024)) {
        diags.push(`${p}: bad max_datagram_size`);
      }
      if (r.frame_size !== null && !isSafeNonNegInt(r.frame_size, 64 * 1024 * 1024)) {
        diags.push(`${p}: bad frame_size`);
      }
      if (
        r.fallback_reason !== null &&
        r.fallback_reason !== "datagram_unavailable" &&
        r.fallback_reason !== "frame_exceeds_max_datagram_size"
      ) {
        diags.push(`${p}: bad fallback_reason`);
      }
      if (r.wss_admission !== null && r.wss_admission !== "bounded_latest_wins_prewrite") {
        diags.push(`${p}: bad wss_admission`);
      }
      if (r.wss_prewrite_drop !== null && r.wss_prewrite_drop !== "sequence_gap") {
        diags.push(`${p}: bad wss_prewrite_drop`);
      }
      if (r.wss_after_write !== null && r.wss_after_write !== "reliable") {
        diags.push(`${p}: bad wss_after_write`);
      }
      if (r.wss_hol !== null && r.wss_hol !== "transport_evidence") diags.push(`${p}: bad wss_hol`);
      if (!isPlainObject(r.registry_bind)) diags.push(`${p}: registry_bind must be object`);
      else diags.push(...diagnoseRegistryBind(r.registry_bind, `${p}.registry_bind`));
      // Datagram constraints
      if (r.wt_transport === "datagram") {
        if (r.negotiation !== true) diags.push(`${p}: datagram requires negotiation=true`);
        if (!isSafePosInt(r.max_datagram_size)) diags.push(`${p}: datagram requires max_datagram_size`);
        if (!isSafePosInt(r.frame_size)) diags.push(`${p}: datagram requires frame_size`);
        if (
          isSafePosInt(r.frame_size) &&
          isSafePosInt(r.max_datagram_size) &&
          (r.frame_size as number) > (r.max_datagram_size as number)
        ) {
          diags.push(`${p}: datagram frame_size must be <= max_datagram_size`);
        }
        if (r.fallback_reason !== null) diags.push(`${p}: datagram must not set fallback_reason`);
      }
      if (r.fallback_reason !== null && r.wt_transport !== "sample_scoped_stream") {
        diags.push(`${p}: fallback_reason requires sample_scoped_stream`);
      }
    }
    // Required rule closure
    for (const req of REQUIRED_TRANSPORT_RULE_IDS) {
      if (!ids.has(req)) diags.push(`parity: missing required transport rule ${req}`);
    }
    if (ids.size !== REQUIRED_TRANSPORT_RULE_IDS.length) {
      diags.push(
        `parity: transport_rules count ${ids.size} != required ${REQUIRED_TRANSPORT_RULE_IDS.length}`,
      );
    }
  }

  return sortAscii(diags);
}

// ---------------------------------------------------------------------------
// Registry cross-bind (exact typed facts)
// ---------------------------------------------------------------------------

export function diagnoseRegistryBind(bind: unknown, path: string): string[] {
  const diags: string[] = [];
  if (!isPlainObject(bind)) return [`${path}: must be object`];
  exactKeys(bind, REGISTRY_BIND_KEYS, path, diags);
  requireKeys(bind, REGISTRY_BIND_KEYS, path, diags);
  if (!Array.isArray(bind.opcodes)) diags.push(`${path}.opcodes: must be array`);
  else {
    for (let i = 0; i < bind.opcodes.length; i++) {
      const o = bind.opcodes[i];
      const p = `${path}.opcodes/${i}`;
      if (!isPlainObject(o)) {
        diags.push(`${p}: must be object`);
        continue;
      }
      exactKeys(o, REGISTRY_OPCODE_BIND_KEYS, p, diags);
      requireKeys(o, REGISTRY_OPCODE_BIND_KEYS, p, diags);
      if (typeof o.name !== "string" || !o.name) diags.push(`${p}: bad name`);
      diags.push(...diagnoseFactList(o.require, `${p}.require`));
    }
  }
  if (!Array.isArray(bind.payload_mappings)) diags.push(`${path}.payload_mappings: must be array`);
  else {
    for (let i = 0; i < bind.payload_mappings.length; i++) {
      const m = bind.payload_mappings[i];
      const p = `${path}.payload_mappings/${i}`;
      if (!isPlainObject(m)) {
        diags.push(`${p}: must be object`);
        continue;
      }
      exactKeys(m, REGISTRY_PAYLOAD_BIND_KEYS, p, diags);
      requireKeys(m, REGISTRY_PAYLOAD_BIND_KEYS, p, diags);
      if (typeof m.semantic !== "string" || !m.semantic) diags.push(`${p}: bad semantic`);
      diags.push(...diagnoseFactList(m.require, `${p}.require`));
    }
  }
  if (!Array.isArray(bind.transport)) diags.push(`${path}.transport: must be array`);
  else {
    for (let i = 0; i < bind.transport.length; i++) {
      const t = bind.transport[i];
      const p = `${path}.transport/${i}`;
      if (!isPlainObject(t)) {
        diags.push(`${p}: must be object`);
        continue;
      }
      exactKeys(t, REGISTRY_TRANSPORT_BIND_KEYS, p, diags);
      requireKeys(t, REGISTRY_TRANSPORT_BIND_KEYS, p, diags);
      if (!Array.isArray(t.path) || t.path.length === 0 || !t.path.every((x) => typeof x === "string")) {
        diags.push(`${p}: path must be non-empty string array`);
      }
      if (!isRegistryEquals(t.equals)) {
        diags.push(`${p}: equals must be string|boolean|number|string[]`);
      }
    }
  }
  // At least one evidence class required.
  const empty =
    Array.isArray(bind.opcodes) &&
    bind.opcodes.length === 0 &&
    Array.isArray(bind.payload_mappings) &&
    bind.payload_mappings.length === 0 &&
    Array.isArray(bind.transport) &&
    bind.transport.length === 0;
  if (empty) diags.push(`${path}: must list at least one opcodes|payload_mappings|transport fact`);
  return diags;
}

function diagnoseFactList(require: unknown, path: string): string[] {
  const diags: string[] = [];
  if (!Array.isArray(require) || require.length === 0) {
    return [`${path}: must be non-empty array`];
  }
  for (let i = 0; i < require.length; i++) {
    const f = require[i];
    const p = `${path}/${i}`;
    if (!isPlainObject(f)) {
      diags.push(`${p}: must be object`);
      continue;
    }
    exactKeys(f, REGISTRY_REQUIRE_KEYS, p, diags);
    requireKeys(f, REGISTRY_REQUIRE_KEYS, p, diags);
    if (!Array.isArray(f.path) || f.path.length === 0 || !f.path.every((x) => typeof x === "string")) {
      diags.push(`${p}: path must be non-empty string array`);
    }
    if (!isRegistryEquals(f.equals)) {
      diags.push(`${p}: equals must be string|boolean|number|string[]`);
    }
  }
  return diags;
}

function resolvePath(root: unknown, pathParts: string[]): { ok: true; value: unknown } | { ok: false } {
  let cur: unknown = root;
  for (const part of pathParts) {
    if (!isPlainObject(cur) || !Object.prototype.hasOwnProperty.call(cur, part)) {
      return { ok: false };
    }
    cur = cur[part];
  }
  return { ok: true, value: cur };
}

/**
 * Cross-bind every parity rule to exact on-disk registry facts.
 * Each required path is resolved and compared with closed typed equality (scalars and string arrays).
 */
export function crossBindRulesToRegistry(
  rules: TransportRule[],
  registryJson: unknown,
): string[] {
  const diags: string[] = [];
  if (!isPlainObject(registryJson)) return ["registry: root must be object"];

  const opcodesRoot = isPlainObject(registryJson.opcodes) ? registryJson.opcodes : null;
  const assigned = opcodesRoot && isPlainObject(opcodesRoot.assigned) ? opcodesRoot.assigned : null;
  const transport = isPlainObject(registryJson.transport) ? registryJson.transport : null;
  const payloadMaps = Array.isArray(registryJson.payload_channel_mapping)
    ? registryJson.payload_channel_mapping
    : null;

  if (!assigned) diags.push("registry: opcodes.assigned missing");
  if (!transport) diags.push("registry: transport missing");
  if (!payloadMaps) diags.push("registry: payload_channel_mapping missing");

  // Detect duplicate opcode names and payload semantics before rule checks.
  const opcodeByName = new Map<string, Record<string, unknown>>();
  if (assigned) {
    const seenNames = new Set<string>();
    for (const [key, row] of Object.entries(assigned)) {
      if (!isPlainObject(row) || typeof row.name !== "string") continue;
      if (seenNames.has(row.name)) {
        diags.push(`registry: duplicate opcode name ${row.name} (assigned key ${key})`);
        continue;
      }
      seenNames.add(row.name);
      opcodeByName.set(row.name, row);
    }
  }
  const payloadBySemantic = new Map<string, Record<string, unknown>>();
  if (payloadMaps) {
    const seenSemantics = new Set<string>();
    for (let i = 0; i < payloadMaps.length; i++) {
      const row = payloadMaps[i];
      if (!isPlainObject(row) || typeof row.semantic !== "string") continue;
      if (seenSemantics.has(row.semantic)) {
        diags.push(
          `registry: duplicate payload_channel_mapping semantic ${row.semantic} at index ${i}`,
        );
        continue;
      }
      seenSemantics.add(row.semantic);
      payloadBySemantic.set(row.semantic, row);
    }
  }

  for (const rule of rules) {
    const p = `rule ${rule.id}`;
    const shape = diagnoseRegistryBind(rule.registry_bind, `${p}.registry_bind`);
    if (shape.length) {
      diags.push(...shape);
      continue;
    }
    const bind = rule.registry_bind;

    for (const op of bind.opcodes) {
      const row = opcodeByName.get(op.name);
      if (!row) {
        diags.push(`${p}: registry missing opcode ${op.name}`);
        continue;
      }
      for (const f of op.require) {
        const got = resolvePath(row, f.path);
        if (!got.ok) {
          diags.push(`${p}: opcode ${op.name} missing path ${f.path.join(".")}`);
        } else if (!valuesEqual(got.value, f.equals)) {
          diags.push(
            `${p}: opcode ${op.name}.${f.path.join(".")} expected ${JSON.stringify(f.equals)} got ${JSON.stringify(got.value)}`,
          );
        }
      }
    }

    for (const pm of bind.payload_mappings) {
      const row = payloadBySemantic.get(pm.semantic);
      if (!row) {
        diags.push(`${p}: registry missing payload_channel_mapping semantic ${pm.semantic}`);
        continue;
      }
      for (const f of pm.require) {
        const got = resolvePath(row, f.path);
        if (!got.ok) {
          diags.push(
            `${p}: payload ${pm.semantic} missing path ${f.path.join(".")}`,
          );
        } else if (!valuesEqual(got.value, f.equals)) {
          diags.push(
            `${p}: payload ${pm.semantic}.${f.path.join(".")} expected ${JSON.stringify(f.equals)} got ${JSON.stringify(got.value)}`,
          );
        }
      }
    }

    if (transport) {
      for (const t of bind.transport) {
        const got = resolvePath(transport, t.path);
        if (!got.ok) {
          diags.push(`${p}: transport missing path ${t.path.join(".")}`);
        } else if (!valuesEqual(got.value, t.equals)) {
          diags.push(
            `${p}: transport.${t.path.join(".")} expected ${JSON.stringify(t.equals)} got ${JSON.stringify(got.value)}`,
          );
        }
      }
    } else if (bind.transport.length > 0) {
      diags.push(`${p}: transport facts present but registry.transport missing`);
    }
  }

  return sortAscii(diags);
}

// ---------------------------------------------------------------------------
// Write / check
// ---------------------------------------------------------------------------

/**
 * Require real directory chains for every source corpus parent used by parity
 * (protocol/testdata/valid and protocol/testdata/sequences/events inclusive).
 * Intermediate parents are validated with the same no-follow directory rules as leaves.
 */
export async function ensureParitySourceDirectoryChains(
  root: string,
  createMissingTestdata: boolean,
): Promise<void> {
  await ensureRealDirectoryChain(root, ["protocol", "testdata"], createMissingTestdata);
  await ensureRealDirectoryChain(root, ["protocol", "testdata", "valid"], false);
  await ensureRealDirectoryChain(root, ["protocol", "testdata", "sequences"], false);
  await ensureRealDirectoryChain(root, ["protocol", "testdata", "sequences", "events"], false);
}

export async function writeParityFixtures(root: string): Promise<ParityDocument> {
  // Aggregate write creates source corpora first; parity requires real source directory chains.
  await ensureParitySourceDirectoryChains(root, true);
  const doc = await buildParityDocument(root);
  const abs = resolveUnderRoot(root, PARITY_REL);
  await writeArtifactBytes(abs, new TextEncoder().encode(stableJson(doc)));
  return doc;
}

export async function checkParityFixtures(root: string): Promise<CheckResult> {
  const diags: string[] = [];

  try {
    await ensureParitySourceDirectoryChains(root, false);
  } catch (e) {
    return {
      diags: [
        `disk: source path chain invalid: ${e instanceof Error ? e.message : String(e)}`,
      ],
      document: null,
    };
  }
  try {
    await ensureRealDirectoryChain(root, ["protocol", "registry"], false);
  } catch (e) {
    return {
      diags: [`disk: registry path chain invalid: ${e instanceof Error ? e.message : String(e)}`],
      document: null,
    };
  }

  const abs = resolveUnderRoot(root, PARITY_REL);
  const read = await readBoundedFile(abs, PARITY_MAX_BYTES);
  if (!read.ok) return { diags: [`parity: ${read.error}`], document: null };

  let raw: unknown;
  try {
    raw = JSON.parse(read.text);
  } catch (e) {
    return {
      diags: [`parity: malformed JSON: ${e instanceof Error ? e.message : String(e)}`],
      document: null,
    };
  }

  const schemaDiags = diagnoseParityValue(raw);
  if (schemaDiags.length) return { diags: sortAscii(schemaDiags), document: null };

  if (read.text !== stableJson(raw)) {
    return {
      diags: ["parity: raw text is not canonical stableJson format"],
      document: null,
    };
  }

  const doc = raw as ParityDocument;

  // Source-manifest cross-reference: parity reads manifests and confined artifacts directly.
  for (const sm of doc.source_manifests) {
    const manAbs = resolveUnderRoot(root, sm.path);
    const manRead = await readBoundedFile(manAbs, SOURCE_MANIFEST_MAX_BYTES);
    if (!manRead.ok) {
      diags.push(`source ${sm.id}: ${manRead.error}`);
      continue;
    }
    if (manRead.bytes.length !== sm.byte_length) {
      diags.push(
        `source ${sm.id}: disk length ${manRead.bytes.length} != parity ${sm.byte_length}`,
      );
    }
    const h = sha256Hex(manRead.bytes);
    if (h !== sm.sha256) diags.push(`source ${sm.id}: disk sha256 mismatch`);

    let parsed: unknown;
    try {
      parsed = JSON.parse(manRead.text);
    } catch (e) {
      diags.push(
        `source ${sm.id}: malformed JSON: ${e instanceof Error ? e.message : String(e)}`,
      );
      continue;
    }

    if (sm.id === "valid_boundary") {
      let fixtures: ValidFixtureEntry[];
      try {
        fixtures = parseValidManifest(parsed);
      } catch (e) {
        diags.push(`source ${sm.id}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      const byId = new Map(fixtures.map((f) => [f.id, f]));
      const expected = new Set(fixtures.map((f) => f.id));
      const seen = new Set<string>();
      for (const a of doc.shared_artifacts.filter((x) => x.source_corpus === "valid_boundary")) {
        seen.add(a.source_id);
        const src = byId.get(a.source_id);
        if (!src) {
          diags.push(`artifact ${a.id}: source id missing from valid manifest`);
          continue;
        }
        if (src.byte_length !== a.byte_length) {
          diags.push(`artifact ${a.id}: byte_length ${a.byte_length} != source ${src.byte_length}`);
        }
        if (src.sha256 !== a.sha256) diags.push(`artifact ${a.id}: sha256 != source manifest`);
        // Disk verify only for confined binary paths; recipe uses source-manifest metadata only.
        if (src.path === null) {
          if (src.id !== MANIFEST_ONLY_RECIPE_ID) {
            diags.push(`artifact ${a.id}: null path only allowed for ${MANIFEST_ONLY_RECIPE_ID}`);
          }
          // Manifest-only recipe: length/hash already cross-bound to source entry above.
        } else {
          // Path already confined to valid/<id>.bin by parseValidManifest.
          const artAbs = resolveUnderRoot(root, path.posix.join("protocol/testdata", src.path));
          const art = await readArtifactBytes(artAbs, VALID_BINARY_MAX_BYTES);
          if (!art.ok) {
            diags.push(`artifact ${a.id}: disk ${art.error}`);
          } else {
            if (art.bytes.length !== a.byte_length) {
              diags.push(`artifact ${a.id}: disk length mismatch`);
            }
            if (sha256Hex(art.bytes) !== a.sha256) {
              diags.push(`artifact ${a.id}: disk sha256 mismatch`);
            }
          }
        }
      }
      for (const id of expected) {
        if (!seen.has(id)) diags.push(`source valid_boundary: missing artifact for ${id}`);
      }
      for (const id of seen) {
        if (!expected.has(id)) diags.push(`source valid_boundary: extra artifact ${id}`);
      }
    }

    if (sm.id === "sequences") {
      let events: SeqEventEntry[];
      try {
        events = parseSeqManifest(parsed);
      } catch (e) {
        diags.push(`source ${sm.id}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      const byId = new Map(events.map((e) => [e.id, e]));
      const expected = new Set(events.map((e) => e.id));
      const seen = new Set<string>();
      for (const a of doc.shared_artifacts.filter((x) => x.source_corpus === "sequences")) {
        seen.add(a.source_id);
        const src = byId.get(a.source_id);
        if (!src) {
          diags.push(`artifact ${a.id}: source id missing from sequences events`);
          continue;
        }
        if (src.byte_length !== a.byte_length) {
          diags.push(`artifact ${a.id}: byte_length ${a.byte_length} != source ${src.byte_length}`);
        }
        if (src.sha256 !== a.sha256) diags.push(`artifact ${a.id}: sha256 != source manifest`);
        // Path already confined to events/<id>.bin by parseSeqManifest (no traversal).
        const artAbs = resolveUnderRoot(
          root,
          path.posix.join("protocol/testdata/sequences", src.path),
        );
        const art = await readArtifactBytes(artAbs, SEQ_EVENT_MAX_BYTES);
        if (!art.ok) diags.push(`artifact ${a.id}: disk ${art.error}`);
        else {
          if (art.bytes.length !== a.byte_length) diags.push(`artifact ${a.id}: disk length mismatch`);
          if (sha256Hex(art.bytes) !== a.sha256) diags.push(`artifact ${a.id}: disk sha256 mismatch`);
        }
      }
      for (const id of expected) {
        if (!seen.has(id)) diags.push(`source sequences: missing artifact for ${id}`);
      }
      for (const id of seen) {
        if (!expected.has(id)) diags.push(`source sequences: extra artifact ${id}`);
      }
    }
  }

  // Registry cross-bind against on-disk registry with exact typed facts.
  {
    const regAbs = resolveUnderRoot(root, REGISTRY_REL);
    const regRead = await readBoundedFile(regAbs, REGISTRY_MAX_BYTES);
    if (!regRead.ok) {
      diags.push(`registry: ${regRead.error}`);
    } else {
      try {
        const reg = JSON.parse(regRead.text) as unknown;
        diags.push(...crossBindRulesToRegistry(doc.transport_rules, reg));
      } catch (e) {
        diags.push(`registry: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  // Optional writer-reference identity (soft)
  try {
    const rebuilt = await buildParityDocument(root);
    if (stableJson(doc) !== stableJson(rebuilt)) {
      diags.push("parity: diverges from deterministic writer reference");
    }
  } catch (e) {
    diags.push(
      `writer reference rebuild failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const sorted = sortAscii(diags);
  return { diags: sorted, document: sorted.length === 0 ? doc : null };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export function parseCliMode(argv: string[]): "write" | "check" | null {
  if (argv.length !== 1) return null;
  if (argv[0] === "--write") return "write";
  if (argv[0] === "--check") return "check";
  return null;
}

export async function main(argv: string[], root = process.cwd()): Promise<number> {
  const mode = parseCliMode(argv);
  if (!mode) {
    console.error("usage: bun run scripts/protocol-parity-fixtures.ts --write|--check");
    return 2;
  }
  if (mode === "write") {
    try {
      const doc = await writeParityFixtures(root);
      console.log(
        `status=ok mode=write shared_artifacts=${doc.shared_artifacts.length} transport_rules=${doc.transport_rules.length} schema_version=${doc.schema_version}`,
      );
      return 0;
    } catch (e) {
      console.error(`status=fail write: ${e instanceof Error ? e.message : String(e)}`);
      return 1;
    }
  }
  const { diags, document } = await checkParityFixtures(root);
  if (diags.length || !document) {
    for (const d of diags) console.error(d);
    console.error(`status=fail diagnostics=${diags.length}`);
    return 1;
  }
  console.log(
    `status=ok mode=check shared_artifacts=${document.shared_artifacts.length} transport_rules=${document.transport_rules.length} schema_version=${document.schema_version}`,
  );
  return 0;
}

if (import.meta.main) {
  main(process.argv.slice(2)).then((c) => process.exit(c));
}
