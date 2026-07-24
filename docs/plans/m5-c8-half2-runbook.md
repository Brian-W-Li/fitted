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
cd ml-system && python -m pytest tests service/tests -q    # ≥1098 (current floor)
cd fitted     && npm test                                  # ≥793 (current floor; incl. generationSnapshotRoundTrip + serde mirror)
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
- **✅ BOTH halves redeployed 2026-07-21 (pre-recruit checklist item 2) — the audited HEAD is now the
  collecting build.** Live web = `origin/main` `734ea85e` via `npx vercel --prod` from `fitted/` → aliased
  `fitted-three.vercel.app`, verified **200**. Fly render service = image
  `deployment-01KY3AR1TAZS67900TCCHW20FE` via `fly deploy` from `ml-system/`, **`fly scale show` = exactly
  1 machine** (rolling update reused the single machine — no HA machine spawned; G1 held), `/readyz` green
  (fittedCore 0.5.0, prompt m5-c1.v1). This build first ships `217a6ee3`'s behavior-preserving cross-runtime
  pins (warmth band + token default single-homed + pinned TS↔Python) — independently audit-reviewed 2026-07-21
  (no load-bearing findings) and exercised end-to-end by the gate below. **Render path RE-VERIFIED live on the
  2026-07-21 build** — `track2-gauntlet.mjs run college-male-minimal` seeded 7 items → daily renders
  200/3-candidates + reroll 200 + feedback recorded (accepted+rejected → proves `bindable:true`), then erased +
  independently read back **0 orphans** across all corpus collections (throwaway-account erasure previously
  PASSED live, 22 rows → 0 + Firebase auth gone). **Onboarding copy FINALIZED (below).**
  **Pre-recruit checklist (2026-07-20 merit+dynamics audit — do these BEFORE the first onboarding
  message; recruiting starts an unrepeatable clock):**
  1. **✅ DONE (2026-07-20) — Pre-registered the re-measure decision rule** (the single highest-
     leverage item), FROZEN freeze-before-look at `ml-system/experiments/track2_transfer/preregistration.md`
     (+ `.json` + `derive_power.py`); Fable-reviewed (SHIP-WITH-CHANGES, all folded). Primary read =
     accepted-vs-rejected discrimination (boundary 0.50, two-look 25/50-per-arm design, point-floor
     ≥0.60, horizon expiry) → decidable even at pessimistic yield; secondary two-boundary transfer
     read reported-never-gates; the inherited 0.70 healthy floor RETIRED (structurally unpassable —
     `derive_power.py`). The export yield readout (`manifest.yield`) is hardened from the raw ≥30
     count to the **scoreable-cluster certificate** — watch `primaryRead.verdict` (UNDERPOWERED →
     DECIDABLE at ≥25/arm both, concentration cap OK). Full rule single-homed in Spec §20 M6 row.
  2. **✅ DONE (2026-07-21) — pushed + redeployed both halves.** `origin/main` `734ea85e` live on Vercel +
     Fly (image `deployment-01KY3AR1TAZS67900TCCHW20FE`, `fly scale show` = 1); the one-render
     `bindable:true` gate re-ran green (gauntlet render → erase → 0-orphan readback). Ops-notes deploy line
     updated. `217a6ee3`'s cross-runtime pins are now live + audit-reviewed (no load-bearing findings).
  3. **Stagger onboarding — never a synchronized friend evening.** The service's sync OpenAI call
     serializes renders on one ASGI event loop (1 machine): ~5 simultaneous first renders → 40–50s
     queue → the 45s Next timeout → "stylist unavailable" as a first impression. One active
     onboarding at a time until the render call is moved off the event loop.
  4. **✅ SCRIPT BUILT (2026-07-21) — scheduling is your call.** The CI-shaped monitor is
     `fitted/scripts/track2-monitor.mjs` (`npm run track2:monitor`): two HARD checks — `/readyz`==200+ready
     ∧ Fly machine-count==1 — plus a read-only yield readout (informational; certified decidability stays
     `export_track2`'s job). A hard FAIL fires a **macOS notification** + appends `fitted/track2-monitor.log`
     + exits non-zero; all checks are read-only (no spend). Both PASS and FAIL paths verified live 2026-07-21.
     **Run manually for now** (script-only per this session). To schedule daily, install the launchd plist
     below. The synthetic render (the sanctioned gate) stays manual/weekly (it spends + writes corpus).

     <details><summary>launchd daily plist (install when you want it running unattended)</summary>

     Write `~/Library/LaunchAgents/com.fitted.track2monitor.plist` (edit the two absolute paths):
     ```xml
     <?xml version="1.0" encoding="UTF-8"?>
     <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
     <plist version="1.0"><dict>
       <key>Label</key><string>com.fitted.track2monitor</string>
       <key>ProgramArguments</key>
       <array>
         <string>/opt/homebrew/bin/node</string>
         <string>/Users/Brian/Documents/fitted/fitted/scripts/track2-monitor.mjs</string>
         <string>--quiet</string>
       </array>
       <key>WorkingDirectory</key><string>/Users/Brian/Documents/fitted/fitted</string>
       <!-- launchd's minimal PATH won't find `fly`; add homebrew so the machine-count check resolves it -->
       <key>EnvironmentVariables</key><dict><key>PATH</key><string>/opt/homebrew/bin:/usr/bin:/bin</string></dict>
       <key>StartCalendarInterval</key><dict><key>Hour</key><integer>9</integer><key>Minute</key><integer>0</integer></dict>
       <key>StandardErrorPath</key><string>/Users/Brian/Documents/fitted/fitted/track2-monitor.log</string>
     </dict></plist>
     ```
     Then `launchctl load ~/Library/LaunchAgents/com.fitted.track2monitor.plist`. (`FLY_BIN`=abs path is an
     alternative to the PATH env var.) Runs only while the Mac is on — a synchronized-evening gap, not a
     24/7 monitor; for always-on coverage a cloud `/readyz` ping would need to be added separately.
     </details>
  Then **recruit** (Brian, out-of-session; ~3 guys / 2 girls, ≥1 dress-heavy closet, but
  engagement > gender). The friend-#0 phone gauntlet (below) is now OPTIONAL — the render +
  erasure layers are verified live and photo display is WYSIWYG (shows exactly as saved → the retake-if-
  sideways guidance moved into the onboarding message); **friend #1's first week is the real acceptance
  test**, watched via the observation channel. Deploys are CLI-driven (not on git push): web from
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

**Friend-facing fixes backlog → `docs/plans/friend-facing-fixes.md`** (single home; don't restate here).
F1–F4 shipped `c73ccf99`/`414dca7b`. **Phases 1–3 IMPLEMENTED + heavy-audited 2026-07-19** (History
curation flip/remove + latest-state dedup + full-corpus reachability; the dislike-reason durable enrich +
restored-chip reconciliation; the SHOULD-FIX copy/polish batch incl. `error.tsx`/`not-found.tsx`) — green
(floors in that plan's STATUS block), committed on `main` (`abc0ba19` + `64b15825`) and **DEPLOYED
2026-07-19** — both are ancestors of the live build `30b03cc9` (Vercel deployment sha verified
2026-07-20). Remaining: **NEW-D** (Atlas M0→M2 ~$9/mo cost
decision) + the OBSERVE-only items. Bounded CURATE-1/2/3 + TEST-1 residuals live in that plan.

**Pre-friend deploy re-verify (fail-SILENT env footguns — a 2026-07-19 whole-codebase sweep finding).**
Every core-flow misconfig degrades *silently* to an empty state (no 500, no alarm), so a mistyped env var =
zero friend yield you only notice by watching. After ANY redeploy, before the next friend:
1. `USE_ML_SHORTLISTER` is exactly `true` (any other value → permanent "stylist temporarily unavailable").
2. `FITTED_SERVICE_KEY` (Vercel) byte-equals `SERVICE_KEY_CURRENT` (Fly) — the naming footgun above; a
   mismatch degrades to `auth_failed`, an *unset* `ML_SERVICE_URL`/`FITTED_SERVICE_KEY` 500s every render.
3. If you ever tune `M5_MAX_COMPLETION_TOKENS`, set it on BOTH Vercel and Fly (drift → silent
   `contract_invalid` empty state); keep `ML_SERVICE_TIMEOUT_MS` ≤ ~45s (too high → platform 504).
4. **The real gate:** run ONE real render in the live UI and confirm the response is `bindable:true` (a
   like/dislike actually records) — that single check catches all of the above at once.

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
- ✅ **TOKCAP-1 DISCHARGED (2026-07-20, live) — DAILY worst case only.** The (cap=`2200`,
  daily ask=`12`) envelope holds at the **daily** capped worst case: the `tokcap-full-ask` gauntlet
  persona (16-item closet) forced `candidateRequested=12` under the live default cap on the deployed
  Fly service — re-roll returned **12/12 outfits, finish `stop`**, one attempt, clean strict-JSON
  parse (root render 11/12, also `stop`); snapshot-verified via `diagnostics`/`generator` before
  erasure (erasure gate re-passed, 37 rows → 0). `service/config.py` comments now carry the validated
  record. Re-check with the same persona after any prompt/schema change that lengthens per-outfit
  output. (Correction the run surfaced: the ask hits 12 for any pool with ≥2 tops × ≥2 bottoms — the
  old "live asks 6–7" line described *returned* counts, not the ask.)
- WATCH **TOKCAP-2** — the pre-C5 empirical gate (`m5-cutover.md`) named **two** worst-case asks to
  validate at the 2200 cap; only the DAILY one (ask=12) was run. The **RESCUE** ask is *not* bounded
  by the daily-12 cap — `_rescue_candidate_requested` (`fitted_core/rescue.py`) clamps to
  [`MIN_RESCUE_CANDIDATES`=6, `MAX_CANDIDATES`=40], so a forced optional (shoes/outer) over a rich
  closet can ask up to 40 drafts (~6,800 tok >> 2,200). **Not a blocker:** the ask is an upper-bound
  hint and a large rescue *yield* would degrade gracefully (truncation → one repair → "couldn't find
  enough" fallback, never a 500 or a corpus lie), and friend closets are small (the live one-green-
  shirt rescue asks 9). To fully discharge: add a worst-case rescue persona to `track2-gauntlet.mjs`
  (forced optional + ≥3 tops × ≥3 bottoms) and confirm `finish_reason != "length"`, or lower the
  rescue ask ceiling. (2026-07-21 audit-review finding.)
- COSMETIC **SEAM-1/2** — client entry caps hand-copied (agree); edit sends `size:""`/`notes:""` (no UI).
- COSMETIC **DASH-COPY-1** (2026-07-21 friend-ready sweep) — the Dashboard like/dislike failure copy is
  generic ("Please try again"), while History has code-aware copy for the same `storage_limit` (400).
  At the 2000-row per-user interaction ceiling a like can never succeed, so the generic copy invites an
  infinite retry. **Not friend-reachable in the study window** (2000 append-only rows ≈ years of feedback);
  `postFeedback` (`dashboard/page.tsx`) discards the response code, so a fix means plumbing the code through
  to render History's ceiling message. Deferred; re-grade only if a friend ever nears the ceiling.
- **2026-07-20 dynamics audit registrations** — three new §23 holes: **H67** (Atlas M0 aggregate
  capacity: base64 ×4/3 means ~4.8 at-cap image accounts fill the 512MB cluster; GenerationSnapshot
  has NO per-user ceiling unlike its three siblings), **H68** (service renders run ON the single ASGI
  event loop — concurrency 1, pinned by `service/tests/test_serialization.py`; mitigated by staggered
  onboarding), **H69** (no pixel-dimension bound on stored images — gates the M6 decode path).
  Details + design calls live in Spec §23, not here.
- **Load/spend model (2026-07-20, worked numbers).** Token bucket burst 5 / refill 0.2/s = 12/min
  global at 1 machine: 5 friends × (1 render + ~2 re-rolls) over 5 min ≈ 15 demands vs ~65 capacity —
  comfortable; only a synchronized >5-renders-in-~25s burst 429s, and that path is honest (the
  "stylist is busy — try again in a minute" copy; a rate-limited re-roll keeps the prior outfits
  visible). **Under real group load the binding constraint is H68's serial queue, not the bucket**
  (renders ~10–15s each → friends 4–5 cross the Next 45s abort) — hence the staggered-onboarding
  rule. Worst-case INPUT cost is bounded by existing tested caps (`MAX_PROMPT_ITEMS=135` of
  max-length fields ≈ ~160k input tokens ≈ ~$0.12/render at $0.75/1M — real closets run ~two orders
  smaller); the output side is TOKCAP-1-validated above.
- Watch-item **REQFIELDS-1 tripwire** — required set relaxed to {name, category}; if sparse closets get
  disliked into undecidability, ask that friend to backfill colors via edit — do NOT re-tighten validation.

**Brian-as-friend-#0 (OPTIONAL as of 2026-07-19 — render + erasure verified live, photos confirmed WYSIWYG;
kept as a reference checklist, not a gate).** If you run it: can't get through it on your phone with your own
closet → no verdict matters; if you can, your thumbs are the "ready" signal. **Screenshot each step** — that
filmstrip is the visual layer the API driver can't see (frozen-button-vs-spinner, HEIC upright, legible
dead-ends, tap targets). 1) Sign in on your phone (real browser). 2) Add ~10 real items via **"Save & add
another"** — smooth now? Include one **HEIC**, one **12MP**, and one shot with the **phone rotated to landscape** — does it
display **upright** (EXIF-rotation check)? (NB: a garment *laid* sideways will correctly stay sideways —
that's faithful capture, not a bug; nothing can auto-upright a garment.) 3) Stop
at ~3 items, try to generate — is the "add N more" dead-end legible? 4) Generate at ~8 items — believable?
spinner or frozen button? try a **cold** one (20–40s wall — what shows?). 5) Like + dislike — each acknowledged?
6) Rescue (build around an item) — how many taps, does it center your item sanely? 7) Edit/change-photo/remove
an item. 8) **Delete your account** → confirm your stuff is gone. Flag any >1s pause with no feedback.

**Friend onboarding message (FINALIZED 2026-07-19 — device-agnostic + retention-disclosed; send as-is or tweak voice):**
> Hey! I've been building an outfit-recommender app and I'm testing it with a few friends to help train the
> next version. Would you be down to be a tester for a few days? ~20 min to set up.
>
> **What it does:** you add photos of your clothes and it builds outfits from *your own* wardrobe — there's
> even a "build an outfit around this one piece" mode.
>
> **What I'd need from you:**
> 1. **Add ~15 of your real clothes, each with a photo** — a few of each type (tops, bottoms, shoes, a jacket
>    or two). The **photos are the important part** (that's literally what the model learns from), so real
>    photos matter way more than filling in every field (a name + category is plenty).
> 2. **Generate some outfits** — try a few different occasions. Also pick 2–3 pieces you own but never
>    quite know how to wear and hit **"Build an outfit around this"** on them — that mode is the heart of
>    the app, and honest ratings there are the most useful ones you can give.
> 3. **Rate them honestly** — 👍 what you'd actually wear, 👎 what you wouldn't. Don't just like everything to
>    be nice — honest thumbs-downs help more than polite likes.
> 4. **Mess with it over a few days** — curate your closet.
>
> **Photo tip:** photos show up exactly the way they're saved, so if one looks sideways just rotate/retake it.
>
> **Opening it:** go to `https://fitted-three.vercel.app` in any normal browser — phone or laptop, whatever's
> easier. Two gotchas: NOT the Instagram/Messenger in-app browser (breaks sign-in), and the first load can
> take a few seconds.
>
> **Your data:** your call whether to delete your account when done — delete anytime in the app. If you don't
> delete, your data may be used for this experiment and to keep building the app. Never shared, never used for
> anything else.

Why each line is load-bearing (the app nudges but can't coerce, so the message carries it): **photos** +
**honest dislikes** are the two out-of-band asks (skip photos → yield stays unpowered no matter how many
snapshots). The **retention line is the honest-consent artifact** — the Fable-settled posture (2026-07-19):
friends who DON'T delete → their data may be kept for the experiment + app-building; deletion still FULLY
erases (a deleted friend exports **zero**), so keeping the "erased permanently"-style promise while retaining
a deleted friend's export would break it — hence the softer "may be used if you don't delete" wording.
**Decidability target (updated 2026-07-20 to the frozen prereg):** the friend-facing intuition is
still "~30+ liked outfits across the cohort," but the DECISION now keys on the **scoreable-cluster
certificate** (`exportTrack2Core.cjs`, prereg §5): watch `manifest.yield.primaryRead.verdict`, which
flips `UNDERPOWERED → DECIDABLE` only at **≥25 scoreable accepted AND ≥25 scoreable rejected** clusters
with the per-friend concentration cap met — so **dislikes now count** (they are the primary read's
negative arm, not just hard negatives). `cohortImageUsableAcceptedOutfits` is kept as a continuity
readout but is no longer the decision. Device note: it's a webapp — phone OR laptop both work;
phone's just handy for snapping clothes on the spot.

Full session context: `docs/sessions/2026-07-18-track2-friend-ready.md` (trust re-grade table + gauntlet).

### clothingType slot-correctness rollout (2026-07-23 — run BEFORE the next recruit wave)

Code is BUILT + audited on `main` (`docs/plans/clothingtype-slot-correctness.md`, C1–C4). The rollout
order is load-bearing (the plan's §6): **web redeploy → migrate → Fly redeploy → re-invite.** Running
the migration BEFORE the web redeploy re-breaks on her next modal edit (the old deployed classifier
re-derives the row back to `dress`).

**Rollout status (2026-07-24): steps 1–3 DONE; step 4 (re-invite) is Brian's, and unblocked.**
Web half pushed + redeployed at `origin/main` `33c3743a` (deploy `fitted-3j576ozpf`, 17/17 live checks).
Migration `--apply` corrected the 1 flagged live row (Zhiyun's "suit dress" `dress → bottom`); the same
dry-run now reports 0 rows disagree (idempotent). Fly redeployed from `ml-system/` (image
`deployment-01KY997XRS7ZK8QMQ3BXQ3MWWV`, rolling in-place on the single machine — `fly scale show` = 1,
`/readyz` green) shipping the F16 honest hints. The recipe below stays as the trap-guard reference (order,
the `clothingTypeSource:"user"` re-run hazard, the backup-delete step).

1. **Push + web redeploy** (`git push origin main` → Vercel builds the fork; verify per "Pre-friend
   deploy re-verify" above — the one-render `bindable:true` gate).
2. **Migrate the live rows** (the conversion lever — this is what actually unblocks Zhiyun):
   ```sh
   cd fitted
   # DRY-RUN first (no writes) — against the LIVE Atlas, same URI pattern as the export:
   MONGODB_URI="$(grep '^MONGODB_URI_ATLAS=' .env.local | cut -d= -f2-)" npx tsx scripts/migrate-clothingtype.ts
   # EXPECTED: exactly 1 flagged row — Zhiyun's "suit dress", stored=dress → derived=bottom (the
   # verified 1-of-20 whole-corpus replay). If MORE rows appear, STOP and read them before applying.
   MONGODB_URI="$(grep '^MONGODB_URI_ATLAS=' .env.local | cut -d= -f2-)" npx tsx scripts/migrate-clothingtype.ts --apply
   ```
   `--apply` writes a timestamped backup JSON (pre-migration values) next to the script — it holds
   live friend data; it is gitignored, and **delete it once the run is verified**. The write is
   `$set clothingType` only, guarded against concurrent edits (Mongoose still bumps `updatedAt`, so
   the corrected row surfaces at the top of her wardrobe list — expected, not a bug).
3. **Fly redeploy** (per Ops notes above; stays 1 machine) — ships the F16 honest hints. Not on the
   conversion critical path, but ship it before re-inviting her (top/dress rescues still return
   2-card partials, and the OLD copy's "try again" is the loop she bounced on).
4. **Re-invite Zhiyun (win-back acceptance test):** the finalized onboarding message (above) + one
   honest line that her closet had a filing bug on our side which is fixed. Acceptance = she gets
   surfaced outfits on daily + skirt-rescue and rates ≥1. Her single-top/dress rescues remain honest
   2-card partials until her closet grows (no classifier can change that — only more items).

**Onboarding guidance for the recruit wave (plan §5 — nudges, never gates; §18 anti-guilt posture):**
- **Steer new friends to DAILY first, not rescue-first** — daily clears the `N_SURFACED=3` floor on a
  modest closet; a single-item rescue structurally caps at 2 outfits until the closet grows.
- **Minimum-closet ask in the onboarding message:** ≥2 tops, **≥2 bottoms, ≥1 pair of shoes** — the
  single change that lifts every mode over the floor (shoes alone lift each single-top rescue 2→4).
  Honest ask in the message, never an app gate (REQFIELDS-1 posture).
- **Dress-heavy recruit caveat:** dress-rescue is structurally ≤2 outfits per dress — a dress-heavy
  closet still needs bottoms + shoes to yield; recruit them, but set the expectation.
- **Yield realism vs the prereg:** at ~1–4 ratings per converting friend, 3–5 friends may miss the
  ≥25+≥25 scoreable-cluster bar — recruit MORE closets than the minimum, prompt "rate what you see,"
  and prefer friends who'll engage over hitting a gender mix. (Informs recruiting only; the frozen
  decision rule is untouched.)

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
