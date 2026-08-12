import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  allocateHeadingSlug,
  checkDocs,
  extractHeadings,
  extractMarkdownLinks,
  githubHeadingSlug,
  isInsideRoot,
  normalizeReferenceLabel,
} from "./docs-check.ts";

const tempRoots: string[] = [];

async function fixtureRoot(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "rclweb-docs-"));
  tempRoots.push(root);
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, body, "utf8");
  }
  return root;
}

afterEach(async () => {
  while (tempRoots.length) {
    const root = tempRoots.pop()!;
    await rm(root, { recursive: true, force: true });
  }
});

const baseAgents = `<!-- PCR:START -->
## Project Context Records
content
<!-- PCR:END -->
`;

const baseDocsReadme = `# Docs

- [Arch](./architecture.md)
`;

const baseAgentsReadme = `# Agents docs

- [Stack](./technology-stack.md)
`;

describe("githubHeadingSlug", () => {
  test("unicode headings", () => {
    expect(githubHeadingSlug("你好 World")).toBe("你好-world");
  });
  test("punctuation stripping", () => {
    expect(githubHeadingSlug("Hello, World!")).toBe("hello-world");
  });
  test("strips underscores and slashes", () => {
    expect(githubHeadingSlug("pin ROS_PREFIX over a host /opt/ros")).toBe(
      "pin-rosprefix-over-a-host-optros",
    );
  });
  test("strips inline HTML tags", () => {
    expect(githubHeadingSlug('Hello <span class="x">World</span>')).toBe("hello-world");
  });
});

describe("allocateHeadingSlug", () => {
  test("Foo, Foo-1, Foo => foo, foo-1, foo-2", () => {
    const used = new Set<string>();
    expect(allocateHeadingSlug(githubHeadingSlug("Foo"), used)).toBe("foo");
    expect(allocateHeadingSlug(githubHeadingSlug("Foo-1"), used)).toBe("foo-1");
    expect(allocateHeadingSlug(githubHeadingSlug("Foo"), used)).toBe("foo-2");
  });
});

describe("extractHeadings", () => {
  test("collision with natural -1 suffix", () => {
    const map = extractHeadings("# Foo\n\n# Foo-1\n\n# Foo\n");
    expect([...map.keys()].sort()).toEqual(["foo", "foo-1", "foo-2"]);
  });
  test("html in heading", () => {
    const map = extractHeadings("# Hello <em>World</em>\n");
    expect(map.has("hello-world")).toBe(true);
  });
});

describe("isInsideRoot", () => {
  test("detects escape", () => {
    const root = "/repo";
    expect(isInsideRoot(root, "/repo/docs/a.md")).toBe(true);
    expect(isInsideRoot(root, "/repo")).toBe(true);
    expect(isInsideRoot(root, "/other/a.md")).toBe(false);
    expect(isInsideRoot(root, "/repo/../other")).toBe(false);
  });
});

describe("extractMarkdownLinks", () => {
  test("ignores fenced code links", () => {
    const md = [
      "See [real](./a.md).",
      "```",
      "[fake](./missing.md)",
      "```",
      "Also [angle](<./b.md>).",
    ].join("\n");
    const links = extractMarkdownLinks(md);
    expect(links.map((l) => l.href)).toEqual(["./a.md", "./b.md"]);
  });

  test("percent-decoded paths stay as written in href", () => {
    const links = extractMarkdownLinks("[x](./foo%20bar.md)");
    expect(links[0].href).toBe("./foo%20bar.md");
  });

  test("reference-style full link yields exactly one link", () => {
    const md = "[Go][target]\n\n[target]: ./page.md\n";
    const links = extractMarkdownLinks(md);
    expect(links).toHaveLength(1);
    expect(links[0].href).toBe("./page.md");
  });

  test("reference label whitespace normalization", () => {
    expect(normalizeReferenceLabel("A   B")).toBe("a b");
    const md = "[Go][A   B]\n\n[a b]: ./page.md\n";
    const links = extractMarkdownLinks(md);
    expect(links).toHaveLength(1);
    expect(links[0].href).toBe("./page.md");
  });

  test("inline and reference images extract destinations", () => {
    const md =
      "![A](./img.png)\n![B][pic]\n\n[pic]: ./other.png\n![Ext](https://example.com/x.png)\n";
    const links = extractMarkdownLinks(md);
    expect(links.map((l) => l.href).sort()).toEqual([
      "./img.png",
      "./other.png",
      "https://example.com/x.png",
    ]);
  });
});

describe("checkDocs", () => {
  test("valid repository", async () => {
    const root = await fixtureRoot({
      "AGENTS.md": baseAgents,
      "docs/README.md": baseDocsReadme,
      "docs/architecture.md": "# Architecture\n\nOk.\n",
      ".agents/docs/README.md": baseAgentsReadme,
      ".agents/docs/technology-stack.md": "# Stack\n\nOk.\n",
    });
    const result = await checkDocs({ root });
    expect(result.ok).toBe(true);
    expect(result.markdownFiles).toBe(5);
    expect(result.pcrMarkers).toBe(2);
  });

  test("skips .pixi markdown", async () => {
    const root = await fixtureRoot({
      "AGENTS.md": baseAgents,
      "docs/README.md": baseDocsReadme,
      "docs/architecture.md": "# Architecture\n\nOk.\n",
      ".agents/docs/README.md": baseAgentsReadme,
      ".agents/docs/technology-stack.md": "# Stack\n\nOk.\n",
      ".pixi/envs/default/share/doc/foo.md": "[Broken](./missing.md)\n",
    });
    const result = await checkDocs({ root });
    expect(result.ok).toBe(true);
    expect(result.markdownFiles).toBe(5);
  });

  test("missing path", async () => {
    const root = await fixtureRoot({
      "AGENTS.md": baseAgents,
      "docs/README.md": "# Docs\n\n[Missing](./nope.md)\n",
      ".agents/docs/README.md": "# Map\n",
    });
    const result = await checkDocs({ root });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.includes("missing path"))).toBe(true);
  });

  test("missing anchor", async () => {
    const root = await fixtureRoot({
      "AGENTS.md": baseAgents,
      "docs/README.md": "# Docs\n\n[A](./a.md#missing)\n",
      "docs/a.md": "# Present\n",
      ".agents/docs/README.md": "# Map\n",
    });
    const result = await checkDocs({ root });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.includes("missing anchor"))).toBe(true);
  });

  test("duplicate heading anchors", async () => {
    const root = await fixtureRoot({
      "AGENTS.md": baseAgents,
      "docs/README.md": "# Docs\n\n[First](./a.md#dup) [Second](./a.md#dup-1)\n",
      "docs/a.md": "# Dup\n\n## Dup\n",
      ".agents/docs/README.md": "# Map\n",
    });
    const result = await checkDocs({ root });
    expect(result.ok).toBe(true);
  });

  test("Foo Foo-1 Foo collision anchors", async () => {
    const root = await fixtureRoot({
      "AGENTS.md": baseAgents,
      "docs/README.md":
        "# Docs\n\n[A](./a.md#foo) [B](./a.md#foo-1) [C](./a.md#foo-2)\n",
      "docs/a.md": "# Foo\n\n# Foo-1\n\n# Foo\n",
      ".agents/docs/README.md": "# Map\n",
    });
    const result = await checkDocs({ root });
    expect(result.ok).toBe(true);
  });

  test("unicode heading anchors", async () => {
    const root = await fixtureRoot({
      "AGENTS.md": baseAgents,
      "docs/README.md": "# Docs\n\n[U](./a.md#标题-alpha)\n",
      "docs/a.md": "# 标题 Alpha\n",
      ".agents/docs/README.md": "# Map\n",
    });
    const result = await checkDocs({ root });
    expect(result.ok).toBe(true);
  });

  test("malformed PCR markers", async () => {
    const root = await fixtureRoot({
      "AGENTS.md": "<!-- PCR:START -->\nonly start\n",
      "docs/README.md": "# Docs\n",
      ".agents/docs/README.md": "# Map\n",
    });
    const result = await checkDocs({ root });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.includes("PCR"))).toBe(true);
  });

  test("duplicate PCR markers", async () => {
    const root = await fixtureRoot({
      "AGENTS.md":
        "<!-- PCR:START -->\na\n<!-- PCR:END -->\n<!-- PCR:START -->\nb\n<!-- PCR:END -->\n",
      "docs/README.md": "# Docs\n",
      ".agents/docs/README.md": "# Map\n",
    });
    const result = await checkDocs({ root });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.includes("PCR"))).toBe(true);
  });

  test("reversed PCR marker order", async () => {
    const root = await fixtureRoot({
      "AGENTS.md": "<!-- PCR:END -->\nbody\n<!-- PCR:START -->\n",
      "docs/README.md": "# Docs\n",
      ".agents/docs/README.md": "# Map\n",
    });
    const result = await checkDocs({ root });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.includes("PCR"))).toBe(true);
  });

  test("unenrolled docs", async () => {
    const root = await fixtureRoot({
      "AGENTS.md": baseAgents,
      "docs/README.md": "# Docs\n",
      "docs/orphan.md": "# Orphan\n",
      ".agents/docs/README.md": "# Map\n",
    });
    const result = await checkDocs({ root });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.includes("unenrolled docs path: docs/orphan.md"))).toBe(
      true,
    );
  });

  test("unenrolled agents docs", async () => {
    const root = await fixtureRoot({
      "AGENTS.md": baseAgents,
      "docs/README.md": "# Docs\n",
      ".agents/docs/README.md": "# Map\n",
      ".agents/docs/orphan.md": "# Orphan\n",
    });
    const result = await checkDocs({ root });
    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.some((d) => d.includes("unenrolled .agents/docs path: .agents/docs/orphan.md")),
    ).toBe(true);
  });

  test("external links are skipped", async () => {
    const root = await fixtureRoot({
      "AGENTS.md": baseAgents,
      "docs/README.md": "# Docs\n\n[Ext](https://example.com/missing)\n[Mail](mailto:a@b.c)\n",
      ".agents/docs/README.md": "# Map\n",
    });
    const result = await checkDocs({ root });
    expect(result.ok).toBe(true);
  });

  test("angle targets and percent-decoded paths", async () => {
    const root = await fixtureRoot({
      "AGENTS.md": baseAgents,
      "docs/README.md":
        "# Docs\n\n[A](<./spaced%20name.md>)\n[B](./spaced%20name.md#section-one)\n",
      "docs/spaced name.md": "# Section One\n",
      ".agents/docs/README.md": "# Map\n",
    });
    const result = await checkDocs({ root });
    expect(result.ok).toBe(true);
  });

  test("same-file fragment", async () => {
    const root = await fixtureRoot({
      "AGENTS.md": baseAgents,
      "docs/README.md": "# Docs\n\n## Details\n\n[Jump](#details)\n",
      ".agents/docs/README.md": "# Map\n",
    });
    const result = await checkDocs({ root });
    expect(result.ok).toBe(true);
  });

  test("link escaping repository root", async () => {
    const root = await fixtureRoot({
      "AGENTS.md": baseAgents,
      "docs/README.md": "# Docs\n\n[Out](../../etc/passwd)\n",
      ".agents/docs/README.md": "# Map\n",
    });
    const result = await checkDocs({ root });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.includes("escapes repository root"))).toBe(true);
  });

  test("reference-style valid and missing", async () => {
    const root = await fixtureRoot({
      "AGENTS.md": baseAgents,
      "docs/README.md":
        "# Docs\n\n[Ok][good]\n[Bad][missing]\n\n[good]: ./architecture.md\n[ext]: https://example.com/x\n[Ext ref][ext]\n",
      "docs/architecture.md": "# Architecture\n",
      ".agents/docs/README.md": "# Map\n",
    });
    const result = await checkDocs({ root });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.includes("missing reference definition [missing]"))).toBe(
      true,
    );
    expect(result.diagnostics.some((d) => d.includes("architecture.md"))).toBe(false);
  });

  test("reference label collapse matches definition", async () => {
    const root = await fixtureRoot({
      "AGENTS.md": baseAgents,
      "docs/README.md": "# Docs\n\n[Go][A   B]\n\n[a b]: ./architecture.md\n",
      "docs/architecture.md": "# Architecture\n",
      ".agents/docs/README.md": "# Map\n",
    });
    const result = await checkDocs({ root });
    expect(result.ok).toBe(true);
  });

  test("valid local image destination", async () => {
    const root = await fixtureRoot({
      "AGENTS.md": baseAgents,
      "docs/README.md": "# Docs\n\n![Diagram](./assets/diagram.png)\n",
      "docs/assets/diagram.png": "fake",
      ".agents/docs/README.md": "# Map\n",
    });
    const result = await checkDocs({ root });
    expect(result.ok).toBe(true);
  });

  test("missing local image destination", async () => {
    const root = await fixtureRoot({
      "AGENTS.md": baseAgents,
      "docs/README.md": "# Docs\n\n![Diagram](./assets/missing.png)\n",
      ".agents/docs/README.md": "# Map\n",
    });
    const result = await checkDocs({ root });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.includes("missing path"))).toBe(true);
  });
});
