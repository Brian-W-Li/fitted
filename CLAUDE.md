# CLAUDE.md

Guidance for Claude Code sessions in this repo.

## Project

**Fitted** — outfit recommender. Users upload clothing photos → CV service extracts attributes → wardrobe stored in Mongo → LLM-generated outfit recommendations (weather-aware) → feedback loop (`OutfitInteraction`) personalizes over time via `PreferenceSummary`.

- **Deployed:** https://fitted-outfits.vercel.app/ (runs the team's repo, not this fork)
- **Upstream (team repo):** ucsb-cs148-w26/pj12-outfit-recommender — tracked as the `upstream` remote
- **This fork:** Brian-W-Li/fitted — Brian's solo continuation, focused on the `ml-system/` rewrite
- **License:** MIT (originally a UCSB CS 148 team project; git history preserves all contributors)

## Layout

This is a monorepo with the Next.js app in a subdirectory, not at root.

| Path | What |
|---|---|
| `fitted/` | The Next.js 16 + React 19 + Tailwind 4 app. **All web dev happens here.** |
| `ml-system/` | Standalone Python rule-based scorer (Issue #32). Not wired into the deployed app, which uses OpenAI directly. **This is the current portfolio focus.** |
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
| `GEMINI_API_KEY` | Personalization summarization in `lib/runPersonalizationSummary.ts` |
| `CV_SERVICE_URL` | Defaults to a teammate's Hugging Face Space (`theanimated01-fitted-cv.hf.space`) — likely brittle long-term; flag if it 404s |

Brian was on the original team, so the team's `.env.local` from CS 148 work is the fastest source. `.env.local` is gitignored.

## Where the recommendation flow lives

Read these before changing recommendation logic:

| File | Purpose |
|---|---|
| `fitted/app/api/recommend/route.ts` | Main recommendation endpoint — calls OpenAI |
| `fitted/app/api/recommend/regenerate/route.ts` | Re-roll variant |
| `fitted/app/api/preferences/summarize/route.ts` | Triggers preference summarization |
| `fitted/lib/runPersonalizationSummary.ts` | Builds per-user `PreferenceSummary` from `OutfitInteraction` history (Gemini) |
| `fitted/lib/weather.ts` | Weather context for recommendations |
| `fitted/models/*.ts` | Mongo schemas: `User`, `WardrobeItem`, `OutfitInteraction`, `PreferenceSummary`, `WardrobeImage` |
| `fitted/docs/ML_OVERVIEW.md` | Team writeup of the ML/CV design |
| `fitted/docs/database.md` | Schema docs |

## Current focus: `ml-system/` rewrite

Goal: replace the rule-based scorer with a feedback-trained **shortlister** that pre-filters the wardrobe before the LLM sees it. Reduces LLM token cost and personalizes recommendations.

Maps to team issues **#84** (Brian's own: *"LLM prompts make it better"*) and **#112** (*"Shortlisting strategy for LLM context"*). The team's brainstorm in `ml-system/mlWhatWeAreGoingTodo` essentially specced it.

Sketch of the arc:

1. Wire `ml-system/` to read real `OutfitInteraction` data from Mongo (currently runs on a hardcoded demo wardrobe).
2. Train a feedback-aware item-pair / item-occasion scorer. Start simple (logistic regression on hand-crafted features); iterate toward embeddings.
3. Offline eval: held-out interactions, ranking metric (e.g. NDCG@k or hit@k against accepted outfits).
4. Wire shortlister → LLM in `fitted/app/api/recommend/route.ts`. Measure cost + quality delta.
5. Writeup: architecture diagram, methodology, before/after numbers.

The `_score_outfit` interface in `ml-system/outfit_recommender.py` is the natural seam — replace the rule body, keep the signature.

## Canonical sources

This is a refactor. The v1.2 spec is the target architecture, not something to negotiate against existing behavior. **It is a direction marker, not a ceiling** (Brian, 2026-06-11): improvements beyond the spec are welcome and expected — the legacy app beats the spec in places (see `docs/plans/legacy-prospecting.md` §3) and the ideas are what matter. A better idea overrides the spec **via a recorded resolution in `spec-resolutions.md`** (the decision ledger), stating which pipeline step it occupies. Precedence: resolutions > spec PDF > legacy-as-reference. The spec still always wins over deployed *behavior*.

**Authoritative for design:**
- `docs/Fitted_Refactor_v1.2_Spec.pdf` — the target architecture. When the spec and deployed behavior disagree, the spec wins.
- `docs/plans/spec-resolutions.md` — canonical overlay resolving the spec's internal ambiguities. Where the PDF is silent, self-contradictory, or defines a term two ways, **this doc wins over the PDF**. Holds the authoritative pipeline order and the resolutions of PDF ambiguities (R1–R13, minus the scope calls below).
- `docs/scope-decisions.md` — settled **scope / boundary** decisions that are *not* PDF-ambiguity resolutions (e.g. host-not-frame, `sessionId = userId`). Same precedence weight as a resolution; split out so the spec-resolutions ledger stays PDF-focused. R-numbers are shared and stable across both docs.
- `ml-system/outfit_recommender.py`, `ml-system/README.md`, `ml-system/mlWhatWeAreGoingTodo` — starting point for the ML substrate; the refactor builds on this.
- `docs/plans/*.md` — per-milestone plans produced by `/spec` or the `planner` subagent. Active execution plans.
- This `CLAUDE.md` — project conventions and scope.

**Authoritative for data shape:**
- `fitted/models/*.ts` — actual deployed Mongo schemas. These are what exists today; M4/M5 will migrate them to support v1.2. Reference them for data shape, not for behavioral baselines.

**Historical context only — do not mine for architectural truth:**
- `docs/DESIGN.md`, `docs/MANUAL.md`, `docs/RECOMMENDATION_MODEL.md` — earlier design docs, superseded by v1.2.
- `meetings/`, `team/` — team artifacts (standups, contribution docs). Not relevant to the refactor.
- The currently-deployed app's behavior at fitted-outfits.vercel.app — what it does today is not a constraint on what v1.2 must do.

When uncertain whether to reference a doc: if it's not in the "Authoritative" lists above, don't bring it in unless directly asked.

### Doc lifecycle (capacity + truth control)

The doc set must stay small, current, and internally consistent. Rules:

- **Single-home rule.** Every decision lives in exactly one authoritative doc —
  `spec-resolutions.md` is the decision ledger. Other docs (plans, session notes, memory)
  may *point* to a resolution, never restate it in full. Duplication is how docs drift.
- **Docs are living, not immutable.** Stale or wrong content is **edited or deleted in
  place** — no "superseded by," no amendment narrative, no preserved drafts. Git is the
  archive; the doc states current verified truth only. Distinction: keep **trap-guards**
  (rationale that stops a future implementer from re-making a mistake — e.g. R6's
  banker's-rounding warning); delete **evolution narrative** (what the doc used to say and
  when it changed).
- **Conflicts are bugs.** If two docs disagree, the non-ledger copy is wrong by definition.
  Fix on sight, in the session that notices it — never leave a known conflict standing.
- **Default reading list** for a milestone session: `CLAUDE.md` + the active milestone's plan
  + `spec-resolutions.md`. Everything else — `sessions/`, completed plans, prospecting docs,
  the spec PDF itself — is on-demand reference, pulled only when a pointer leads there.
- **Retirement.** When a milestone completes, its plan doc gets a `> COMPLETED <date>` header
  line and leaves the default list. `sessions/` notes are write-mostly: read only when
  hunting history, never required context. (Retired/historical docs are exempt from the
  truth standard; the ledger and active plans are not.)
- **Hole/conflict cadence.** Each milestone `/spec` opens by hole-checking and
  conflict-checking the docs it inherits. Global review passes concluded 2026-06-11.
- **Compaction backstop.** In-place editing should keep the ledger from accreting; if the
  default reading list nonetheless exceeds roughly **1,500 lines**, spend a dedicated session
  compacting it.

## Deletion license (refactor scope)

Canonical sources says the spec is the design target, not the deployed behavior. This extends
that to **code**: where existing app-side code is ugly, tangled, or fights the v1.2 design,
**mass deletion is on the table — not just refactoring around it.** This codebase carries heavy
migrational and structural debt (a 10-week class project: an abandoned early ML attempt, and
dresses bolted on at week 8 via string-matching over `category`/`name`/`subCategory` instead of
a first-class `clothingType` — see `docs/plans/spec-resolutions.md` §4). Carrying that cruft
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
  **W-track** in `docs/plans/spec-resolutions.md` §4; sequenced adjacent to M4/M5, `/spec`
  before building.
- **`meetings/`, `team/`.** Class-project artifacts; leave alone.

## Conventions

- Match existing team code style — don't refactor for taste.
- Brian leads with systems engineering; he won't deep-read TS/Next.js. When writing app-side code, lean on plain explanation of what it does so he can verify behavior.
- For ml-system work, prefer source-grounded reasoning (datasets, eval methodology, citations to specific papers/issues) over vibes.
- Tests: `fitted/tests/` uses jest. `ml-system/` has no tests yet — add pytest as the rewrite lands.
- **Spec-first for non-trivial work.** For any task spanning more than 1–2 files or with unclear scope, prefer `/spec <slug>` (interview + write `docs/plans/<slug>.md`) or the `planner` subagent before coding. Spec-first beats code-first when sessions are days apart and context recovery matters.
- **Promise-driven decisions.** For non-trivial design calls: reason from the user-facing promise the decision serves (determinism/consistency, speed + convenience), teach the mechanics from first principles before deciding, and get a Fable review (`Agent` with `model: "fable"`) on the important ones. Record resolutions in `docs/plans/` (e.g. `spec-resolutions.md`). **Fable is currently unavailable (2026-06-15):** in its place, a thorough dual read substitutes for the important-call review — a deep first-principles code+doc review in-session **plus** an independent codex pass (the `CODEX_HANDOFF.md` loop), with both converging before the call is locked. Note the substitute review basis in the resolution.
- **Short sessions; externalize state.** Keep sessions short — long context is the main usage cost. Push durable state into `docs/plans/`, `docs/sessions/`, and memory so each session starts from a small reading list, not full history. `/clear` between unrelated tasks.
- **Past goes to commits; future stays in docs.** When writing or pruning a doc, sort content by orientation. **Past-oriented** content — what changed, when, why we picked X over Y, review history, fold-in narratives, "reviewed on date Z" annotations — belongs in the commit message, not the doc; delete it. **Future-oriented** content — how it works, the contract, what's planned, what a resolution *is* (not how we got there) — stays, living in exactly one place. The rule is **not** "delete past tense": past rationale that stops a future mistake (a *trap-guard*) stays, reframed as a forward warning. Example: R6's resolution text (the integer half-up split + the value table) is future and stays; the "Fable-reviewed, Brian pushed back" review history is past and belongs in the commit that landed R6 — but R6's banker's-rounding warning stays, because it stops a re-implementer from reintroducing the bug. When a sentence is genuinely both, keep it.
