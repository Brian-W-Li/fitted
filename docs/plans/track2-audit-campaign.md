# Track 2 pre-push audit campaign

> **CONVERGED 2026-07-17** (initial convergence, then re-opened for the Brian-requested round-3
> push-gate review below and re-converged the same day). The stack is push-ready pending Brian's
> manual push + redeploy of BOTH halves — `npx vercel --prod` AND `fly deploy` (the runbook §8
> ops precondition — required BEFORE the first friend signs up). Residuals + follow-ups below
> are the honest remainder, all judged non-blocking.

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

## Round 3 — final push-gate review (2026-07-17, Brian-requested; 70% campaign / 30% app+ambition)

Four fresh lanes (UI↔bounds boundary, 12 suspicious areas, non-campaign M5 surfaces, a Fable
ambition/taste seat) + a coordinator deep-read. Landed in the round-3 commit: the batch-onboarding
duplicate-invite banner fix ("the item itself was saved"), entry-time chip caps (occasions 60/25,
colors 25), name maxLength, magic-byte image sniffing (the renamed-HEIC silent-broken-tile hole;
sniffed type is stored truth), the garbage-imagePath CastError guard + de-echoed upload 500s,
per-user interactions ceiling (2000 rows) + perItemFeedback dupe rejection, the render limiter
moved AFTER the §C.4 replay (an idempotent resume can't be rate-limited out of its paid render),
history-join projection (multi-MB reads → slim fields), and the Fable-lane mechanical taste set
(optionPath Reliable/Bridge/Stretch pills, rescue-item amber ring, dashboard rescue entry,
honest CV not-configured copy, truthful landing cards, AI→stylist rename, star-copy fix,
unrated-0 fix, signup sign-in link, rate-limited copy "in a minute").

**Lane F(2) taste verdicts:** all five campaign decisions KEEP (6/min ceiling sized to the real
Fly constraint with burst 6; 300/80MB derived from the M0; rejection-over-truncation; the 200-char
occasion pattern; photos-required ask). Campaign copy matches the house voice throughout.

## DRAFT-FOR-BRIAN (needs your voice — deliberately NOT AI-drafted)

- The spoken friend pitch (runbook §8 stays your crib sheet; deliver it in your words).
- The dashboard header/button ("Get Outfit Recommendations" / "Get Recommendations") — 2–3
  options worth sketching, not landing one.
- The landing identity line (the "Smart Wardrobe Assistant" badge + headline — "the green shirt
  you never wear" belongs on this page, and it should be your sentence).
- Any visible-personalization copy (e.g. "avoiding pieces you've disliked") — the wrong sentence
  fakes more intelligence than exists; registered below as a chip instead.

## Registered follow-ups (explicitly out of this campaign)

- **Repair-call timeout budget (service, pre-next-Fly-deploy-after-this-one):** the §12 parse-repair
  is a second full OpenAI call inside one `/render`; worst case 30s+30s beats the client's 45s
  abort → the friend waits 45s, BOTH paid calls are lost, and no snapshot lands (the §D
  failure-corpus promise defeated Next-side). Tail-rare (needs parse-failure AND both calls slow).
  Fix design: thread a per-request deadline so the repair call gets `min(OPENAI_TIMEOUT_SECONDS,
  remaining)`, NOT a blanket timeout cut — the 30s value is pinned cross-runtime in the §A.6
  generator-surface contract (~15 files), so the change must move both runtimes in lockstep.
- **Visible personalization (M6-era, with Brian's copy):** the AffinitySignalScorer/cooldown are
  live but never acknowledged on screen; the honest cheap version needs a small route change to
  surface what the reducers computed. The trust-lane + personalization surfaces are where the app
  stops reading as a GPT wrapper — both cheaper than they look (data already in the responses).
- **Round-3 closing minors (registered by the final reviewer, all non-blocking):** (a) a
  limiter-denied fresh render still pays the weather fetch + (for regens) the unprojected parent
  read before the pacer runs — zero spend/writes, but a scripted unique-requestId loop gets
  unbounded per-user Mongo/weather reads (fix sketch: requestId existence probe → limiter →
  identity build); (b) the dashboard rescue-entry banner shows for a zero-item user (copy
  prematurity — gate on wardrobe count if it grates); (c) occasion-chip errors render in the
  modal footer, not beside the input like color errors; (d) the interactions ceiling is
  check-then-create (concurrent posts at 1999 can land 2001 — soft bound, fine at friend scale);
  (e) the GET-join test doesn't assert optionPath/risk/template — the exact fields a future
  .select() edit would silently drop.
- **F10 resume weather-identity window:** the §C.4 render identity includes `weatherRaw`, so a
  minutes-scale temp drift between render and resume 409s ("generate again" — graceful copy).
  Fix options: freeze `{weather, weatherRaw}` into the pending envelope, or drop `weatherRaw`
  from the identity set. Contract-adjacent; not worth the churn pre-push.

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
Floors (run-verified 2026-07-17): jest ≥649, pytest ≥1091 — green and may grow, never shrink.

## Residuals ledger (from 46e6c2c6, updated by the lane landings)

Open (all judged non-blocking for the 3–5-friend cohort by Lane F):
- transparent-WEBP flattens to JPEG on client downscale (phone cameras emit JPEG/HEIC — rare input)
- multi-word color names render an empty swatch (cosmetic; data stored fine)
- account profile photo has no client downscale — a typical phone JPEG (>~2.2MB) gets "Photo is too large" every time (worse than first recorded: everyday rejection, not just the 413 edge; still an optional vanity feature — polish chip above)
- AuthGate first paint pays a sync+cookie round-trip (the price of the self-healing sync)
- no signInWithRedirect fallback for in-app browsers (copy + personal onboarding mitigate)
- bounds arithmetic note: 300 items × 5MB server image cap ≫ the 80MB byte budget (the budget binds first at ~80 full-size photos) — unreachable at friends-scale; make the pair mutually consistent if these bounds outlive Track 2

Closed by this campaign:
- ~~sync-E11000 branch untested~~ + ~~DELETE partial-failure branch untested~~ → Lane D (9452af5e)
- ~~interactions writer lacked the post-persist erasure check~~ → Lane B (51203254)
