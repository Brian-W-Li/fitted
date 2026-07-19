# M5 — C8 half-2 runbook (the live `USE_ML_SHORTLISTER` flip)

> **Executable checklist only.** All *rationale* lives in `docs/plans/m5-cutover.md` §C8 (gates,
> the §A degraded contract, §D timeouts, §G.1 write ownership) — this doc is the ordered command
> sequence, so the two never duplicate (single-home rule). Run from a real machine with the Fly CLI
> + the keys (RC-to-Claude can't execute deploys).
>
> **Half-1 is DONE** (commit `754135a8`, this branch): legacy vertical + `regenerate/route.ts` +
> `lib/gemini.ts` deleted; `recommend/route.ts` is the M5 dispatcher (flag-OFF → §A degraded empty
> state); enum trimmed; `openai`/`@google/generative-ai` npm deps gone.
>
> **STATUS (2026-07-16): DEPLOYED + LIVE-VERIFIED.** The cloud deploy ran (Track 2 collaborative ops
> session): Fly render service + the fork's Next app on Vercel, real E2E observed (daily + rescue +
> re-roll + bound feedback persisted to Atlas). **§8 below is the deployed-state record + friend
> onboarding + ops notes** — the current-truth section; §§0–7 remain as the (executed) procedure.

## Naming footgun (read first)
The shared secret has **two different env-var names** for the same value:
- **Service (Fly)** reads `SERVICE_KEY_CURRENT` (`ml-system/service/config.py`).
- **Next** sends it as `FITTED_SERVICE_KEY` (`fitted/lib/mlServiceClient.ts`).

`FITTED_SERVICE_KEY` (Next) **must equal** `SERVICE_KEY_CURRENT` (service), byte-for-byte, or every
render 401s → the route degrades on `auth_failed`.

---

## 0. Prereqs
- `fly auth login` done; an OpenAI key; a generated shared secret (step 1).
- Repo clean on the M5 branch; both suites green locally (step 4, H13).

## 1. Generate the shared secret
```sh
openssl rand -hex 32     # → SERVICE_KEY_CURRENT (service) AND FITTED_SERVICE_KEY (Next): the SAME value
```

## 2. Set the Fly service secrets
```sh
cd ml-system
fly secrets set \
  OPENAI_API_KEY='sk-...' \
  SERVICE_KEY_CURRENT='<the openssl value>' \
  --app fitted-render-service
# optional: SERVICE_KEY_NEXT='<rotation slot>'   M5_MAX_COMPLETION_TOKENS='<int override>'
```

## 3. Deploy + pin single-machine (gate G1)
```sh
cd ml-system && fly deploy                       # config: ml-system/fly.toml, build ctx = ml-system/
fly scale count 1 --app fitted-render-service
fly scale show  --app fitted-render-service       # MUST be exactly 1 machine, no autoscale
```
- **G1 is load-bearing:** the §A rate ceiling (`RATE_LIMIT_BURST=5`, refill `0.2/s` = 12/min) is a
  *per-instance* in-process token bucket, so it's the global bound only at 1 machine. Paste
  `fly scale show` into the cutover record. If it's ever >1, a shared durable limiter is required
  first (registered, not built). The $10 OpenAI cap (G2, below) is the hard backstop regardless.

## 4. Pre-flip gates — each a **verified fact**, not an intent

### G2 — OpenAI budget cap — ✅ DONE (2026-07-08)
Project `cssEnjbkDMOuCfMqzDuGdtLP` (as provided — verify it's the full id; real OpenAI ids are
usually `proj_…`), **$10 / month** cap + alert set. Confirm still in place at flip time.

### G9 — `/readyz` green (zero OpenAI spend)
```sh
curl -s https://fitted-render-service.fly.dev/readyz
# expect: 200 {"ready":true,"versions":{fittedCoreVersion, promptVersion, rankerConfigVersion, reducerConfigVersion}}
# a 503 {"ready":false,"reason":...} BLOCKS the flip (missing key / bad version / model off allowlist)
```

### Index existence — `{user, requestId}` partial-unique on `generationsnapshots`
```
// mongosh against the live Atlas DB:
db.generationsnapshots.getIndexes()
// assert an index { user:1, requestId:1 } with unique:true AND
//   partialFilterExpression: { requestId: { $type: "string" } }
```
- An absent / `$exists`-only unique index is **silent idempotency death** (§G.1). It builds on Next
  boot (`autoIndex:true` + `db.ts` `Model.init()`); if missing, start Next once against Atlas and re-check.

### H13 — cross-runtime conformance green BEFORE the flip
```sh
cd ml-system && python -m pytest tests service/tests -q    # ≥1091 (current floor)
cd fitted     && npm test                                  # ≥690 (current floor; incl. generationSnapshotRoundTrip + serde mirror)
```
Or rely on the `.github/workflows/conformance.yml` gate being green on the branch (it runs exactly these).

### Mechanical read — daily AND rescue on real `gpt-5.4-mini` (F3)
```sh
cd ml-system
# daily (in-process, reads render_with_trace's trace):
python -m fitted_core.cli --intent daily  --corpus-dir tests/fixtures/daily_corpus --runs 5
# rescue:
python -m fitted_core.cli --intent rescue --corpus-dir tests/fixtures/corpus       --runs 5
# gates: parse rate, hallucinated ids, schema-rejection rate;
#        rescue additionally → forced-item inclusion (forced item in EVERY surfaced outfit) + StyleMove presence.
# The CLI reads OPENAI_API_KEY from os.environ (NOT fitted/.env.local) — export it first.
```

**✅ DAILY read RECORDED (2026-07-08, `gpt-5.4-mini`, 2 cases × 5 runs = 10 renders):**
- parse_success_rate **1.00**; repair_rate 0.00; rejections **(none) — 0 hallucinated/schema across 10 runs**.
- style_move_rate **1.00** (a StyleMove on every validated candidate); mean_candidates 6.0 / 7.2;
  mean_variants **3.0** (full surfaced set every run); insufficient_rate 0.00.
- spread: daily_office achieved distinct path/risk cells 4/5 runs; daily_hot_weekend collapsed to one
  cell every run (a lighter closet — descriptive, not a gate).
- cost: **$0.0356 total / ~$0.0036 per render**, mean latency 4.4s (p95 5.7s). Well under the $10 cap.
- **Verdict: the daily prompt (C1, first live exercise) passes the F3 daily gate cleanly.**
- Cosmetic: the shared cost-summary line labels renders "rescue(s)" for both intents (numbers correct).

**✅ RESCUE read RECORDED (2026-07-08, `gpt-5.4-mini`, 12 cases × 5 runs):**
- Every **generating** case: parse_success_rate **1.00**, **`forced_inclusion_rate` 1.00** (the forced
  item is in EVERY surfaced outfit, every run), style_move_rate **1.00**.
- Rejections seen were **only `duplicateFullSignature`** (the validator correctly deduping repeat
  outfits) — **0 hallucinated ids, 0 schema rejections**.
- The non-perfect aggregates are the **designed stress cases**: `tiny_insufficient` is a pre-GPT
  `not_enough_items` exit every run (H22 min-closet → parse 0 / 0 candidates, expected); `duplicate_outfits`
  / `id_conformance` are tiny closets that hit `insufficient_rate=1.0` by design.
- cost **~$0.12 total / ~$0.0022 per render**, latency p50 2.7s / p95 4.0s.
- **Verdict: rescue F3 gate passes on `gpt-5.4-mini`** (supersedes the old H40 `gpt-4o` baseline).

> **F3 COMPLETE for both intents.** Optionally route a read through the deployed `/render` HTTP path
> if you want the wire covered by the eval too (else the live smoke, step 6, covers the wire).

### Local backend smoke (automatable, pre-deploy — no Fly, no browser) — ✅ RUN 2026-07-08
Proves the WHOLE cutover wire (Next adapter → HTTP → python service → real `gpt-5.4-mini` → §G
validation → snapshot write → §6.5 feedback bind) across both runtimes on localhost, over an
**ephemeral in-memory Mongo** (zero Atlas/Firebase touch). Run it before the cloud deploy for near-zero
deploy risk:
```sh
# 1. Launch the service locally (uvicorn is a container dep — add it to the venv once):
cd ml-system && source .venv/bin/activate && pip install uvicorn==0.50.2
OPENAI_API_KEY=<key> SERVICE_KEY_CURRENT=local-smoke \
  python -m uvicorn service.app:app --host 127.0.0.1 --port 8099 &
curl -s http://127.0.0.1:8099/readyz          # expect {"ready": true, "versions": {...}}
# 2. Drive the real Next core → the local service → snapshot + feedback (gated jest, skips in CI):
cd ../fitted
ML_SMOKE_URL=http://127.0.0.1:8099 ML_SMOKE_KEY=local-smoke npx jest localServiceSmoke --runInBand
```
**Result (2026-07-08):** both cases green — daily 200/bindable/3-outfit snapshot
(`generator.model=gpt-5.4-mini`) + feedback bound to `{snapshotId,candidateId}`; rescue forced-item
in every surfaced outfit. Only the CLOUD deploy (Fly) + the visual UI click-through remain.

## 5. Wire Next + flip the flag
`fitted/.env.local` (local smoke) **or** the deploy-host env:
```sh
ML_SERVICE_URL=https://fitted-render-service.fly.dev
FITTED_SERVICE_KEY=<same value as the service SERVICE_KEY_CURRENT>   # ← the footgun
ML_SERVICE_TIMEOUT_MS=45000        # optional (default 45000; must keep < maxDuration 60s budget, §D)
USE_ML_SHORTLISTER=true            # ← THE FLIP
# Firebase + MONGODB_URI as before. OPENAI_API_KEY is NO LONGER read by Next.
```
```sh
cd fitted && npm run build && npm run start     # or: npm run dev
```

## 6. Live smoke (the UI already speaks the new contract — C6)
- **daily** render → exactly one `GenerationSnapshot` row; cards render; `bindable:true`.
- **rescue** (force an item) → the forced item appears in **every** surfaced outfit.
- **re-roll** → a lineaged child snapshot (`generationIndex = parent+1`, `parentSnapshotId` set).
- **like / dislike** → append-only `OutfitInteraction` bound to `{snapshotId, candidateId}`; history shows it.
- **flag OFF** (unset `USE_ML_SHORTLISTER`, restart) → §A degraded empty state ("stylist temporarily
  unavailable", no feedback controls). Sanity-check the rollback path.

## 7. Post-flip reconciliation — ✅ DONE (2026-07-16, the Track 2 deploy commit)
- `fitted/.env.sample` rewritten post-cutover; `CLAUDE.md` env table reconciled; `m5-cutover.md`
  half-2 marked done; `conformance.yml` confirmed on `main`.

## 8. Deployed state (2026-07-16) — current truth

| Piece | Value |
|---|---|
| Render service | Fly app `fitted-render-service`, region `lax`, **1× shared-cpu-1x / 512 MB (G1 pin verified — Fly auto-created a 2nd HA machine on deploy; scaled back to 1)** |
| Service URL | `https://fitted-render-service.fly.dev` — `/readyz` green (fitted_core 0.5.0, prompt `m5-c1.v1`); 401 on missing/wrong key; 404 envelope on unknown routes — all probed live |
| Fly secrets | `OPENAI_API_KEY`, `SERVICE_KEY_CURRENT` (imported via `fly secrets import` from a staging file, since deleted; values never in any transcript/history) |
| Next app | Vercel project `brian-lis-projects-64ed3bc0/fitted` (Hobby), rooted at `fitted/` via CLI link |
| App URL | **`https://fitted-three.vercel.app`** (production alias) |
| Vercel env (production) | `NEXT_PUBLIC_FIREBASE_*` ×4, `FIREBASE_SERVICE_ACCOUNT_KEY`, `MONGODB_URI` (Atlas), `ML_SERVICE_URL`, `FITTED_SERVICE_KEY`, `USE_ML_SHORTLISTER=true` |
| Database | Fresh Atlas **M0** cluster (project `fitted-3To5PeopleTest`, `cluster0.d3swzkg`), db **`fitted`**, network access 0.0.0.0/0 (Vercel egress is dynamic; the credential is the lock — dedicated least-privilege DB user). Local dev `.env.local` keeps `MONGODB_URI`=localhost; the Atlas URI lives Vercel-side (+ a `MONGODB_URI_ATLAS` convenience row locally). |
| Firebase | Production domain `fitted-three.vercel.app` added to Auth authorized domains |
| Spend envelope (all verified active) | OpenAI **$10/mo project cap** (re-confirmed at deploy); per-request `max_completion_tokens=2200`; service token bucket **12 renders/min global** (true only under the 1-machine pin); interactions limiter 60/min/user (per-instance courtesy pacing; the storage bound is the 2000-row per-user ceiling) + `MAX_PER_ITEM_FEEDBACK=20`. Observed cost ~$0.002–0.004/render. |
| CV | `CV_SERVICE_URL` unset → `/api/cv/status` returns `not_configured`; upload UI degrades to manual entry (verified live) |

**E2E verification observed (2026-07-16):** cloud smoke (gated jest `localServiceSmoke` against the
deployed Fly URL) passed both intents; then a full driver against the deployed Vercel app (admin-minted
token for Brian's real user) — 8 wardrobe items (classifier-derived `clothingType`/`warmth`), a daily
render, a rescue (forced item in **every** shown outfit), a re-roll, and accepted+rejected feedback.
Atlas read-back confirmed: 3 `GenerationSnapshot` rows with the full §A.6 generator provenance
(`gpt-5.4-mini`/0.5/2200/`chat_completions`/`json_schema_strict`/`none`/`none`), correct lineage
(`generationIndex=1`, `parentSnapshotId` → the daily root, inherited occasion/seedDate, same
`candidateCacheKey`), both interactions bound `{snapshotId, candidateId}` with candidate ∈ shown set,
and the `{user,requestId}` partial-unique index built. **Known residue:** Brian's account holds those
8 placeholder items + 3 test snapshots + 2 test interactions — wipe the placeholder wardrobe before
adding the real closet (snapshots are append-only and stay; filter by date/user for M6).

### Friend onboarding (what a friend does)

> **The ask is data-shaped (Lane F, 2026-07-17).** The M6/H26 catalog→closet transfer re-measure is
> an *image-embedding* measure — a photo-less item contributes ZERO to it, however many snapshots it
> generates — and its negative-sampling needs category depth (H26 skipped 25/39 pairs for lack of a
> same-category negative; the closet probe read effective-N = 6). Decidability needs ~30–60 usable
> positively-labeled outfits across the cohort (~8–15 per friend over a few weeks). Pitch photos and
> depth as the default, not an extra, or Track 2 "succeeds" while the transfer lever stays unpowered.

1. Visit **https://fitted-three.vercel.app** → sign in with any Google account (a real browser, not
   an in-app one — Instagram/Messenger webviews block Google sign-in).
2. Wardrobe → add items **manually** (CV is off): **photo + name + category for every item** — the
   photos are the point (they feed the ML measurement; the app downscales client-side, ~1MB each).
   Aim for **~15+ items with at least 2 per category** across tops/bottoms/shoes (outerwear too);
   honest names/colors/occasions make both the recommendations and the corpus better.
3. Dashboard → daily render (pick an occasion) or rescue (pick an item to build around); re-roll and
   like/dislike freely — every render persists a snapshot, every reaction binds to it. **Make honest
   feedback a habit** (like what you'd actually wear, dislike what you wouldn't): the accepted/rejected
   labels are the positive/negative signal the re-measure trains against.
4. Privacy: your items, photos, and feedback are stored in Brian's database for a small ML experiment
   among friends (3–5 closets). Deleting your account (account page) permanently erases everything of
   yours **on our side** — wardrobe, photos, feedback, and every generated-outfit record —
   immediately and irreversibly. The only things we can't reach in and delete are transient
   third-party operational logs (hosting + the AI provider's standard short-term retention), which
   age out on their own within weeks; none of them are used for anything (§23-H43 scope note).

### Ops notes (Brian)
- **✅ Pushed + web-redeployed twice: the 2026-07-17 stack (post ingestion honesty pass + stable audit)
  AND the 2026-07-18 friend-ready stack (add-another + REQFIELDS-1 + M6 export/outfit-lint + doc fixes;
  `origin/main` `78e5556a`, Vercel new build live). Fly last deployed 2026-07-17 (unchanged since).**
  `main` (`d71e9f06`) pushed to `origin`; the stack = the wardrobe ingestion honesty pass + this
  audit's honesty-copy / double-tap-latch / yield-readout / D1 one-tap-dislike / D2+REPLACE-1
  keep-referenced-image fixes. **Vercel web** redeployed via `npx vercel --prod` from `fitted/` →
  aliased to fitted-three.vercel.app, live-verified serving the audited copy ("adjust to your
  like/dislike feedback", not "ML model learn"). **Fly** redeployed via `fly deploy` from `ml-system/`
  (image `deployment-01KXT098P0DTH37M10102J76S6`; the `ml-system/` code was unchanged, so functionally
  a no-op, but refreshed on request); rolling update on the existing machine, **G1 pin held — verified
  exactly 1 machine**, `/readyz` green (fittedCore 0.5.0, prompt m5-c1.v1). The throwaway-account
  **erasure loop PASSED live 2026-07-18** (22 rows → 0 across all 5 owned collections + Firebase auth
  gone; `scripts/track2-erasure-check.mjs`). **The 2026-07-18 friend-ready web work — "Save & add another"
  + REQFIELDS-1 — was pushed (`origin/main` `78e5556a`) + web-redeployed 2026-07-18** (`npx vercel --prod`
  from `fitted/` → `fitted-three.vercel.app`, verified 200; **Fly NOT redeployed — web-only change, so the
  1-machine pin is unaffected**). **Remaining pre-recruiting steps: (1) Brian's friend-#0 phone gauntlet
  (now testable on the live friend-ready build); (2) finalize onboarding copy; (3) recruit.** Deploys are
  CLI-driven (not on
  git push): web from
  `fitted/` via `npx vercel --prod`, service from `ml-system/` via `fly deploy` — and the repo ROOT
  must never be vercel-deployed (the root/app folders are both named `fitted`; a root deploy
  uploads the whole monorepo and fails the free-tier file quota).
- **Corpus health:** re-certify the growing friend corpus any time with the gated read-back verifier
  (runs the real payload validator + lineage/join/orphan/degenerate checks over the live DB, read-only):
  `cd fitted && CORPUS_READBACK_URI="$(grep '^MONGODB_URI_ATLAS=' .env.local | cut -d= -f2-)" npx jest corpusReadback --runInBand`
- **Spend:** OpenAI usage dashboard (the $10 cap is the hard backstop); `fly status`/`fly logs --app
  fitted-render-service`; Vercel logs via the project's Inspect URL.
- **Machine count must stay 1** (`fly scale show`) — >1 silently multiplies the rate ceiling (G1).
- **Rollback:** remove/false `USE_ML_SHORTLISTER` in Vercel env + `npx vercel --prod` redeploy → §A
  degraded state (never legacy, never 5xx). `fly scale count 0` stops the service (and all spend);
  `fly apps destroy fitted-render-service` ends the ~$4/mo when the collection window closes.

### Track 2 collection-window ops (folded in 2026-07-18 — the living ops home)

**Observation channel — run every 1–2 days while friends collect.** Without a signal, friend #2 hits a
wall day 1 and you learn day 9. Minimum watch = the corpus/yield readout (the `corpusReadback` command
above) + a log/spend skim (`fly logs … | tail`, `fly scale show` = 1, OpenAI dashboard). Friend #1's
first week IS the final audit round — unknown defects surface here within ~1–2 days, not via more static audits.

**Friend-facing fixes backlog → `docs/plans/friend-facing-fixes.md`** (F1–F4 shipped `c73ccf99`/`414dca7b`).
That plan is the single home + the fresh-session prompt: the History-curation cluster (flip/remove/delete +
dedup + the 1-month reachability window), the dislike-reason data-loss/double-write, the SHOULD-FIX copy/polish
batch, and the NEW-D Atlas-M0-tier cost decision. Don't restate it here — edit it there.

**Pull the corpus (M6 export, read-only):**
```sh
cd fitted && node scripts/export_track2.mjs --uri "$(grep '^MONGODB_URI_ATLAS=' .env.local | cut -d= -f2-)" --out ./track2-export
```
→ `manifest.json` (counts + a `yield` block with the decidability verdict vs the 30–60 bar), snapshots /
wardrobe / interactions_latest (§H61) / training_examples JSONL + `images/`. The manifest's `yield` IS the
yield artifact (one home, no drift). A **deleted friend exports zero** (erasure). Round-trip proven live:
`node scripts/track2-export-roundtrip.mjs` (incl. a D2-retained photo of a deleted item).

**Content monitor:** `cd fitted && npx jest outfitLint` — the deterministic mechanical-absurdity checker
(two-bottoms / dress-with-separates / formality-clash / …). A rising hit-rate = stylist-quality
regression. Baseline over 51 real candidates: 1 finding (2%). `scripts/track2-lint.mjs` runs it over output.

**Live driver (no browser):** `TRACK2_LIVE_OK=1 node scripts/track2-live.mjs smoke` mints a throwaway
`track2test_*` user (local service-account) and drives the live API as a friend would; `track2-gauntlet.mjs`
seeds persona closets + real renders; `track2-erasure-check.mjs <slug>` proves erasure with an Atlas
read-back. All gated `TRACK2_LIVE_OK=1`; they write the live corpus + spend $, so they always erase after.

**KNOWN-RESIDUALS BACKLOG (the anti-spiral home — non-blocking findings live here, graded):**
- STUMBLE **CONTENT-1** — outfit-lint flagged `gym hoodie + suit trousers` (2%); monitored, not a wall.
- STUMBLE **OPS-1** — no proactive failure alerting; mitigated by the observation channel (manual).
- COSMETIC **COMMENT-1** — stale comment `wardrobe/page.tsx` (predates D2); fix when next in that file.
- COSMETIC **SEAM-1/2** — client entry caps hand-copied (agree); edit sends `size:""`/`notes:""` (no UI).
- Watch-item **REQFIELDS-1 tripwire** — required set relaxed to {name, category}; if sparse closets get
  disliked into undecidability, ask that friend to backfill colors via edit — do NOT re-tighten validation.

**Brian-as-friend-#0 (do before recruiting).** If you can't get through this on your phone with your own
closet, no verdict matters; if you can, your thumbs are the "ready" signal. **Screenshot each step** — that
filmstrip is the visual layer the API driver can't see (frozen-button-vs-spinner, HEIC upright, legible
dead-ends, tap targets). 1) Sign in on your phone (real browser). 2) Add ~10 real items via **"Save & add
another"** — smooth now? Include one **HEIC**, one **12MP**, and one shot with the **phone rotated to landscape** — does it
display **upright** (EXIF-rotation check)? (NB: a garment *laid* sideways will correctly stay sideways —
that's faithful capture, not a bug; nothing can auto-upright a garment.) 3) Stop
at ~3 items, try to generate — is the "add N more" dead-end legible? 4) Generate at ~8 items — believable?
spinner or frozen button? try a **cold** one (20–40s wall — what shows?). 5) Like + dislike — each acknowledged?
6) Rescue (build around an item) — how many taps, does it center your item sanely? 7) Edit/change-photo/remove
an item. 8) **Delete your account** → confirm your stuff is gone. Flag any >1s pause with no feedback.

**Friend onboarding message (draft — finalize in your voice; it's the first UI + honest-consent artifact):**
> Hey — I built an outfit recommender and I'm collecting a little data from a few friends to train the next
> version. ~20 min? You add photos of your clothes, it builds outfits from *your* wardrobe (incl. a "build
> around this piece" mode). It's early — decent, not magic — which is why honest ratings help. **Most useful:
> add real photos** (they're what the ML measures) and **rate honestly — a dislike helps more than a polite
> like**; aim for ~15 items, a couple of each type. Open `https://fitted-three.vercel.app` on your phone
> (Safari/Chrome, not the Instagram/Messenger in-app browser). Privacy: your stuff lives in my DB for this
> small experiment among ~5 friends; delete your account anytime and everything of yours is erased permanently.

(Risk: the message sets the photo + honest-dislike expectation out-of-band — load-bearing, since the app
nudges but doesn't coerce. Skip photos → yield stays unpowered no matter how many snapshots.)

Full session context: `docs/sessions/2026-07-18-track2-friend-ready.md` (trust re-grade table + gauntlet).

## Rollback (pinned — honest)
- **Immediate safe state:** `USE_ML_SHORTLISTER` off/unset → §A **degraded empty state** (no
  recommendations, but no errors/leaks). The flag alone disables the vertical — no redeploy needed.
- **There is no working-legacy fallback:** legacy is deleted (half-1). Restoring the old recommender
  requires `git revert`-ing the half-1 commit (`754135a8`) + rebuild. In practice you fix-forward the
  service (it's the only recommender now) rather than revert.
- Service-side: `fly apps` scale down / redeploy a prior image; Next flag-off → degraded meanwhile.

## Owed pre-flip build items
1. **✅ DONE — Daily-intent path in `fitted_core/cli.py`** (`--intent daily`; reads
   `render_with_trace`'s trace; daily corpus at `tests/fixtures/daily_corpus/`; 11 hermetic tests).
   The daily F3 read has now been run live — see the recorded numbers in §4 above.
2. **✅ DONE — Rescue live read on `gpt-5.4-mini`** — recorded in §4 (parse 1.00, forced-inclusion
   1.00, StyleMove 1.00; ~$0.12). F3 is complete for both intents.
3. *(optional)* Route the mechanical read through the deployed `/render` HTTP path instead of
   in-process, if you want the wire covered by the eval too (else the live smoke covers it).
