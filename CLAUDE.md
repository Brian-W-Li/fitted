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
| `docs/` | Team-facing project docs |
| `meetings/`, `team/` | Class-project artifacts; don't modify |
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

All of these are required end-to-end. Missing any → silent failures or 500s on the relevant routes.

| Variable | Used by |
|---|---|
| `NEXT_PUBLIC_FIREBASE_*` (4 vars) | Client-side Firebase Auth (Google sign-in) |
| `FIREBASE_SERVICE_ACCOUNT_KEY` | Server-side Firebase Admin (token verification) |
| `MONGODB_URI` | Mongo Atlas connection |
| `OPENAI_API_KEY` | Main LLM in `/api/recommend` |
| `CV_SERVICE_URL` | Defaults to a teammate's Hugging Face Space (`theanimated01-fitted-cv.hf.space`) — likely brittle long-term; flag if it 404s |

Brian was on the original team, so the team's `.env.local` from CS 148 work is the fastest source. `.env.local` is gitignored.

## Where the recommendation flow lives

Read these before changing app-side recommendation wiring. These files are the deployed legacy vertical /
fallback arm, not behavioral truth; v2 wins when they disagree.

| File | Purpose |
|---|---|
| `fitted/app/api/recommend/route.ts` | Legacy main recommendation endpoint; rewritten at M5 |
| `fitted/app/api/recommend/regenerate/route.ts` | Legacy re-roll variant; folded into the single route at M5 |
| `fitted/lib/weather.ts` | Legacy weather helper; v2 re-derives weather as the bucketed Lens field |
| `fitted/models/*.ts` | Mongo schemas: `User`, `WardrobeItem`, `OutfitInteraction`, `PreferenceSummary`, `WardrobeImage` |
| `fitted/docs/ML_OVERVIEW.md` | Team writeup of the ML/CV design |
| `fitted/docs/database.md` | Schema docs |

## Current focus: `ml-system/` rewrite

Goal: build the v2 recommendation substrate first, then use it as the seam for the trained style-graph scorer. The immediate work is `ml-system/fitted_core/`: pure contracts, sampler, validator, ranker, cache/logging contracts, and later the M5 service boundary.

Maps to team issues **#84** (Brian's own: *"LLM prompts make it better"*) and **#112** (*"Shortlisting strategy for LLM context"*). The team's brainstorm in `ml-system/mlWhatWeAreGoingTodo` essentially specced it.

Sketch of the arc:

1. Finish `fitted_core` M1-M3: sampler, validation boundary, ranker, regen controls, and deterministic tests.
2. M4/M5: migrate data shape, add GenerationSnapshot / feedback authenticity, deploy the Python service, and wire the Next app behind `USE_ML_SHORTLISTER`.
3. Build the orphan-item rescue spearhead on the v2 pipeline.
4. M6: train the style-graph scorer at the `SignalScorer` seam; evaluate with GenerationSnapshots + feedback.
5. Writeup: architecture diagram, methodology, before/after numbers.

The old `_score_outfit` interface in `ml-system/outfit_recommender.py` is legacy inspiration only. The active seam is `fitted_core`'s `SignalScorer` protocol in `docs/Fitted_Spec_v2.md` §10/§11.

## Canonical sources

This is an **overhaul** (Brian, 2026-06-17). The product direction is the **lens-first personal style graph**: turning a scattered closet into a graph where boards + routines reveal wearable connections between owned clothes (the "green-shirt" problem). The earlier v1.2 PDF is now the *engine substrate* underneath that vision, not the whole target. The single canonical, **editable** spec is `docs/Fitted_Spec_v2.md` — it supersedes the v1.2 PDF, `spec-resolutions.md`, and `scope-decisions.md` (all retired; their R#/S#/N# map forward via v2 Appendix A). Edit v2 in place; the old addendum-against-a-PDF pattern is dead.

**Authoritative for design:**
- `docs/Fitted_Spec_v2.md` — **the** canonical spec. Build-ladder tagged (`[NOW]`/`[NEXT]`/`[STAGED]`/`[NORTH-STAR]`); §23 is the live Open Holes Register. When v2 and deployed behavior disagree, v2 wins.
- `ml-system/fitted_core/`, `ml-system/README.md`, `docs/plans/m0-m1-substrate.md` — current substrate implementation and execution plan.
- `docs/plans/*.md` — per-milestone plans produced by `/spec` or the `planner` subagent. Active execution plans.
- This `CLAUDE.md` — project conventions and scope.

**Authoritative for data shape:**
- `fitted/models/*.ts` — actual deployed Mongo schemas. These are what exists today; M4/M5 will migrate them to support the v2 contracts. Reference them for data shape, not for behavioral baselines.

**Historical context only — do not mine for architectural truth:**
- `docs/Fitted_Spec_v2_recovered_appendix.md` — preserved ambition, anecdotes, dream notes, user-story inventory, and north-star concepts from the Codex brainstorm. It is intentionally separate from the implementation-facing spec.
- `ml-system/outfit_recommender.py`, `ml-system/mlWhatWeAreGoingTodo` — legacy ML demo/brainstorm; useful context, not the active seam.
- `docs/plans/spec-resolutions.md`, `docs/scope-decisions.md` — retired ledgers superseded by `Fitted_Spec_v2.md` (folded in via its Appendix A concordance). Read only when hunting history.
- `docs/DESIGN.md`, `docs/MANUAL.md`, `docs/RECOMMENDATION_MODEL.md` — earlier design docs, superseded.
- `meetings/`, `team/` — team artifacts (standups, contribution docs). Not relevant to the refactor.
- The currently-deployed app's behavior at fitted-outfits.vercel.app — what it does today is not a constraint on what v2 must do.

When uncertain whether to reference a doc: if it's not in the "Authoritative" lists above, don't bring it in unless directly asked.

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
  PDF/ledgers — is on-demand reference, pulled only when a pointer leads there.
- **Retirement.** When a milestone completes, its plan doc gets a `> COMPLETED <date>` header
  line and leaves the default list. `sessions/` notes are write-mostly: read only when
  hunting history, never required context. (Retired/historical docs are exempt from the
  truth standard; the ledger and active plans are not.)
- **Hole/conflict cadence.** Each milestone `/spec` opens by hole-checking and
  conflict-checking the docs it inherits. Active holes go in `Fitted_Spec_v2.md` §23, or in
  the active milestone plan if the issue is local to that milestone.
- **Compaction backstop.** In-place editing should keep active docs from accreting; if a single
  active spec/plan exceeds roughly **1,500 lines**, or the default reading list exceeds roughly
  **2,000 lines**, spend a dedicated session compacting it.
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
  **Exception (Brian, 2026-06-11): the wardrobe *ingestion* surface is in-scope** — it's the
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
- **Promise-driven decisions.** For non-trivial design calls: reason from the user-facing promise the decision serves (determinism/consistency, speed + convenience), teach the mechanics from first principles before deciding, and get a Fable review (`Agent` with `model: "fable"`) on the important ones. Record current resolutions in `docs/Fitted_Spec_v2.md` or the active milestone plan, not in retired ledgers. **Fable is currently unavailable (2026-06-15):** in its place, a thorough dual read substitutes for the important-call review — a deep first-principles code+doc review in-session plus an independent second pass, with both converging before the call is locked. Note the substitute review basis in the resolution.
- **Short sessions; externalize state.** Keep sessions short — long context is the main usage cost. Push durable state into `docs/plans/`, `docs/sessions/`, and memory so each session starts from a small reading list, not full history. `/clear` between unrelated tasks.
- **Past goes to commits; future stays in docs.** When writing or pruning a doc, sort content by orientation. **Past-oriented** content — what changed, when, why we picked X over Y, review history, fold-in narratives, "reviewed on date Z" annotations — belongs in the commit message, not the doc; delete it. **Future-oriented** content — how it works, the contract, what's planned, what a resolution *is* (not how we got there) — stays, living in exactly one place. The rule is **not** "delete past tense": past rationale that stops a future mistake (a *trap-guard*) stays, reframed as a forward warning. Example: R6's resolution text (the integer half-up split + the value table) is future and stays; the "Fable-reviewed, Brian pushed back" review history is past and belongs in the commit that landed R6 — but R6's banker's-rounding warning stays, because it stops a re-implementer from reintroducing the bug. When a sentence is genuinely both, keep it.
