import { afterEach, describe, expect, test } from "bun:test";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ARTIFACT_MAX_BYTES,
  ARTIFACT_REL,
  BINARY_MAX_BYTES,
  CORPUS_ID,
  CORPUS_REL,
  FROZEN_SUMMARY,
  MANIFEST_MAX_BYTES,
  MANIFEST_REL,
  asciiCompare,
  buildFromRoot,
  buildTailSlackModel,
  bytesEqual,
  deriveMemberEvidence,
  isAllZero,
  isAllowedZeroTail,
  isFixtureBinaryPath,
  isSafeRelativePath,
  parseCliMode,
  resolveTrustedRelativeFile,
  runCli,
  selectCanonical,
  sha256Hex,
  stableJsonPretty,
  type GroupMember,
  type LoadedFixture,
  type ManifestComparison,
} from "./cdr-tail-slack.ts";

const temps: string[] = [];

afterEach(async () => {
  while (temps.length > 0) {
    const dir = temps.pop()!;
    await rm(dir, { recursive: true, force: true });
  }
});

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "cdr-tail-slack-"));
  temps.push(dir);
  return dir;
}

function fixture(
  id: string,
  case_id: string,
  ros_distro: string,
  support_row_id: string,
  bytes: Uint8Array,
): LoadedFixture {
  return { id, case_id, ros_distro, support_row_id, path: `${id}.bin`, bytes };
}

describe("cdr-tail-slack pure helpers", () => {
  test("CLI mode parsing", () => {
    expect(parseCliMode(["--write"])).toEqual({ mode: "write" });
    expect(parseCliMode(["--check"])).toEqual({ mode: "check" });
    expect(parseCliMode([])).toHaveProperty("error");
    expect(parseCliMode(["--other"])).toHaveProperty("error");
  });

  test("safe relative paths and fixture path containment", () => {
    expect(isSafeRelativePath("fixtures/H-CY/collections.bin")).toBe(true);
    expect(isSafeRelativePath("../etc/passwd")).toBe(false);
    expect(isSafeRelativePath("/abs")).toBe(false);
    expect(isSafeRelativePath("a\\b")).toBe(false);
    expect(isSafeRelativePath("")).toBe(false);
    expect(isSafeRelativePath(".")).toBe(false);
    expect(isSafeRelativePath("fixtures/./x.bin")).toBe(false);
    expect(isSafeRelativePath("fixtures/foo/../bar.bin")).toBe(false);
    expect(isFixtureBinaryPath("fixtures/H-CY/collections.bin")).toBe(true);
    expect(isFixtureBinaryPath("other/H-CY/collections.bin")).toBe(false);
    expect(isFixtureBinaryPath("fixtures")).toBe(false);
  });

  test("selectCanonical prefers shortest then ASCII id", () => {
    const members: GroupMember[] = [
      { id: "Z-long", support_row_id: "Z", bytes: new Uint8Array([1, 2, 3, 0, 0]) },
      { id: "A-short", support_row_id: "A", bytes: new Uint8Array([1, 2, 3]) },
      { id: "B-short", support_row_id: "B", bytes: new Uint8Array([1, 2, 3]) },
    ];
    expect(selectCanonical(members).id).toBe("A-short");
  });

  test("allowed 0/4/12 zero-tail buckets", () => {
    expect(isAllowedZeroTail(0)).toBe(true);
    expect(isAllowedZeroTail(4)).toBe(true);
    expect(isAllowedZeroTail(12)).toBe(true);
    expect(isAllowedZeroTail(8)).toBe(false);
    const prefix = new Uint8Array([0xaa, 0xbb, 0xcc]);
    const exact: GroupMember = {
      id: "CY",
      support_row_id: "CY",
      bytes: prefix,
    };
    const four: GroupMember = {
      id: "FT",
      support_row_id: "FT",
      bytes: new Uint8Array([...prefix, 0, 0, 0, 0]),
    };
    const twelve: GroupMember = {
      id: "ZN",
      support_row_id: "ZN",
      bytes: new Uint8Array([...prefix, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    };
    const canon = selectCanonical([twelve, four, exact]);
    expect(canon.id).toBe("CY");
    expect(deriveMemberEvidence(exact, canon).ok).toBe(true);
    const d4 = deriveMemberEvidence(four, canon);
    expect(d4.ok && d4.zero_tail_bytes).toBe(4);
    const d12 = deriveMemberEvidence(twelve, canon);
    expect(d12.ok && d12.zero_tail_bytes).toBe(12);
  });

  test("8-byte zero suffix is rejected", () => {
    const prefix = new Uint8Array([1, 2, 3]);
    const canon: GroupMember = {
      id: "canon",
      support_row_id: "CY",
      bytes: prefix,
    };
    const eight: GroupMember = {
      id: "eight",
      support_row_id: "FT",
      bytes: new Uint8Array([...prefix, 0, 0, 0, 0, 0, 0, 0, 0]),
    };
    const r = deriveMemberEvidence(eight, canon);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("outside allowed set {0, 4, 12}");
    }
  });

  test("prefix divergence fails", () => {
    const a: GroupMember = {
      id: "a",
      support_row_id: "A",
      bytes: new Uint8Array([1, 2, 3]),
    };
    const b: GroupMember = {
      id: "b",
      support_row_id: "B",
      bytes: new Uint8Array([1, 2, 9, 0]),
    };
    const r = deriveMemberEvidence(b, a);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("prefix diverges");
  });

  test("suffix byte must equal zero", () => {
    const a: GroupMember = {
      id: "a",
      support_row_id: "A",
      bytes: new Uint8Array([1]),
    };
    const b: GroupMember = {
      id: "b",
      support_row_id: "B",
      bytes: new Uint8Array([1, 0, 1, 0]),
    };
    const r = deriveMemberEvidence(b, a);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("suffix byte must equal zero");
  });

  test("bytesEqual and isAllZero", () => {
    expect(bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(bytesEqual(new Uint8Array([1]), new Uint8Array([2]))).toBe(false);
    expect(isAllZero(new Uint8Array([0, 0]))).toBe(true);
    expect(isAllZero(new Uint8Array([0, 1]))).toBe(false);
  });

  test("stable pretty JSON is deterministic and key-sorted", () => {
    const a = stableJsonPretty({ z: 1, a: { d: 2, c: 3 } });
    const b = stableJsonPretty({ a: { c: 3, d: 2 }, z: 1 });
    expect(a).toBe(b);
    expect(a.endsWith("\n")).toBe(true);
    expect(asciiCompare("a", "b")).toBe(-1);
  });
});

describe("cdr-tail-slack model assembly", () => {
  test("comparison row mismatch fails", () => {
    const fixtures = [
      fixture("H-CY-x", "x", "humble", "H-CY", new Uint8Array([1, 2])),
      fixture("H-FT-x", "x", "humble", "H-FT", new Uint8Array([1, 2, 0, 0, 0, 0])),
    ];
    const comparisons: ManifestComparison[] = [
      { case_id: "x", ros_distro: "humble", rows: ["H-CY", "H-ZN"] },
    ];
    const built = buildTailSlackModel(fixtures, comparisons, "ab".repeat(32));
    expect(built.ok).toBe(false);
    if (!built.ok) {
      expect(built.diagnostics.some((d) => d.includes("row set mismatch"))).toBe(
        true,
      );
    }
  });

  test("duplicate comparison identity fails", () => {
    const fixtures = [
      fixture("H-CY-x", "x", "humble", "H-CY", new Uint8Array([1])),
      fixture("H-FT-x", "x", "humble", "H-FT", new Uint8Array([1, 0, 0, 0, 0])),
    ];
    const comparisons: ManifestComparison[] = [
      { case_id: "x", ros_distro: "humble", rows: ["H-CY", "H-FT"] },
      { case_id: "x", ros_distro: "humble", rows: ["H-CY", "H-FT"] },
    ];
    const built = buildTailSlackModel(fixtures, comparisons, "ab".repeat(32));
    expect(built.ok).toBe(false);
    if (!built.ok) {
      expect(
        built.diagnostics.some((d) => d.includes("duplicate comparison identity")),
      ).toBe(true);
    }
  });

  test("duplicate support row in comparison fails", () => {
    const fixtures = [
      fixture("H-CY-x", "x", "humble", "H-CY", new Uint8Array([1])),
      fixture("H-FT-x", "x", "humble", "H-FT", new Uint8Array([1, 0, 0, 0, 0])),
    ];
    const comparisons: ManifestComparison[] = [
      { case_id: "x", ros_distro: "humble", rows: ["H-CY", "H-CY", "H-FT"] },
    ];
    const built = buildTailSlackModel(fixtures, comparisons, "ab".repeat(32));
    expect(built.ok).toBe(false);
    if (!built.ok) {
      expect(
        built.diagnostics.some((d) =>
          d.includes("duplicate support_row_id H-CY in comparison"),
        ),
      ).toBe(true);
    }
  });

  test("duplicate support row in fixture group fails", () => {
    const fixtures = [
      fixture("H-CY-a", "x", "humble", "H-CY", new Uint8Array([1])),
      fixture("H-CY-b", "x", "humble", "H-CY", new Uint8Array([1, 0, 0, 0, 0])),
    ];
    const built = buildTailSlackModel(fixtures, [], "cd".repeat(32));
    expect(built.ok).toBe(false);
    if (!built.ok) {
      expect(
        built.diagnostics.some((d) =>
          d.includes("duplicate support_row_id H-CY in group"),
        ),
      ).toBe(true);
    }
  });

  test("duplicate fixture id fails", () => {
    const fixtures = [
      fixture("dup", "x", "humble", "H-CY", new Uint8Array([1])),
      fixture("dup", "x", "humble", "H-FT", new Uint8Array([1, 0, 0, 0, 0])),
    ];
    const built = buildTailSlackModel(fixtures, [], "cd".repeat(32));
    expect(built.ok).toBe(false);
    if (!built.ok) {
      expect(built.diagnostics.some((d) => d.includes("duplicate fixture id"))).toBe(
        true,
      );
    }
  });

  test("artifact fixture ordering is ASCII by id", () => {
    const fixtures = [
      fixture("H-ZN-x", "x", "humble", "H-ZN", new Uint8Array([9, 0, 0, 0, 0])),
      fixture("H-CY-x", "x", "humble", "H-CY", new Uint8Array([9])),
      fixture("H-FT-x", "x", "humble", "H-FT", new Uint8Array([9, 0, 0, 0, 0])),
    ];
    const comparisons: ManifestComparison[] = [
      { case_id: "x", ros_distro: "humble", rows: ["H-CY", "H-FT", "H-ZN"] },
    ];
    const built = buildTailSlackModel(fixtures, comparisons, "ef".repeat(32));
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.artifact.fixtures.map((f) => f.id)).toEqual([
        "H-CY-x",
        "H-FT-x",
        "H-ZN-x",
      ]);
      const again = stableJsonPretty(built.artifact);
      expect(again).toBe(built.bytes);
    }
  });

  test("multi-row fixture group without comparison fails", () => {
    const fixtures = [
      fixture("H-CY-x", "x", "humble", "H-CY", new Uint8Array([1])),
      fixture("H-FT-x", "x", "humble", "H-FT", new Uint8Array([1, 0, 0, 0, 0])),
    ];
    const built = buildTailSlackModel(fixtures, [], "ab".repeat(32));
    expect(built.ok).toBe(false);
    if (!built.ok) {
      expect(
        built.diagnostics.some((d) =>
          d.includes("fixture group humble/x: missing comparison entry"),
        ),
      ).toBe(true);
    }
  });
});

describe("cdr-tail-slack real corpus", () => {
  test("committed corpus yields frozen 56/18 and exact 24/12/20", async () => {
    const root = process.cwd();
    const built = await buildFromRoot(root);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.artifact.corpus).toBe(CORPUS_ID);
    expect(built.artifact.summary.fixtures).toBe(FROZEN_SUMMARY.fixtures);
    expect(built.artifact.summary.comparisons).toBe(FROZEN_SUMMARY.comparisons);
    expect(built.artifact.summary.exact_fixtures).toBe(
      FROZEN_SUMMARY.exact_fixtures,
    );
    expect(built.artifact.summary.four_byte_tail_fixtures).toBe(
      FROZEN_SUMMARY.four_byte_tail_fixtures,
    );
    expect(built.artifact.summary.twelve_byte_tail_fixtures).toBe(
      FROZEN_SUMMARY.twelve_byte_tail_fixtures,
    );
    const s = built.artifact.summary;
    expect(
      s.exact_fixtures + s.four_byte_tail_fixtures + s.twelve_byte_tail_fixtures,
    ).toBe(s.fixtures);
    expect(built.artifact.source_manifest_sha256).toHaveLength(64);
  });
});

describe("cdr-tail-slack I/O adversarial", () => {
  test("null and non-object manifest roots return diagnostics", async () => {
    const root = await tempRoot();
    await mkdir(path.join(root, CORPUS_REL), { recursive: true });
    await writeFile(path.join(root, MANIFEST_REL), "null");
    const nullRoot = await buildFromRoot(root);
    expect(nullRoot.ok).toBe(false);
    if (!nullRoot.ok) {
      expect(
        nullRoot.diagnostics.some((d) =>
          d.includes("root must be a plain object"),
        ),
      ).toBe(true);
    }
    const nullCode = await runCli(["--check"], root);
    expect(nullCode).toBe(1);

    await writeFile(path.join(root, MANIFEST_REL), "[]");
    const arrayRoot = await buildFromRoot(root);
    expect(arrayRoot.ok).toBe(false);
    if (!arrayRoot.ok) {
      expect(
        arrayRoot.diagnostics.some((d) =>
          d.includes("root must be a plain object"),
        ),
      ).toBe(true);
    }

    await writeFile(path.join(root, MANIFEST_REL), "42");
    const primRoot = await buildFromRoot(root);
    expect(primRoot.ok).toBe(false);
    if (!primRoot.ok) {
      expect(
        primRoot.diagnostics.some((d) =>
          d.includes("root must be a plain object"),
        ),
      ).toBe(true);
    }
  });

  test("fixture directory symlink is rejected", async () => {
    const root = await tempRoot();
    const corpus = path.join(root, CORPUS_REL);
    await mkdir(corpus, { recursive: true });
    const realFix = path.join(root, "real-fixtures");
    await mkdir(realFix, { recursive: true });
    const payload = new Uint8Array([1, 2, 3]);
    const digest = sha256Hex(payload);
    await writeFile(path.join(realFix, "a.bin"), payload);
    await symlink(realFix, path.join(corpus, "fixtures"));
    const manifest = {
      corpus: CORPUS_ID,
      fixtures: [
        {
          id: "sym",
          case_id: "c",
          ros_distro: "humble",
          support_row_id: "H-CY",
          serialized: {
            path: "fixtures/a.bin",
            byte_length: 3,
            sha256: digest,
          },
        },
      ],
      comparisons: [],
    };
    await writeFile(path.join(root, MANIFEST_REL), JSON.stringify(manifest));
    const loaded = await buildFromRoot(root);
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) {
      expect(
        loaded.diagnostics.some((d) => d.includes("symlink rejected")),
      ).toBe(true);
    }
  });

  test("final fixture file symlink is rejected", async () => {
    const root = await tempRoot();
    const corpus = path.join(root, CORPUS_REL);
    const fixDir = path.join(corpus, "fixtures");
    await mkdir(fixDir, { recursive: true });
    const payload = new Uint8Array([1, 2, 3]);
    const digest = sha256Hex(payload);
    const realFile = path.join(root, "real.bin");
    await writeFile(realFile, payload);
    await symlink(realFile, path.join(fixDir, "a.bin"));
    const manifest = {
      corpus: CORPUS_ID,
      fixtures: [
        {
          id: "filesym",
          case_id: "c",
          ros_distro: "humble",
          support_row_id: "H-CY",
          serialized: {
            path: "fixtures/a.bin",
            byte_length: 3,
            sha256: digest,
          },
        },
      ],
      comparisons: [],
    };
    await writeFile(path.join(root, MANIFEST_REL), JSON.stringify(manifest));
    const loaded = await buildFromRoot(root);
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) {
      expect(
        loaded.diagnostics.some((d) => d.includes("symlink rejected")),
      ).toBe(true);
    }
  });

  test("write replaces artifact symlink without following the target", async () => {
    const root = await tempRoot();
    const srcCorpus = path.join(process.cwd(), CORPUS_REL);
    const dstCorpus = path.join(root, CORPUS_REL);
    await mkdir(dstCorpus, { recursive: true });
    await cp(
      path.join(srcCorpus, "manifest.json"),
      path.join(dstCorpus, "manifest.json"),
    );
    await cp(path.join(srcCorpus, "fixtures"), path.join(dstCorpus, "fixtures"), {
      recursive: true,
    });
    const outside = path.join(root, "outside-target.json");
    await writeFile(outside, "sentinel-outside\n", "utf8");
    await symlink(outside, path.join(dstCorpus, "tail-slack.json"));

    const code = await runCli(["--write"], root);
    expect(code).toBe(0);

    const artifactPath = path.join(root, ARTIFACT_REL);
    const st = await lstat(artifactPath);
    expect(st.isSymbolicLink()).toBe(false);
    expect(st.isFile()).toBe(true);
    const body = await readFile(artifactPath, "utf8");
    expect(body.includes('"exact_fixtures": 24')).toBe(true);
    const outsideBody = await readFile(outside, "utf8");
    expect(outsideBody).toBe("sentinel-outside\n");
  });

  test("escaped fixture path and malformed length/SHA fail load", async () => {
    const root = await tempRoot();
    const corpus = path.join(root, CORPUS_REL);
    await mkdir(path.join(corpus, "fixtures"), { recursive: true });
    const payload = new Uint8Array([1, 2, 3]);
    const digest = sha256Hex(payload);
    await writeFile(path.join(corpus, "fixtures", "a.bin"), payload);

    const escapedManifest = {
      corpus: CORPUS_ID,
      fixtures: [
        {
          id: "escaped",
          case_id: "c",
          ros_distro: "humble",
          support_row_id: "H-CY",
          serialized: {
            path: "../escape.bin",
            byte_length: 3,
            sha256: digest,
          },
        },
      ],
      comparisons: [],
    };
    await writeFile(
      path.join(root, MANIFEST_REL),
      JSON.stringify(escapedManifest),
    );
    const escaped = await buildFromRoot(root);
    expect(escaped.ok).toBe(false);
    if (!escaped.ok) {
      expect(
        escaped.diagnostics.some(
          (d) => d.includes("safe relative path under fixtures") || d.includes("unsafe path"),
        ),
      ).toBe(true);
    }

    const lenManifest = {
      corpus: CORPUS_ID,
      fixtures: [
        {
          id: "len",
          case_id: "c",
          ros_distro: "humble",
          support_row_id: "H-CY",
          serialized: {
            path: "fixtures/a.bin",
            byte_length: 1.5,
            sha256: digest,
          },
        },
      ],
      comparisons: [],
    };
    await writeFile(path.join(root, MANIFEST_REL), JSON.stringify(lenManifest));
    const lenFail = await buildFromRoot(root);
    expect(lenFail.ok).toBe(false);
    if (!lenFail.ok) {
      expect(
        lenFail.diagnostics.some((d) =>
          d.includes("byte_length must be a safe nonnegative integer"),
        ),
      ).toBe(true);
    }

    const shaManifest = {
      corpus: CORPUS_ID,
      fixtures: [
        {
          id: "sha",
          case_id: "c",
          ros_distro: "humble",
          support_row_id: "H-CY",
          serialized: {
            path: "fixtures/a.bin",
            byte_length: 3,
            sha256: "ABCDEF" + "0".repeat(58),
          },
        },
      ],
      comparisons: [],
    };
    await writeFile(path.join(root, MANIFEST_REL), JSON.stringify(shaManifest));
    const shaFail = await buildFromRoot(root);
    expect(shaFail.ok).toBe(false);
    if (!shaFail.ok) {
      expect(
        shaFail.diagnostics.some((d) =>
          d.includes("sha256 must be lowercase 64-hex"),
        ),
      ).toBe(true);
    }

    const mismatchManifest = {
      corpus: CORPUS_ID,
      fixtures: [
        {
          id: "sha-disk",
          case_id: "c",
          ros_distro: "humble",
          support_row_id: "H-CY",
          serialized: {
            path: "fixtures/a.bin",
            byte_length: 3,
            sha256: "00".repeat(32),
          },
        },
      ],
      comparisons: [],
    };
    await writeFile(
      path.join(root, MANIFEST_REL),
      JSON.stringify(mismatchManifest),
    );
    const diskSha = await buildFromRoot(root);
    expect(diskSha.ok).toBe(false);
    if (!diskSha.ok) {
      expect(diskSha.diagnostics.some((d) => d.includes("sha256 mismatch"))).toBe(
        true,
      );
    }
  });

  test("sparse oversized binary is rejected before content load", async () => {
    const root = await tempRoot();
    const corpus = path.join(root, CORPUS_REL);
    const fixDir = path.join(corpus, "fixtures");
    await mkdir(fixDir, { recursive: true });
    const oversizePath = path.join(fixDir, "huge.bin");
    await writeFile(oversizePath, new Uint8Array(0));
    await truncate(oversizePath, BINARY_MAX_BYTES + 1);
    const manifest = {
      corpus: CORPUS_ID,
      fixtures: [
        {
          id: "huge",
          case_id: "c",
          ros_distro: "humble",
          support_row_id: "H-CY",
          serialized: {
            path: "fixtures/huge.bin",
            byte_length: BINARY_MAX_BYTES + 1,
            sha256: "00".repeat(32),
          },
        },
      ],
      comparisons: [],
    };
    await writeFile(path.join(root, MANIFEST_REL), JSON.stringify(manifest));
    const loaded = await buildFromRoot(root);
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) {
      expect(
        loaded.diagnostics.some(
          (d) =>
            d.includes(`exceeds max ${BINARY_MAX_BYTES}`) ||
            d.includes("byte_length"),
        ),
      ).toBe(true);
    }
  });

  test("declared byte_length above binary ceiling is rejected without reading", async () => {
    const root = await tempRoot();
    const corpus = path.join(root, CORPUS_REL);
    const fixDir = path.join(corpus, "fixtures");
    await mkdir(fixDir, { recursive: true });
    // Tiny on-disk file; declared length alone must fail before open.
    await writeFile(path.join(fixDir, "tiny.bin"), new Uint8Array([1]));
    const manifest = {
      corpus: CORPUS_ID,
      fixtures: [
        {
          id: "declared-huge",
          case_id: "c",
          ros_distro: "humble",
          support_row_id: "H-CY",
          serialized: {
            path: "fixtures/tiny.bin",
            byte_length: BINARY_MAX_BYTES + 64,
            sha256: "00".repeat(32),
          },
        },
      ],
      comparisons: [],
    };
    await writeFile(path.join(root, MANIFEST_REL), JSON.stringify(manifest));
    const loaded = await buildFromRoot(root);
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) {
      expect(
        loaded.diagnostics.some((d) =>
          d.includes(`byte_length ${BINARY_MAX_BYTES + 64} exceeds max ${BINARY_MAX_BYTES}`),
        ),
      ).toBe(true);
    }
  });

  test("sparse oversized manifest is rejected by maxBytes before parse", async () => {
    const root = await tempRoot();
    await mkdir(path.join(root, CORPUS_REL), { recursive: true });
    const manPath = path.join(root, MANIFEST_REL);
    await writeFile(manPath, new Uint8Array(0));
    await truncate(manPath, MANIFEST_MAX_BYTES + 1);
    const result = await resolveTrustedRelativeFile(root, MANIFEST_REL, {
      maxBytes: MANIFEST_MAX_BYTES,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/exceeds max/);
    }
    const built = await buildFromRoot(root);
    expect(built.ok).toBe(false);
    if (!built.ok) {
      expect(built.diagnostics.some((d) => d.includes("exceeds max"))).toBe(true);
    }
  });

  test("frozen ceilings are the documented production bounds", () => {
    expect(MANIFEST_MAX_BYTES).toBe(2 * 1024 * 1024);
    expect(ARTIFACT_MAX_BYTES).toBe(2 * 1024 * 1024);
    expect(BINARY_MAX_BYTES).toBe(64 * 1024 * 1024);
  });

  test("CLI check accepts then rejects drifted artifact with production invariants", async () => {
    const root = await tempRoot();
    const srcCorpus = path.join(process.cwd(), CORPUS_REL);
    const dstCorpus = path.join(root, CORPUS_REL);
    await mkdir(dstCorpus, { recursive: true });
    await cp(
      path.join(srcCorpus, "manifest.json"),
      path.join(dstCorpus, "manifest.json"),
    );
    await cp(path.join(srcCorpus, "fixtures"), path.join(dstCorpus, "fixtures"), {
      recursive: true,
    });
    await cp(
      path.join(srcCorpus, "tail-slack.json"),
      path.join(dstCorpus, "tail-slack.json"),
    );

    const okCode = await runCli(["--check"], root);
    expect(okCode).toBe(0);

    const artifactPath = path.join(root, ARTIFACT_REL);
    const original = await Bun.file(artifactPath).text();
    const drifted = original.replace(
      `"exact_fixtures": ${FROZEN_SUMMARY.exact_fixtures}`,
      `"exact_fixtures": 0`,
    );
    expect(drifted === original).toBe(false);
    await writeFile(artifactPath, drifted, "utf8");

    const failCode = await runCli(["--check"], root);
    expect(failCode).toBe(1);
  });
});
