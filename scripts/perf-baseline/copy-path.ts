/**
 * Structural copy accounting for an inbound sample CDR body.
 *
 * This is not a live e2e measurement. It names the hops each system
 * takes after the payload exists as serialized bytes. Network RX/TX
 * sits outside the budget. Optional application copies (public Node,
 * Worker `postMessage`, Studio GPU upload) are listed separately.
 *
 * Machine-checkable copy counts for [docs/performance.md](../../docs/performance.md).
 */

export type CopySystemId =
  | "rclweb"
  | "foxglove-bridge"
  | "rosbridge-json"
  | "rosbridge-cbor-raw";

export type CopyKind = "inherent" | "extra" | "outside" | "optional";

export type CopyStage = {
  stage: string;
  copies: number;
  kind: CopyKind;
  note: string;
};

export type CopyPath = {
  system: CopySystemId;
  label: string;
  stages: CopyStage[];
  /** Sum of inherent + extra (not network, not optional app copies). */
  controllable: number;
};

function path(
  system: CopySystemId,
  label: string,
  stages: CopyStage[],
): CopyPath {
  const controllable = stages
    .filter((s) => s.kind === "inherent" || s.kind === "extra")
    .reduce((n, s) => n + s.copies, 0);
  return { system, label, stages, controllable };
}

export const COPY_PATHS: Record<CopySystemId, CopyPath> = {
  rclweb: path("rclweb", "rclweb (R2WP)", [
    {
      stage: "rmw serialized take",
      copies: 1,
      kind: "inherent",
      note: "rcl_take_serialized_message into a header-prefixed buffer",
    },
    {
      stage: "gateway framing",
      copies: 0,
      kind: "extra",
      note: "fill the reserved R2WP header in place",
    },
    {
      stage: "gateway fan-out",
      copies: 0,
      kind: "extra",
      note: "Bytes::clone of the framed payload",
    },
    {
      stage: "network RX",
      copies: 0,
      kind: "outside",
      note: "kernel / browser socket buffers; not in the copy budget",
    },
    {
      stage: "Worker → wasm",
      copies: 0,
      kind: "inherent",
      note: "ROS_SAMPLE stays in the JS buffer; wasm is not on that data plane (ADR 0017)",
    },
    {
      stage: "wasm-thread application view",
      copies: 0,
      kind: "extra",
      note: "TypedArray view of the host-retained WebSocket buffer (rcl-web/internal)",
    },
    {
      stage: "public Node / Worker → main",
      copies: 1,
      kind: "optional",
      note: "PointCloud2 data (and service/action CDR) copied so the app never holds a lease",
    },
  ]),
  "foxglove-bridge": path("foxglove-bridge", "Foxglove Bridge (MessageData)", [
    {
      stage: "rmw serialized take",
      copies: 1,
      kind: "inherent",
      note: "serialized subscription; CDR stays on the wire",
    },
    {
      stage: "gateway framing",
      copies: 1,
      kind: "extra",
      note: "MessageData is one WS blob (1+4+8 header + CDR); typical coalesce copies the body",
    },
    {
      stage: "network RX",
      copies: 0,
      kind: "outside",
      note: "kernel / browser socket buffers",
    },
    {
      stage: "JS client view",
      copies: 0,
      kind: "extra",
      note: "no wasm hop; payload can be a subarray of the WebSocket ArrayBuffer",
    },
  ]),
  "rosbridge-json": path("rosbridge-json", "rosbridge JSON + base64", [
    {
      stage: "take / deserialize",
      copies: 1,
      kind: "inherent",
      note: "message_conversion builds a language object from the ROS message",
    },
    {
      stage: "base64 + JSON",
      copies: 1,
      kind: "extra",
      note: "opaque blobs travel as base64 inside a JSON publish op (≈4/3 expansion)",
    },
    {
      stage: "network RX",
      copies: 0,
      kind: "outside",
      note: "WebSocket text frame",
    },
    {
      stage: "JSON parse + base64 decode",
      copies: 1,
      kind: "extra",
      note: "client reconstitutes bytes from the JSON envelope",
    },
  ]),
  "rosbridge-cbor-raw": path("rosbridge-cbor-raw", "rosbridge CBOR-RAW", [
    {
      stage: "rmw serialized take",
      copies: 1,
      kind: "inherent",
      note: "CBOR-RAW keeps a CDR body instead of JSON fields",
    },
    {
      stage: "CBOR bstr wrap",
      copies: 1,
      kind: "extra",
      note: "thin envelope (0x5a + u32 + body) still typically materializes a new buffer",
    },
    {
      stage: "network RX",
      copies: 0,
      kind: "outside",
      note: "binary WebSocket",
    },
    {
      stage: "client unwrap",
      copies: 0,
      kind: "extra",
      note: "bstr payload can be a subarray; no base64",
    },
  ]),
};

export const COPY_SYSTEMS = Object.keys(COPY_PATHS) as CopySystemId[];

/** Minimum JSON+base64 expansion of a binary field (RFC 4648). */
export const ROSBRIDGE_JSON_BASE64_EXPANSION = 4 / 3;

export function formatCopyPathTable(): string {
  const rows = COPY_SYSTEMS.map((id) => {
    const p = COPY_PATHS[id];
    return `${p.label.padEnd(36)} ${String(p.controllable).padStart(3)}`;
  });
  return [
    "Controllable payload copies (structural; network RX excluded)",
    `${"system".padEnd(36)} n`,
    ...rows,
  ].join("\n");
}
