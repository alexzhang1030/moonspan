#!/usr/bin/env bun
/**
 * Authoritative ROS CDR corpus generator and checker (M0-04).
 *
 * --write  builds the pinned Humble/Jazzy environments and replaces committed fixtures
 * --check  rebuilds manifest metadata from committed row records and verifies every artifact
 */
import { createHash } from "node:crypto";
import {
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export const CORPUS_REL = "conformance/cdr";
export const FIXTURES_REL = `${CORPUS_REL}/fixtures`;
export const MANIFEST_REL = `${CORPUS_REL}/manifest.json`;
export const CORPUS_ID = "rclweb-ros-cdr-v1";
export const SCHEMA_VERSION = 1;
export const SCHEMA_GENERATION = 1;
export const BUNDLE_FORMAT = "rclweb-schema-bundle-v1";
export const PLATFORM = "linux/arm64";

export type Mode = "write" | "check" | "reproduce";

export type SupportRow = {
  id: "H-FT" | "H-CY" | "H-ZN" | "J-FT" | "J-CY" | "J-ZN";
  distro: "humble" | "jazzy";
  rmw: "rmw_fastrtps_cpp" | "rmw_cyclonedds_cpp" | "rmw_zenoh_cpp";
  baseImage: string;
  cyclonePackage: string;
  cycloneVersion: string;
  zenohPackage: string;
  zenohVersion: string;
  imageTag: string;
};

export const SUPPORT_ROWS: readonly SupportRow[] = [
  {
    id: "H-FT",
    distro: "humble",
    rmw: "rmw_fastrtps_cpp",
    baseImage:
      "docker.io/library/ros:humble-ros-base-jammy@sha256:7bea3d9aa2483d3ca34c8e30d921b79273b0913bd7dc64bebf51d082b5d107e4",
    cyclonePackage: "ros-humble-rmw-cyclonedds-cpp",
    cycloneVersion: "1.3.4-1jammy.20260717.012644",
    zenohPackage: "ros-humble-rmw-zenoh-cpp",
    zenohVersion: "0.1.9-1jammy.20260725.135946",
    imageTag: "rclweb-cdr-generator:humble-arm64-v2",
  },
  {
    id: "H-CY",
    distro: "humble",
    rmw: "rmw_cyclonedds_cpp",
    baseImage:
      "docker.io/library/ros:humble-ros-base-jammy@sha256:7bea3d9aa2483d3ca34c8e30d921b79273b0913bd7dc64bebf51d082b5d107e4",
    cyclonePackage: "ros-humble-rmw-cyclonedds-cpp",
    cycloneVersion: "1.3.4-1jammy.20260717.012644",
    zenohPackage: "ros-humble-rmw-zenoh-cpp",
    zenohVersion: "0.1.9-1jammy.20260725.135946",
    imageTag: "rclweb-cdr-generator:humble-arm64-v2",
  },
  {
    id: "H-ZN",
    distro: "humble",
    rmw: "rmw_zenoh_cpp",
    baseImage:
      "docker.io/library/ros:humble-ros-base-jammy@sha256:7bea3d9aa2483d3ca34c8e30d921b79273b0913bd7dc64bebf51d082b5d107e4",
    cyclonePackage: "ros-humble-rmw-cyclonedds-cpp",
    cycloneVersion: "1.3.4-1jammy.20260717.012644",
    zenohPackage: "ros-humble-rmw-zenoh-cpp",
    zenohVersion: "0.1.9-1jammy.20260725.135946",
    imageTag: "rclweb-cdr-generator:humble-arm64-v2",
  },
  {
    id: "J-FT",
    distro: "jazzy",
    rmw: "rmw_fastrtps_cpp",
    baseImage:
      "docker.io/library/ros:jazzy-ros-base-noble@sha256:da725acf8b0f9f30c683e33ffbdcd6482d077af96d6fdc7688c5f4f280b7d923",
    cyclonePackage: "ros-jazzy-rmw-cyclonedds-cpp",
    cycloneVersion: "2.2.3-1noble.20260612.091852",
    zenohPackage: "ros-jazzy-rmw-zenoh-cpp",
    zenohVersion: "0.2.9-1noble.20260612.051449",
    imageTag: "rclweb-cdr-generator:jazzy-arm64-v2",
  },
  {
    id: "J-CY",
    distro: "jazzy",
    rmw: "rmw_cyclonedds_cpp",
    baseImage:
      "docker.io/library/ros:jazzy-ros-base-noble@sha256:da725acf8b0f9f30c683e33ffbdcd6482d077af96d6fdc7688c5f4f280b7d923",
    cyclonePackage: "ros-jazzy-rmw-cyclonedds-cpp",
    cycloneVersion: "2.2.3-1noble.20260612.091852",
    zenohPackage: "ros-jazzy-rmw-zenoh-cpp",
    zenohVersion: "0.2.9-1noble.20260612.051449",
    imageTag: "rclweb-cdr-generator:jazzy-arm64-v2",
  },
  {
    id: "J-ZN",
    distro: "jazzy",
    rmw: "rmw_zenoh_cpp",
    baseImage:
      "docker.io/library/ros:jazzy-ros-base-noble@sha256:da725acf8b0f9f30c683e33ffbdcd6482d077af96d6fdc7688c5f4f280b7d923",
    cyclonePackage: "ros-jazzy-rmw-cyclonedds-cpp",
    cycloneVersion: "2.2.3-1noble.20260612.091852",
    zenohPackage: "ros-jazzy-rmw-zenoh-cpp",
    zenohVersion: "0.2.9-1noble.20260612.051449",
    imageTag: "rclweb-cdr-generator:jazzy-arm64-v2",
  },
] as const;

type JsonObject = Record<string, unknown>;

type FixtureSpec = {
  typeName: string;
  sourceTypeNames: string[];
  dependencyTargets: string[];
  values: JsonObject;
  coverage: string[];
};

const primitiveValues = {
  bool_value: true,
  byte_value: 165,
  char_value: 90,
  float32_value: -12.5,
  float64_value: 12345.125,
  int8_value: -120,
  uint8_value: 250,
  int16_value: -32000,
  uint16_value: 65000,
  int32_value: -2000000000,
  uint32_value: 4000000000,
  int64_value: "-9000000000000000000",
  uint64_value: "18000000000000000000",
  string_value: "rclweb CDR ✓",
  wstring_value: "月面CDR",
};

const collectionsValues = {
  fixed_i32: [-2147483648, 0, 2147483647],
  bounded_f64: [-1.25, 0, 3.5, 1024.125],
  bytes_value: [0, 1, 127, 128, 255],
  bounded_string: "0123456789abcdef",
  bounded_wstring: "0123456789abcdef",
};

const nestedValues = {
  stamp: { sec: 1700000000, nanosec: 123456789 },
  scalars: primitiveValues,
  collections: collectionsValues,
};

const pointCloudValues = {
  header: { stamp: { sec: 1700000001, nanosec: 987654321 }, frame_id: "map" },
  height: 2,
  width: 3,
  fields: [
    { name: "x", offset: 0, datatype: 7, count: 1 },
    { name: "y", offset: 4, datatype: 7, count: 1 },
    { name: "z", offset: 8, datatype: 7, count: 1 },
    { name: "intensity", offset: 12, datatype: 4, count: 1 },
    { name: "ring", offset: 14, datatype: 4, count: 1 },
  ],
  is_bigendian: false,
  point_step: 16,
  row_step: 48,
  points: [
    { x: 1, y: 2, z: 3, intensity: 10, ring: 0 },
    { x: -1, y: -2, z: -3, intensity: 20, ring: 1 },
    { x: 0.5, y: 0.25, z: 0.125, intensity: 30, ring: 2 },
    { x: 10, y: 20, z: 30, intensity: 40, ring: 3 },
    { x: -10, y: 4, z: 8, intensity: 50, ring: 4 },
    { x: 1024, y: -1024, z: 64, intensity: 60, ring: 5 },
  ],
  is_dense: true,
};

export const FIXTURE_SPECS: Readonly<Record<string, FixtureSpec>> = {
  primitive_scalars: {
    typeName: "rclweb_cdr_interfaces/msg/PrimitiveScalars",
    sourceTypeNames: ["rclweb_cdr_interfaces/msg/PrimitiveScalars"],
    dependencyTargets: [],
    values: primitiveValues,
    coverage: ["endianness_little", "primitives", "strings", "wide_strings"],
  },
  primitive_scalars_big_endian: {
    typeName: "rclweb_cdr_interfaces/msg/PrimitiveScalars",
    sourceTypeNames: ["rclweb_cdr_interfaces/msg/PrimitiveScalars"],
    dependencyTargets: [],
    values: primitiveValues,
    coverage: ["endianness_big", "primitives", "strings", "wide_strings"],
  },
  collections: {
    typeName: "rclweb_cdr_interfaces/msg/Collections",
    sourceTypeNames: ["rclweb_cdr_interfaces/msg/Collections"],
    dependencyTargets: [],
    values: collectionsValues,
    coverage: ["arrays", "bounds", "endianness_little", "strings", "wide_strings"],
  },
  nested_sample: {
    typeName: "rclweb_cdr_interfaces/msg/NestedSample",
    sourceTypeNames: [
      "builtin_interfaces/msg/Time",
      "rclweb_cdr_interfaces/msg/Collections",
      "rclweb_cdr_interfaces/msg/NestedSample",
      "rclweb_cdr_interfaces/msg/PrimitiveScalars",
    ],
    dependencyTargets: [
      "builtin_interfaces/msg/Time",
      "rclweb_cdr_interfaces/msg/Collections",
      "rclweb_cdr_interfaces/msg/PrimitiveScalars",
    ],
    values: nestedValues,
    coverage: ["endianness_little", "nesting"],
  },
  point_cloud2: {
    typeName: "sensor_msgs/msg/PointCloud2",
    sourceTypeNames: [
      "builtin_interfaces/msg/Time",
      "sensor_msgs/msg/PointCloud2",
      "sensor_msgs/msg/PointField",
      "std_msgs/msg/Header",
    ],
    dependencyTargets: ["sensor_msgs/msg/PointField", "std_msgs/msg/Header"],
    values: pointCloudValues,
    coverage: ["arrays", "endianness_little", "nesting", "point_cloud2"],
  },
  echo_nested_request: {
    typeName: "rclweb_cdr_interfaces/srv/EchoNested_Request",
    sourceTypeNames: [
      "builtin_interfaces/msg/Time",
      "rclweb_cdr_interfaces/msg/Collections",
      "rclweb_cdr_interfaces/msg/NestedSample",
      "rclweb_cdr_interfaces/msg/PrimitiveScalars",
      "rclweb_cdr_interfaces/srv/EchoNested",
    ],
    dependencyTargets: [
      "rclweb_cdr_interfaces/msg/NestedSample",
      "rclweb_cdr_interfaces/srv/EchoNested",
    ],
    values: { input: nestedValues },
    coverage: ["endianness_little", "nesting", "service"],
  },
  echo_nested_response: {
    typeName: "rclweb_cdr_interfaces/srv/EchoNested_Response",
    sourceTypeNames: [
      "builtin_interfaces/msg/Time",
      "rclweb_cdr_interfaces/msg/Collections",
      "rclweb_cdr_interfaces/msg/NestedSample",
      "rclweb_cdr_interfaces/msg/PrimitiveScalars",
      "rclweb_cdr_interfaces/srv/EchoNested",
    ],
    dependencyTargets: [
      "rclweb_cdr_interfaces/msg/NestedSample",
      "rclweb_cdr_interfaces/srv/EchoNested",
    ],
    values: { output: nestedValues, accepted: true },
    coverage: ["endianness_little", "nesting", "service"],
  },
  measure_sequence_goal: {
    typeName: "rclweb_cdr_interfaces/action/MeasureSequence_Goal",
    sourceTypeNames: [
      "rclweb_cdr_interfaces/action/MeasureSequence",
      "rclweb_cdr_interfaces/msg/Collections",
    ],
    dependencyTargets: [
      "rclweb_cdr_interfaces/action/MeasureSequence",
      "rclweb_cdr_interfaces/msg/Collections",
    ],
    values: { target: collectionsValues },
    coverage: ["action", "bounds", "endianness_little"],
  },
  measure_sequence_result: {
    typeName: "rclweb_cdr_interfaces/action/MeasureSequence_Result",
    sourceTypeNames: [
      "builtin_interfaces/msg/Time",
      "rclweb_cdr_interfaces/action/MeasureSequence",
      "rclweb_cdr_interfaces/msg/Collections",
      "rclweb_cdr_interfaces/msg/NestedSample",
      "rclweb_cdr_interfaces/msg/PrimitiveScalars",
    ],
    dependencyTargets: [
      "rclweb_cdr_interfaces/action/MeasureSequence",
      "rclweb_cdr_interfaces/msg/NestedSample",
    ],
    values: { result: nestedValues },
    coverage: ["action", "endianness_little", "nesting"],
  },
  measure_sequence_feedback: {
    typeName: "rclweb_cdr_interfaces/action/MeasureSequence_Feedback",
    sourceTypeNames: [
      "builtin_interfaces/msg/Time",
      "rclweb_cdr_interfaces/action/MeasureSequence",
      "rclweb_cdr_interfaces/msg/Collections",
      "rclweb_cdr_interfaces/msg/NestedSample",
      "rclweb_cdr_interfaces/msg/PrimitiveScalars",
    ],
    dependencyTargets: [
      "rclweb_cdr_interfaces/action/MeasureSequence",
      "rclweb_cdr_interfaces/msg/NestedSample",
    ],
    values: { progress: 0.625, sample: nestedValues },
    coverage: ["action", "endianness_little", "nesting"],
  },
};

const NATIVE_CASES = Object.keys(FIXTURE_SPECS)
  .filter((id) => id !== "primitive_scalars_big_endian")
  .sort(asciiCompare);

export const REQUIRED_COVERAGE = [
  "action",
  "arrays",
  "bounds",
  "endianness_big",
  "endianness_little",
  "nesting",
  "point_cloud2",
  "primitives",
  "service",
  "strings",
  "wide_strings",
] as const;

const SOURCE_PATHS: Readonly<Record<string, { scope: "repo" | "row"; rel: string }>> = {
  "builtin_interfaces/msg/Time": {
    scope: "row",
    rel: "sources/builtin_interfaces/msg/Time.msg",
  },
  "sensor_msgs/msg/PointCloud2": {
    scope: "row",
    rel: "sources/sensor_msgs/msg/PointCloud2.msg",
  },
  "sensor_msgs/msg/PointField": {
    scope: "row",
    rel: "sources/sensor_msgs/msg/PointField.msg",
  },
  "std_msgs/msg/Header": { scope: "row", rel: "sources/std_msgs/msg/Header.msg" },
  "rclweb_cdr_interfaces/msg/PrimitiveScalars": {
    scope: "repo",
    rel: "conformance/interfaces/rclweb_cdr_interfaces/msg/PrimitiveScalars.msg",
  },
  "rclweb_cdr_interfaces/msg/Collections": {
    scope: "repo",
    rel: "conformance/interfaces/rclweb_cdr_interfaces/msg/Collections.msg",
  },
  "rclweb_cdr_interfaces/msg/NestedSample": {
    scope: "repo",
    rel: "conformance/interfaces/rclweb_cdr_interfaces/msg/NestedSample.msg",
  },
  "rclweb_cdr_interfaces/srv/EchoNested": {
    scope: "repo",
    rel: "conformance/interfaces/rclweb_cdr_interfaces/srv/EchoNested.srv",
  },
  "rclweb_cdr_interfaces/action/MeasureSequence": {
    scope: "repo",
    rel: "conformance/interfaces/rclweb_cdr_interfaces/action/MeasureSequence.action",
  },
};

const REVISION_FILES = [
  "scripts/cdr-corpus.ts",
  "conformance/cdr/generate/Dockerfile",
  "conformance/cdr/generate/rclweb_cdr_generator/CMakeLists.txt",
  "conformance/cdr/generate/rclweb_cdr_generator/package.xml",
  "conformance/cdr/generate/rclweb_cdr_generator/src/generate.cpp",
  "conformance/interfaces/rclweb_cdr_interfaces/CMakeLists.txt",
  "conformance/interfaces/rclweb_cdr_interfaces/package.xml",
  "conformance/interfaces/rclweb_cdr_interfaces/msg/PrimitiveScalars.msg",
  "conformance/interfaces/rclweb_cdr_interfaces/msg/Collections.msg",
  "conformance/interfaces/rclweb_cdr_interfaces/msg/NestedSample.msg",
  "conformance/interfaces/rclweb_cdr_interfaces/srv/EchoNested.srv",
  "conformance/interfaces/rclweb_cdr_interfaces/action/MeasureSequence.action",
].sort(asciiCompare);

type SummaryRow = {
  fixtureId: string;
  typeName: string;
  serializer: string;
  endianness: "little" | "big";
  typeHash: string;
  byteLength: number;
};

export type FixtureRecord = {
  id: string;
  case_id: string;
  support_row_id: string;
  ros_distro: string;
  rmw_identifier: string;
  ros_image: string;
  platform: string;
  generator_revision: string;
  type_name: string;
  encoding: "CDR1";
  schema_generation: number;
  schema_identity: { scheme: "rclweb-schema-v1" | "rep2011-rihs"; value: string };
  type_description: {
    canonical_bundle_path: string;
    canonical_bundle_sha256: string;
  };
  serialized: {
    path: string;
    byte_length: number;
    sha256: string;
    endianness: "little" | "big";
    serializer: string;
    padding: "zero-filled-v1";
  };
  values: JsonObject;
  semantic_value_sha256: string;
  expected: { roundtrip: "semantic-equality" };
  coverage: string[];
};

export type RowRecord = {
  schema_version: number;
  support_row: {
    id: string;
    ros_distro: string;
    rmw_identifier: string;
    ros_image: string;
    platform: string;
    package_versions: Record<string, string>;
  };
  generator_revision: string;
  fixtures: FixtureRecord[];
};

export function asciiCompare(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value === null || typeof value !== "object") return value;
  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(input).sort(asciiCompare)) {
    output[key] = sortKeysDeep(input[key]);
  }
  return output;
}

export function stableJsonCompact(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

export function stableJsonPretty(value: unknown): string {
  return `${JSON.stringify(sortKeysDeep(value), null, 2)}\n`;
}

export function normalizeSourceText(text: string): string {
  const lf = text.replace(/\r\n?/g, "\n");
  const lines = lf.split("\n").map((line) => line.replace(/[\t ]+$/g, ""));
  while (lines.length > 0 && lines.at(-1) === "") lines.pop();
  return `${lines.join("\n")}\n`;
}

export function parseCliMode(args: string[]): { mode: Mode } | { error: string } {
  if (args.length !== 1) {
    return { error: "usage: cdr-corpus.ts --write|--check|--reproduce" };
  }
  if (args[0] === "--write") return { mode: "write" };
  if (args[0] === "--check") return { mode: "check" };
  if (args[0] === "--reproduce") return { mode: "reproduce" };
  return { error: `unknown mode ${args[0]}` };
}

export async function computeGeneratorRevision(root: string): Promise<string> {
  const hash = createHash("sha256");
  for (const rel of REVISION_FILES) {
    const bytes = await readFile(path.join(root, rel));
    hash.update(rel, "utf8");
    hash.update("\0", "utf8");
    hash.update(String(bytes.byteLength), "utf8");
    hash.update("\0", "utf8");
    hash.update(bytes);
  }
  return `sha256:${hash.digest("hex")}`;
}

async function runCommand(args: string[], cwd: string): Promise<void> {
  const proc = Bun.spawn(args, { cwd, stdout: "inherit", stderr: "inherit", env: process.env });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`command failed (${code}): ${args.join(" ")}`);
}

async function buildGeneratorImages(root: string): Promise<void> {
  const byDistro = new Map<string, SupportRow>();
  for (const row of SUPPORT_ROWS) byDistro.set(row.distro, row);
  for (const row of [...byDistro.values()].sort((a, b) => asciiCompare(a.distro, b.distro))) {
    await runCommand(
      [
        "docker",
        "build",
        "--platform",
        PLATFORM,
        "--file",
        path.join(root, "conformance/cdr/generate/Dockerfile"),
        "--build-arg",
        `BASE_IMAGE=${row.baseImage}`,
        "--build-arg",
        `CYCLONE_PACKAGE=${row.cyclonePackage}`,
        "--build-arg",
        `CYCLONE_VERSION=${row.cycloneVersion}`,
        "--build-arg",
        `ZENOH_PACKAGE=${row.zenohPackage}`,
        "--build-arg",
        `ZENOH_VERSION=${row.zenohVersion}`,
        "--tag",
        row.imageTag,
        path.join(root, "conformance/cdr/generate"),
      ],
      root,
    );
  }
}

const containerGenerateScript = `
set -eo pipefail
mkdir -p /tmp/ws/src
cp -a /repo/conformance/interfaces/rclweb_cdr_interfaces /tmp/ws/src/
cp -a /repo/conformance/cdr/generate/rclweb_cdr_generator /tmp/ws/src/
set +u
source "/opt/ros/$ROS_DISTRO/setup.bash"
set -u
cd /tmp/ws
colcon build --merge-install --packages-up-to rclweb_cdr_generator --event-handlers console_start_end+ console_cohesion- console_direct-
set +u
source /tmp/ws/install/setup.bash
set -u
/tmp/ws/install/lib/rclweb_cdr_generator/rclweb_cdr_generate /out
mkdir -p /out/sources/builtin_interfaces/msg /out/sources/sensor_msgs/msg /out/sources/std_msgs/msg
cp "/opt/ros/$ROS_DISTRO/share/builtin_interfaces/msg/Time.msg" /out/sources/builtin_interfaces/msg/Time.msg
cp "/opt/ros/$ROS_DISTRO/share/sensor_msgs/msg/PointCloud2.msg" /out/sources/sensor_msgs/msg/PointCloud2.msg
cp "/opt/ros/$ROS_DISTRO/share/sensor_msgs/msg/PointField.msg" /out/sources/sensor_msgs/msg/PointField.msg
cp "/opt/ros/$ROS_DISTRO/share/std_msgs/msg/Header.msg" /out/sources/std_msgs/msg/Header.msg
dpkg-query -W > /out/packages.tsv
`;

async function runRowGenerator(root: string, rawRoot: string, row: SupportRow): Promise<string> {
  const outputDir = path.join(rawRoot, row.id);
  await mkdir(outputDir, { recursive: true });
  await runCommand(
    [
      "docker",
      "run",
      "--rm",
      "--platform",
      PLATFORM,
      "--env",
      `RMW_IMPLEMENTATION=${row.rmw}`,
      "--mount",
      `type=bind,src=${root},dst=/repo,readonly`,
      "--mount",
      `type=bind,src=${outputDir},dst=/out`,
      row.imageTag,
      "bash",
      "-lc",
      containerGenerateScript,
    ],
    root,
  );
  return outputDir;
}

export function parseSummaryTsv(text: string): SummaryRow[] {
  const lines = text.trimEnd().split("\n");
  const header = "fixture_id\ttype_name\tserializer\tendianness\ttype_hash\tbyte_length";
  if (lines.shift() !== header) throw new Error("summary.tsv header mismatch");
  return lines.map((line) => {
    const parts = line.split("\t");
    if (parts.length !== 6) throw new Error(`summary.tsv malformed row: ${line}`);
    const [fixtureId, typeName, serializer, endianness, typeHash, byteLengthText] = parts;
    const byteLength = Number(byteLengthText);
    if (!fixtureId || !typeName || !serializer || !["little", "big"].includes(endianness!)) {
      throw new Error(`summary.tsv invalid row: ${line}`);
    }
    if (!Number.isSafeInteger(byteLength) || byteLength <= 0) {
      throw new Error(`summary.tsv invalid byte length: ${line}`);
    }
    return {
      fixtureId,
      typeName,
      serializer,
      endianness: endianness as "little" | "big",
      typeHash: typeHash ?? "",
      byteLength,
    };
  });
}

function parsePackageVersions(text: string, distro: string): Record<string, string> {
  const all = new Map<string, string>();
  for (const line of text.trimEnd().split("\n")) {
    const [name, version] = line.split("\t");
    if (name && version) all.set(name, version);
  }
  const names = [
    `ros-${distro}-fastcdr`,
    `ros-${distro}-rclcpp`,
    `ros-${distro}-rmw-cyclonedds-cpp`,
    `ros-${distro}-rmw-fastrtps-cpp`,
    `ros-${distro}-rmw-zenoh-cpp`,
    `ros-${distro}-rosidl-typesupport-cpp`,
    `ros-${distro}-sensor-msgs`,
  ];
  const selected: Record<string, string> = {};
  for (const name of names) {
    const version = all.get(name);
    if (!version) throw new Error(`missing package version ${name}`);
    selected[name] = version;
  }
  return selected;
}

function transitiveDependencyEdges(rootTypeName: string, caseId: string): Array<{ from: string; to: string }> {
  const spec = FIXTURE_SPECS[caseId]!;
  const edges = spec.dependencyTargets.map((to) => ({ from: rootTypeName, to }));
  if (spec.sourceTypeNames.includes("rclweb_cdr_interfaces/msg/NestedSample")) {
    for (const to of [
      "builtin_interfaces/msg/Time",
      "rclweb_cdr_interfaces/msg/Collections",
      "rclweb_cdr_interfaces/msg/PrimitiveScalars",
    ]) {
      edges.push({ from: "rclweb_cdr_interfaces/msg/NestedSample", to });
    }
  }
  if (caseId === "point_cloud2") {
    edges.push({ from: "std_msgs/msg/Header", to: "builtin_interfaces/msg/Time" });
  }
  const unique = new Map(edges.map((edge) => [`${edge.from}\0${edge.to}`, edge]));
  return [...unique.values()].sort((a, b) =>
    asciiCompare(`${a.from}\0${a.to}`, `${b.from}\0${b.to}`),
  );
}

async function buildCanonicalBundle(
  root: string,
  rawRowDir: string,
  caseId: string,
  rootTypeName: string,
  generatorRevision: string,
): Promise<{ text: string; sha256: string }> {
  const spec = FIXTURE_SPECS[caseId]!;
  const sources = [];
  for (const typeName of [...spec.sourceTypeNames].sort(asciiCompare)) {
    const source = SOURCE_PATHS[typeName];
    if (!source) throw new Error(`missing source mapping for ${typeName}`);
    const base = source.scope === "repo" ? root : rawRowDir;
    const content = normalizeSourceText(await readFile(path.join(base, source.rel), "utf8"));
    sources.push({ type_name: typeName, encoding: "ROS2_INTERFACE_TEXT", content });
  }
  const bundle = {
    format: BUNDLE_FORMAT,
    generator_revision: generatorRevision,
    root_type_name: rootTypeName,
    dependency_graph: transitiveDependencyEdges(rootTypeName, caseId),
    sources,
  };
  const text = `${stableJsonCompact(bundle)}\n`;
  return { text, sha256: sha256Hex(text) };
}

function expectedCaseIds(row: SupportRow): string[] {
  const cases = [...NATIVE_CASES];
  if (row.rmw === "rmw_fastrtps_cpp") cases.push("primitive_scalars_big_endian");
  return cases.sort(asciiCompare);
}

function validateCdrHeader(bytes: Uint8Array, endianness: "little" | "big", label: string): void {
  if (bytes.length < 4 || bytes[0] !== 0 || bytes[1] !== (endianness === "little" ? 1 : 0)) {
    throw new Error(`${label}: DDS CDR encapsulation does not match ${endianness} endian`);
  }
}

async function buildRowRecord(
  root: string,
  corpusRoot: string,
  rawRowDir: string,
  row: SupportRow,
  generatorRevision: string,
  bundles: Map<string, string>,
): Promise<RowRecord> {
  const summary = parseSummaryTsv(await readFile(path.join(rawRowDir, "summary.tsv"), "utf8"));
  const byId = new Map(summary.map((entry) => [entry.fixtureId, entry]));
  const fixtures: FixtureRecord[] = [];
  for (const caseId of expectedCaseIds(row)) {
    const entry = byId.get(caseId);
    const spec = FIXTURE_SPECS[caseId];
    if (!entry || !spec) throw new Error(`${row.id}: missing generator case ${caseId}`);
    if (entry.typeName !== spec.typeName) {
      throw new Error(`${row.id}/${caseId}: type name ${entry.typeName} != ${spec.typeName}`);
    }
    const bytes = await readFile(path.join(rawRowDir, `${caseId}.bin`));
    if (bytes.byteLength !== entry.byteLength) {
      throw new Error(`${row.id}/${caseId}: byte length mismatch`);
    }
    validateCdrHeader(bytes, entry.endianness, `${row.id}/${caseId}`);

    const bundle = await buildCanonicalBundle(
      root,
      rawRowDir,
      caseId,
      entry.typeName,
      generatorRevision,
    );
    const prior = bundles.get(bundle.sha256);
    if (prior && prior !== bundle.text) throw new Error(`bundle digest collision ${bundle.sha256}`);
    bundles.set(bundle.sha256, bundle.text);

    let scheme: "rclweb-schema-v1" | "rep2011-rihs";
    let schemaValue: string;
    if (row.distro === "humble") {
      if (entry.typeHash !== "") throw new Error(`${row.id}/${caseId}: Humble emitted RIHS`);
      scheme = "rclweb-schema-v1";
      schemaValue = bundle.sha256;
    } else {
      if (!/^RIHS01_[0-9a-f]{64}$/.test(entry.typeHash)) {
        throw new Error(`${row.id}/${caseId}: malformed Jazzy RIHS ${entry.typeHash}`);
      }
      scheme = "rep2011-rihs";
      schemaValue = entry.typeHash;
    }

    const artifactRel = `fixtures/${row.id}/${caseId}.bin`;
    const artifactAbs = path.join(corpusRoot, artifactRel);
    await mkdir(path.dirname(artifactAbs), { recursive: true });
    await copyFile(path.join(rawRowDir, `${caseId}.bin`), artifactAbs);
    fixtures.push({
      id: `${row.id}-${caseId}`,
      case_id: caseId,
      support_row_id: row.id,
      ros_distro: row.distro,
      rmw_identifier: row.rmw,
      ros_image: row.baseImage,
      platform: PLATFORM,
      generator_revision: generatorRevision,
      type_name: entry.typeName,
      encoding: "CDR1",
      schema_generation: SCHEMA_GENERATION,
      schema_identity: { scheme, value: schemaValue },
      type_description: {
        canonical_bundle_path: `fixtures/bundles/${bundle.sha256}.json`,
        canonical_bundle_sha256: bundle.sha256,
      },
      serialized: {
        path: artifactRel,
        byte_length: bytes.byteLength,
        sha256: sha256Hex(bytes),
        endianness: entry.endianness,
        serializer: entry.serializer,
        padding: "zero-filled-v1",
      },
      values: structuredClone(spec.values),
      semantic_value_sha256: sha256Hex(stableJsonCompact(spec.values)),
      expected: { roundtrip: "semantic-equality" },
      coverage: [...spec.coverage].sort(asciiCompare),
    });
  }

  return {
    schema_version: SCHEMA_VERSION,
    support_row: {
      id: row.id,
      ros_distro: row.distro,
      rmw_identifier: row.rmw,
      ros_image: row.baseImage,
      platform: PLATFORM,
      package_versions: parsePackageVersions(
        await readFile(path.join(rawRowDir, "packages.tsv"), "utf8"),
        row.distro,
      ),
    },
    generator_revision: generatorRevision,
    fixtures: fixtures.sort((a, b) => asciiCompare(a.id, b.id)),
  };
}

function buildComparisons(fixtures: FixtureRecord[]) {
  const comparisons = [];
  for (const distro of ["humble", "jazzy"] as const) {
    const prefix = distro === "humble" ? "H" : "J";
    const rowIds = [`${prefix}-FT`, `${prefix}-CY`, `${prefix}-ZN`] as const;
    for (const caseId of NATIVE_CASES) {
      const byRow = Object.fromEntries(
        rowIds.map((rowId) => {
          const fixture = fixtures.find((item) => item.id === `${rowId}-${caseId}`);
          if (!fixture) throw new Error(`missing comparison fixture ${rowId}/${caseId}`);
          return [rowId, fixture] as const;
        }),
      ) as Record<(typeof rowIds)[number], FixtureRecord>;
      const semantic = byRow[rowIds[0]].semantic_value_sha256;
      for (const rowId of rowIds) {
        if (byRow[rowId].semantic_value_sha256 !== semantic) {
          throw new Error(`semantic values diverge for ${distro}/${caseId}`);
        }
      }
      const digests = rowIds.map((rowId) => byRow[rowId].serialized.sha256);
      const bytesEqual = digests.every((digest) => digest === digests[0]);
      comparisons.push({
        case_id: caseId,
        ros_distro: distro,
        rows: [...rowIds],
        bytes_equal: bytesEqual,
        semantic_equal: true,
        sha256_by_row: Object.fromEntries(
          rowIds.map((rowId) => [rowId, byRow[rowId].serialized.sha256]),
        ),
      });
    }
  }
  return comparisons.sort((a, b) =>
    asciiCompare(`${a.ros_distro}\0${a.case_id}`, `${b.ros_distro}\0${b.case_id}`),
  );
}

export function buildProvenance(fixtures: FixtureRecord[], generatorRevision: string) {
  const entries = new Map<string, { type_name: string; rihs: string; bundle_sha256: string }>();
  for (const fixture of fixtures) {
    if (fixture.schema_identity.scheme !== "rep2011-rihs") continue;
    const item = {
      type_name: fixture.type_name,
      rihs: fixture.schema_identity.value,
      bundle_sha256: fixture.type_description.canonical_bundle_sha256,
    };
    const key = `${item.rihs}\0${item.bundle_sha256}`;
    entries.set(key, item);
  }
  return {
    schema_version: SCHEMA_VERSION,
    generator_revision: generatorRevision,
    mappings: [...entries.values()].sort((a, b) =>
      asciiCompare(`${a.type_name}\0${a.rihs}`, `${b.type_name}\0${b.rihs}`),
    ),
  };
}

export function buildManifest(rowRecords: RowRecord[], provenanceSha256: string) {
  const fixtures = rowRecords
    .flatMap((record) => record.fixtures)
    .sort((a, b) => asciiCompare(a.id, b.id));
  const coverage = [...new Set(fixtures.flatMap((fixture) => fixture.coverage))].sort(asciiCompare);
  return {
    schema_version: SCHEMA_VERSION,
    corpus: CORPUS_ID,
    encoding: "CDR1",
    schema_generation: SCHEMA_GENERATION,
    generator_revision: rowRecords[0]?.generator_revision,
    canonicalization: {
      bundle_json: "recursive-key-sort compact UTF-8 with one LF",
      source_text: "UTF-8 LF, trailing horizontal whitespace removed, one final LF",
      cdr_padding: "preallocated bytes zero-filled before ROS serialization",
    },
    environments: rowRecords
      .map((record) => record.support_row)
      .sort((a, b) => asciiCompare(a.id, b.id)),
    provenance: {
      path: "fixtures/provenance/jazzy-rihs-to-bundle.json",
      sha256: provenanceSha256,
    },
    coverage,
    fixtures,
    comparisons: buildComparisons(fixtures),
  };
}

async function assembleCorpus(
  root: string,
  corpusRoot: string,
  rawRoot: string,
  generatorRevision: string,
): Promise<void> {
  await mkdir(path.join(corpusRoot, "fixtures"), { recursive: true });
  const bundles = new Map<string, string>();
  const rowRecords: RowRecord[] = [];
  for (const row of SUPPORT_ROWS) {
    const record = await buildRowRecord(
      root,
      corpusRoot,
      path.join(rawRoot, row.id),
      row,
      generatorRevision,
      bundles,
    );
    rowRecords.push(record);
    await writeFile(
      path.join(corpusRoot, `fixtures/${row.id}/row.json`),
      stableJsonPretty(record),
    );
  }

  await mkdir(path.join(corpusRoot, "fixtures/bundles"), { recursive: true });
  for (const [digest, text] of [...bundles.entries()].sort(([a], [b]) => asciiCompare(a, b))) {
    await writeFile(path.join(corpusRoot, `fixtures/bundles/${digest}.json`), text);
  }

  const allFixtures = rowRecords.flatMap((record) => record.fixtures);
  const provenance = buildProvenance(allFixtures, generatorRevision);
  const provenanceText = stableJsonPretty(provenance);
  await mkdir(path.join(corpusRoot, "fixtures/provenance"), { recursive: true });
  await writeFile(
    path.join(corpusRoot, "fixtures/provenance/jazzy-rihs-to-bundle.json"),
    provenanceText,
  );
  const manifest = buildManifest(rowRecords, sha256Hex(provenanceText));
  await writeFile(path.join(corpusRoot, "manifest.json"), stableJsonPretty(manifest));
}

function assertExactCaseCoverage(row: SupportRow, fixtures: FixtureRecord[]): void {
  const actual = fixtures.map((fixture) => fixture.case_id).sort(asciiCompare);
  const expected = expectedCaseIds(row);
  if (stableJsonCompact(actual) !== stableJsonCompact(expected)) {
    throw new Error(`${row.id}: fixture case set mismatch`);
  }
}

async function validateRowRecord(
  sourceRoot: string,
  corpusRoot: string,
  row: SupportRow,
  record: RowRecord,
  generatorRevision: string,
): Promise<void> {
  if (record.schema_version !== SCHEMA_VERSION || record.generator_revision !== generatorRevision) {
    throw new Error(`${row.id}: stale row record generator revision`);
  }
  const expectedSupportRow = {
    id: row.id,
    ros_distro: row.distro,
    rmw_identifier: row.rmw,
    ros_image: row.baseImage,
    platform: PLATFORM,
  };
  for (const [key, expected] of Object.entries(expectedSupportRow)) {
    if ((record.support_row as unknown as Record<string, unknown>)[key] !== expected) {
      throw new Error(`${row.id}: support row ${key} mismatch`);
    }
  }
  if (Object.keys(record.support_row.package_versions).length < 7) {
    throw new Error(`${row.id}: package version record is incomplete`);
  }
  assertExactCaseCoverage(row, record.fixtures);

  for (const fixture of record.fixtures) {
    const spec = FIXTURE_SPECS[fixture.case_id];
    if (!spec) throw new Error(`${fixture.id}: unknown case`);
    if (
      fixture.id !== `${row.id}-${fixture.case_id}` ||
      fixture.support_row_id !== row.id ||
      fixture.ros_distro !== row.distro ||
      fixture.rmw_identifier !== row.rmw ||
      fixture.ros_image !== row.baseImage ||
      fixture.platform !== PLATFORM ||
      fixture.generator_revision !== generatorRevision ||
      fixture.type_name !== spec.typeName ||
      fixture.encoding !== "CDR1" ||
      fixture.schema_generation !== SCHEMA_GENERATION
    ) {
      throw new Error(`${fixture.id}: fixture identity metadata mismatch`);
    }
    if (stableJsonCompact(fixture.values) !== stableJsonCompact(spec.values)) {
      throw new Error(`${fixture.id}: semantic values mismatch`);
    }
    if (fixture.semantic_value_sha256 !== sha256Hex(stableJsonCompact(spec.values))) {
      throw new Error(`${fixture.id}: semantic value hash mismatch`);
    }
    if (stableJsonCompact(fixture.coverage) !== stableJsonCompact([...spec.coverage].sort(asciiCompare))) {
      throw new Error(`${fixture.id}: coverage mismatch`);
    }
    if (fixture.expected.roundtrip !== "semantic-equality") {
      throw new Error(`${fixture.id}: roundtrip expectation mismatch`);
    }
    const bytes = await readFile(path.join(corpusRoot, fixture.serialized.path));
    if (
      bytes.byteLength !== fixture.serialized.byte_length ||
      sha256Hex(bytes) !== fixture.serialized.sha256
    ) {
      throw new Error(`${fixture.id}: serialized artifact mismatch`);
    }
    validateCdrHeader(bytes, fixture.serialized.endianness, fixture.id);
    if (fixture.serialized.padding !== "zero-filled-v1") {
      throw new Error(`${fixture.id}: padding policy mismatch`);
    }
    const bundlePath = path.join(corpusRoot, fixture.type_description.canonical_bundle_path);
    const bundleText = await readFile(bundlePath, "utf8");
    const parsedBundle = JSON.parse(bundleText) as JsonObject;
    if (`${stableJsonCompact(parsedBundle)}\n` !== bundleText) {
      throw new Error(`${fixture.id}: bundle bytes are not canonical`);
    }
    const bundleSha = sha256Hex(bundleText);
    if (
      bundleSha !== fixture.type_description.canonical_bundle_sha256 ||
      parsedBundle.root_type_name !== fixture.type_name ||
      parsedBundle.generator_revision !== generatorRevision
    ) {
      throw new Error(`${fixture.id}: bundle identity mismatch`);
    }
    if (row.distro === "humble") {
      if (
        fixture.schema_identity.scheme !== "rclweb-schema-v1" ||
        fixture.schema_identity.value !== bundleSha
      ) {
        throw new Error(`${fixture.id}: Humble schema identity mismatch`);
      }
    } else if (
      fixture.schema_identity.scheme !== "rep2011-rihs" ||
      !/^RIHS01_[0-9a-f]{64}$/.test(fixture.schema_identity.value)
    ) {
      throw new Error(`${fixture.id}: Jazzy schema identity mismatch`);
    }
  }

  void sourceRoot;
}

export async function checkCorpus(sourceRoot: string, corpusRoot = path.join(sourceRoot, CORPUS_REL)) {
  const generatorRevision = await computeGeneratorRevision(sourceRoot);
  const rowRecords: RowRecord[] = [];
  for (const row of SUPPORT_ROWS) {
    const rowPath = path.join(corpusRoot, `fixtures/${row.id}/row.json`);
    const record = JSON.parse(await readFile(rowPath, "utf8")) as RowRecord;
    if (stableJsonPretty(record) !== (await readFile(rowPath, "utf8"))) {
      throw new Error(`${row.id}: row.json is not canonical`);
    }
    await validateRowRecord(sourceRoot, corpusRoot, row, record, generatorRevision);
    rowRecords.push(record);
  }

  const fixtures = rowRecords.flatMap((record) => record.fixtures);
  const coverage = new Set(fixtures.flatMap((fixture) => fixture.coverage));
  for (const token of REQUIRED_COVERAGE) {
    if (!coverage.has(token)) throw new Error(`missing corpus coverage ${token}`);
  }
  const provenancePath = path.join(
    corpusRoot,
    "fixtures/provenance/jazzy-rihs-to-bundle.json",
  );
  const provenanceText = await readFile(provenancePath, "utf8");
  const expectedProvenance = stableJsonPretty(buildProvenance(fixtures, generatorRevision));
  if (provenanceText !== expectedProvenance) throw new Error("Jazzy provenance mapping mismatch");
  const expectedManifest = stableJsonPretty(
    buildManifest(rowRecords, sha256Hex(provenanceText)),
  );
  const manifestText = await readFile(path.join(corpusRoot, "manifest.json"), "utf8");
  if (manifestText !== expectedManifest) throw new Error("CDR corpus manifest mismatch");

  const bundleNames = (await readdir(path.join(corpusRoot, "fixtures/bundles")))
    .filter((name) => name.endsWith(".json"))
    .sort(asciiCompare);
  const referencedBundles = [...new Set(
    fixtures.map((fixture) => path.basename(fixture.type_description.canonical_bundle_path)),
  )].sort(asciiCompare);
  if (stableJsonCompact(bundleNames) !== stableJsonCompact(referencedBundles)) {
    throw new Error("bundle directory contains missing or unreferenced files");
  }
  return {
    rows: rowRecords.length,
    fixtures: fixtures.length,
    bundles: bundleNames.length,
    comparisons: buildComparisons(fixtures).length,
  };
}

async function generateCorpus(sourceRoot: string, destination: string): Promise<void> {
  const rawRoot = path.join(path.dirname(destination), "raw");
  await buildGeneratorImages(sourceRoot);
  for (const row of SUPPORT_ROWS) await runRowGenerator(sourceRoot, rawRoot, row);
  const generatorRevision = await computeGeneratorRevision(sourceRoot);
  await assembleCorpus(sourceRoot, destination, rawRoot, generatorRevision);
  await checkCorpus(sourceRoot, destination);
}

/** Paths written by generate/write: corpus root `manifest.json` plus everything under `fixtures/`. */
export const GENERATED_CORPUS_ENTRIES = ["fixtures", "manifest.json"] as const;

async function listFileDigests(root: string, rel = ""): Promise<Array<[string, string]>> {
  const dir = path.join(root, rel);
  const entries = await readdir(dir, { withFileTypes: true });
  const output: Array<[string, string]> = [];
  for (const entry of entries.sort((a, b) => asciiCompare(a.name, b.name))) {
    const childRel = path.join(rel, entry.name);
    if (entry.isDirectory()) output.push(...(await listFileDigests(root, childRel)));
    else output.push([childRel, sha256Hex(await readFile(path.join(root, childRel)))]);
  }
  return output;
}

/**
 * Digest inventory for reproduce comparison. Scope matches the generated corpus
 * artifact set only: `manifest.json` and every file under `fixtures/`.
 * Source trees under `generate/`, docs such as `README.md`, and other non-artifact
 * paths are excluded so they cannot affect pinned-environment equality.
 */
export async function listGeneratedCorpusDigests(
  corpusRoot: string,
): Promise<Array<[string, string]>> {
  const digests: Array<[string, string]> = [];
  digests.push([
    "manifest.json",
    sha256Hex(await readFile(path.join(corpusRoot, "manifest.json"))),
  ]);
  digests.push(...(await listFileDigests(corpusRoot, "fixtures")));
  return digests.sort(([a], [b]) => asciiCompare(a, b));
}

export function digestsEqual(
  left: ReadonlyArray<readonly [string, string]>,
  right: ReadonlyArray<readonly [string, string]>,
): boolean {
  return stableJsonCompact(left) === stableJsonCompact(right);
}

async function writeCorpus(sourceRoot: string): Promise<void> {
  const temp = await mkdtemp(path.join(tmpdir(), "rclweb-cdr-write-"));
  try {
    const generated = path.join(temp, "cdr");
    await generateCorpus(sourceRoot, generated);
    const target = path.join(sourceRoot, CORPUS_REL);
    await rm(path.join(target, "fixtures"), { recursive: true, force: true });
    await rm(path.join(target, "manifest.json"), { force: true });
    await mkdir(target, { recursive: true });
    await cp(path.join(generated, "fixtures"), path.join(target, "fixtures"), { recursive: true });
    await copyFile(path.join(generated, "manifest.json"), path.join(target, "manifest.json"));
    const result = await checkCorpus(sourceRoot);
    console.log(
      `cdr-corpus: status=ok mode=write rows=${result.rows} fixtures=${result.fixtures} bundles=${result.bundles} comparisons=${result.comparisons}`,
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

async function reproduceCorpus(sourceRoot: string): Promise<void> {
  const temp = await mkdtemp(path.join(tmpdir(), "rclweb-cdr-reproduce-"));
  try {
    const generated = path.join(temp, "cdr");
    await generateCorpus(sourceRoot, generated);
    const expected = await listGeneratedCorpusDigests(path.join(sourceRoot, CORPUS_REL));
    const actual = await listGeneratedCorpusDigests(generated);
    if (!digestsEqual(actual, expected)) {
      throw new Error("pinned ROS generation differs from the committed CDR corpus");
    }
    console.log(`cdr-corpus: status=ok mode=reproduce files=${actual.length}`);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const parsed = parseCliMode(process.argv.slice(2));
  if ("error" in parsed) throw new Error(parsed.error);
  const root = path.resolve(import.meta.dir, "..");
  if (parsed.mode === "write") {
    await writeCorpus(root);
    return;
  }
  if (parsed.mode === "reproduce") {
    await reproduceCorpus(root);
    return;
  }
  const result = await checkCorpus(root);
  console.log(
    `cdr-corpus: status=ok mode=check rows=${result.rows} fixtures=${result.fixtures} bundles=${result.bundles} comparisons=${result.comparisons}`,
  );
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(`cdr-corpus: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
