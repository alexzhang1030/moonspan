import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  PROJECT_PACKAGE_RELS,
  USER_HELP,
  buildFromDirs,
  buildIr,
  buildProject,
  constantValueExpr,
  defaultExprFor,
  isDirectoryOut,
  parseCli,
  parseInterfaceSection,
  parseTypeExpr,
  resolveNamedType,
  runCli,
  runUserCli,
  tsTypeFor,
} from "./rosidl-dts.ts";

const ROOT = path.resolve(import.meta.dir, "..");

describe("rosidl-dts parser", () => {
  test("parses primitives, bounds, arrays, and named types", () => {
    expect(parseTypeExpr("bool")).toEqual({
      ok: true,
      type: { base: { kind: "primitive", name: "bool" }, array: { kind: "none" } },
    });
    expect(parseTypeExpr("int32[3]").ok && parseTypeExpr("int32[3]")).toMatchObject({
      ok: true,
      type: { array: { kind: "fixed", size: 3 } },
    });
    expect(parseTypeExpr("float64[<=4]").ok && parseTypeExpr("float64[<=4]")).toMatchObject({
      ok: true,
      type: { array: { kind: "bounded", size: 4 } },
    });
    expect(parseTypeExpr("uint8[]").ok && parseTypeExpr("uint8[]")).toMatchObject({
      ok: true,
      type: { array: { kind: "unbounded" } },
    });
    expect(parseTypeExpr("string<=16")).toEqual({
      ok: true,
      type: { base: { kind: "string", wide: false, bound: 16 }, array: { kind: "none" } },
    });
    expect(parseTypeExpr("builtin_interfaces/Time")).toEqual({
      ok: true,
      type: { base: { kind: "named", raw: "builtin_interfaces/Time" }, array: { kind: "none" } },
    });
    expect(parseTypeExpr("sequence<int32>").ok).toBe(false);
    expect(parseTypeExpr("").ok).toBe(false);
  });

  test("parses fields, constants, and comments", () => {
    const parsed = parseInterfaceSection(`
# comment
uint8 INT8 = 1
string name
uint32 offset 0
PointField[] fields
`);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.parsed.constants).toEqual([
      {
        name: "INT8",
        type: { base: { kind: "primitive", name: "uint8" }, array: { kind: "none" } },
        value: "1",
      },
    ]);
    expect(parsed.parsed.fields.map((f) => f.name)).toEqual(["name", "offset", "fields"]);
    expect(parsed.parsed.fields[1]?.defaultText).toBe("0");
    const bounds = parseInterfaceSection(
      "float64[<=4] bounded_f64\nstring<=16 bounded_string\nwstring<=16 bounded_wstring\n",
    );
    expect(bounds.ok && bounds.parsed.fields.map((f) => f.name)).toEqual([
      "bounded_f64",
      "bounded_string",
      "bounded_wstring",
    ]);
  });

  test("rejects malformed field lines", () => {
    expect(parseInterfaceSection("int32").ok).toBe(false);
    expect(parseInterfaceSection("# only comments").ok).toBe(false);
    expect(parseInterfaceSection("int32 9bad = 1").ok).toBe(false);
  });
});

describe("rosidl-dts type mapping", () => {
  const id = (name: string) => name.split("/").pop()!;

  test("maps ROS IDL types to rcl-web TypeScript", () => {
    const boolT = parseTypeExpr("bool");
    const i64 = parseTypeExpr("int64");
    const bytes = parseTypeExpr("uint8[]");
    const fixed = parseTypeExpr("int32[3]");
    const seq = parseTypeExpr("float64[<=4]");
    const named = parseTypeExpr("pkg/msg/Foo");
    expect(boolT.ok && tsTypeFor(boolT.type, id)).toBe("boolean");
    expect(i64.ok && tsTypeFor(i64.type, id)).toBe("bigint");
    expect(bytes.ok && tsTypeFor(bytes.type, id)).toBe("Uint8Array");
    expect(fixed.ok && tsTypeFor(fixed.type, id)).toBe("[number, number, number]");
    expect(seq.ok && tsTypeFor(seq.type, id)).toBe("number[]");
    expect(named.ok && tsTypeFor(named.type, id)).toBe("Foo");
    expect(bytes.ok && defaultExprFor(bytes.type, id)).toBe("new Uint8Array()");
    expect(fixed.ok && defaultExprFor(fixed.type, id)).toBe("[0, 0, 0]");
    expect(constantValueExpr("1", i64.ok ? i64.type : bytes.type)).toBe("1n");
  });

  test("resolves short, pkg/Name, and fully qualified names", () => {
    const catalog = new Map([
      [
        "sensor_msgs/msg/PointField",
        { typeName: "sensor_msgs/msg/PointField", shortName: "PointField", packageName: "sensor_msgs" },
      ],
      [
        "std_msgs/msg/Header",
        { typeName: "std_msgs/msg/Header", shortName: "Header", packageName: "std_msgs" },
      ],
    ]);
    expect(resolveNamedType("PointField", "sensor_msgs", catalog)).toEqual({
      ok: true,
      typeName: "sensor_msgs/msg/PointField",
    });
    expect(resolveNamedType("std_msgs/Header", "sensor_msgs", catalog)).toEqual({
      ok: true,
      typeName: "std_msgs/msg/Header",
    });
    expect(resolveNamedType("std_msgs/msg/Header", "sensor_msgs", catalog)).toEqual({
      ok: true,
      typeName: "std_msgs/msg/Header",
    });
    expect(resolveNamedType("Missing", "sensor_msgs", catalog).ok).toBe(false);
  });
});

describe("rosidl-dts emit", () => {
  test("CLI parsing", () => {
    expect(parseCli(["--write"])).toEqual({ ok: true, cli: { mode: "write" } });
    expect(parseCli(["--check"])).toEqual({ ok: true, cli: { mode: "check" } });
    expect(parseCli(["--write", "--check"]).ok).toBe(false);
    expect(parseCli(["gen", "--package", "p", "--out", "p.d.ts"])).toMatchObject({
      ok: true,
      cli: { mode: "emit", dirs: ["p"], out: "p.d.ts", runtime: false },
    });
    expect(parseCli(["--package", "p", "--out", "p.d.ts"])).toMatchObject({
      ok: true,
      cli: { mode: "emit", dirs: ["p"], out: "p.d.ts", runtime: false },
    });
    expect(parseCli(["--package", "p", "--out", "p.ts"])).toMatchObject({
      ok: true,
      cli: { runtime: true },
    });
    expect(isDirectoryOut("out")).toBe(true);
    expect(isDirectoryOut("out/pkg.d.ts")).toBe(false);
  });

  test("emits srv and action section classes", () => {
    const built = buildIr([
      {
        name: "demo_pkg",
        dir: "/tmp/demo_pkg",
        messages: [
          {
            typeName: "demo_pkg/msg/Ping",
            packageName: "demo_pkg",
            shortName: "Ping",
            fields: [
              {
                name: "n",
                type: { base: { kind: "primitive", name: "int32" }, array: { kind: "none" } },
              },
            ],
            constants: [],
          },
        ],
        services: [
          {
            typeName: "demo_pkg/srv/Echo",
            packageName: "demo_pkg",
            shortName: "Echo",
            request: {
              fields: [
                {
                  name: "input",
                  type: { base: { kind: "named", raw: "Ping" }, array: { kind: "none" } },
                },
              ],
              constants: [],
            },
            response: {
              fields: [
                {
                  name: "ok",
                  type: { base: { kind: "primitive", name: "bool" }, array: { kind: "none" } },
                },
              ],
              constants: [],
            },
          },
        ],
        actions: [
          {
            typeName: "demo_pkg/action/Go",
            packageName: "demo_pkg",
            shortName: "Go",
            goal: {
              fields: [
                {
                  name: "target",
                  type: { base: { kind: "primitive", name: "int32" }, array: { kind: "none" } },
                },
              ],
              constants: [],
            },
            result: {
              fields: [
                {
                  name: "done",
                  type: { base: { kind: "primitive", name: "bool" }, array: { kind: "none" } },
                },
              ],
              constants: [],
            },
            feedback: {
              fields: [
                {
                  name: "progress",
                  type: { base: { kind: "primitive", name: "float32" }, array: { kind: "none" } },
                },
              ],
              constants: [],
            },
          },
        ],
      },
    ]);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.dts).toContain('static readonly typeName: "demo_pkg/srv/Echo_Request"');
    expect(built.dts).toContain("export declare const Echo:");
    expect(built.dts).toContain("export declare const Go:");
    expect(built.dts).toContain("readonly Goal: typeof Go_Goal");
    expect(built.ts).toContain("input = new Ping()");
    expect(built.ts).toContain("export const demo_pkg = {");
    expect(built.ts).toContain("srv: { Echo },");
    expect(built.ts).toContain("action: { Go },");
  });

  test("loads the project interface set", async () => {
    const dirs = PROJECT_PACKAGE_RELS.map((rel) => path.join(ROOT, rel));
    const built = await buildFromDirs(dirs);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.packages.map((p) => p.name)).toEqual([
      "builtin_interfaces",
      "rclweb_cdr_interfaces",
      "sensor_msgs",
      "std_msgs",
    ]);
    expect(built.dts).toContain('static readonly typeName: "std_msgs/msg/String"');
    expect(built.dts).toContain('static readonly typeName: "sensor_msgs/msg/PointCloud2"');
    expect(built.dts).toContain("static readonly FLOAT32: number");
    expect(built.dts).toContain("fixed_i32: [number, number, number]");
    expect(built.dts).toContain("bytes_value: Uint8Array");
    expect(built.dts).toContain("int64_value: bigint");
    expect(built.dts).toContain("export declare const EchoNested:");
    expect(built.dts).toContain("export declare const MeasureSequence:");
    expect(built.ts).toContain('static readonly typeName = "rclweb_cdr_interfaces/msg/NestedSample" as const');
    expect(built.ts).toContain("scalars = new PrimitiveScalars()");
    expect(built.ts).toContain("static readonly INT8 = 1");
  });

  test("writes a package DTS and rejects OMG-only directories", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "rosidl-dts-"));
    await mkdir(path.join(dir, "msg"));
    await writeFile(path.join(dir, "msg", "Hi.msg"), "string data\n");
    await writeFile(path.join(dir, "package.xml"), "<package><name>tmp_pkg</name></package>\n");
    const out = path.join(dir, "tmp_pkg.d.ts");
    const code = await runCli(["--package", dir, "--out", out], ROOT);
    expect(code).toBe(0);
    const dts = await readFile(out, "utf8");
    expect(dts).toContain('static readonly typeName: "tmp_pkg/msg/Hi"');
    expect(dts).toContain("export declare const tmp_pkg:");
  });

  test("rejects OMG .idl in a package", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "rosidl-idl-"));
    await mkdir(path.join(dir, "msg"));
    await writeFile(path.join(dir, "msg", "Hi.idl"), "struct Hi { string data; };\n");
    const out = path.join(dir, "out.d.ts");
    const code = await runCli(["--package", dir, "--out", out], ROOT);
    expect(code).toBe(1);
  });
});

describe("rosidl-dts project artifacts", () => {
  test("--check matches --write output", async () => {
    const built = await buildProject(ROOT);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const code = await runCli(["--check"], ROOT);
    // Before the first write this may drift; the generate step in this change
    // commits matching artifacts. A missing file is a hard fail after write.
    expect(code).toBe(0);
  });

  test("npx rcl-web gen prints help and rejects repo --write", async () => {
    const help = await runUserCli([]);
    expect(help).toBe(2);
    const write = await runUserCli(["--write"], ROOT);
    expect(write).toBe(2);
    const dir = await mkdtemp(path.join(tmpdir(), "rcl-web-gen-"));
    await mkdir(path.join(dir, "msg"));
    await writeFile(path.join(dir, "msg", "Status.msg"), "float64 battery\n");
    await writeFile(path.join(dir, "package.xml"), "<package><name>my_interfaces</name></package>\n");
    const out = path.join(dir, "my_interfaces.ts");
    const code = await runUserCli(["gen", "--package", dir, "--out", out], ROOT);
    expect(code).toBe(0);
    const ts = await readFile(out, "utf8");
    expect(ts).toContain("npx rcl-web gen");
    expect(ts).toContain('static readonly typeName = "my_interfaces/msg/Status" as const');
    expect(ts).toContain("export const my_interfaces = {");
    expect(USER_HELP).toContain("npx rcl-web gen --package");
  });
});
