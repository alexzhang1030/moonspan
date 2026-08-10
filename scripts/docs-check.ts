#!/usr/bin/env bun
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

export type DocsCheckOptions = {
  root: string;
};

export type DocsCheckResult = {
  ok: boolean;
  diagnostics: string[];
  markdownFiles: number;
  localLinks: number;
  anchors: number;
  pcrMarkers: number;
  enrolledDocs: number;
  enrolledAgentsDocs: number;
};

const SKIP_DIR_NAMES = new Set([
  ".git",
  "node_modules",
  ".bun",
  "dist",
  "build",
  "out",
  "coverage",
  "reports",
  "report",
  "tmp",
  "temp",
  ".turbo",
  ".next",
  "target",
]);

const URI_SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/** Normalize heading text to a GitHub-style base slug (no uniqueness). */
export function githubHeadingSlug(text: string): string {
  const plain = text
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
    .replace(/\[([^\]]+)\]/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/[*_~]+/g, "")
    .trim();
  return plain
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s-]/gu, "")
    .trim()
    .replace(/[\s]+/g, "-");
}

/**
 * Allocate a unique slug given already-used slugs (GitHub behavior).
 * "# Foo", "# Foo-1", "# Foo" => foo, foo-1, foo-2
 */
export function allocateHeadingSlug(base: string, used: Set<string>): string {
  if (!base) return base;
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let n = 1;
  while (used.has(`${base}-${n}`)) n += 1;
  const slug = `${base}-${n}`;
  used.add(slug);
  return slug;
}

function stripFencedCodeBlocks(content: string): string {
  const lines = content.split(/\r?\n/);
  const out: string[] = [];
  let inFence = false;
  let fenceChar = "";
  let fenceLen = 0;
  for (const line of lines) {
    const m = line.match(/^(\s{0,3})([`~]{3,})(.*)$/);
    if (!inFence && m) {
      inFence = true;
      fenceChar = m[2][0];
      fenceLen = m[2].length;
      out.push("");
      continue;
    }
    if (inFence && m && m[2][0] === fenceChar && m[2].length >= fenceLen && m[3].trim() === "") {
      inFence = false;
      fenceChar = "";
      fenceLen = 0;
      out.push("");
      continue;
    }
    if (inFence) {
      out.push("");
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

export type ExtractedLink = {
  raw: string;
  href: string;
  line: number;
};

function parseAngleOrBare(target: string): string {
  let href = target.trim();
  if (href.startsWith("<") && href.endsWith(">")) {
    href = href.slice(1, -1).trim();
  }
  // strip optional title
  const titled = href.match(/^(\S+)\s+(".*"|'.*'|\(.*\))$/);
  if (titled) href = titled[1];
  return href.trim();
}

/** CommonMark reference label: trim, collapse ASCII whitespace, lowercase. */
export function normalizeReferenceLabel(label: string): string {
  return label.trim().replace(/[ \t\n\r]+/g, " ").toLowerCase();
}

export function extractReferenceDefinitions(content: string): Map<string, string> {
  const stripped = stripFencedCodeBlocks(content);
  const defs = new Map<string, string>();
  const lines = stripped.split(/\r?\n/);
  // [id]: url or [id]: <url>
  const re = /^ {0,3}\[([^\]]+)\]:\s*(\S+.*)$/;
  for (const line of lines) {
    const m = line.match(re);
    if (!m) continue;
    const id = normalizeReferenceLabel(m[1]);
    const rest = m[2].trim();
    // optional title after URL
    const parts = rest.match(/^(<[^>]+>|\S+)(?:\s+(".*"|'.*'|\(.*\)))?\s*$/);
    const target = parts ? parts[1] : rest.split(/\s+/)[0];
    defs.set(id, parseAngleOrBare(target));
  }
  return defs;
}

type Span = { start: number; end: number };

function overlaps(span: Span, used: Span[]): boolean {
  return used.some((u) => span.start < u.end && span.end > u.start);
}

export function extractMarkdownLinks(content: string): ExtractedLink[] {
  const stripped = stripFencedCodeBlocks(content);
  const lines = stripped.split(/\r?\n/);
  const defs = extractReferenceDefinitions(content);
  const links: ExtractedLink[] = [];

  // Inline link/image: optional ! then [text](url)
  const inlineRe = /(!)?\[([^\]]*)\]\(\s*(<[^>]+>|[^)\s]+)(?:\s+"[^"]*")?\s*\)/g;
  // Full/collapsed reference link/image: [text][id] or [text][]
  const refRe = /(!)?\[([^\]]+)\]\[([^\]]*)\]/g;
  // Shortcut reference link/image: [text] not followed by ( or [
  const shortcutRe = /(!)?\[([^\]]+)\](?!\(|\[)/g;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // skip pure definition lines
    if (/^ {0,3}\[[^\]]+\]:/.test(line)) continue;

    const used: Span[] = [];

    const take = (re: RegExp, kind: "inline" | "ref" | "shortcut") => {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(line)) !== null) {
        const start = m.index;
        const end = m.index + m[0].length;
        if (overlaps({ start, end }, used)) continue;
        used.push({ start, end });

        if (kind === "inline") {
          links.push({ raw: m[0], href: parseAngleOrBare(m[3]), line: i + 1 });
          continue;
        }
        if (kind === "ref") {
          const text = m[2];
          const id = normalizeReferenceLabel(m[3] || text);
          const href = defs.get(id);
          links.push({
            raw: m[0],
            href: href === undefined ? `__missing_ref__:${id}` : href,
            line: i + 1,
          });
          continue;
        }
        // shortcut
        const id = normalizeReferenceLabel(m[2]);
        if (!defs.has(id)) continue;
        links.push({ raw: m[0], href: defs.get(id)!, line: i + 1 });
      }
    };

    // Order: full inline and full reference first so their labels are consumed
    take(inlineRe, "inline");
    take(refRe, "ref");
    take(shortcutRe, "shortcut");
  }
  return links;
}

export function extractHeadings(content: string): Map<string, number> {
  const used = new Set<string>();
  const valid = new Map<string, number>();
  const lines = content.split(/\r?\n/);
  let inFence = false;
  let fenceChar = "";
  let fenceLen = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fm = line.match(/^(\s{0,3})([`~]{3,})(.*)$/);
    if (!inFence && fm) {
      inFence = true;
      fenceChar = fm[2][0];
      fenceLen = fm[2].length;
      continue;
    }
    if (inFence && fm && fm[2][0] === fenceChar && fm[2].length >= fenceLen && fm[3].trim() === "") {
      inFence = false;
      continue;
    }
    if (inFence) continue;

    const atx = line.match(/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (atx) {
      const base = githubHeadingSlug(atx[2]);
      if (!base) continue;
      const slug = allocateHeadingSlug(base, used);
      valid.set(slug, i + 1);
      continue;
    }
    if (i + 1 < lines.length) {
      const next = lines[i + 1];
      if (/^ {0,3}=+\s*$/.test(next) || /^ {0,3}-+\s*$/.test(next)) {
        if (line.trim() && !line.startsWith("#")) {
          const base = githubHeadingSlug(line);
          if (base) {
            const slug = allocateHeadingSlug(base, used);
            valid.set(slug, i + 1);
          }
        }
      }
    }
  }
  return valid;
}

async function listMarkdownFiles(root: string): Promise<string[]> {
  const results: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const name = ent.name;
      const full = path.join(dir, name);
      if (ent.isDirectory()) {
        if (SKIP_DIR_NAMES.has(name)) continue;
        await walk(full);
      } else if (ent.isFile() && name.endsWith(".md")) {
        results.push(full);
      }
    }
  }
  await walk(root);
  results.sort((a, b) => a.localeCompare(b));
  return results;
}

function isExternalHref(href: string): boolean {
  if (href.startsWith("#")) return false;
  if (href.startsWith("__missing_ref__:")) return false;
  if (URI_SCHEME_RE.test(href)) return true;
  return false;
}

function splitHref(href: string): { pathPart: string; fragment: string | null } {
  const hash = href.indexOf("#");
  if (hash === -1) return { pathPart: href, fragment: null };
  return { pathPart: href.slice(0, hash), fragment: href.slice(hash + 1) };
}

function safeDecode(p: string): string {
  try {
    return decodeURIComponent(p);
  } catch {
    return p;
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

function relPosix(fromRoot: string, abs: string): string {
  return path.relative(fromRoot, abs).split(path.sep).join("/");
}

/** True when abs is root or a path inside root. */
export function isInsideRoot(root: string, abs: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedAbs = path.resolve(abs);
  const rel = path.relative(resolvedRoot, resolvedAbs);
  return rel === "" || (!rel.startsWith(`..${path.sep}`) && rel !== ".." && !path.isAbsolute(rel));
}

export async function checkDocs(options: DocsCheckOptions): Promise<DocsCheckResult> {
  const root = path.resolve(options.root);
  const diagnostics: string[] = [];
  const markdownAbs = await listMarkdownFiles(root);
  const markdownFiles = markdownAbs.length;

  const contentByAbs = new Map<string, string>();
  const headingsByAbs = new Map<string, Map<string, number>>();

  for (const abs of markdownAbs) {
    const content = await readFile(abs, "utf8");
    contentByAbs.set(abs, content);
    headingsByAbs.set(abs, extractHeadings(content));
  }

  let localLinks = 0;
  let anchors = 0;

  for (const abs of markdownAbs) {
    const content = contentByAbs.get(abs)!;
    const links = extractMarkdownLinks(content);
    const fileRel = relPosix(root, abs);
    for (const link of links) {
      const href = link.href;
      if (!href) continue;
      if (href.startsWith("__missing_ref__:")) {
        const id = href.slice("__missing_ref__:".length);
        diagnostics.push(`${fileRel}:${link.line}: missing reference definition [${id}]`);
        continue;
      }
      if (href.startsWith("mailto:") || isExternalHref(href)) {
        continue;
      }
      const { pathPart: rawPath, fragment } = splitHref(href);
      const pathPart = safeDecode(rawPath);

      let targetAbs: string;
      if (pathPart === "" || pathPart === ".") {
        targetAbs = abs;
      } else {
        targetAbs = path.resolve(path.dirname(abs), pathPart);
        localLinks += 1;
        if (!isInsideRoot(root, targetAbs)) {
          diagnostics.push(`${fileRel}:${link.line}: link escapes repository root ${href}`);
          continue;
        }
        if (!(await pathExists(targetAbs))) {
          diagnostics.push(`${fileRel}:${link.line}: missing path ${href}`);
          continue;
        }
      }

      if (fragment !== null && fragment !== "") {
        anchors += 1;
        const decodedFrag = safeDecode(fragment);
        if (targetAbs.endsWith(".md")) {
          let headings = headingsByAbs.get(targetAbs);
          if (!headings) {
            try {
              const c = await readFile(targetAbs, "utf8");
              headings = extractHeadings(c);
              headingsByAbs.set(targetAbs, headings);
            } catch {
              diagnostics.push(
                `${fileRel}:${link.line}: missing anchor target file for ${href}`,
              );
              continue;
            }
          }
          if (!headings.has(decodedFrag)) {
            diagnostics.push(
              `${fileRel}:${link.line}: missing anchor #${decodedFrag} in ${relPosix(root, targetAbs)}`,
            );
          }
        }
      }
    }
  }

  let pcrMarkers = 0;
  const agentsPath = path.join(root, "AGENTS.md");
  if (await pathExists(agentsPath)) {
    const agents = await readFile(agentsPath, "utf8");
    const starts = [...agents.matchAll(/<!--\s*PCR:START\s*-->/g)];
    const ends = [...agents.matchAll(/<!--\s*PCR:END\s*-->/g)];
    if (starts.length === 1 && ends.length === 1 && (starts[0].index ?? 0) < (ends[0].index ?? 0)) {
      pcrMarkers = 2;
    } else {
      diagnostics.push(
        `AGENTS.md: expected exactly one ordered <!-- PCR:START --> / <!-- PCR:END --> pair (found start=${starts.length}, end=${ends.length})`,
      );
    }
  } else {
    diagnostics.push("AGENTS.md: missing file for PCR marker validation");
  }

  async function collectReachable(entryRel: string, treePrefix: string): Promise<Set<string>> {
    const entryAbs = path.join(root, entryRel);
    const reachable = new Set<string>();
    if (!(await pathExists(entryAbs))) {
      diagnostics.push(`${entryRel}: enrollment entry missing`);
      return reachable;
    }
    const queue: string[] = [entryAbs];
    const seen = new Set<string>();
    while (queue.length) {
      const cur = queue.shift()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      const rel = relPosix(root, cur);
      if (rel === treePrefix || rel.startsWith(treePrefix + "/")) {
        if (rel.endsWith(".md")) reachable.add(rel);
      }
      const content = contentByAbs.get(cur) ?? (await readFile(cur, "utf8").catch(() => ""));
      if (!content) continue;
      for (const link of extractMarkdownLinks(content)) {
        if (link.href.startsWith("__missing_ref__:")) continue;
        if (isExternalHref(link.href) || link.href.startsWith("mailto:")) continue;
        const { pathPart: rawPath } = splitHref(link.href);
        if (!rawPath || rawPath === ".") continue;
        const decoded = safeDecode(rawPath);
        const target = path.resolve(path.dirname(cur), decoded);
        if (!isInsideRoot(root, target)) continue;
        const tRel = relPosix(root, target);
        if (!(tRel === treePrefix || tRel.startsWith(treePrefix + "/"))) continue;
        if (!tRel.endsWith(".md")) continue;
        if (!(await pathExists(target))) continue;
        queue.push(target);
      }
    }
    return reachable;
  }

  const docsTree = markdownAbs
    .map((a) => relPosix(root, a))
    .filter((r) => r === "docs" || r.startsWith("docs/"));
  const agentsTree = markdownAbs
    .map((a) => relPosix(root, a))
    .filter((r) => r === ".agents/docs" || r.startsWith(".agents/docs/"));

  const docsReachable = await collectReachable("docs/README.md", "docs");
  const agentsReachable = await collectReachable(".agents/docs/README.md", ".agents/docs");

  for (const f of docsTree) {
    if (!docsReachable.has(f)) diagnostics.push(`unenrolled docs path: ${f}`);
  }
  for (const f of agentsTree) {
    if (!agentsReachable.has(f)) diagnostics.push(`unenrolled .agents/docs path: ${f}`);
  }

  diagnostics.sort((a, b) => a.localeCompare(b));

  return {
    ok: diagnostics.length === 0,
    diagnostics,
    markdownFiles,
    localLinks,
    anchors,
    pcrMarkers,
    enrolledDocs: docsReachable.size,
    enrolledAgentsDocs: agentsReachable.size,
  };
}

export function formatSummary(result: DocsCheckResult): string {
  return [
    `markdown_files=${result.markdownFiles}`,
    `local_links=${result.localLinks}`,
    `anchors=${result.anchors}`,
    `pcr_markers=${result.pcrMarkers}`,
    `enrolled_docs=${result.enrolledDocs}`,
    `enrolled_agents_docs=${result.enrolledAgentsDocs}`,
    result.ok ? "status=ok" : `status=fail diagnostics=${result.diagnostics.length}`,
  ].join(" ");
}

async function main(): Promise<void> {
  const root = process.cwd();
  const result = await checkDocs({ root });
  for (const d of result.diagnostics) {
    console.error(d);
  }
  console.log(formatSummary(result));
  if (!result.ok) process.exit(1);
}

if (import.meta.main) {
  await main();
}
