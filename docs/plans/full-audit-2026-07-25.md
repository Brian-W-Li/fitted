# Full-codebase audit — session prompts (2026-07-25)

Paste ONE prompt per fresh session, `/clear` between them. Run in order.

## Status

**SESSION 1 is DONE and CONVERGED** (5 rounds, `df9d8f1f`…`e63a928a`, deployed 2026-07-25).
It verified the friend-first-use pass (all six fixes correct) and audited every TS test for forgery.
Suite **888 → 960**. Details: `docs/sessions/2026-07-25-audit-session1.md`; live-deploy state:
`m5-c8-half2-runbook.md` §8. New holes: **DEFECTS-H78–H85**.

Remaining: **Session 2** (verify session 1, then close its top registered holes) → **Session 3** (the
app, from cold) → **Session 4** (Python + cross-runtime).

### Why session 2 was split
The original plan had one session for the whole app. Session 1 showed that *verifying the previous
session* alone consumes a large fraction of a long session — so bundling verification with a from-cold
DFS of 73 files guarantees the DFS gets shortchanged. Verification + bounded hole-closing is now
session 2; the from-cold audit is session 3.

---

## Standing rules — apply to EVERY session

### Agent safety
- **Every review/search subagent MUST be read-only** (`subagent_type: "Explore"`). A writable agent
  deleted a user file in an earlier session.
- Record `git status --porcelain -uall` at session start; re-check at the end and confirm the same
  untracked list. Never `git clean/checkout -- ./stash/reset --hard`, or `rm` anything you did not
  create this session.
- Your own mutations only on **committed** files, `cp` a backup first, and verify restoration with
  `git diff --stat`. **A command timeout can kill the restore step** — this happened twice in session
  1, leaving a source file mutated. Always re-check the tree after a timeout.

### Evidence rules (these are what actually found the defects)
- **Never trust a green test. Mutate the source, require RED, restore, confirm restored.** ~40
  mutations in session 1 found four load-bearing gaps that were invisible to reading, including a
  data-loss fix whose full revert left all 17 of its suite's tests green.
- **A RED run is evidence. Never write one off as "transient."** Capture the FULL output to a file
  **before** re-running — the re-run deletes your only sample. Session 1 lost the first sample this
  way and had to infer the failing suite from a test-count delta. A low reproduction rate says nothing
  about severity, and a flaky suite is as corrosive as a vacuous one: every later regression hides
  behind "that's the flaky one."
- **For a bug fix, write the failing test FIRST — and verify it fails for the RIGHT reason.** Twice in
  session 1 a "failing" test passed on broken code (a boundary fixture sized from the constant under
  test; a race repro whose blanked span happened to contain no bracket). A test you *believe* fails is
  worth nothing.
- **Never assert a fix works in a comment, a commit message, or §23 without a mutation.** The session-1
  blocker was a `cancelled` flag that could not fire, shipped with a comment claiming the race was
  closed; then the same error recurred one round later in a commit message. This is the repo's
  characteristic failure — a false guarantee in source is worse than the original bug.
- **Verify every subagent finding against source before acting.** ~3 of 40 needed correcting in session
  1: one reported blocker was a limit the target file already documented; one "these tests pin nothing"
  was too strong (a mutation reddened five of them).

### Known vacuous-test patterns (all found live here)
1. `new File(["x"], …)` + `Object.defineProperty(f,"size",…)` — a faked size with one real byte.
2. A stub restored **synchronously** while the code consumes it after an `await`.
3. **One-sided thresholds.** Bracket from ABSOLUTE endpoints, or assert an inequality against an
   external fact. A fixture sized from the constant moves with it and pins nothing.
4. Assertions on strings the fixture can never produce, or on copy that exists nowhere in `app/`/`lib/`.
5. `waitFor`/`findBy` sampling before async state lands; a negative assertion that races.
6. `X.prototype.foo = …` is NOT undone by `jest.restoreAllMocks()`; jest.config sets neither
   `restoreMocks` nor `resetMocks`. `clearAllMocks` keeps implementations — use `resetAllMocks`.
7. **Mirrors** — a test reimplementing the unit instead of importing it.
8. Asserting a mocked value rather than real behavior. `expect(x).toBe(process.env.NODE_ENV === "…")`
   is a tautology in test env.
9. `.only`/`.skip`/`xit`/`todo`, or a file not registered in the run.

### Local verification is YOURS, not Brian's
If it can be checked on this machine without touching production and without spending money, **do it**.
Only deploys, pushes, the Fly machine, and paid API runs are Brian's. Session 1 wrongly handed back
browser testing; the harness now exists and found a defect jsdom could not:

```
# in the scratchpad, NOT the repo (keeps package.json clean)
npm i playwright                      # or playwright-core for Chrome-only
npx playwright install webkit         # Safari's engine
```
- **Chrome:** `chromium.launch({ channel: "chrome" })` — no download needed.
- **WebKit:** `webkit.launch()` + `newContext({ isMobile: true, hasTouch: true, viewport: {width:390,height:844} })`.
- To exercise an auth-gated client component, add a **temporary** `fitted/app/dev-*/page.tsx` harness
  rendering it with injected props — no auth, no DB — and **delete it in the same session** (never
  commit; also `rm -rf fitted/.next/dev/types` afterwards or `tsc` reports stale generated types).
- Extract a non-exported function's source from the file at run time and `eval` it, so the test cannot
  drift from the shipped implementation.
- Neutralise Next's dev overlay: `nextjs-portal{display:none!important;pointer-events:none!important}`.
- **Two engines disagree on real numbers** — the same 12MP JPEG at q0.85 lands ~455KB on Chrome and
  ~1.0MB on WebKit. Never generalise one engine's margin.
- Still genuinely out of reach: iOS memory pressure / tab discard (DEFECTS-H79 residual).

### Convergence — must TAPER, not stay rectangular
- A round must be **broad early** (whole scope). Delta-only rounds are circular.
- But each round should be **narrower and cheaper than the last**, because the loop cannot close while
  your fixes create as much new unreviewed surface as the round reviewed. Session 1's shape:
  3 lanes → 2 lanes → newest-weighted → newest-commit+sample → one-commit+regression-checks.
- **Once severity drops (a round with no blocker), fix only blockers/important; register minors as §23
  rows.** That is the mechanism that makes it taper. Comment-only corrections are exempt — they add no
  reviewable behavior.
- **Done = a fresh round on the FINAL code returns no blocker and no important.** Expect 3; budget 5.
- Closure names residuals and unchecked surface. Never "all clean."

### Scope + docs
- Out-of-lane findings: **report and register** in §23, do not fix.
- **Cite by SYMBOL, not line number.** Session 1's line cites went stale twice in one day, including in
  the very commit that wrote them.
- Conflicts are bugs: reconcile `Fitted_Spec_v2.md` / the runbook in the same commit. Check `models/`
  and `lib/` too — a stale claim about H14 sat in `models/User.ts`, which a `docs/`-only sweep missed.
- Commit on `main`; end messages with the `Co-Authored-By` trailer. **Do not deploy** unless Brian says
  so in that session; if he does, it is `git push origin main` then `cd fitted && npx vercel --prod`
  (NEVER the repo root), keep Fly at **1 machine**, and update runbook §8's live-SHA bullet in the same
  session.

---

## SESSION 2 — Verify session 1, then close its top registered holes

```
Read docs/plans/full-audit-2026-07-25.md FIRST and follow its "Standing rules" exactly — especially
mutate-to-verify, write-the-failing-test-first, read-only subagents, and the tapering convergence rule.
Trust nothing from session 1: it made real errors, including a fix that was a no-op shipped with a
comment claiming it worked.

JOB A — VERIFY SESSION 1 (commits fa73be11..e63a928a, 14 commits, now DEPLOYED).
Read `git show` on each, then read the CHANGED FILES WHOLE. Session 1 added ~70 tests and a lexing
meta-test, and changed the wardrobe page, the image route, lib/db, lib/recommendCopy, models/User and
the §23 register. For each change decide independently: is it correct, is it complete, did it break
something else? Specifically re-derive, because these are the ones session 1 got wrong at least once:
 1. The wardrobe GET **merge** (`app/(app)/wardrobe/page.tsx`). Its predecessor — a `cancelled` flag —
    was a NO-OP shipped with a comment claiming the race was closed. Prove the merge actually holds:
    can it duplicate a row, lose a locally-edited row, or break the newest-first ordering? Is the new
    test a real pin (mutate it) or does it pass on a pre-state?
 2. `tests/testHarnessContract.test.ts` — a hand-written lexer, rewritten FOUR times because each
    version was defeated. Attack `codeOnly`/`bootTimeouts` for a **false green** (a number reported for
    a hook with no timeout). Do its self-tests each fail on the implementation they claim to pin?
 3. `tests/dbErasureDoor.test.ts` — the only test that runs the real erasure door. Does it prove
    erasure, or only that some rows vanished? Does it interact with the other real-mongod suites?
 4. The census scope sentence (`lib/recommendCopy.ts`). Read the composed output for EVERY census
    shape. Its predecessor had a false antecedent that never reached the case it was written for.
 5. The image-header, cookie-`Secure`, `confirm`-gate and cross-user-scoping pins added in `3d7cfed9`.
Also: re-run `npx jest` and `npx jest --randomize` several times and report ANY nondeterminism.

JOB B — close the highest-cost registered holes, in this order, test-first:
 - DEFECTS-H78: `imagePath` is PATCH-able with no shape or ownership gate, so an authed user can point an
   item at another friend's image and land that photo in the M6 export. No client path sends it in a
   PATCH — check, then prefer removing it from `PATCH_STRING_FIELDS` (a contract narrowing: get a Fable
   read). Also add the missing `user` filter to the exporter's image resolve and extend
   exportTrack2.test.ts's scoping test to `wardrobeimages`.
 - DEFECTS-H84 items (1) and (5): `writeJSON`'s silent quota failure versus the "you won't lose your place"
   promise, and the three `if (!firebaseUser) return` no-ops that swallow a confirmed destructive action.
 - DEFECTS-H82's top items: the dashboard like/dislike failure revert (the primary M6 label path), the F10
   envelope's write-before-fetch, and `DISLIKE_REASONS` ⊆ `FEEDBACK_REASON_CODES`.
 - DEFECTS-H80/H81 if budget remains.

Use the browser harness (standing rules) wherever a claim is about real browser behavior. Fix
load-bearing findings, register the rest, reconcile docs in the same commit, and run TAPERING
convergence rounds until a fresh round returns no blocker and no important. Name residuals.
```

---

## SESSION 3 — The web app, from cold, detective-style

```
Read docs/plans/full-audit-2026-07-25.md FIRST and follow its "Standing rules" exactly. Read-only
subagents. Trust no prior audit, doc, or test — sessions 1 and 2 both shipped defects in their own fixes.

Scope: fitted/app, fitted/lib, fitted/models, fitted/scripts (73 files, ~13.4k lines). There is no
fitted/components — shared client pieces live in fitted/lib. NOT the Python side (session 4).

Work like a principal engineer joining cold, with a tester's suspicion. Do not skim. Pick a few entry
points and DFS to their leaves, understanding each fully before moving on:
 1. Auth + session: signin → /api/auth/sync → AuthGate → session cookie → image serving ownership.
    (AuthGate has ZERO tests — DEFECTS-H82.)
 2. Ingestion: add item → validation → POST /api/wardrobe → clothingType/warmth derivation → Mongo;
    photo → downscale → image route → imageStorage → WardrobeImage.
 3. Recommend: Generate → /api/recommend → lib/mlRecommend → mlServiceClient → snapshot write →
    browser projection → render.
 4. Feedback: like/dislike → /api/interactions → binding → latest-state (§23-H61) → history curation.
 5. Deletion/erasure: item delete, wardrobe clear, DELETE /api/account three-phase sweep, the D2
    keep-referenced-photos carve-out.
 6. The export/monitor scripts that read the live corpus.

Enumerate the state space and walk every cell; fault-inject every boundary (fetch rejects / non-JSON /
401 / 413 / 429 / 500, token throws, FileReader errors, absent browser APIs, storage throws, DB down,
timeouts). At every step ask "what if this fails, and does the user find out?" — SILENT failure is the
defect class this project keeps shipping.

Priorities: (a) data loss/corruption · (b) erasure correctness (§23-H43/H74/H75) · (c) M6 corpus
integrity · (d) security/untrusted input (open Google sign-up) · (e) silent user-facing dead ends ·
(f) cross-file contract drift with no equality test.

Map before edit; cite by symbol; register out-of-lane findings; taper the rounds; name residuals.
```

---

## SESSION 4 — The Python substrate + cross-runtime seams

```
Read docs/plans/full-audit-2026-07-25.md FIRST and follow its "Standing rules" exactly. Read-only
subagents. Use ml-system/.venv (base anaconda numpy is broken).

Scope: ml-system/fitted_core (18 files, ~8.7k lines), ml-system/service (~1.6k lines), the Python test
suites, and the TS↔Python↔Mongoose contract surface.

 1. fitted_core DFS: sampler → validator → ranker → generation/rescue → response, with concrete values.
    Enumerate degenerate closets (0 tops, dress-only, single item, all-unavailable, 300 items) and
    confirm each yields an honest outcome, not a crash, an empty, or a misleading hint.
 2. The render service: auth, throttle ordering, the 500 wrapper, controls dedup/canonical-order,
    timeout budgets. DEFECTS-H76 is a REAL open defect — Next budgets ONE OpenAI call while the engine
    lawfully makes TWO; verify it and whether the margin test's premise is wrong. DEFECTS-H68 records
    effective concurrency 1. Do not hot-edit deployed config: propose, register, Fable-review the math.
 3. CROSS-RUNTIME DRIFT (highest value): every fact that must agree across Python/TS/Mongoose — enums,
    numeric clamps, format regexes, wire field sets, timeouts. For each: single generated source, or a
    cross-runtime equality test, or neither? A hand-copied mirror with neither is the drift disease.
    Enumerate them all; register the gaps. Note DEFECTS-H82 lists several already found.
 4. Python test audit at session 1's rigour: mutate load-bearing pins, hunt vacuous/mirror tests, find
    unguarded claims. Apply the nine patterns — they are language-agnostic.
 5. The frozen artifacts — experiments/track2_transfer/preregistration.md(+.json), exportTrack2Core's
    CERTIFICATE constants, the H26 frozen order. Verify NOTHING in any recent pass altered a frozen
    value or the decision rule. A touched frozen artifact is a BLOCKER: report, do not "fix".

Same method and tapering convergence. Name residuals. Do not touch the Fly machine count.
```

---

## Open items for Brian (decisions, not audit work)

1. **`fitted/scripts/track2-users-peek.mjs`** was deleted by a review subagent and is unrecoverable
   (never committed). Decide whether to reconstruct it.
2. **Rating yield is the next binding constraint.** The prereg needs **≥25 accepted + ≥25 rejected**
   scoreable clusters; the live corpus is ~6 interactions. Nothing in the hardening pass or the audit
   increases ratings-per-friend, and nothing was supposed to. Candidate next build: extend the
   empty-closet signpost to a confirmed **below-floor** closet — it currently fires only at exactly 0
   items, so the 3- and 6-item closets (the ones that actually hit the render wall) get nothing
   proactive. A signpost, not a gate; same §18 anti-guilt shape.
3. **Real-device testing is the one remaining verification gap.** Chrome and WebKit are both covered by
   the harness above, and DEFECTS-H79(b) is narrowed accordingly. What no desktop engine can settle: iOS
   memory pressure and tab discard, which is what the data-URL-over-blob decision rests on. Brian's
   framing (2026-07-25): friends can use the web app on desktop, so this does not gate recruiting —
   but cross-platform code quality is still non-negotiable.
