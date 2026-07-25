/**
 * A guard on the TEST HARNESS itself — plus a self-test of the guard's own logic.
 *
 * Booting a `mongodb-memory-server` mongod routinely takes longer than jest's **5 s default hook
 * timeout** once several suites do it concurrently. When it overruns, the `beforeAll` throws, the
 * suite's `harness` stays `undefined`, and every test in that file fails on `harness.clear()` —
 * an intermittent red that looks like flake and trains people to re-run instead of look.
 *
 * Not hypothetical: on 2026-07-25 the full suite failed ~1 run in 8 with `Exceeded timeout of 5000 ms
 * for a hook` pointing at `mlRecommend.test.ts`'s `startMemoryMongo`. Sixteen of twenty real-Mongo
 * suites already passed an explicit `120_000`; four did not, and those four were the flaky ones —
 * because `helpers/mongoHarness.ts`'s usage docblock showed the timeout-less one-liner and four suites
 * copied it. Sixteen-of-twenty is a convention held by discipline, so this enforces it mechanically.
 *
 * WHY IT LEXES. Three earlier attempts were each defeated, and the failures are instructive enough to
 * keep written down:
 *   1. A regex reading "the next `}, <n>)` after the boot" passed a timeout-less ONE-LINE hook by
 *      picking up a LATER hook's timeout — and the one-liner was exactly the shape the helper docblock
 *      taught. It also passed a boot inside a plain helper, passed a boot at module scope with no hook
 *      at all, and reported a false RED for `}, HOOK_TIMEOUT)`.
 *   2. Balanced-paren walking with quote-skipping but no comment-skipping: an apostrophe in prose
 *      ("don't") opened a string that swallowed the rest of the file, so four already-correct suites
 *      reported `timeoutMs: null`.
 *   3. Blanking comments with a regex before walking: the `//` inside `"http://cv.example"` was blanked
 *      as a comment, leaving an unterminated string and one bogus failure.
 * Strings, comments and regex literals cannot be handled independently of one another — they need a
 * single left-to-right pass. `codeOnly()` is that pass, and `describe("codeOnly")` below pins it
 * against all three defeat shapes so this guard cannot quietly rot into false assurance.
 */
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const TESTS_DIR = __dirname;
const BOOT_SRC = "(?:startMemoryMongo|MongoMemoryServer\\.create)\\s*\\(";
const HOOK = /\b(?:beforeAll|beforeEach)\s*\(/g;

/**
 * Blank every string body, comment and regex literal to spaces, preserving length and newlines, so
 * that index-based matching on the result still lines up with the original source.
 */
export function codeOnly(src: string): string {
  const out = src.split("");
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < out.length; k++) if (out[k] !== "\n") out[k] = " ";
  };
  // Regex-vs-division is decided by the PREVIOUS TOKEN, not by "is there an operator nearby".
  // Two earlier versions got this wrong in different ways: first a `|^` alternative made the probe
  // vacuous (in a non-anchored `.test()`, `^` matches any string); then, with that removed, it still
  // scanned a fixed 8-character window — and `=`/`(`/`;`/`,` sit within 8 characters of essentially
  // every real division, so the probe stayed true anyway. `console.log(total / n); const avg = t / n;`
  // therefore entered regex mode at the first `/` and blanked through to the second, eating the `)`
  // and unbalancing the walk, which reported an innocent correctly-timed suite as timeout-less.
  // After a VALUE (identifier, number, `)`, `]`) a `/` is division; after anything else it opens a
  // regex. These keywords are the exception — a regex may directly follow them.
  const REGEX_AFTER = new Set([
    "return", "typeof", "case", "in", "of", "delete", "void", "new", "do", "else", "yield",
    "await", "instanceof", "throw",
  ]);
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i);
      const end = nl < 0 ? src.length : nl;
      blank(i, end);
      i = end - 1;
    } else if (c === "/" && src[i + 1] === "*") {
      const close = src.indexOf("*/", i + 2);
      const end = close < 0 ? src.length : close + 2;
      blank(i, end);
      i = end - 1;
    } else if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === "\\" ? 2 : 1;
      blank(i, Math.min(j + 1, src.length));
      i = j;
    } else if (c === "/") {
      // Backward scan to the previous non-space character (no slicing: this runs per `/`).
      let k = i - 1;
      while (k >= 0 && /\s/.test(src[k])) k--;
      if (k >= 0) {
        const prev = src[k];
        if (prev === ")" || prev === "]") continue; // `(a+b) / c`, `xs[0] / n` → division
        if (/[\w$]/.test(prev)) {
          let m = k;
          while (m >= 0 && /[\w$]/.test(src[m])) m--;
          if (!REGEX_AFTER.has(src.slice(m + 1, k + 1))) continue; // identifier/number → division
        }
      }
      let j = i + 1;
      let cls = false;
      while (j < src.length && src[j] !== "\n") {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === "[") cls = true;
        else if (src[j] === "]") cls = false;
        else if (src[j] === "/" && !cls) break;
        j++;
      }
      if (src[j] === "/") { blank(i, j + 1); i = j; }
    }
  }
  return out.join("");
}

/** From `open` (index just past a `(`) in ALREADY-BLANKED code, the index of the matching `)`. */
export function callExtent(code: string, open: number): number {
  let depth = 1;
  for (let i = open; i < code.length; i++) {
    const c = code[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** `null` = the boot is not inside any hook. Otherwise the enclosing hook's timeout, or `null`. */
export function bootTimeouts(src: string): (number | null)[] {
  const code = codeOnly(src);
  const hooks: { start: number; end: number; body: string }[] = [];
  for (const m of code.matchAll(HOOK)) {
    const open = m.index! + m[0].length;
    const end = callExtent(code, open);
    if (end >= 0) hooks.push({ start: open, end, body: code.slice(open, end) });
  }
  return [...code.matchAll(new RegExp(BOOT_SRC, "g"))].map((m) => {
    const idx = m.index!;
    // INNERMOST enclosing hook, so a nested hook is not attributed to an outer one.
    const owner = hooks
      .filter((h) => idx > h.start && idx < h.end)
      .sort((a, b) => b.start - a.start)[0];
    if (!owner) return null;
    const arg = /,\s*([A-Za-z_$][\w$]*|[\d_]+)\s*$/.exec(owner.body);
    if (!arg) return null;
    if (/^[\d_]+$/.test(arg[1])) return Number(arg[1].replace(/_/g, ""));
    const decl = new RegExp(`\\b(?:const|let|var)\\s+${arg[1]}\\s*(?::[^=]+)?=\\s*([\\d_]+)`).exec(code);
    return decl ? Number(decl[1].replace(/_/g, "")) : null;
  });
}

// ── The guard's own logic, pinned against every shape that defeated an earlier version ─────────────
describe("codeOnly/bootTimeouts — the guard cannot be defeated the ways it was before", () => {
  const T = "}, 120_000);";
  it("a timeout-less ONE-LINE hook is not rescued by a later hook's timeout", () => {
    const src = `beforeAll(async () => { harness = await startMemoryMongo([U]); });\nbeforeEach(async () => {\n  await x();\n${T}`;
    expect(bootTimeouts(src)).toEqual([null]);
  });
  it("a boot inside a plain helper the hook merely calls is reported as hook-less", () => {
    const src = `async function boot(){ harness = await startMemoryMongo([U]); }\nbeforeAll(boot);\nbeforeEach(async () => {\n${T}`;
    expect(bootTimeouts(src)).toEqual([null]);
  });
  it("a boot at module scope is reported as hook-less", () => {
    const src = `const s = await MongoMemoryServer.create();\nbeforeAll(async () => {\n  await x();\n${T}`;
    expect(bootTimeouts(src)).toEqual([null]);
  });
  it("an apostrophe in prose does not swallow the file (defeat #2)", () => {
    const src = `// we don't want this to break\nbeforeAll(async () => {\n  harness = await startMemoryMongo([U]);\n${T}`;
    expect(bootTimeouts(src)).toEqual([120000]);
  });
  it("a URL inside a string is not mistaken for a comment (defeat #3)", () => {
    const src = `beforeAll(async () => {\n  harness = await startMemoryMongo([U]);\n  process.env.X = "http://cv.example";\n${T}`;
    expect(bootTimeouts(src)).toEqual([120000]);
  });
  it("a named timeout constant resolves instead of reading as absent", () => {
    const src = `const HOOK_TIMEOUT = 120_000;\nbeforeAll(async () => {\n  harness = await startMemoryMongo([U]);\n}, HOOK_TIMEOUT);`;
    expect(bootTimeouts(src)).toEqual([120000]);
  });
  it("TWO divisions on one line do not blank the code between them", () => {
    // The case the `|^` fix did NOT close, and which its own self-test missed: the "is a regex allowed
    // here" probe looked at the previous EIGHT characters for any operator, and `=` / `(` / `;` / `,`
    // sit within 8 chars of essentially every real division. So `const a = b / c; const d = e / f;`
    // still entered regex mode at the first `/` and blanked through to the second, unbalancing the
    // walk and reporting an innocent, correctly-timed suite as timeout-less.
    const src = `beforeAll(async () => {\n  console.log(total / n); const avg = total / n;\n  harness = await startMemoryMongo([U]);\n${T}`;
    expect(bootTimeouts(src)).toEqual([120000]);
  });
  // Smoke case, NOT the pin — be precise about which test carries which guarantee. This shape
  // passes on all three historical `codeOnly` implementations (the `|^` one, the 8-char-window
  // one, and the current previous-token one), because a single division has no second `/` to
  // blank through to. The test that pins the division rule is "TWO divisions on one line…"
  // above: reverting to the 8-char window reddens exactly that one and nothing else
  // (mutation-verified). The other self-tests DO pin real properties — restoring the
  // comments-before-strings ordering reddens five of them — just not the division rule.
  it("a single division is left alone (smoke; the TWO-division case above is the real pin)", () => {
    // `|^` in the regex-permitted-here test made it vacuous, so every `/` opened a regex scan that
    // blanked through to the next `/` on the line — swallowing real code between two divisions.
    const src = `const a = b / c;\nbeforeAll(async () => {\n  const d = e / f;\n  harness = await startMemoryMongo([U]);\n${T}`;
    expect(bootTimeouts(src)).toEqual([120000]);
  });
  it("a regex literal containing a quote or a brace does not skew the walk", () => {
    const src = `const q = /["']/;\nconst b2 = /[({]/;\nbeforeAll(async () => {\n  harness = await startMemoryMongo([U]);\n${T}`;
    expect(bootTimeouts(src)).toEqual([120000]);
  });
  it("a template literal with \${} braces and a // inside does not skew the walk", () => {
    const src = "beforeAll(async () => {\n  const s = `a${{x:1}}b//c`;\n  harness = await startMemoryMongo([U]);\n" + T;
    expect(bootTimeouts(src)).toEqual([120000]);
  });
  it("a quoted URL is a string, not a comment, even in JSX-ish source", () => {
    const src = `const a = <img src="//x" />;\nbeforeAll(async () => {\n  harness = await startMemoryMongo([U]);\n${T}`;
    expect(bootTimeouts(src)).toEqual([120000]);
  });
  it("the INNERMOST enclosing hook owns the boot, not an outer one", () => {
    const src = `beforeAll(async () => {\n  describe("x", () => {\n    beforeAll(async () => {\n      harness = await startMemoryMongo([U]);\n    });\n  });\n${T}`;
    // The inner hook has no timeout, so this must NOT be rescued by the outer one's.
    expect(bootTimeouts(src)).toEqual([null]);
  });
  it("a COMPUTED timeout reads as absent — conservative by design (false red, never false green)", () => {
    // `}, 2 * 60_000)` and `}, T.MS)` are legitimate but unparsed here. Failing loudly is the safe
    // direction: use a numeric literal or a named const (both are recognised).
    expect(bootTimeouts(`beforeAll(async () => {\n  harness = await startMemoryMongo([U]);\n}, 2 * 60_000);`)).toEqual([null]);
    expect(bootTimeouts(`beforeAll(async () => {\n  harness = await startMemoryMongo([U]);\n}, T.MS);`)).toEqual([null]);
  });
  it("a plain timed hook is accepted", () => {
    const src = `beforeAll(async () => {\n  harness = await startMemoryMongo([U]);\n${T}`;
    expect(bootTimeouts(src)).toEqual([120000]);
  });
});

// ── The contract itself ────────────────────────────────────────────────────────────────────────────
/** Every `.test.ts(x)` under tests/, RECURSIVELY — jest's testMatch spans subdirectories, so a
 *  non-recursive scan would let a suite in one run unchecked. */
function collect(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return collect(full);
    return /\.test\.tsx?$/.test(e.name) ? [full] : [];
  });
}

const suites = collect(TESTS_DIR)
  // Exclude self: this file names both boot symbols in its own source (and in its self-tests).
  .filter((f) => !f.endsWith("testHarnessContract.test.ts"))
  .map((file) => ({ file: file.slice(TESTS_DIR.length + 1), src: readFileSync(file, "utf8") }))
  // Filter on the RAW source, deliberately. Filtering on the projection meant that if `codeOnly` ever
  // mis-lexed a file badly enough to lose the boot call (e.g. a bare apostrophe in JSX text opening a
  // "string" that runs to EOF), the suite silently dropped OUT of scope and was never checked. Now it
  // stays in scope and fails loudly on the `boots.length > 0` assertion below.
  // ACCEPTED COST, stated because the lines above justified the change only by the mis-lex route:
  // a file that merely NAMES a boot symbol in prose or a string — `expect(msg).toContain(
  // "startMemoryMongo(")` — is now pulled into scope, where the projection correctly blanks it and
  // the suite reddens with zero boots. That is a false RED, the documented safe direction, and it is
  // not live today (raw-match and projection-match are both 21 across the tree). If it ever fires,
  // rename the symbol in that prose; do not loosen this filter back to the projection.
  .filter(({ src }) => new RegExp(BOOT_SRC).test(src));

describe("test-harness contract — every mongod boot sits in a hook with an explicit timeout", () => {
  it("finds the real-Mongo suites (a zero-length list would make the next test vacuous)", () => {
    // Floored at the real count, so a suite cannot silently drop out of scope — e.g. via a wrapper
    // under a third name, or a move into a subdirectory.
    expect(suites.length).toBeGreaterThanOrEqual(21);
  });

  it.each(suites.map((s) => s.file))("%s", (file) => {
    const timeouts = bootTimeouts(suites.find((s) => s.file === file)!.src);
    expect(timeouts.length).toBeGreaterThan(0);
    // `file` is inside the assertion so a failure names the suite without needing this file open.
    expect({ file, timeouts }).toEqual({ file, timeouts: timeouts.map(() => expect.any(Number)) });
    for (const ms of timeouts) expect(ms).toBeGreaterThanOrEqual(30_000);
  });
});
