# Track 2 pre-push audit campaign

> **CONVERGED 2026-07-17.** All lanes run and landed; the final regression rounds returned zero
> load-bearing on the closing tree. The stack is push-ready pending Brian's manual push +
> Vercel redeploy (the runbook §8 ops precondition — required BEFORE the first friend signs up).
> Residuals + follow-ups below are the honest remainder, all judged non-blocking by Lane F.

> Status tracker for the pre-push audit of the Track 2 deployment work. Goal: converge
> `git diff 2df4ea75..HEAD` to a stable, push-safe state for friend use. Brian pushes
> manually after all lanes converge. Everything before 2df4ea75 was certified by earlier
> campaigns (the 2026-07-06 full audit + the post-M5 reset lanes) and is out of scope.

## Scope

- **Base:** `2df4ea75` (Post-M5 Track 1 close — last reviewed state).
- **Under review:** cb29ac57 (deploy), 46e6c2c6 (friend-readiness fixes), 3a652675 (Lane A),
  3ae0fbe3 (Lane G), dcd234ed (docs), 3a9008d4 (Lane H). Later lanes treat earlier lanes'
  fixes as auditable surface, not trusted — fixes regress.
- **Deployed reality:** `docs/plans/m5-c8-half2-runbook.md` §8 is the single source of truth.
  Live with real spend: fitted-three.vercel.app (Vercel) → fitted-render-service.fly.dev
  (Fly, exactly 1 machine) → Atlas M0 `fitted`. Purpose: 3–5 friend closets → the M6/H26
  re-measure gate (Spec §20). Data collection, not a launch.

## Lanes

| Lane | Scope | Status |
|---|---|---|
| (trio) | 3 fresh-context audits: wardrobe ingestion, recommend/feedback, new-user auth | DONE — 46e6c2c6 |
| A | Correctness/edge-case deep-read of the friend-readiness fixes | DONE — 3a652675 |
| G | Corpus audit: account deletion = erasure (H43), live-corpus read-back verifier | DONE — 3ae0fbe3 + dcd234ed |
| H | Deployed-service audit (ml-system as deployed): surrogate→500 corpus loss + cross-runtime pins | DONE — 3a9008d4 |
| B | Security / untrusted-input / spend-abuse on the live deployment (IDOR matrix, spend exhaustion, secret hygiene, PII) | DONE — 51203254 (IDOR/secrets clean; storage bounds + per-user render pacing + interactions erasure-race landed) |
| C | Wide diff catch-net: hunk-by-hunk over the full 43-file diff | DONE — 959a28fb (no load-bearing; cargos keyword + env.sample warning + honest re-derive comment) |
| D | Test quality / mutation / coverage of the new Track 2 code paths | DONE — 9452af5e (2 load-bearing holes guarded, mutants killed at landing; verifier mirror pinned) |
| E | Documentation consistency + spec↔code fidelity (runbook §8 claims, CLAUDE.md, single-home) | DONE — this commit (§19/§20/H13/H28 reconciled; floors run-verified) |
| F | Fable seat: ambition-merit (do 3–5 closets power the H26 re-measure?) + the privacy and ship-readiness policy calls | DONE — this commit (all four verdicts GO/GO-WITH-CONDITIONS; data-shaped onboarding ask + §H43 scope note landed) |
| Final | Fresh-context regression round on the post-fix diff; converged only at zero load-bearing | CONVERGED 2026-07-17 — round 1 (828f320d): 0 blockers, 1 test-shaped load-bearing fixed + mutant-killed; round 2 on the fix diff: 0 load-bearing, verdict CONVERGED; the round-2 replace-edge minor fixed + pinned in the closing commit |

## Lane F verdicts (2026-07-17, Fable seat)

- **Merit — GO-WITH-CONDITIONS.** The two M6 entry levers are decoupled: gate-B repower is
  corpus-side and friend-independent (~100–250 more judged questions from the frozen
  `fitb_order.json`, ≈$0.41–$1.03 — see the registered micro-session below); the friend closets
  power ONLY the catalog→closet transfer, and 3–5 *photo-bearing, category-deep, feedback-active*
  closets sit in the needed ~30–60-positive-outfit range. The onboarding ask was rewritten
  data-shaped (runbook §8) so recruiting can't "succeed" while the transfer stays at effective-N=6.
- **Privacy — GO with one sequencing condition.** The shipped H43 erasure is defensible
  delete-means-delete; the runbook copy now carries the honest third-party-residue scope note.
  Condition: **push + redeploy BEFORE the first friend signs up** (the live app still runs the
  pre-audit build — ops-note precondition in runbook §8).
- **Ship-readiness — GO.** No must-fix among the residuals; worst (in-app-browser sign-in) is
  mitigated by personal onboarding + the sign-in-page copy.
- **Fidelity — GO.** H28 rank hook still open; SignalScorer seam exercised; Lane G field-verified
  the corpus feeds the re-measure. The only drift found was the recruiting guidance itself (fixed).

## Registered follow-ups (explicitly out of this campaign)

- **Gate-B repower micro-session (pre-M6, decoupled from recruiting):** rework the H56 repower
  tooling ledger ergonomics (append/keep-last, not delete-then-regenerate), then judge +100–250
  more questions in the frozen order (≈$0.41–$1.03) to close the +3.02e-4 half-width miss.
  Friend data contributes nothing to this lever.
- **Client-side test infra (jsdom + RTL) — an explicit decision, not a default:** the unguarded
  client cluster (re-roll veto *wiring*, edit-modal input-loss fix, resume occasion restore,
  delete-account client flow, prepareImageForUpload) is only honestly testable with component
  rendering; one infra investment would cover all of it. Until decided, the compensating control
  is the runbook §8 manual E2E.
- **Optional polish (Lane F #6):** reuse `prepareImageForUpload` for the account profile photo
  (kills the dataURL ~4.5MB 413 dead-end on an optional vanity feature).

## Execution model

Lanes B–F fan out as parallel fresh-context **report-only** auditors. The coordinator
verifies every finding against source before acting, lands fixes serially (one commit per
lane), runs tsc + jest + build per landing, and keeps docs reconciled in the same pass.
Floors (run-verified 2026-07-17): jest ≥643, pytest ≥1091 — green and may grow, never shrink.

## Residuals ledger (from 46e6c2c6, updated by the lane landings)

Open (all judged non-blocking for the 3–5-friend cohort by Lane F):
- transparent-WEBP flattens to JPEG on client downscale (phone cameras emit JPEG/HEIC — rare input)
- multi-word color names render an empty swatch (cosmetic; data stored fine)
- account profile photo uploads as a dataURL (~4.5MB 413 dead-end on an optional feature — polish chip above)
- AuthGate first paint pays a sync+cookie round-trip (the price of the self-healing sync)
- no signInWithRedirect fallback for in-app browsers (copy + personal onboarding mitigate)

Closed by this campaign:
- ~~sync-E11000 branch untested~~ + ~~DELETE partial-failure branch untested~~ → Lane D (9452af5e)
- ~~interactions writer lacked the post-persist erasure check~~ → Lane B (51203254)
