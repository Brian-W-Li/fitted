# Full-codebase audit — session prompts (2026-07-25)

Three self-contained prompts. Run in order; each ends at a safe stopping point. Paste ONE per fresh
session (`/clear` between them). Session 1 is the highest priority — it verifies work that is
committed but unverified.

## Why this exists (read before running any of them)

On 2026-07-25 a six-item "friend-first-use hardening" pass ran on `main`. It produced four commits
(`df9d8f1f`, `24f8b816`, `ec75ecbb`, `31b6df45`), ~1,519 lines. During it:

- **Every convergence round found real defects in the PREVIOUS round's fixes.** Three rounds ran.
  The last one still found 12+ load-bearing issues, so convergence was never reached.
- **Three shipped tests were VACUOUS** — green while measuring nothing — and one of them was cited
  in `docs/Fitted_Spec_v2.md` §23-H77 as a pin. A doc asserted a guarantee that did not exist.
- **Two pre-existing data-destroying bugs** were found in code the pass merely made more reachable
  (photo-replace deleted before storing; the EXIF fallback baked wrong rotation and stripped the
  tag). Both were in files no prior audit had opened.
- **A review subagent deleted an untracked file** (`fitted/scripts/track2-users-peek.mjs`, never
  committed, unrecoverable).
- **Zero browser verification.** All of it is jsdom simulation.

The lesson driving these prompts: *the surface has been audited repeatedly; the substrate has not,
and a green suite is not evidence.*

---

## Standing rules — apply to ALL THREE sessions

Copy these into every session; they are not optional.

### Agent safety
- **Every review/search subagent MUST be read-only** (`subagent_type: "Explore"`, or an agent with
  no Edit/Write). A writable agent deleted a user file in the originating session.
- At session start run `git status --short` and **record the untracked files**. Re-check at the end
  and confirm the same list. Never run `git clean`, `git checkout -- .`, `git stash`, `git reset
  --hard`, or `rm` on anything you did not create in that session.
- Do your own mutations only on **committed** files, and `cp` a backup first; verify restoration
  with `git diff --stat` before moving on.

### Trust nothing, verify everything
- **Never trust a subagent finding.** Read the cited source yourself before acting. Subagents in the
  originating session reported findings against stale trees and against code they misread.
- **Never trust a green test.** For every behavioral claim, name the source mutation that would
  redden it; for load-bearing ones, PERFORM the mutation, confirm red, restore, confirm restored.
- **Never trust a doc.** Any doc sentence claiming code behavior or test coverage must be verified
  against the code. `§23` and the runbook both carried false claims as of this pass.
- **Never trust prior audits, including the one that produced this file.**

### Known vacuous-test patterns (hunt these specifically — all found live in this repo)
1. `new File(["x"], …)` + `Object.defineProperty(f, "size", …)` — a **faked** size with one real
   byte. Any assertion on read bytes or data-URL length cannot distinguish original from processed.
2. A stub installed and restored **synchronously**, while the code under test consumes it after an
   `await` → the real (absent) implementation is used and the test asserts the wrong branch.
3. **One-sided threshold assertions.** "Rejects 45MB" proves nothing about a 40MB-vs-5MB ceiling;
   only the ACCEPT side pins the value.
4. Assertions on **unrelated strings** the test never triggers, standing in for the real claim.
5. `waitFor` sampling **before** an async state lands, so the assertion passes on the pre-state.
6. Prototype assignment (`X.prototype.foo = …`) is **not** undone by `jest.restoreAllMocks()` —
   it leaks into every later test in the file.
7. **Mirrors**: a test reimplementing the unit inline instead of importing it (CLAUDE.md forbids).
8. Tests asserting a **mocked** value rather than real behavior.
9. `.only` / `.skip` / `xit` / `todo`, or a file not actually registered in the run.

### Method (non-negotiable)
- **MAP BEFORE EDIT.** Before changing anything: read the whole file (not the hunk), write the map —
  exact lines, the execution path, and **every other call site touched by the change (ripple
  check)**. Line-cites in docs drift; verify them.
- **Trace like a debugger.** Name concrete input values and follow them through every branch.
- **Enumerate the state space and walk every cell** (e.g. add|edit × photo|none × ok|fail|pending).
- **Fault-inject every boundary**: fetch rejects / non-JSON / 401 / 413 / 429 / 500, token throws,
  FileReader errors, absent browser APIs, storage throws, DB unavailable, timeouts.
- **Hunt absence-shaped defects**: a missing catch, missing bound, missing cleanup, an unreachable
  state, an unhandled rejection, a state with no exit.
- **Understand fully before implementing.** No speculative edits.

### Convergence rule (the one that failed)
- A convergence round must be **BROAD — the whole session scope**, never "did my last patch break
  something." Delta-only rounds are circular and were the specific failure here.
- **Done = a FRESH round on the FINAL post-fix code returns zero load-bearing findings.**
  Punch-list-executed ≠ converged. Expect ≥2 rounds; budget for 3.
- **Load-bearing** = would mislead an implementer, lose/corrupt data, break a downstream seam, or
  ship broken/dishonest to a friend. Style nits never block convergence.
- Closure statement **names residuals and unchecked surface**. Never "all clean."

### Scope discipline
- Anything outside the session's lane: **report and register**, do not fix. New holes go to
  `docs/Fitted_Spec_v2.md` §23 with a status and a resolution sketch.
- **Do NOT deploy.** Deploy is Brian's and is **CLI-driven — this project does NOT deploy on git
  push**: `git push origin main`, then `cd fitted && npx vercel --prod` (never from the repo ROOT).
  The Fly render service stays at **1 machine**; do not touch it.
- Commit on `main` (solo fork). End commit messages with the `Co-Authored-By` trailer.
- Keep docs conflict-free in the same pass: if a fix makes code diverge from `Fitted_Spec_v2.md` or
  a plan, reconcile the doc in that commit.

---

## SESSION 1 — Verify the 2026-07-25 pass + full TS test-forgery audit

> **Highest priority.** This work is committed to `main` and unverified. Do this before anything else.

```
Full verification audit. Two coupled jobs. Read docs/plans/full-audit-2026-07-25.md FIRST and follow
its "Standing rules" exactly — especially read-only subagents, the vacuous-test patterns, and the
broad convergence rule. Do not trust the prior session's claims, its tests, or its docs.

JOB A — Verify the 2026-07-25 friend-first-use pass.
Scope: commits fa73be11..HEAD (df9d8f1f, 24f8b816, ec75ecbb, 31b6df45). Read `git show` on each, then
read the CHANGED FILES WHOLE. The pass rewrote the wardrobe add/edit modal contract, image
pick/preview/upload handling, an API rate limit, the dashboard's geolocation + closet-count, the slot
census copy, and the M6 export manifest counters.

For each of the six original fixes AND every follow-up fix, independently decide: is it correct, is
it complete, and did it break something else? Trace concrete values. Specifically re-derive these,
which the prior session changed but never verified beyond unit tests:
 1. `app/api/wardrobe/[id]/image/route.ts` was reordered to store→repoint→delete. Verify no failure
    path can now leave an orphan WardrobeImage, a dangling imagePath, or a double-charged byte
    budget. The reorder lets old+new coexist briefly — quantify that overshoot against
    MAX_USER_IMAGE_BYTES and §23-H67, and confirm the erasure guard (§23-H43/H74) still holds.
 2. `prepareImageForUpload`'s EXIF fallback now returns the ORIGINAL instead of re-encoding. Verify
    this doesn't now reject a large class of real phone photos, and that stored orientation is
    correct/correctable in EVERY path (small-file skip, successful downscale, fallback). This feeds
    the M6 embedding pipeline — §23-H53 and the frozen preregistration depend on it.
 3. `prepareImageForUpload` now runs TWICE per pick (preview effect + upload). Independent decodes.
    Verify they cannot disagree in a way that matters.
 4. The modal's `SaveResult` union and every branch of `submitForm`; the page-level `photoFailures`
    list; the `photoPreviewSrc` truthfulness across all four (imageFile × isEdit) states.
 5. `lib/recommendCopy.ts` census: verify against the REAL engine
    (ml-system/fitted_core/sampler.py candidate_requested, slotmap.py) that every census shape gives
    correct guidance, and that no shape gets neither a diagnosis nor a useful hint.
 6. Dashboard geo (opt-in + Permissions resume + timeout + unsupported) and `closetCount`
    (null-vs-0, bfcache/pageshow refetch, races with the F10 pending-render resume).
 7. `scripts/exportTrack2Core.cjs` new counters — verify they don't touch the FROZEN certificate
    constants or the preregistration's decision rule.

JOB B — Full TypeScript test-forgery audit (fitted/tests, 54 files, ~11.5k lines).
Do NOT limit this to files the pass touched. Three vacuous pins already shipped here.
 - Build a claim inventory: for every behavioral guarantee the app makes, is there a test, and would
   it actually FAIL if the behavior regressed? Name the mutation. PERFORM the mutation for every
   load-bearing claim, confirm red, restore, verify restoration.
 - Sweep for all nine vacuous patterns listed in the plan doc.
 - Find claims with NO test at all; rank by what a regression costs a friend or the M6 corpus.
 - Verify every doc sentence of the form "pinned in X" / "mutation-proven" against reality. Correct
   any that are false — a doc asserting a guarantee that doesn't exist is load-bearing.

DELIVERABLE: fix what is load-bearing (map ripples first), register the rest as §23 holes, reconcile
docs in the same commits, and run BROAD convergence rounds until a fresh round returns zero
load-bearing findings. Report residuals explicitly. Do not deploy. State plainly at the end what is
still unverified — in particular, nothing in this pass has ever run in a real browser.
```

---

## SESSION 2 — The web app (`fitted/`), detective-style

```
Deep behavioral audit of the Next.js app. Read docs/plans/full-audit-2026-07-25.md FIRST and follow
its "Standing rules" exactly. Read-only subagents only. Trust no prior audit, doc, or test.

Scope: fitted/app, fitted/lib, fitted/models, fitted/components, fitted/scripts (~69 files, ~12.8k
lines). NOT the Python side (session 3).

Work like a principal engineer joining the codebase cold, with a tester's suspicion. Do not skim.
Choose a small number of entry points and DFS them to their leaves, understanding each fully before
moving on. Suggested entry points, each traced end-to-end through every branch:
 1. Auth + session: signin → /api/auth/sync → AuthGate → session cookie → image serving ownership.
 2. Ingestion: add item → validation → POST /api/wardrobe → clothingType/warmth derivation → Mongo;
    photo → downscale → POST image route → imageStorage → WardrobeImage.
 3. Recommend: dashboard Generate → /api/recommend → lib/mlRecommend → mlServiceClient → snapshot
    write → browser projection → render.
 4. Feedback: like/dislike → /api/interactions → binding → latest-state (§23-H61) → history curation.
 5. Deletion/erasure: item delete, wardrobe clear, DELETE /api/account three-phase sweep, the D2
    keep-referenced-photos carve-out.
 6. The export/monitor scripts that read the live corpus.

For each: enumerate the state space and walk every cell; fault-inject every boundary; hunt
absence-shaped defects. Ask at every step "what happens if this fails, and does the user find out?"
— the defect class this project keeps shipping is SILENT failure.

Priorities, in order:
 (a) Data loss or corruption (friend photos, wardrobe rows, snapshots, interactions).
 (b) Erasure correctness — "delete me" must actually delete (§23-H43/H74/H75).
 (c) Corpus integrity — anything that silently degrades what M6 will train on.
 (d) Security / untrusted input on authed routes (the app has open Google sign-up).
 (e) Silent user-facing failures and dead ends.
 (f) Cross-file contract drift (a value hand-copied between two files with no test).

Before ANY code change: write the map (exact lines, execution path, every other call site =
ripple check). Verify doc line-cites; they drift. Fix load-bearing findings, register the rest as
§23 holes, reconcile docs in the same commit. BROAD convergence rounds until a fresh round returns
zero load-bearing. Name residuals. Do not deploy.
```

---

## SESSION 3 — The Python substrate (`ml-system/`) + cross-runtime seams

```
Deep behavioral audit of the Python side and the seams between runtimes. Read
docs/plans/full-audit-2026-07-25.md FIRST and follow its "Standing rules" exactly. Read-only
subagents only. Trust no prior audit, doc, or test.

Scope: ml-system/fitted_core (18 files, ~8.7k lines), ml-system/service (10 files, ~1.6k lines),
ml-system/tests + service/tests (29 files), and the TS↔Python↔Mongoose contract surface. Use
ml-system/.venv (base anaconda numpy is broken).

 1. fitted_core DFS: sampler → validator → ranker → generation/rescue → response. Trace a real
    wardrobe through it with concrete values. Enumerate the degenerate closets (0 tops, dress-only,
    single item, all-unavailable, 300 items) and confirm each yields an honest outcome rather than a
    crash, an empty, or a misleading hint.
 2. The render service: auth, throttle ordering, the 500 wrapper, controls dedup/canonical-order,
    timeout budgets. §23-H76 records a REAL open defect — the Next timeout budgets ONE OpenAI call
    while the engine lawfully makes TWO. Verify it, and whether the margin test's premise is wrong.
    §23-H68 records effective concurrency 1. Do not hot-edit deployed config; propose and register.
 3. CROSS-RUNTIME DRIFT (highest value): every fact that must agree across Python/TS/Mongoose — enum
    values, numeric clamps, format regexes, wire field sets, timeouts. For each, is there a single
    generated source or a cross-runtime equality test? A hand-copied mirror with neither is the
    drift disease this project has already been bitten by. Enumerate them all; register the gaps.
 4. Python test audit, same rigour as session 1's TS pass: mutation-prove load-bearing pins, hunt
    vacuous/mirror tests, find unguarded claims.
 5. The frozen artifacts — ml-system/experiments/track2_transfer/preregistration.md(+.json),
    exportTrack2Core's certificate constants, the H26 frozen order. Verify NOTHING in the recent
    passes altered a frozen value or the decision rule. If a frozen artifact was touched, that is a
    blocker: report, do not "fix".

Same method and convergence rules. Fix load-bearing findings, register the rest as §23 holes,
reconcile docs in the same commit. BROAD convergence until a fresh round returns zero load-bearing.
Name residuals. Do not deploy; do not touch the Fly machine count.
```

---

## Open items for Brian (decisions, not audit work)

1. **`fitted/scripts/track2-users-peek.mjs` was deleted** by a review subagent and is unrecoverable
   (never committed). Decide whether to reconstruct it.
2. **Rating yield is the next binding constraint** (NOT a criticism of this pass — see the
   correction below). The prereg needs **≥25 accepted + ≥25 rejected** scoreable clusters; the live
   corpus is ~6 interactions. Nothing in this pass increases ratings-per-friend, and nothing was
   supposed to. Candidate for the next build: extend the empty-closet signpost to a confirmed
   **below-floor** closet (a signpost, not a gate — same §18 anti-guilt shape). It currently fires
   only at exactly 0 items, so the 3-item and 6-item closets — the ones that actually hit the render
   wall — get nothing proactive.

   > **Corrected 2026-07-25.** A convergence-round reviewer argued this pass "hardened the wrong
   > step," reasoning that Zhiyun bounced on rating yield rather than add-path friction. That premise
   > was **false**: her root cause was the clothingType mis-slot, which was diagnosed, migrated on her
   > live row, and re-verified on **2026-07-24** (runbook §8 "clothingType slot-correctness rollout",
   > steps 1–3 DONE) — a day BEFORE this pass, whose stated purpose was to flush out the REMAINING
   > first-use defects before the next recruit wave. It did exactly that, including two pre-existing
   > data-destroying bugs. The finding was relayed without checking it against the task's own stated
   > premise — the same "verify every subagent finding against source before acting" rule this
   > document mandates. Treat it as a worked example: an articulate reviewer reasoning from a stale
   > premise produces a confident, wrong conclusion.
3. **Nothing in the 2026-07-25 pass has run in a real browser.** Before any friend sees it: add an
   item with a real camera photo, replace a photo, use "Save & add another", and tap the location
   button — on a phone.
