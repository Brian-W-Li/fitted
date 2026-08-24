/**
 * Repo-hygiene checks — docs/plans/maintainability.md §5.
 *
 * Two channels. ENFORCED checks (9, 10, 11, 13, 14, 15, 12b) assert a fact about truth
 * or location as a ratchet against fitted/tests/repoHygiene.baseline.json: red means
 * something got WORSE than the seeded baseline, never "the campaign is unfinished" (D4).
 * PRINTED checks (1–7, 12a, and 8 until S4a promotes it) report size and shape with
 * direction of travel and never fail.
 *
 * Runs as the `hygiene` jest project via `npm run hygiene` — deliberately outside
 * `npm test` (see jest.config.js). A session that improves a number lowers its baseline
 * in the same commit; raising one is legal but is a one-line diff a reviewer can watch.
 */
import { execFileSync, spawnSync } from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

// Check 15 runs real child suites (~11s warm); the project config cannot carry a
// testTimeout (invalid at project level in jest 29), so the override lives here. The
// spawnSync timeouts below are the real hang guard: they kill a wedged child so the
// check goes RED (fail closed) instead of outliving the Stop hook's timeout, which
// would kill the hook and silently fail OPEN.
jest.setTimeout(240000);

const ROOT = path.resolve(__dirname, "..", "..", "..");
const BASELINE_PATH = path.join(ROOT, "fitted", "tests", "repoHygiene.baseline.json");
const SPEC = "docs/Fitted_Spec_v2.md";
const PLAN = "docs/plans/maintainability.md";

interface Baseline {
  enforced: {
    check9_docCiteMissingPath: number;
    check11_sha256: Record<string, string>;
    check13_anchor: string;
    check14_volatileMarkers: number;
    check15_suiteFloors: { jest: number; pytest: number; experimentsCollected: number };
  };
  printed: {
    landing: Record<string, number>;
    targets: Record<string, number | null>;
  };
}
const baseline: Baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));

// ------------------------------------------------------------------ plumbing

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64e6 });
}

function trackedFiles(): string[] {
  return git("ls-files").split("\n").filter(Boolean);
}

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function bytesOf(rel: string): number {
  return fs.statSync(path.join(ROOT, rel)).size;
}

/** Tracked *.md, excluding team/ + meetings/ — the exclusion is part of the check
 * definitions (§5 check 1): unfiltered is ~60% higher and makes figures unfalsifiable. */
function trackedMd(): string[] {
  return trackedFiles().filter((f) => f.endsWith(".md") && !/^(team|meetings)\//.test(f));
}

// --------------------------------------------------------- citation scanning

// Path-shaped cites only: tokens rooted at a known top-level dir. Prose-form
// cross-references ("recovered appendix C.4") are invisible to this check by design —
// documented in §5 check 9 and D5. Regexes are built from strings so the PATTERNS add
// no matchable literals — but this file (and jest.config.js, hygiene-guard.sh,
// state.sh) deliberately cites docs/plans/maintainability.md in comments and the PLAN
// const, and check 10 scans this file too. Those cites resolve today; at S6, when the
// plan is deleted, they must be scrubbed in the same commit or check 10 goes red — the
// obligation is recorded in the plan's §7.3 S6 entry.
const CITE_PREFIXES = "(?:docs|fitted|ml-system|\\.claude|\\.github)";
const CITE_RE = new RegExp(
  "(?<![\\w./-])(" + CITE_PREFIXES + "\\/[A-Za-z0-9_][A-Za-z0-9_\\/.-]*\\.[A-Za-z0-9]+)",
  "g"
);

/** check 9: (doc, cited-path) pairs where the cited path does not exist. A cite resolves
 * against the repo root, or against the citing file's own directory (fitted/README.md
 * legitimately cites docs/database.md meaning fitted/docs/database.md). */
function docCiteMissing(): string[] {
  const out: string[] = [];
  for (const f of trackedMd()) {
    const seen = new Set<string>();
    for (const m of read(f).matchAll(CITE_RE)) {
      const cite = m[1];
      if (seen.has(cite)) continue;
      seen.add(cite);
      const ok =
        fs.existsSync(path.join(ROOT, cite)) ||
        fs.existsSync(path.join(ROOT, path.dirname(f), cite));
      if (!ok) out.push(`${f} -> ${cite}`);
    }
  }
  return out.sort();
}

const SOURCE_RE = /\.(ts|tsx|js|mjs|cjs|py|sh)$/;
const DOC_CITE_RE = new RegExp(
  "(?<![\\w./-])((?:fitted\\/)?docs\\/[A-Za-z0-9_][A-Za-z0-9_\\/.-]*\\.md)",
  "g"
);

/** check 10: source files citing a doc that does not exist. A cite resolves if it exists
 * relative to the repo root OR to fitted/ (source under fitted/ may cite fitted/docs
 * root-relatively). Target 0 — not ratcheted (§5 / D4). */
function sourceCiteMissing(): string[] {
  const out: string[] = [];
  for (const f of trackedFiles().filter((p) => SOURCE_RE.test(p))) {
    const seen = new Set<string>();
    for (const m of read(f).matchAll(DOC_CITE_RE)) {
      const cite = m[1];
      if (seen.has(cite)) continue;
      seen.add(cite);
      const ok =
        fs.existsSync(path.join(ROOT, cite)) || fs.existsSync(path.join(ROOT, "fitted", cite));
      if (!ok) out.push(`${f} -> ${cite}`);
    }
  }
  return out.sort();
}

// ------------------------------------------------------------- sha256 pins

function sha256(rel: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, rel))).digest("hex");
}

/** check 11: every pinned file exists byte-identical, and every preregistration file is
 * pinned (a new freeze must add its pin in the same commit). The pin set is wider than
 * the plan's glob where a preregistration's own freeze-set sentence names more files —
 * track2_transfer names derive_power.py + power_derivation.json as frozen artifacts. */
function pinViolations(): string[] {
  const out: string[] = [];
  const pins = baseline.enforced.check11_sha256;
  for (const [rel, expected] of Object.entries(pins)) {
    if (!fs.existsSync(path.join(ROOT, rel))) out.push(`pinned file missing: ${rel}`);
    else if (sha256(rel) !== expected) out.push(`pinned file MODIFIED: ${rel}`);
  }
  const prereg = trackedFiles().filter((f) =>
    /^ml-system\/experiments\/[^/]+\/preregistration\.[^/]+$/.test(f)
  );
  for (const f of prereg) if (!(f in pins)) out.push(`preregistration file not pinned: ${f}`);
  return out;
}

// ------------------------------------------------- EXTRACTED blocks (check 13)

function existsAtCommit(sha: string, rel: string): boolean {
  try {
    execFileSync("git", ["cat-file", "-e", `${sha}:${rel}`], { cwd: ROOT, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function grepTestsAtCommit(sha: string, needle: string): boolean {
  try {
    const hits = execFileSync(
      "git",
      ["grep", "-l", "-F", needle, sha, "--", "fitted/tests", "ml-system/tests", "ml-system/service/tests", "ml-system/experiments"],
      { cwd: ROOT, encoding: "utf8" }
    );
    return hits.trim().length > 0;
  } catch {
    return false;
  }
}

/** check 13 + the DROPPED cost meter. Every commit since the anchor that deletes a
 * tracked *.md must carry, per deleted file, an `EXTRACTED <path>` block whose
 * destinations resolve AT THAT COMMIT and whose DROPPED: is an integer. `test:` names
 * resolve by literal grep over the test trees at that commit — an approximation of "is
 * collected by a suite", chosen because running real collection per historical commit is
 * not practical; it still defeats the fabricated-destination failure mode. Merge commits
 * are scanned with the default (combined) diff, which normally reports no deletions —
 * deletions must land on first-parent commits. `-M` is load-bearing: without it a pure
 * rename (`git mv`, the campaign's own re-homing operation) reports as D and would
 * demand a semantically wrong EXTRACTED block — proven against the real re-home commit
 * 395f937e, which moved one *.md and deleted another; only the true deletion may trip. */
function extractedScan(): { violations: string[]; droppedTotal: number } {
  const violations: string[] = [];
  let droppedTotal = 0;
  const anchor = baseline.enforced.check13_anchor;
  const commits = git("rev-list", `${anchor}..HEAD`).split("\n").filter(Boolean);
  for (const sha of commits) {
    const deleted = git(
      "diff-tree", "-M", "--no-commit-id", "--name-only", "--diff-filter=D", "-r", sha, "--", "*.md"
    ).split("\n").filter(Boolean);
    if (deleted.length === 0) continue;
    const short = sha.slice(0, 8);
    const lines = git("log", "-1", "--format=%B", sha).split("\n");
    for (const p of deleted) {
      const idx = lines.findIndex((l) => l.trim() === `EXTRACTED ${p}`);
      if (idx < 0) {
        violations.push(`${short}: deletes ${p} without an "EXTRACTED ${p}" block`);
        continue;
      }
      const block: string[] = [];
      for (let i = idx + 1; i < lines.length && !lines[i].trim().startsWith("EXTRACTED "); i++) {
        block.push(lines[i]);
      }
      let hasDropped = false;
      for (const l of block) {
        const m = l.trim().match(/^(code|spec|test|DROPPED):\s*(.*)$/);
        if (!m) continue;
        const kind = m[1];
        const val = m[2].trim();
        if (kind === "DROPPED") {
          hasDropped = true;
          if (!/^\d+$/.test(val)) violations.push(`${short} ${p}: DROPPED not an integer: "${val}"`);
          else droppedTotal += parseInt(val, 10);
        } else if (kind === "code") {
          for (const dest of val.split(/\s+/).filter(Boolean)) {
            if (!existsAtCommit(sha, dest)) violations.push(`${short} ${p}: code dest missing: ${dest}`);
          }
        } else if (kind === "spec") {
          let spec = "";
          try {
            spec = git("show", `${sha}:${SPEC}`);
          } catch {
            /* spec absent at that commit */
          }
          if (!val || !spec.includes(val)) violations.push(`${short} ${p}: spec dest unresolved: "${val}"`);
        } else if (kind === "test") {
          if (!val || !grepTestsAtCommit(sha, val)) violations.push(`${short} ${p}: test dest unresolved: "${val}"`);
        }
      }
      if (!hasDropped) violations.push(`${short} ${p}: no DROPPED: line`);
    }
  }
  return { violations, droppedTotal };
}

// --------------------------------------------------- volatile markers (check 14)

/** A plan's "status banner" is its blockquote lines before the first `## ` heading
 * (a file with no `## ` heading is all banner). The marker classes, not any heading
 * name, are the target — §5 check 14: a heading ban is evadable by renaming and
 * over-broad against the durable arc. */
function planBanner(text: string): string {
  const out: string[] = [];
  for (const l of text.split("\n")) {
    if (/^## /.test(l)) break;
    if (/^>/.test(l)) out.push(l);
  }
  return out.join("\n");
}

const SHA_RE = /\b[0-9a-f]{8,40}\b/g;
const SUITE_A = /(?:≥|>=)?\s?\d[\d,]*(?:\s*\(\+\d+\s*skip\))?\s+(?:experiments\s+)?(?:pytest|jest)\b/gi;
const SUITE_B = /\b(?:pytest|jest)\s+(?:floors?\s+)?(?:≥|>=)?\s?\d[\d,]*/gi;
const STATUS_LINE = /^\s*(?:[>#*-]\s*)*(?:\*\*)?\s*(?:Remaining|Now|Next|next)\s*(?:\*\*)?\s*:/;
const ISO_DATE = /\b20\d{2}-\d{2}-\d{2}\b/g;

function volatileMarkers(scope: string, text: string): string[] {
  const hits: string[] = [];
  for (const m of text.match(SHA_RE) ?? []) {
    if (/\d/.test(m) && /[a-f]/.test(m)) hits.push(`${scope}: commit-sha "${m}"`);
  }
  for (const m of text.match(/✅/g) ?? []) hits.push(`${scope}: ${m}`);
  for (const l of text.split("\n")) {
    if (STATUS_LINE.test(l)) hits.push(`${scope}: status line "${l.trim().slice(0, 60)}"`);
  }
  for (const m of text.match(SUITE_A) ?? []) hits.push(`${scope}: bare suite count "${m.trim()}"`);
  for (const m of text.match(SUITE_B) ?? []) hits.push(`${scope}: bare suite count "${m.trim()}"`);
  for (const m of text.match(ISO_DATE) ?? []) hits.push(`${scope}: ISO date as status "${m}"`);
  return hits;
}

function allVolatileMarkers(): string[] {
  const hits = volatileMarkers("CLAUDE.md", read("CLAUDE.md"));
  for (const f of trackedMd().filter((p) => /^docs\/plans\/[^/]+\.md$/.test(p))) {
    const banner = planBanner(read(f));
    if (banner) hits.push(...volatileMarkers(`${f} (banner)`, banner));
  }
  return hits;
}

// ------------------------------------------------------- suite counts (check 15)

function run(cmd: string, args: string[], cwd: string): string {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 64e6, timeout: 120000 });
  if (r.error) throw new Error(`child suite run failed to complete (${cmd} ${args.join(" ")}): ${r.error.message}`);
  return `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
}

// Both runners return the raw summary line alongside the count so a floor miss can be
// told apart from a child-suite failure: "passed 971, failed 1" is a red test (run
// `npm test` and look), not a deleted test. Observed once during the S1a-lite build:
// an unreproduced single red immediately after a full npm test whose detail was lost
// to output filtering — this message is why that cannot happen silently again.
function jestPassed(): { passed: number; summary: string } {
  const out = run("npx", ["--no-install", "jest", "--selectProjects", "node", "jsdom"], path.join(ROOT, "fitted"));
  const line = out.split("\n").filter((l) => /^Tests:/.test(l)).pop() ?? "";
  const m = line.match(/(\d+) passed/);
  if (!m) throw new Error(`could not parse jest output; last Tests: line: "${line}"`);
  return { passed: parseInt(m[1], 10), summary: line.trim() };
}

function pytestPassed(): { passed: number; summary: string } {
  const py = path.join(ROOT, "ml-system", ".venv", "bin", "python");
  if (!fs.existsSync(py)) throw new Error("ml-system/.venv missing — cannot verify the pytest floor");
  const out = run(py, ["-m", "pytest", "tests", "service/tests", "-q"], path.join(ROOT, "ml-system"));
  const line = out.split("\n").filter((l) => /\d+ (passed|failed)/.test(l)).pop() ?? "";
  const m = line.match(/(\d+) passed/);
  if (!m) throw new Error(`could not parse pytest output (tail: "${out.trim().slice(-200)}")`);
  return { passed: parseInt(m[1], 10), summary: line.trim() };
}

/** Experiments suites are counted by COLLECTION, not execution: the full h26 run is ~29s
 * and execution is what the spend/ledger guards exist to gate, so a Stop-hook-frequency
 * check must not execute it. Collection catches deletion — §5: removal is the cheapest
 * and most common way a count drops — but not a skip-mark added in place. */
function experimentsCollected(): number {
  const py = path.join(ROOT, "ml-system", "experiments", "h26", ".venv", "bin", "python");
  if (!fs.existsSync(py)) throw new Error("experiments/h26/.venv missing — cannot verify the experiments floor");
  let total = 0;
  for (const dir of ["h26", "track2_transfer"]) {
    const out = run(py, ["-m", "pytest", "-q", "--collect-only", "tests"], path.join(ROOT, "ml-system", "experiments", dir));
    const m = out.match(/(\d+)(?:\/\d+)? tests? collected/) ?? out.match(/collected (\d+) items/);
    if (!m) throw new Error(`could not parse collect-only output for experiments/${dir} (tail: "${out.trim().slice(-200)}")`);
    total += parseInt(m[1], 10);
  }
  return total;
}

// ---------------------------------------------------- register scan (checks 7, 8)

/** §23 rows, code-spans stripped before splitting on `|` — H101 embeds a pipe inside an
 * inline code span and a naive split mis-reads its status column (proven in state.sh). */
function registerRows(): { raw: string; status: string }[] {
  return read(SPEC)
    .split("\n")
    .filter((l) => /^\| H\d+ \|/.test(l))
    .map((raw) => {
      const cols = raw.replace(/`[^`]*`/g, "CODE").split("|");
      const status = (cols[3] ?? "").replace(/\*/g, "").trim();
      return { raw, status };
    });
}

// ------------------------------------------------------------------ the checks

describe("repo hygiene — enforced channel (ratchets vs baseline; red = worse than baseline)", () => {
  test("check 9: doc cites naming a nonexistent path", () => {
    const missing = docCiteMissing();
    if (missing.length > baseline.enforced.check9_docCiteMissingPath) {
      throw new Error(
        `check 9 REGRESSION: ${missing.length} broken doc cites > baseline ${baseline.enforced.check9_docCiteMissingPath}\n` +
          missing.join("\n")
      );
    }
    console.log(`check 9 current ${missing.length} → target 0 (baseline ${baseline.enforced.check9_docCiteMissingPath})`);
  });

  test("check 10: source files citing a nonexistent doc (at target 0)", () => {
    const missing = sourceCiteMissing();
    if (missing.length > 0) {
      throw new Error(`check 10: source files cite nonexistent docs:\n${missing.join("\n")}`);
    }
  });

  test("check 11: sha256 pins — preregistrations + the recovered appendix", () => {
    const v = pinViolations();
    if (v.length > 0) throw new Error(`check 11: pin violations:\n${v.join("\n")}`);
  });

  test("check 13: every *.md deletion since the anchor carries a resolving EXTRACTED block", () => {
    const { violations } = extractedScan();
    if (violations.length > 0) throw new Error(`check 13: violations:\n${violations.join("\n")}`);
  });

  test("check 14: volatile markers in CLAUDE.md / plan status banners", () => {
    const hits = allVolatileMarkers();
    if (hits.length > baseline.enforced.check14_volatileMarkers) {
      throw new Error(
        `check 14 REGRESSION: ${hits.length} volatile markers > baseline ${baseline.enforced.check14_volatileMarkers}\n` +
          hits.join("\n")
      );
    }
    console.log(`check 14 current ${hits.length} → target 0 (baseline ${baseline.enforced.check14_volatileMarkers})`);
  });

  test("check 15: suite counts never decrease (floors live here and nowhere else)", () => {
    const floors = baseline.enforced.check15_suiteFloors;
    const jest = jestPassed();
    const pytest = pytestPassed();
    const experiments = experimentsCollected();
    const broken: string[] = [];
    if (jest.passed < floors.jest) {
      broken.push(`jest passed ${jest.passed} < floor ${floors.jest} — raw: "${jest.summary}" (if it reports failed>0 this is a RED TEST, not a deleted one: run npm test)`);
    }
    if (pytest.passed < floors.pytest) {
      broken.push(`pytest passed ${pytest.passed} < floor ${floors.pytest} — raw: "${pytest.summary}" (if it reports failed>0 this is a RED TEST, not a deleted one)`);
    }
    if (experiments < floors.experimentsCollected) {
      broken.push(`experiments collected ${experiments} < floor ${floors.experimentsCollected}`);
    }
    if (broken.length > 0) throw new Error(`check 15: suite count decreased:\n${broken.join("\n")}`);
    console.log(`check 15 jest ${jest.passed}≥${floors.jest} · pytest ${pytest.passed}≥${floors.pytest} · experiments ${experiments}≥${floors.experimentsCollected}`);
  });

  test("check 12b: liveness — the campaign plan exists iff any enforced check is short of target", () => {
    const gap =
      docCiteMissing().length > 0 ||
      sourceCiteMissing().length > 0 ||
      pinViolations().length > 0 ||
      extractedScan().violations.length > 0 ||
      allVolatileMarkers().length > 0;
    const exists = fs.existsSync(path.join(ROOT, PLAN));
    if (gap && !exists) {
      throw new Error(`check 12b: enforced targets unmet but ${PLAN} is gone — S6 was declared early`);
    }
    if (!gap && exists) {
      throw new Error(`check 12b: every enforced target met but ${PLAN} still exists — S6 (git rm it) is due`);
    }
  });
});

describe("repo hygiene — printed channel (information, never blocks)", () => {
  test("checks 1–7, 8, 12a: size and shape readout", () => {
    const md = trackedMd();
    const appendix = "docs/Fitted_Spec_v2_recovered_appendix.md";
    // Built without a path-shaped literal: the file does not exist until S4a, and check
    // 10 scans THIS file — a literal here is a broken cite the moment this file is
    // tracked. (It was invisible pre-commit: git ls-files omits untracked files, so the
    // suite could not see itself until it landed. The Stop hook caught it post-commit.)
    const defectsDoc = ["docs", "DEFECTS.md"].join("/");
    const rows = registerRows();

    const current: Record<string, number> = {
      check1_trackedMdCount: md.length,
      check2_totalMdBytes: md
        .filter((f) => f !== defectsDoc && f !== appendix)
        .reduce((s, f) => s + bytesOf(f), 0),
      check3_largestDocBytes: Math.max(...md.map(bytesOf)),
      check4_readingListBytes: ["CLAUDE.md", SPEC, PLAN]
        .filter((f) => fs.existsSync(path.join(ROOT, f)))
        .reduce((s, f) => s + bytesOf(f), 0),
      check5_plansCount: md.filter((f) => /^docs\/plans\/[^/]+\.md$/.test(f)).length,
      check6_sessionsCount: md.filter((f) => /^docs\/sessions\/[^/]+\.md$/.test(f)).length,
      check7_resolvedRowBytes: rows
        .filter((r) => !r.status.startsWith("OPEN"))
        .reduce((s, r) => s + Buffer.byteLength(r.raw, "utf8"), 0),
      check8_statusVocabulary: new Set(rows.map((r) => r.status)).size,
    };

    const lines: string[] = [];
    const regressions: string[] = [];
    for (const [key, cur] of Object.entries(current)) {
      const landing = baseline.printed.landing[key];
      const target = baseline.printed.targets[key] ?? null;
      const toGo = target === null ? "" : ` (${Math.max(0, cur - target)} to go)`;
      lines.push(`  ${key}: ${cur} → ${target === null ? "no ruled target" : target}${toGo}  [landing ${landing}]`);
      if (landing !== undefined && cur > landing) regressions.push(`${key} ${cur} > landing ${landing}`);
    }
    lines.push(`  check8 note: distinct §23 status strings; membership becomes enforced at S4a (D6c)`);
    lines.push(`  EXTRACTED cost meter: ${extractedScan().droppedTotal} paragraphs dropped since anchor`);
    lines.push(`REGRESSIONS: ${regressions.length ? regressions.join("; ") : "none"}`);
    console.log(`hygiene (printed channel)\n${lines.join("\n")}`);
    expect(true).toBe(true); // printed channel never blocks (§5)
  });
});
