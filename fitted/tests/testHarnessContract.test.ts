/**
 * A guard on the TEST HARNESS itself.
 *
 * Booting a `mongodb-memory-server` mongod routinely takes longer than jest's **5 s default hook
 * timeout** once several suites do it concurrently. When it overruns, the `beforeAll` throws, the
 * suite's `harness` stays `undefined`, and every test in that file fails on `harness.clear()` —
 * producing an intermittent red that looks like flake and trains people to re-run instead of look.
 *
 * That is not hypothetical: on 2026-07-25 the full suite failed roughly 1 run in 8, and the error was
 * literally `Exceeded timeout of 5000 ms for a hook` pointing at `mlRecommend.test.ts`'s
 * `startMemoryMongo` call. Sixteen of the twenty real-Mongo suites already passed an explicit
 * `120_000`; four did not, and those four were the flaky ones.
 *
 * Sixteen-out-of-twenty is exactly the shape of a convention enforced by discipline. CLAUDE.md's rule
 * is to enforce process rules with CI-shaped artifacts instead, so this asserts it mechanically: any
 * suite that boots a mongod must give its hook an explicit timeout. A new real-DB suite that forgets
 * reddens HERE, at authoring time, instead of reddening something unrelated one run in eight.
 */
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const TESTS_DIR = __dirname;

describe("test-harness contract — every mongod-booting suite sets an explicit hook timeout", () => {
  const suites = readdirSync(TESTS_DIR)
    // Exclude self: this file names both boot symbols in its own source and would otherwise flag itself.
    .filter((f) => /\.test\.tsx?$/.test(f) && f !== "testHarnessContract.test.ts")
    .map((f) => ({ file: f, src: readFileSync(join(TESTS_DIR, f), "utf8") }))
    // BOTH doors to a mongod: the shared helper, and a direct `MongoMemoryServer.create()` (which is
    // how `dbErasureDoor.test.ts` boots one so it can drive the REAL `connectMongo`). A first version
    // of this guard matched only the helper and therefore skipped that suite — the same
    // sixteen-of-twenty blind spot it exists to prevent, reproduced inside the guard itself.
    .filter(({ src }) => /startMemoryMongo\s*\(|MongoMemoryServer\.create\s*\(/.test(src));

  it("finds the real-Mongo suites (a zero-length list would make the next test vacuous)", () => {
    // Guards against the whole check quietly becoming a no-op if the helper is ever renamed.
    expect(suites.length).toBeGreaterThanOrEqual(16);
  });

  it.each(suites.map((s) => s.file))("%s gives its mongod boot an explicit hook timeout", (file) => {
    const src = suites.find((s) => s.file === file)!.src;
    // The call closes with `}, <timeout>);` — a bare `});` means jest's 5s default governs.
    const boots = [
      ...src.matchAll(
        /(?:startMemoryMongo|MongoMemoryServer\.create)\s*\([\s\S]*?\n\s*\}(,\s*[\d_]+)?\s*\)/g,
      ),
    ];
    expect(boots.length).toBeGreaterThan(0);
    for (const m of boots) {
      const timeout = m[1] ? Number(m[1].replace(/[,\s_]/g, "")) : null;
      // Named in the failure message so the fix is obvious without opening this file.
      expect({ file, timeoutMs: timeout }).toEqual({
        file,
        timeoutMs: expect.any(Number),
      });
      expect(timeout).toBeGreaterThanOrEqual(30_000);
    }
  });
});

export {};
