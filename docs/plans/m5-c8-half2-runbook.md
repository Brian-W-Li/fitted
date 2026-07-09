# M5 — C8 half-2 runbook (the live `USE_ML_SHORTLISTER` flip)

> **Executable checklist only.** All *rationale* lives in `docs/plans/m5-cutover.md` §C8 (gates,
> the §A degraded contract, §D timeouts, §G.1 write ownership) — this doc is the ordered command
> sequence, so the two never duplicate (single-home rule). Run from a real machine with the Fly CLI
> + the keys (RC-to-Claude can't execute deploys).
>
> **Half-1 is DONE** (commit `754135a8`, this branch): legacy vertical + `regenerate/route.ts` +
> `lib/gemini.ts` deleted; `recommend/route.ts` is the M5 dispatcher (flag-OFF → §A degraded empty
> state); enum trimmed; `openai`/`@google/generative-ai` npm deps gone. Half-2 = everything below.

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
cd ml-system && python -m fitted_core.cli --corpus-dir tests/fixtures/corpus --runs 5
# gates: parse rate, hallucinated ids, schema-rejection rate;
#        rescue additionally → forced-item inclusion (forced item in EVERY surfaced outfit) + StyleMove presence.
# Capture the legacy baseline numbers as the writeup "before".
```
> **OWED (see §Owed):** `fitted_core.cli` today is **rescue-only + in-process** — there is no `daily`
> intent flag and it doesn't call the deployed `/render`. The daily half of this gate needs the small
> CLI extension below. The in-process read still exercises the real model + prompt (the load-bearing
> parse/hallucination/schema gates); the HTTP wire is additionally covered by the live smoke (step 6).

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

## Owed pre-flip build items (key-independent — safe to do ahead of the flip)
1. **Daily-intent path in `fitted_core/cli.py`** (currently rescue-only) so the F3 mechanical read
   covers the daily prompt on real `gpt-5.4-mini`. Small: add an intent selector + a daily corpus
   source; reuse the evaluation harness. Needs a key only to *run*, not to build.
2. *(optional)* Route the mechanical read through the deployed `/render` HTTP path instead of
   in-process, if you want the wire covered by the eval too (else the live smoke covers it).
