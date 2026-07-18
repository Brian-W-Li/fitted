# Track 2 "stable version" audit — 2026-07-17

> Tracker for the audit-and-harden campaign driving `main` to a new STABLE, PUSH-SAFE state before
> Brian pushes/redeploys for friend data collection. Coordinator: Opus session. Auditors: 7 parallel
> fresh-context report-only lanes + a Fable ambition/ethics seat. **Brian pushes/deploys; this session
> never did.** Mission: `docs/plans/track2-stable-audit-prompt.md`.

## Ranges audited
- Honesty-pass diff `b1215625..af…HEAD` (client-only). Everything unaudited since the last certified
  push `af836070` (13 commits). Tree at start: `372707af`, clean, `main`.

## Green floors (run-verified this session)
- jest **674 passed** + 10 skipped (grew 649→674). pytest **1091 passed**. `npm run build` ✓. `tsc` ✓.
- 10 skips = 2 env-gated integration suites (`corpusReadback` ×8 needs live Atlas URI;
  `localServiceSmoke` ×2 needs the deployed Fly URL+key). No `it.skip`/`xit` anywhere — nothing
  surgically disabled.
- The gated **corpus-readback verifier was RUN live read-only** against the Track 2 Atlas: 8/8 pass
  (7 integrity + the new yield readout, which read Brian's cruft → "UNDERPOWERED, image-usable 0").

## Lane roster — all reported
| Lane | Angle | Headline |
|---|---|---|
| DP | data provenance + corpus validity | write path airtight; **no per-friend yield visibility** (fixed) + image-provenance chip |
| HON | honesty of copy | 3 live false/overclaiming strings (fixed); ingestion surface clean |
| FRIEND | first 20 min + chaotic input + mobile | double-tap dup item (fixed); add-another friction (deferred-by-design chip) |
| TRUST | privacy / deletion / dignity | **erasure promise HOLDS**, race closed, no load-bearing |
| FAIL | degraded states + money/abuse | friend-UX legible; **operator-blind** (no alerting) — ops chips |
| SEAM | integration + cross-runtime drift | **zero load-bearing**; "no wire-shape change" holds byte-for-byte |
| DRIFT | doc fidelity + deployed-vs-main | stale "SATISFIED" marker (fixed) + floor/H45 (fixed) |
| Fable | ambition/merit + anti-capture | rung-1 MEETS; data side FALLS SHORT on assured yield (2 decisions) |

## LANDED this session (committed on `main`, NOT pushed)
1. `99455ad5` — honesty copy: account age/gender claim (false), landing "ML model learn" (no learning
   model), dashboard "smarter" → truthful minimal corrections. Verified: age/gender referenced nowhere
   in the engine.
2. `2941e40c` — save re-entrancy latch (`savingRef`) so a sub-frame double-tap can't POST a duplicate
   item. Mutation-verified test (form submit ×2 in one tick → onSave once with latch, twice without).
3. `a0e2cc43` — per-friend corpus-yield readout in the gated verifier (photo coverage %, clothingType
   depth, like/dislike balance, image-usable likes, cohort vs 30–60 decidability bar). Read-only,
   assertion-free instrument. LIVE-VERIFIED: read the current cruft → "UNDERPOWERED, image-usable
   likes 0" (the 8 placeholders are 0%-photo).
4. `1ca0053e` — doc reconciliation: runbook §8 "SATISFIED"→"RE-OPENED" (live build is behind
   `main`; redeploy the web half + run erasure check before first friend); CLAUDE.md status; jest
   floor 649→663; Spec §23-H45 "→ implement at M5 C6" → IMPLEMENTED.
5. `a4983e1a` — D2 delete-cascade fix (see decisions below).
6. `f37da88b` — D1 one-tap dislike (see decisions below).

The jest floor grew to **674** after D1/D2; docs (CLAUDE.md / campaign / this tracker) still cite
663 as the post-doc-reconciliation number — update to 674 at the final doc pass if desired (663 is
still met, so no floor is broken).

## DECISIONS (Brian chose "fix both now" 2026-07-17 — both LANDED)
- **D1 — Feedback like/dislike asymmetry → FIXED `f37da88b`.** One-tap dislike posts `rejected`
  instantly (symmetric with Like); the structured reasons are an optional "Tell us why?" follow-up
  that re-posts `rejected` with reasons, collapsed by per-candidate latest-state (§H61) so the
  negative isn't double-counted. Yield readout deduped per candidate to match.
- **D2 — Item/clear delete photo cascade → FIXED `a4983e1a`.** `lib/imageReferences` keeps a
  snapshot-referenced image on item-delete and clear-wardrobe; account-delete still purges all
  (erasure). Mutation-verified real-Mongo behavioral tests (referenced image survives, unreferenced
  deleted, other-user ref doesn't protect).

## CHIPS (out of scope / ops — registered, not fixed)
- **OPS-1 (FAIL L1, high).** No proactive failure alerting — every degraded path is legible to the
  friend but invisible to Brian, so a $10-cap hit / M0-full / Fly outage silently stops a weeks-long
  collection. Mitigation is external (a `/readyz` uptime ping + an OpenAI usage alarm + an
  engine_failure-rate glance). Brian ops.
- **OPS-2 (FAIL I6).** Confirm the OpenAI $10 is a HARD project spend limit, not a soft email alert
  (an abuser at 12/min ≈ $52/day would blow past $10 on an alert alone). Dashboard check.
- **OPS-3 (FAIL I3).** Fly can silently re-spawn a 2nd HA machine on redeploy → doubles the 12/min
  global ceiling. Only guard is `fly scale show`. Confirm 1 machine after every deploy.
- **STORAGE-1 (FAIL I4/I5).** Per-user 80 MB image budget × base64 ×1.33 × 5 friends ≈ 530 MB > M0
  512 MB (safe for realistic closets, not for max); no per-user snapshot-count cap (failure rows can
  fill M0 under scripted abuse, bounded by 12/min). Backend/infra.
- **FRIEND-1 (yield, deferred-by-design).** 15 items = 15 modal open/close cycles (~135-150
  interactions); no "Save & add another." Deliberately deferred (honesty-pass C4/D4). Top of the
  next-pass list; flag the yield/dropout risk to Brian.
- **FRIEND-2 (edge).** Strict in-app-browser (IG/Messenger) sign-in can hang on "Signing in…"; common
  case handled by existing error copy + the runbook's "use a real browser" ask.
- **SEAM-1 (latent, pre-existing).** Client entry caps (25/60) are hand-copied literals in page.tsx,
  not imported from the server single-home (`mlRequestAdapter`), no equality test — values currently
  agree; classic drift setup if either side changes. Add an import or equality test when next touched.
- **SEAM-2 (pre-existing).** Edit always sends `size:""`/`notes:""` → wipes those on edit of any legacy
  item that had them. No UI for the fields; the fresh Track 2 corpus has none. 
- **M6-loader notes:** apply `exif_transpose` uniformly (small-photo skip path keeps EXIF; downscale
  bakes it); dedup positive labels by `fullSignature` (re-roll siblings); "accepted" = card-tap proxy,
  not a wear signal — record in the M6 methodology.
- **PRECEDENT (Fable M3).** When `wardrobe-ingestion-honesty-pass.md` retires, fold its yield-vs-
  integrity posture (nudge + honest label + out-of-band ask; never progress mechanics) into the spec
  (§18/§22) as the standing rule, so the next milestone doesn't re-litigate it.

## CLEARED (verified safe — no action)
Feedback binding server-derived + snapshot-scoped (no wrong-candidate path); photo-less items cleanly
excluded from the image measure; clothingType/warmth always valid; snapshot provenance complete for
M6. Erasure cascade covers all 5 owned collections; in-flight self-erase race closed; hard-delete
throughout; validator makes absurd outfits unreachable; rescue/daily degrade legibly; feedback taps
acknowledged. "No backend / no wire-shape / no derivation-seam change" holds byte-for-byte; jsdom
project no double-run; swatchColor single-source parity; crop-guard × CV-off × edit-photo composes.
Unauth strangers can't burn budget (every render/write route token-gated; service key HMAC). Color
save-flush rescues typed-but-un-added entries; magic-byte sniff rejects renamed non-images. H33
photo-copy consistent across all docs; honesty-pass ground truth matches source.

## Convergence gate
A fresh-context round on the FINAL post-fix tree must return zero load-bearing before DONE.
