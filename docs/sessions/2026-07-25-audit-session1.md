# Session 1 of the 2026-07-25 full audit — verification + TS test-forgery

> Write-mostly. Read only when hunting history. Current truth lives in `docs/Fitted_Spec_v2.md` §23
> and `docs/plans/m5-c8-half2-runbook.md` §8.

Ran SESSION 1 of `docs/plans/full-audit-2026-07-25.md`: verify the four-commit friend-first-use
hardening pass (`fa73be11..31b6df45`), and audit all of `fitted/tests/` for tests that are green
while measuring nothing.

## Method that actually found things

**Mutation, not reading.** ~30 source mutations: change the source, run the suite, require RED,
restore, `git diff --stat` to confirm restoration. Reading a test tells you what it *says*; mutating
the source tells you what it *measures*. Four of the five most important findings were invisible to
reading and only appeared under mutation.

**Three read-only lanes in parallel, then verify every finding against source myself.** The lanes
(vacuous-test sweep / untested-guarantee inventory / doc-claim verification) produced ~40 candidate
findings; ~6 did not survive verification, including one flagged as a blocker that turned out to be a
limit the target file already documented in prose. One lane correctly flagged an item as UNSURE that I
had also suspected — mutation settled it as SOUND. Both directions of error appeared, so neither
"trust the agent" nor "distrust the agent" is the rule; verify.

## What the pass got right (verified, not assumed)

All six original fixes are correct. Specifically re-derived:

- **Image-replace ordering** is genuinely store → repoint → delete; every failure arm leaves the old
  photo intact. Byte-budget overshoot quantified: ≤ one `MAX_WARDROBE_IMAGE_BYTES` (5MB) for the
  duration of one `deleteOne` — immaterial against DEFECTS-H67's ~107MB-per-at-cap-account arithmetic, so
  H67 needed no amendment. The erasure guard (§23-H43/H74) still holds; `cascadeDeleteUserData` covers
  all four collections including D2-retained images.
- **The EXIF fallback is correct in all four paths** (small-file skip, successful downscale,
  `from-image` decode rejection, non-shrinking re-encode). Every path leaves stored orientation either
  already-upright or EXIF-recoverable, so `exif_transpose` at embed time (§23-H53) is never a silent
  no-op. Cost registered as H79(b).
- **The slot census is well-founded against the real engine.** `candidate_requested` in
  `fitted_core/sampler.py` really is `n_tops * n_bottoms + n_dresses`, so the dress-only carve-out is
  right, and the `(0 tops, N bottoms, D dresses)` asymmetry is justified — adding one top there DOES
  unlock outfits, whereas at `(0, 0, D)` adding one piece alone does not. Every healthy-empty engine
  path sets `reason_hint`, so no census shape lands without a diagnosis or a hint.
- **The M6 export counters** are purely additive, mirror `buildCertificate`'s `imageUsable` predicate
  exactly, and touch no frozen value. The preregistration files are untouched by the pass, and the
  `CERTIFICATE` ↔ `preregistration.json` equality test still passes.

## What was actually broken (all closed, all mutation-verified)

The pattern: **the pass's own fixes were mostly right; what was missing was anything that would stop
them from being silently undone.**

1. The store→repoint→delete order — one of the two data-destroying bugs it fixed — had **no
   regression test**. Reverting it left all 17 image-route tests green.
2. `lib/db.ts` was mocked by all 12 suites that touch it, so `deleteUserWithData` (the only door that
   erases a friend's data) and `initDatabase` (the only index builder in production) had **never been
   executed by any test**. `accountDeleteRoute.test.ts` documented that in prose.
3. `/api/images/<id>`'s `Cache-Control: private` was unasserted — one word (`public`) leaks friend
   photos through Vercel's edge CDN, bypassing the ownership check the suite *does* test.
4. `GET /api/wardrobe`, the one read returning a whole closet, had no cross-user test.
5. Six one-sided numeric thresholds: `MAX_UPLOAD_BYTES` 4MB→8KB, `MAX_WARDROBE_IMAGE_BYTES` 5MB→64B,
   the Content-Length pre-check to `> 0`, `MAX_PICK_BYTES` 40MB→9MB — all green.
6. Three assertions that could not fail, plus a prototype-stub leak in the file whose own comment
   warned about prototype-stub leaks.
7. §23-H14 still registered the image-replace ordering as DEFERRED-W-track a day after it was fixed —
   the drift that invites a future session to re-revert it. The runbook simultaneously claimed
   "redeployed to HEAD" at a six-commit-stale SHA and "awaiting Brian's deploy".

## Traps worth remembering

- **A boundary test sized from the constant under test pins nothing.** First attempt at the
  `MAX_UPLOAD_BYTES` bracket used `installWorkingDownscaler(MAX_UPLOAD_BYTES + 1)`; halving the
  constant stayed green because the fixture halved with it. Bracket from ABSOLUTE endpoints chosen for
  the real-world claim, or assert the inequality against an external fact (Vercel's ~4.5MB body cap,
  the 16MB BSON limit after base64 inflation) — never restate the value.
- **An index-existence assertion cannot pin `initDatabase`'s `init()` list.** `connectMongo` sets
  `autoIndex: NODE_ENV !== "production"`, so under jest mongoose builds every index regardless;
  deleting the whole list left the assertion green. Pin the CALLS.
- **`expect(x).toBe(process.env.NODE_ENV === "production")` is a tautology in a test env.** For the
  session cookie's `Secure` flag, set NODE_ENV *before* the import and assert `true`.
- **`jest.resetModules()` near mongoose gives a second uncollected instance and jest never exits.**
  Cost 15 minutes of a hung suite; the fix is simply not to reset.
- **`lib/mongodb` memoizes on `globalThis`, which is shared across test FILES in a worker** (module
  registries are not). Any suite driving the real `connectMongo` must clear it in `afterAll`.

## State at close

- Commits: `3d7cfed9` (+ a convergence follow-up if one landed). Suite **888 → 922** green
  (+10 skip, 2 env-gated); `tsc` clean; `eslint` clean on touched files; `npm run build` clean
  (the two new `export`s on a live page + route handler are safe).
- **Nothing deployed.** Live web remains `46857aab`; `main` is ahead by the hardening pass + audit.
- New holes: **DEFECTS-H78–H82** (PATCH-able `imagePath` → foreign photo in the M6 export; double decode
  per pick + the EXIF yield cliff; store-succeeded/repoint-failed orphan; non-atomic
  `clearWardrobe`; the residual coverage backlog for session 2).
- `docs/Fitted_Spec_v2.md` is now **~1455 lines** — the 1500-line compaction trigger is close.
