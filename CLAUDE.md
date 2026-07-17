# CLAUDE.md

Guidance for Claude Code sessions in this repo.

## Project

**Fitted** — outfit recommender. Users upload clothing photos → CV service extracts attributes → wardrobe stored in Mongo → LLM-generated outfit candidates → Python sampler/ranker validates and ranks → structured feedback (`OutfitInteraction` + `FeedbackReason`) personalizes over time.

- **Deployed:** https://fitted-outfits.vercel.app/ (runs the team's repo, not this fork)
- **Upstream (team repo):** ucsb-cs148-w26/pj12-outfit-recommender — tracked as the `upstream` remote
- **This fork:** Brian-W-Li/fitted — Brian's solo continuation, focused on the `ml-system/` rewrite
- **License:** MIT (originally a UCSB CS 148 team project; git history preserves all contributors)

## Layout

This is a monorepo with the Next.js app in a subdirectory, not at root.

| Path | What |
|---|---|
| `fitted/` | The Next.js 16 + React 19 + Tailwind 4 app. **All web dev happens here.** |
| `ml-system/` | Python home for the v2 substrate (`fitted_core/`) plus the legacy rule-based demo. **`fitted_core/` is the current portfolio focus.** |
| `docs/` | Mixed active + archive docs. Start with `docs/README.md`; future direction lives in `docs/Fitted_Spec_v2.md`. |
| `meetings/`, `team/` | CS148 archive artifacts. Do not read for future-looking work unless explicitly asked for provenance/history. |
| `package.json` (root) | Thin — only delegates `test` to `fitted/`. Don't add deps here. |

## Run

All web commands run from `fitted/`:

```sh
cd fitted
npm install
cp .env.sample .env.local        # fill in real values, see "Env" below
npm run dev                      # http://localhost:3000
npm run build
npm run lint
npm test                         # jest
```

`ml-system/` standalone demo:

```sh
cd ml-system
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python3 outfit_recommender.py    # runs the rule-based demo on a hardcoded wardrobe
```

## Env (`fitted/.env.local`)

The first four are required end-to-end. Missing any → silent failures or 500s on the relevant routes. The last one (`CV_SERVICE_URL`) is optional (it degrades gracefully when absent).

| Variable | Used by |
|---|---|
| `NEXT_PUBLIC_FIREBASE_*` (4 vars) | Client-side Firebase Auth (Google sign-in) |
| `FIREBASE_SERVICE_ACCOUNT_KEY` | Server-side Firebase Admin (token verification) |
| `MONGODB_URI` | Mongo Atlas connection |
| `OPENAI_API_KEY` | The `gpt-5.4-mini` stylist. **C8 (half-1) retired the legacy in-Next OpenAI call**; post-cutover the key lives service-side (the Fly render service, m5-cutover §D5), not the Next app. The full env reconciliation (drop this row, add `ML_SERVICE_URL`/`FITTED_SERVICE_KEY`) lands with the C8 half-2 flag flip. |
| `CV_SERVICE_URL` | Optional CV-service endpoint; **no default** (the teammate HF Space was removed). The W-track replaces CV with Brian's own service (§18). |

Brian was on the original team, so the team's `.env.local` from CS 148 work is the fastest source. `.env.local` is gitignored.

## Where the recommendation flow lives

Read these before changing app-side recommendation wiring. These files are the deployed legacy vertical /
fallback arm, not behavioral truth; v2 wins when they disagree.

| File | Purpose |
|---|---|
| `fitted/app/api/recommend/route.ts` | The single recommend endpoint. **C8 rewrote it to the M5 dispatcher** (flag-ON → `lib/mlRecommend`; flag-OFF → §A degraded state). Legacy is deleted; regenerate is folded in (a `/render` with `parentSnapshotId`). |
| `fitted/lib/weather.ts` | Weather helper; still live — `lib/mlRecommend.ts` imports `getWeatherContext` to re-derive the bucketed Lens field |
| `fitted/models/*.ts` | Mongo schemas: `User`, `WardrobeItem`, `OutfitInteraction`, `WardrobeImage`, `GenerationSnapshot` (M4b; registered dormant) |
| `fitted/docs/ML_OVERVIEW.md` | Legacy deployed-app writeup. Prefer source code; v2 wins. |
| `fitted/docs/database.md` | Deployed-schema reference. Prefer `fitted/models/*.ts`; v2 wins for targets. |

## Current focus: `ml-system/` rewrite

Goal: build the v2 recommendation substrate first, then use it as the seam for the trained style-graph scorer. The substrate (`ml-system/fitted_core/` M0–M3 + the Spearhead rescue vertical) and the M4 data/snapshot layer are **built**. The **H26 compatibility spike** is **DONE** (C1–C6, 2026-07-05; offline; the zero-user demonstrable ML result): mechanical verdict **NO-GO by the frozen letter** — gate B "underpowered / inconclusive" (a power miss at the frozen N=500 cap, not an accuracy miss — the CI sits wholly above +δ) while gates A/D pass and the seam ablation falsified the item-level shape. Deliverable: `ml-system/experiments/h26/results.md`; M6 entry conditions in Spec §20/§23-H26/H28. **M5 service cutover is DONE** (C1–C8, `docs/plans/m5-cutover.md`; merged to `main` 2026-07-09): the intent-generic render core, reducers + `AffinitySignalScorer`, the stateless Fly.io render service, the full Next-side integration (recommend/interactions rewrite behind `USE_ML_SHORTLISTER`), the live GenerationSnapshot write + authenticity gate, and the daily/rescue UI — all landed; C8 half-2 validated locally on real `gpt-5.4-mini` (cloud Fly deploy deferred, `docs/plans/m5-c8-half2-runbook.md`). **Now: the post-M5 trust-restoration campaign** (`docs/plans/post-m5-reset.md` §4 — R0 diagnosed 2026-07-09). Sequence: consolidation → H26 ✅ → M5 ✅ → reset (Spec §20).

Maps to team issues **#84** (Brian's own: *"LLM prompts make it better"*) and **#112** (*"Shortlisting strategy for LLM context"*). The team's brainstorm in `ml-system/mlWhatWeAreGoingTodo` essentially specced it.

Sketch of the arc:

1. ✅ `fitted_core` M0-M3: sampler, validation boundary, ranker, regen controls, deterministic tests; closed.
2. ✅ Spearhead: orphan-item rescue end-to-end on the v2 pipeline (C1–C6; done 2026-06-25, specced in `docs/plans/spearhead.md`) — three new modules `generation`/`rescue`/`response` + the `Generator` seam + the C6 `evaluation`/`cli` eval surface, over the closed M0–M3 substrate. C6/H40 live-eval recorded in the plan's §E. Deferred feedback storage to M4.
3. M4: **✅ done** (C1–C8, `docs/plans/m4-data-model-migration.md` §14). **M4a** (data path — DB wipe, 5-value `clothingType` + keyword-derived `warmth`, PreferenceSummary rip, ingestion rebuild; C1–C3) committed + live-verified. **M4b** (dormant snapshot substrate — fitted_core version constants + `snapshot_serde` wire layer, the GenerationSnapshot model + immutability guard + indexes, the Python `GenerationSnapshotPayload` + Option-B trace siblings, the `wardrobeimages` cascade, the e2e contract fixture; C4–C8) committed + heavy-audited, ships dormant. `material`/`formality`/`styleTags` columns + cascade-redaction wiring scope-trimmed to later milestones. **M5 owns the live cutover — see the plan's §14.5 M5-handoff note.** Current suite floors: **≥1074 pytest (`ml-system/tests` + `service/tests`) / ≥305 (+1 skip) h26 pytest / ≥577 jest** (floors grow, never pins).
4. **H26 compatibility spike (offline, ✅ DONE 2026-07-05 — C1–C6; verdict NO-GO by the frozen letter (gate B power miss +3.02e-4 over δ at the N=500 cap; A/D pass; item-level seam shape falsified); deliverable `ml-system/experiments/h26/results.md`; completed build reference `docs/plans/h26-compatibility-spike-v2.md`):** a public-corpus content-compatibility baseline (Polyvore disjoint split; AUC + FITB vs a `gpt-5.4-mini`-as-judge baseline) — the zero-user demonstrable ML result + the go/no-go on the trained scorer; settles the H28 seam shape (pairwise/edge) before M5 wires it. It ran as its own rung before M5 (consolidation → H26 → M5), settling the seam shape before M5 wires any scorer call. The thesis is a **systems decision — _when does a tiny specialized model beat a per-edge LLM call?_ — not a quality contest** (`gpt-5.4-mini` is the production stylist — `recommend/route.ts`; a mini-tier model, so the bar is parity-not-superiority, and the §9 cost/determinism/availability table is the headline artifact); the **go/no-go is A∧B∧D** (the catalog→closet transfer is **reported, not gated** — too underpowered on one closet — and becomes an M6 re-measure entry condition); a no-go still ships as a clean engineering verdict. (Spec §20 + §23-H26/H28.)
5. M5: deploy the Python service; wire the Next app behind `USE_ML_SHORTLISTER`; live GenerationSnapshot write + the runtime authenticity gate; full recommend/regenerate rewrite.
6. M6: train the style-graph scorer — the content-compatibility prior lands on the §23-H28 pairwise/outfit-level `rank()` hook (not the item-level `SignalScorer` sampler slot, which stays the behavioral/personalization seam); evaluate with GenerationSnapshots + feedback. **H26 returned NO-GO by the frozen letter (a power miss, not an accuracy miss), so M6 does not proceed on H26's authority alone** — entry requires the pre-identified levers (extend gate-B power over the frozen question order; re-measure the catalog→closet transfer on powered real-ingestion / friend-closet data). See `ml-system/experiments/h26/results.md` §10.
7. Writeup: architecture diagram, methodology, before/after numbers.

The old `_score_outfit` interface in `ml-system/outfit_recommender.py` is legacy inspiration only. The active seams are `fitted_core`'s item-level `SignalScorer` protocol (the behavioral/personalization sampler slot, `docs/Fitted_Spec_v2.md` §10/§11) and — for the content-compatibility dive — the additive pairwise/outfit-level `rank()`/`RankerContext` hook reserved by §23-H28 (not yet in code).

## Canonical sources

This is an **overhaul**. The product direction is the **lens-first personal style graph**: turning a scattered closet into a graph where boards + routines reveal wearable connections between owned clothes (the "green-shirt" problem). The earlier v1.2 PDF is now the *engine substrate* underneath that vision, not the whole target. The single canonical, **editable** spec is `docs/Fitted_Spec_v2.md` — it supersedes the v1.2 PDF, `spec-resolutions.md`, and `scope-decisions.md` (all retired; their R#/S#/N# map forward via v2 Appendix A). Edit v2 in place; the old addendum-against-a-PDF pattern is dead.

**Authoritative for design:**
- `docs/Fitted_Spec_v2.md` — **the** canonical spec. Build-ladder tagged (`[NOW]`/`[NEXT]`/`[STAGED]`/`[NORTH-STAR]`); §23 is the live Open Holes Register. When v2 and deployed behavior disagree, v2 wins.
- `ml-system/fitted_core/`, `ml-system/README.md` — current substrate implementation. `docs/plans/m3-ranker.md` is the **completed M3 ranker reference** (C1–C6; per-checkpoint detail in its §11 checkpoint table); `docs/plans/m2-validator.md` is the completed M2 validator reference; `docs/plans/m0-m1-substrate.md` is completed M0/M1 context; `docs/plans/spearhead.md` is the **completed Spearhead reference** (orphan-item rescue, C1–C6; C6/H40 live-eval in its §E). `docs/plans/m4-data-model-migration.md` is the **completed M4 reference** (C1–C8; the §14.5 M5-handoff note records what M5 inherits/owns). `docs/plans/h26-compatibility-spike-v2.md` is the **completed H26 reference** (C1–C6; verdict NO-GO by the frozen letter; the deliverable is `ml-system/experiments/h26/results.md`). `docs/plans/m5-cutover.md` is the **completed M5 reference** (C1–C8; cloud deploy deferred to `docs/plans/m5-c8-half2-runbook.md`). **Next active work: the post-M5 trust-restoration campaign — `docs/plans/post-m5-reset.md` (§4 R0 diagnosed 2026-07-09). Sequence = consolidation → H26 ✅ → M5 ✅ → reset (Spec §20). M4/M5 done.**
- `docs/plans/*.md` — per-milestone plans produced by `/spec` or the `planner` subagent. Active execution plans.
- This `CLAUDE.md` — project conventions and scope.

**Authoritative for data shape:**
- `fitted/models/*.ts` — actual deployed Mongo schemas. **M4 already migrated them** (5-value `clothingType`, the `warmth` column, the `GenerationSnapshot` model, the `OutfitInteraction` binding/scope fields); M5 extends them further (the request adapter + the live snapshot write). Reference them for data shape, not for behavioral baselines.

**Historical context only — do not mine for architectural truth:**
- `docs/Fitted_Spec_v2_recovered_appendix.md` — preserved ambition, anecdotes, dream notes, user-story inventory, and north-star concepts from the Codex brainstorm. It is intentionally separate from the implementation-facing spec.
- `ml-system/outfit_recommender.py`, `ml-system/mlWhatWeAreGoingTodo` — legacy ML demo/brainstorm; useful context, not the active seam.
- `docs/plans/spec-resolutions.md`, `docs/scope-decisions.md` — retired ledgers superseded by `Fitted_Spec_v2.md` (folded in via its Appendix A concordance). Read only when hunting history. (The old CS148/v1.2 design docs `DESIGN.md`/`MANUAL.md`/`RECOMMENDATION_MODEL.md` were deleted in the 2026-07-06 doc-compaction — git history preserves them.)
- `meetings/`, `team/` — team artifacts (standups, contribution docs). Not relevant to the refactor.
- `fitted/docs/ML_OVERVIEW.md`, `fitted/docs/database.md`, `ml-system/cv-integration.md` — deployed/legacy references. For code changes, read the source files; for future targets, read v2.
- The currently-deployed app's behavior at fitted-outfits.vercel.app — what it does today is not a constraint on what v2 must do.

When uncertain whether to reference a doc: if it's not in the "Authoritative" lists above, don't bring it in unless directly asked.
For future-looking product/architecture analysis, do **not** read archive docs just because they mention
"design", "recommendation", "ML", "database", "team", or "meeting"; those names reflect the CS148/deployed
past, not the v2 target.

### Doc lifecycle (capacity + truth control)

The doc set must stay small, current, and internally consistent. Rules:

- **Single-home rule.** Every decision lives in exactly one authoritative doc —
  `Fitted_Spec_v2.md` is the canonical spec. Other docs (plans, session notes, memory)
  may *point* to a section, never restate it in full. Duplication is how docs drift.
- **Active docs are living, not immutable.** Stale or wrong content in active docs is
  **edited or deleted in place** — no amendment narrative, no preserved draft sections. Git
  is the archive; the active doc states current verified truth only. Retired historical docs
  may keep their old body only if they have an explicit retirement banner and are excluded
  from the default reading list. Distinction: keep **trap-guards** (rationale that stops a
  future implementer from re-making a mistake — e.g. R6's banker's-rounding warning);
  delete **evolution narrative** (what the doc used to say and when it changed) from active
  docs.
- **Conflicts are bugs.** If two docs disagree, `Fitted_Spec_v2.md` wins unless the conflict
  is entirely inside an active milestone plan. Fix on sight in the session that notices it —
  never leave a known conflict standing.
- **Default reading list** for a milestone session: `CLAUDE.md` + `Fitted_Spec_v2.md` + the
  active milestone's plan. Everything else — `sessions/`, completed plans, the retired
  PDF/ledgers — is on-demand reference, pulled only when a pointer leads there. **Execution
  sessions may scope the spec to the sections the active plan cites** (the plan names them);
  `/spec`/design/heavy-audit sessions read it whole.
- **Retirement.** When a milestone completes, its plan doc gets a `> COMPLETED <date>` header
  line and leaves the default list. `sessions/` notes are write-mostly: read only when
  hunting history, never required context. (Retired/historical docs are exempt from the
  truth standard; the ledger and active plans are not.)
- **Hole/conflict cadence.** Each milestone `/spec` opens by hole-checking and
  conflict-checking the docs it inherits. Active holes go in `Fitted_Spec_v2.md` §23, or in
  the active milestone plan if the issue is local to that milestone.
- **Compaction backstop.** In-place editing should keep active docs from accreting. The primary
  guardrail is **per-doc**: if any single active spec/plan exceeds roughly **1,500 lines**, spend a
  dedicated session compacting it. The default reading list (`CLAUDE.md` + spec + active plan) should
  stay under roughly **2,500 lines**; because the canonical spec legitimately spans M0–M6 + the §23
  holes register, the per-doc 1,500 ceiling — not a tight sum — is the load-bearing limit, and the
  next compaction trigger is the spec itself crossing 1,500.
- **Critical-usage recovery backstop.** If Claude sees usage/context critically low and likely
  cannot complete the current request, stop before the next risky edit or long-running task.
  Bring any document currently being edited to a safe or safe-enough stopping point (finish the
  current paragraph/table row; do not start a new broad rewrite), then write or overwrite
  `docs/sessions/RECOVERY.md`. Record: current request, files touched, what is done, what is
  partial, decisions made, commands/tests run or skipped, whether the stop is safe/safe-enough/
  unsafe, and the exact next 1-3 steps. Then send a final response with a pointer to that file. The next
  healthy session folds durable history into a dated session note or commit and clears/replaces
  the recovery scratch.

## Deletion license (refactor scope)

Canonical sources says the spec is the design target, not the deployed behavior. This extends
that to **code**: where existing app-side code is ugly, tangled, or fights the v2 design,
**mass deletion is on the table — not just refactoring around it.** This codebase carries heavy
migrational and structural debt (a 10-week class project: an abandoned early ML attempt, and
dresses bolted on at week 8 via string-matching over `category`/`name`/`subCategory` instead of
a first-class `clothingType` — see `docs/Fitted_Spec_v2.md` §6.1 / §19). Carrying that cruft
forward weakens the foundation.

This is a **license, not a default.** Measure before cutting. Guardrails:

- **Activation: M5 (cutover) and M6 (legacy retirement), NOT now.** M0–M3 are pure additive
  substrate in `ml-system/fitted_core/` — nothing to delete yet. `outfit_recommender.py` stays
  untouched until M6 (plan §1.5 decision 2).
- **Threshold:** any deletion under `fitted/` is a **design call** — get a Fable read first, same
  as any contract change.
- **Test:** if a code path would **not** survive the M5 `USE_ML_SHORTLISTER` cutover, it's fair
  game to delete cleanly. If it's still called by paths we keep, it gets **migrated, not deleted.**

## Out of scope (don't proactively work on these)

- **Public launch / user growth.** Teammates' framing; Brian has explicitly scoped to portfolio + technical depth. Don't suggest deploy / marketing / scaling work unless asked.
- **Visual try-on** (issues #82, #87–92). v2 candidate at most; diffusion-model territory; not the current dive.
- **Frontend redesign.** UX changes only if they're needed to demo the `ml-system/` work.
  **Exception: the wardrobe *ingestion* surface is in-scope** — it's the
  data faucet for M4/M6 (CV reliability, async/batch upload, review form). Tracked as the
  **W-track** in `docs/Fitted_Spec_v2.md` §18; sequenced adjacent to M4/M5, `/spec`
  before building.
- **`meetings/`, `team/`.** Class-project artifacts; leave alone.

## Conventions

- Match existing team code style — don't refactor for taste.
- Brian leads with systems engineering; he won't deep-read TS/Next.js. When writing app-side code, lean on plain explanation of what it does so he can verify behavior.
- For ml-system work, prefer source-grounded reasoning (datasets, eval methodology, citations to specific papers/issues) over vibes.
- Tests: `fitted/tests/` uses jest. `ml-system/tests/` uses pytest for `fitted_core`; add coverage as the rewrite lands.
- **Spec-first for non-trivial work.** For any task spanning more than 1–2 files or with unclear scope, prefer `/spec <slug>` (interview + write `docs/plans/<slug>.md`) or the `planner` subagent before coding. Spec-first beats code-first when sessions are days apart and context recovery matters.
- **Build-and-audit loop (standing procedure for implementation — run it without being re-prompted).** Brian wants long autonomous sessions, not step-by-step prompting. When executing a build ladder (the C1–Cn checkpoints in an active plan):
  - **Per checkpoint:** read the real files *first* (the plan's line-cites drift — verify before editing); implement matching team style; then run `npm test` + `npx tsc --noEmit` (scoped to touched files) + `eslint` on touched files; spawn **one** fresh-context review agent before calling the checkpoint done; fix what it finds, verifying each finding against source. This is the *light* loop — one agent, every checkpoint.
  - **At sub-milestone boundaries and before risky cutovers** (e.g. end of M4a, before the M5 flag flip — NOT after every checkpoint): run the **heavy loop** — a multi-round comprehensive audit with **parallel** subagents on distinct lanes (**ambition-merit**, correctness/edge-cases, spec↔code fidelity, test-quality/mutation, forward-compat to later milestones, security/untrusted-input, and — once fixes exist — regression-of-the-fixes). **Loop until a round returns no load-bearing findings.** Each round covers similar-but-different ground; **later rounds must re-audit the prior round's fixes** — fixes regress, proven repeatedly (a fix landed a new bug caught only by the next round, three times in the M4 session).
  - **Ambition-merit is a first-class lane, separate from fidelity ([[feedback_audit_ambition_merit]]).** Audit *two* questions, not one: (a) **merit** — is the north-star (the lens-first style graph / green-shirt promise / the M6 ML dive) *itself* still a good ambition worth pursuing? and (b) **fidelity** — are the committed decisions faithfully building toward it / has anything quietly drifted or narrowed? Most audits only ask (b); (a) is the one that catches a sound-but-misaimed project. Run merit as an adversarial multi-lens critique (product/market, ML-feasibility, architecture/effort-allocation, portfolio-value) with a **Fable synthesis** seat (promise-driven decisions), grounded in `Fitted_Spec_v2.md` + the recovered appendix + the *real* committed state — not flattery, not manufactured doom.
  - **"Load-bearing"** = would mislead an implementer, mis-store/corrupt data, break a downstream seam, or ship broken. Phrasing/style nits never block convergence — report-and-move-on.
  - **Verify before acting:** never trust a subagent's finding as authoritative — read the cited source yourself first ([[feedback_verify_before_answering]], [[feedback_citation_accuracy]]). Severity-grade; fix blockers/important; flag genuinely out-of-scope items as `spawn_task` chips, not scope creep.
  - **Keep canonical truth conflict-free:** when a fix makes code diverge from `Fitted_Spec_v2.md`/the active plan, reconcile the doc in the same pass (conflicts are bugs).
  - **Close the decision loop — a checkpoint isn't done until the docs that recorded the decision are current.** When a checkpoint implements a §23 hole or a plan decision, the SAME commit flips its status from any forward-looking pointer ("→ implement at Cn", "Cn next") to IMPLEMENTED/LANDED with the code cite. Mechanical check: grep the checkpoint/hole ID across the docs and confirm zero surviving forward-looking statements. A "→ implement" pointer outliving its Cn is the recurring drift that erodes trust in the register — the R0 sweep found H7/H8/H61 stale exactly this way.
  - **A cross-runtime fact needs a test, not a copy; a test must exercise the real unit.** Any fact that must agree across the Python↔TS↔Mongoose boundary (an enum, a numeric clamp, a format regex, a wire field set) gets a single generated source OR a cross-runtime equality test in the *same* checkpoint that introduces the second copy — a hand-copied mirror with neither is the drift disease. Likewise a test must IMPORT and exercise the real unit under test; an inline reimplementation (a "mirror") can never catch a regression. General principle: enforce process rules with CI-shaped artifacts (tests), not discipline — prose rules drift under context pressure (this doc already said "single-home / conflicts are bugs" and the staleness happened anyway).
  - Calibrate cost to risk: a trivial additive checkpoint gets the light loop only; the dormant-substrate one-way-door work (snapshot schema) and the live cutover get the full heavy loop.
- **Promise-driven decisions.** For non-trivial design calls: reason from the user-facing promise the decision serves (determinism/consistency, speed + convenience), teach the mechanics from first principles before deciding, and get a Fable review (`Agent` with `model: "fable"`) on the important ones. Record current resolutions in `docs/Fitted_Spec_v2.md` or the active milestone plan, not in retired ledgers. When Fable is unavailable, a thorough dual read substitutes for the important-call review — a deep first-principles code+doc review in-session plus an independent second pass, with both converging before the call is locked. Note the substitute review basis in the resolution.
- **Short sessions; externalize state.** Keep sessions short — long context is the main usage cost. Push durable state into `docs/plans/`, `docs/sessions/`, and memory so each session starts from a small reading list, not full history. `/clear` between unrelated tasks.
- **Past goes to commits; future stays in docs.** When writing or pruning a doc, sort content by orientation. **Past-oriented** content — what changed, when, why we picked X over Y, review history, fold-in narratives, "reviewed on date Z" annotations — belongs in the commit message, not the doc; delete it. **Future-oriented** content — how it works, the contract, what's planned, what a resolution *is* (not how we got there) — stays, living in exactly one place. The rule is **not** "delete past tense": past rationale that stops a future mistake (a *trap-guard*) stays, reframed as a forward warning. Example: R6's resolution text (the integer half-up split + the value table) is future and stays; the "Fable-reviewed, Brian pushed back" review history is past and belongs in the commit that landed R6 — but R6's banker's-rounding warning stays, because it stops a re-implementer from reintroducing the bug. When a sentence is genuinely both, keep it.
