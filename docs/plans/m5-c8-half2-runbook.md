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
> **STATUS (2026-07-08): half-2 is VALIDATED LOCALLY; the cloud deploy is DEFERRED (Brian's call).**
> The engine (F3, §4) and the full cutover wire (local integration smoke, §4 "Local backend smoke")
> are proven live on `gpt-5.4-mini` — nothing left to *prove*. This runbook's deploy steps stand for
> whenever Fly is stood up; they can be run **remotely, non-interactively** by exporting a `FLY_API_TOKEN`
> (created in the Fly web dashboard) — no terminal/browser login required, only a Fly account + billing.

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
cd ml-system && python -m pytest tests service/tests -q    # 1049
cd fitted     && npm test                                  # 516 (incl. generationSnapshotRoundTrip + serde mirror)
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

## 7. Post-flip reconciliation (same or follow-up commit)
- `fitted/.env.sample`: delete the `OPENAI_API_KEY` row; **uncomment** the staged half-2 block.
- `CLAUDE.md` env table: drop `OPENAI_API_KEY`; add `ML_SERVICE_URL` + `FITTED_SERVICE_KEY` rows.
- `docs/plans/m5-cutover.md`: mark **C8 half-2 ✅ DONE**; record before/after numbers for the writeup.
- Ensure `.github/workflows/conformance.yml` is on the default branch.

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
