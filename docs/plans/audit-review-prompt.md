# Review of the 2026-07-20 merit+live+dynamics audit — handoff prompt (next session)

> Authored 2026-07-20. Paste the block below into a fresh session verbatim. Delete this file (or
> banner it COMPLETED) once the session runs.

---

ultracode: Fresh-eyes verification of the 2026-07-20 merit+live+dynamics audit session (commit
`fd5b1448`; session record `docs/sessions/2026-07-20-merit-live-dynamics-audit.md`). That session
audited itself as it went, but self-review shares the author's blind spots — your job is to verify
its load-bearing claims and artifacts INDEPENDENTLY, not to re-run the audit. Scale: a focused
verification (a handful of parallel verify lanes + a synthesis), not a full fan-out. Severity bar:
load-bearing = would mislead an implementer, mis-store/corrupt data, break a downstream seam, or
ship broken. Report-and-fix small confirmed issues; anything structural becomes a finding, not a
rewrite.

Read first: CLAUDE.md · the session note above · `git show fd5b1448 --stat` (then the diff per lane).

Verify lanes (parallel where independent):

1. **The three new tests are real and load-bearing, not mirrors.** For each —
   `ml-system/service/tests/test_serialization.py`, the composed erasure-race test and the
   concurrent different-identity-409 test in `fitted/tests/mlRecommend.test.ts` — confirm they
   import and exercise the REAL units, then MUTATION-TEST them: break the guarded behavior in the
   source (e.g. comment out the mlRecommend step-11.5 `User.exists` self-erase; invert the
   identity-mismatch 409; sketch how the serialization pin would flip under an executor dispatch)
   and confirm each test goes red. A test that stays green under its mutation is a load-bearing
   finding. Restore sources after.
2. **The power-math claim** (the audit's single highest-leverage decision rests on it): re-derive
   from scratch whether the inherited H26 healthy band (`CI_low(AUC_closet) ≥ 0.70`,
   `CI_high(drop) ≤ 0.12`, catalog AUC 0.7315 per `ml-system/experiments/h26/results.md` §2/§6) is
   truly undecidable/unpassable at N≈30–60 outfit clusters. If the conclusion survives, say so
   plainly; if any constant or structural step was wrong, that is a TOP finding (it changes the
   Spec §20 M6-row resolution written in this commit).
3. **TOKCAP-1 discharge validity**: read the flipped records (`ml-system/service/config.py`,
   runbook §8, Spec §16, `docs/plans/m5-cutover.md`) against what was actually observed (a
   candidateRequested=12 render under cap 2200, re-roll 12/12 finish `stop`, root 11/12). Is the
   validated-record wording faithful — no overclaim (e.g. does anything now imply the cap was
   validated for RESCUE intent or for max-length-tag closets when it wasn't)? Is the
   `tokcap-full-ask` persona in `fitted/scripts/track2-gauntlet.mjs` correctly constructed to
   re-force ask=12 (check `_daily_candidate_requested` + `candidate_requested` in
   `ml-system/fitted_core/rescue.py`/`sampler.py`)?
4. **The new §23 holes H67/H68/H69 are accurate against source**: H67's arithmetic (base64 ×4/3,
   80MB budget, no GenerationSnapshot per-user ceiling — confirm by reading `lib/mlRecommend.ts`
   steps 4–12 and `app/api/wardrobe/[id]/image/route.ts`), H68's structural claim
   (`service/app.py` sync `handle_render` on the loop, no executor, 1 worker), H69's claim (no
   dimension parse anywhere in `lib/imageStorage.ts` / the image route). Also check the three
   entries don't contradict any existing hole or runbook text.
5. **Doc-fold consistency sweep**: the commit touched CLAUDE.md, README.md, docs/README.md, Spec
   (§16, §20 M6 row, §23), runbook §8 (checklist, onboarding message, load model, TOKCAP,
   deploy-state line), m5-cutover. Grep-check: zero surviving forward-looking TOKCAP-1 pointers;
   the README's new claims are true (M5 ✅ + live-system section; its stated floors 1098/786 match
   what the suites actually produce when you run them); the mermaid diagram renders (syntax-check
   the fence); no doc now contradicts another (conflicts are bugs — fix on sight).
6. **Live-residue + leftover check (read-only)**: confirm the gauntlet/TOKCAP run left zero rows in
   the live Atlas (the corpusReadback command in runbook §8, read-only) and that
   `ml-system/experiments/h26/gate_b_extension.py` (a parallel session's in-flight work) remains
   uncommitted and untouched — `git log --all -- ml-system/experiments/h26/gate_b_extension.py`
   should be empty. Do NOT run any TRACK2_LIVE_OK driver (spends money); read-only verification only.

Close: run the full suites (floors ≥1098 pytest / ≥786 jest, growing) + tsc + eslint. Output = a
verdict per lane (CONFIRMED / CORRECTED-with-fix / FINDING), the list of anything fixed, and an
explicit statement of what this review did NOT check. Fix-and-commit confirmed small issues on main
(never touching the uncommitted gate-B file); structural findings get written into the session note
+ reported, not silently rewritten.
