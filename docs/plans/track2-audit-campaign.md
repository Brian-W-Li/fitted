# Track 2 pre-push audit campaign

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
| B | Security / untrusted-input / spend-abuse on the live deployment (IDOR matrix, spend exhaustion, secret hygiene, PII) | pending |
| C | Wide diff catch-net: hunk-by-hunk over the full 42-file diff | pending |
| D | Test quality / mutation / coverage of the new Track 2 code paths | pending |
| E | Documentation consistency + spec↔code fidelity (runbook §8 claims, CLAUDE.md, single-home) | pending |
| F | Fable seat: ambition-merit (do 3–5 closets power the H26 re-measure?) + the privacy and ship-readiness policy calls | pending |
| Final | Fresh-context regression round on the post-fix diff; converged only at zero load-bearing | pending |

## Execution model

Lanes B–F fan out as parallel fresh-context **report-only** auditors. The coordinator
verifies every finding against source before acting, lands fixes serially (one commit per
lane), runs tsc + jest + build per landing, and keeps docs reconciled in the same pass.
Floors: jest ≥611, pytest ≥1075 — green and may grow, never shrink.

## Residuals ledger (logged in 46e6c2c6; re-verify status before re-reporting)

- transparent-WEBP flattens to JPEG on client downscale
- multi-word color names render an empty swatch
- sync-E11000 branch untested; DELETE /api/account partial-failure branch untested
- account profile photo uploads as a dataURL (~4.5MB exposure)
- AuthGate first paint pays a sync+cookie round-trip
- no signInWithRedirect fallback for in-app browsers (copy says use a real browser)
