# 2026-07-20 — Post-deploy merit + live-truth + dynamics audit (the three tracks the same-day drift audit didn't cover)

Charter: `docs/plans/merit-live-audit-prompt.md` (deleted this commit — it ran). Orchestration: 4 merit
lens agents + Fable synthesis (Track A) · sequential live verification (Track B) · 2 dynamics finders +
Fable verification + implementation (Track C). Decisions were folded into their single homes in this
commit (Spec §20 M6 row + §23-H67/H68/H69 · runbook §8 pre-recruit checklist/message/load-model ·
CLAUDE.md focus · README/docs-README truth refresh); this note is the session record, not a second home.

## Track A — decision memo (Fable synthesis over 4 adversarial lenses)

Per-lens: **Product** GO (rescue/green-shirt wedge right + genuinely shipped; but no "lens" exists yet and
the friend week as scripted observes a closet-grounded stylist, not a graph) · **ML-feasibility** GO on
the systems thesis, with the audit's sharpest finding: **the inherited H26 healthy band is structurally
undecidable at friend-cohort N** (the CI_low≥0.70 floor read needs a point estimate above the catalog AUC
itself; the drop≤0.12 read fails at true drop 0 half the time; deciding 0.12 at the H26 point needs
N≈200 clusters vs the ~18–35 a 3–5-friend cohort yields) · **Architecture** correctly sized on all three
interrogated targets (contract pins / Fly service / W-track deferral); under-built = alerting +
G1-pin enforcement (both discipline, not CI artifacts) · **Portfolio** strong three-legged story whose
front door denied its own live half (fixed this commit).

**THE single highest-leverage change (unanimously supported): pre-register the Track-2 re-measure
decision rule BEFORE the first friend's data is exportable** — two-boundary directional rule +
accepted-vs-rejected primary read + a scoreable-cluster export certificate (full resolution: Spec §20 M6
row). It is the only change addressing a near-certain failure (a third underpowered inconclusive), it is
a one-way door (a rule written after seeing data is worthless), and it roughly doubles information per
friend. Ride-alongs (runbook §8 pre-recruit checklist): push+redeploy, staggered onboarding (H68), the
cron monitor, the rescue-task onboarding sentence (added). KEEP: sequencing recruit → (gate-B ∥
embedding) → M6; the architecture; writeup-deferral (front door now current). KILL: the inherited band
as acceptance criterion; synchronized friend evenings. Convergence signal: Lenses 2+3 independently —
"there is a short pre-recruit build window and it is the last one."

Gate-B extension: worth it (~$1–2, near-certain pass; pre-commit N′ once, in advance). A parallel
session's in-flight `gate_b_extension.py` (uncommitted) already takes the separate-ledger approach that
sidesteps H56 — reconcile H56's register entry when that lands.

## Track B — live truth (all 7 CLOSED, 2026-07-20)

1. `fly scale show` → **exactly 1 machine** ✅
2. Live web = deployment `dpl_BUgbcC…` aliased `fitted-three.vercel.app`, **gitCommitSha `30b03cc9`** —
   exactly what §8 claims ✅ (found+fixed a stale "Phases 1–3 NOT yet deployed" line — they're ancestors
   of the live build). Residual: `217a6ee3`'s behavior-preserving runtime refactors are committed but
   not deployed (checklist item 2).
3. Env posture ✅ — `M5_MAX_COMPLETION_TOKENS` unset on BOTH (the pinned 2200 defaults are load-bearing,
   and the live snapshot's `maxCompletionTokens:2200` proves the default active); `ML_SERVICE_TIMEOUT_MS`
   + `CV_SERVICE_URL` unset; `USE_ML_SHORTLISTER` proven `"true"` functionally.
4. Key equality **proven functionally** (authed render 200; Fly has no NEXT slot → equality is vs
   `SERVICE_KEY_CURRENT`). Hash comparison impossible: Vercel marks the env sensitive (pull returns
   literal `[SENSITIVE]`) — itself a good posture fact.
5. `/readyz` green (fittedCore 0.5.0, prompt m5-c1.v1) ✅
6. Gauntlet render → feedback accepted+rejected both 200 (**bindable:true**) + erasure gate re-passed
   (**37 rows → 0**, Firebase binding gone) ✅
7. **TOKCAP-1 DISCHARGED at the literal worst case**: new `tokcap-full-ask` persona (16 items) forced
   `candidateRequested=12` under the live 2200 default → re-roll returned **12/12 outfits, finish
   `stop`**, one attempt, clean parse (root 11/12, also `stop`); snapshot-verified pre-erasure.
   Records flipped in `service/config.py` + runbook §8 + Spec §16 + m5-cutover. (Correction surfaced:
   the ask hits 12 for any pool with ≥2 tops × ≥2 bottoms — "6–7" was returned-count, not ask.)

## Track C — dynamics (finders → Fable verify → landed)

**Tests landed (floors 1097→1098 pytest / 784→786 jest):**
- `ml-system/service/tests/test_serialization.py` — pins H68's concurrency=1 (a parked render blocks
  `/readyz`); EXPECTED to flip when the executor fix lands (that flip is the fix's proof). Harness:
  `helpers.http` refactored to expose `http_async`.
- `fitted/tests/mlRecommend.test.ts` — composed erasure race: the REAL `DELETE /api/account` completes
  while a render is parked in `callService`; asserts zero rows across all 5 collections + non-bindable
  response (docblock records the one window no seam can compose — the hand-injection test remains its
  guard).
- `fitted/tests/mlRecommend.test.ts` — concurrent duplicate `requestId` with DIFFERENT identity: the
  post-write G5 409 arm (previously dead code in the suite) → one 200 winner + one 409 with no token;
  stored occasion = the winner's.

**Registered:** §23-**H67** (Atlas M0 aggregate capacity: base64 ×4/3 → ~4.8 at-cap image accounts fill
the cluster; GenerationSnapshot has no per-user ceiling) · **H68** (renders execute on the single ASGI
event loop) · **H69** (no pixel-dimension bound — gates the M6 decode path). **Modeled into runbook §8:**
the token-bucket friend-evening table (bucket comfortable; H68's queue is the binding constraint) + the
worst-case input-cost line (~$0.12 bounded by existing caps).

**Killed by the verify seat (with corrected coverage claims):** double-DELETE 500 (client latch + two
confirms make it unreachable; taste chip only) · H61 concurrent-feedback (already covered at
`interactionsBinding.test.ts:436-467` + the three-runtime same-ms tie fixture — the finder missed both) ·
cap TOCTOU (cosmetic soft bound) · A2's "no per-user render limit" (a 6/min limiter exists —
`mlRecommend.ts:193`; the storage half survived into H67) · the reroll-preserves-results jest half
(truth table already pinned in `renderResultGuards.test.ts`; page-level RTL infra is an already-registered
residual).

## Explicitly UNCOVERED after this session

- The **H43 middle window** (write landing between the cascade sweep and the user row's death) is still
  only guarded by the hand-injected phase-3 test — no injection seam exists to compose it with a real
  render.
- **H68 was code-read + pinned, never load-tested** — the queue model is arithmetic, and Fly's proxy
  behavior toward an unhealthy-while-blocked machine is unmodeled; staggering is a mitigation, not a proof.
- The **personal-graph arm still has no scheduled evidence path** (Lens 1's deepest point) — the friend
  week observes the universal prior's inputs; B-track remains unbuilt with no new commitment either way.
- **Browser-layer dynamics** (double-taps, spinner honesty under the real 20–40s cold path) remain
  manually-verified only — the client-test-infra decision is a standing registered residual.
- Fable-seat spot-checks verified the load-bearing lens cites, but Lens 2's exact CI constants were
  checked directionally, not re-derived — the prereg session re-derives its own N′ and boundaries.

## 2026-07-21 — fresh-eyes verification of this audit (independent review, coordinator session)

A fresh session re-verified this audit's load-bearing claims independently (6 read-only lanes +
the coordinator's own mutation testing + suite run). Verdict: **the audit stands** — one
load-bearing overclaim corrected, small truth-refreshes applied, everything else CONFIRMED.

- **Power math (Lane 2): CONFIRMED.** The H26 healthy-band structural-undecidability arithmetic
  was re-derived from scratch (Hanley-McNeil, catalog AUC 0.7315) — every constant in the frozen
  `preregistration.md` §9 reproduced; the Spec §20 M6-row resolution rests on sound math.
- **The three dynamics tests (Lane 1): CONFIRMED load-bearing** by mutation. Serialization pin →
  red when `handle_render` is dispatched off-loop (order flips to `[readyz, render]`); composed
  erasure race → red when the step-11.5 `User.exists` self-erase is disabled (`bindable` returns
  `true`); different-identity 409 → red when the post-write G5 `!identityMatches` is inverted
  (both arms return 200). All sources restored via `git checkout`.
- **H67/H68/H69 (Lane 4): substantively accurate.** H68 (renders on the single ASGI loop) and H69
  (no pixel-dimension bound) confirmed against source; H67 arithmetic sound. One small figure fixed:
  H67 said "renders 6/min/instance" — the token bucket is 12/min sustained (burst 5, refill 0.2/s).
- **Doc-fold + prereg fold-in (Lanes 5, 7): CONFIRMED,** no cross-doc contradictions; prereg homes
  (Spec §20 M6 row / runbook §8 / preregistration.md ↔ .json ↔ CERTIFICATE) mutually consistent.
  Fix-on-sight floor refresh applied (ground-truth suites: 1098 ml-system pytest / 308 (+2 skip)
  experiments / 793 jest) across README, CLAUDE.md, runbook §8.
- **Git hygiene (Lane 6): clean** — `gate_b_extension.py` untouched/uncommitted; tree otherwise pristine.

**LOAD-BEARING FINDING — TOKCAP-1 discharge was DAILY-only; records overclaimed (now corrected).**
The pre-C5 empirical gate (`m5-cutover.md`) named **two** worst-case asks to validate at the 2200
cap: a worst-case **daily** ask *and* a worst-case **rescue** ask. The 2026-07-20 discharge ran only
the daily case (`candidateRequested=12`). Rescue's ask is *not* bounded by the daily-12 cap —
`_rescue_candidate_requested` (`fitted_core/rescue.py:472`) clamps to [6, 40], so a forced
optional over a rich closet can ask up to 40 drafts (~6,800 tok >> 2,200). The records
(`service/config.py`, Spec §16, runbook §8, `m5-cutover.md`) presented the daily-12 discharge as the
whole "capped worst case." Corrected this session: all four homes now scope the discharge to the
DAILY worst case and register the un-revalidated rescue ask as graded residual **TOKCAP-2** (runbook
§8). Not a shipping blocker — the ask is an upper-bound hint and a large rescue yield degrades
gracefully (truncation → repair → "couldn't find enough", never a 500); friend closets are small
(the live one-green-shirt rescue asks 9). To fully discharge: a worst-case-rescue gauntlet persona.

**NOT changed (out of fold, reported):** `docs/plans/friend-facing-fixes.md:21` carries a stale
"NOT yet deployed" line, but it is a completed/retired plan doc (its fixes are ancestors of the live
build `30b03cc9`) and exempt from the active-truth standard — left as-is.
