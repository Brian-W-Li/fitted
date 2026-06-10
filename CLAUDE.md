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

## Out of scope (don't proactively work on these)

- **Public launch / user growth.** Teammates' framing; Brian has explicitly scoped to portfolio + technical depth. Don't suggest deploy / marketing / scaling work unless asked.
- **Visual try-on** (issues #82, #87–92). v2 candidate at most; diffusion-model territory; not the current dive.
- **Frontend redesign.** UX changes only if they're needed to demo the `ml-system/` work.
- **`meetings/`, `team/`.** Class-project artifacts; leave alone.

## Conventions

- Match existing team code style — don't refactor for taste.
- Brian leads with systems engineering; he won't deep-read TS/Next.js. When writing app-side code, lean on plain explanation of what it does so he can verify behavior.
- For ml-system work, prefer source-grounded reasoning (datasets, eval methodology, citations to specific papers/issues) over vibes.
- Tests: `fitted/tests/` uses jest. `ml-system/` has no tests yet — add pytest as the rewrite lands.
