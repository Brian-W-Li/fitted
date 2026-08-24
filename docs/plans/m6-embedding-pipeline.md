# M6 embedding pipeline — the Track-2 Look executor

> **STATUS: SPEC — build not started; implement C1 in a fresh session referencing this plan.**
> This plan **implements** the frozen re-measure rule; it never restates or amends it. The
> decision rule's single home is `ml-system/experiments/track2_transfer/preregistration.md` (+ the
> Spec §20 M6 row summary). Where this plan freezes a micro-decision the prereg does not address
> (§D9), that freeze happens **here, pre-look** — the prereg files are never edited.

## Goal

Build the offline machinery that, when a Track-2 export bundle's own certificate satisfies the
pre-registered Look trigger, computes the frozen content prior's outfit scores over friend closets
and executes the pre-registered Look — so the sole remaining M6 entry gate (Spec §20 M6 row) fires
promptly and correctly the day the data qualifies, with every analysis choice frozen in code
**before** any friend label is scored.

## The promise this serves

1. **Freeze-before-look credibility.** The prereg froze the statistics; it could not freeze the
   dozens of implementation micro-decisions an analysis inevitably makes (cluster→snapshot
   assignment, degenerate bootstrap replicates, abort ordering, tolerance tiers). Building the
   executor **while the data is still collecting** freezes all of them pre-look, in committed
   code with tests — the same discipline that made the H26 NO-GO credible, extended from the rule
   to the machinery. A pipeline written *after* the certificate reads DECIDABLE would make every
   one of those choices with labels in reach.
2. **The α-fence is a mechanism, not discipline.** The prereg's two-look design spends a real,
   unrecoverable α budget. The pipeline structurally refuses to score friend labels below the
   frozen floors (§D2): no bypass flag exists, the label-touching entry point requires a clearance
   object only the gate can construct, and a once-only look ledger makes "look again" refuse.
3. **Promptness.** Track 2 is COLLECTING (2 friends rating). When an export first certifies
   ≥25 scoreable clusters per arm with the concentration cap holding, Look 1 should run that day —
   not after a multi-session scramble that itself risks post-hoc choices.

## Success criteria (mechanical, whole-plan)

- The gated Look runner exists and its **rehearsal mode** runs the full path end-to-end
  (gate → decode/embed → score → bootstrap → record write) on legal-to-score inputs (a synthetic
  bundle + the **local** H26 closet photos — gitignored face-bearing photos that must NEVER be
  committed; see C6), producing a mock look record — the "ready before the data is" proof.
- The gate provably refuses (each with a red-if-removed test): arms of 24, cap 0.51,
  a single-friend bundle, Look 2 without a committed non-ESTABLISHED Look-1 record, a re-run when a
  look record already exists, an empty operator-exclusion list without the explicit override, and a
  certificate that disagrees with the Python re-derivation.
- The pipeline's constants are **pinned equal** to `preregistration.json` by test, and its Python
  eligibility re-derivation is **pinned equal to the real JS `buildCertificate`** over one shared
  committed fixture, from both runtimes (pytest + jest).
- Zero friend-label scores are computed in any build or test session (no real export bundle enters
  the repo or any test; fixtures are synthetic or H26 data).
- All suites green at every checkpoint boundary: `npm test` + `npm run hygiene` (from `fitted/`),
  pytest for `fitted_core` (ml-system/.venv) and for both experiment suites
  (experiments/h26/.venv — the venv hygiene check 15 collects with). Floors grow with the new
  tests, never get pinned back.

## Files

**New (all under `ml-system/experiments/track2_transfer/` unless noted):**

| File | Purpose |
|---|---|
| `h26_bridge.py` | Puts `../h26` on `sys.path` once and re-exports the imported H26 surface (see §D1). The ONLY place H26 symbols enter; no H26 file is copied or edited. |
| `constants.py` | The pipeline's copy of every frozen number it consumes (floors 25/50, cap 0.5, boundary 0.50, point floor 0.60, CI levels 0.975/0.95, B=10,000, horizon 2026-10-31) — pinned equal to `preregistration.json` by `tests/test_pipeline_constants.py`, never a bare hand copy. |
| `bundle.py` | Load + validate an export bundle (manifest.json, training_examples.jsonl, images/); re-derive scoreable clusters per prereg §5 in Python; apply the operator/test exclusions (the bundle FILES are not exclusion-filtered — only manifest.yield is). |
| `gate.py` | The freeze gate: trigger re-check, cross-runtime certificate agreement assert, `LookClearance` (module-private constructor), the once-only look ledger, the horizon branch. |
| `embed_bundle.py` | Decode (EXIF-transposed) + embed bundle images through the frozen FashionSigLIP backbone via the H26 loader; write the per-bundle embedding cache + content-hash manifest. |
| `scoring.py` | Outfit scores (mean over C(n,2) type-conditioned edges via the sealed head; cosine reference rung), pooled within-friend AUC, the snapshot-blocked-within-friend bootstrap, LOFO sensitivity, per-friend reporting. |
| `transfer_read.py` | The secondary read: H26's `build_pairwise` construction over accepted clusters at clothingType grain, source-outfit bootstrap, 95% two-boundary read. |
| `run_look.py` | The CLI driver: `--bundle --as-of [--look 1|2] [--verify] [--rehearsal] [--allow-no-operator]`. Assembles the stages in the frozen order; writes `analysis_sample.json` + the look record. |
| `fixtures/synthetic_bundle/` | The deterministic synthetic-bundle generator. The tiny synthetic jsonl + manifest are **COMMITTED** (jest's cross-runtime suite feeds them to `buildCertificate` and must work on a fresh clone with no Python step; the certificate math never reads image bytes — image-usability is manifest/row status); `regen.py` regenerates them (byte-identical, asserted by a test) AND produces the images into the gitignored `generated/images/` (needed only by rehearsal + image-leg tests, which run `regen.py` first); `regen.mjs` calls the REAL `buildCertificate` for the committed yield block. Its manifest must include a fabricated non-empty `exclusions.operatorAuthIds` + `yield.excluded.users` block so gate step 1 passes without any bypass. |
| `tests/test_pipeline_constants.py`, `tests/test_bundle.py`, `tests/test_gate.py`, `tests/test_embed_bundle.py`, `tests/test_scoring.py`, `tests/test_transfer_read.py`, `tests/test_run_look.py` | The pytest suite (counted by hygiene check 15's `experimentsCollected`). |
| `looks/` | The committed look ledger (empty until Look 1; `analysis_sample.json`, `look1_record.json`, later `look2_record.json` — which carries its own frozen snapshot-ID set, the prereg §8 `analysis_sample` analogue for Look 2's qualifying export). Rehearsal output goes to a gitignored `rehearsal_out/`, never here. |
| `.gitignore` (in `track2_transfer/`) | NEW — must be created at C1: ignores `rehearsal_out/`, the per-bundle embedding cache (§D7), and `fixtures/synthetic_bundle/generated/` (the regenerated IMAGES only; committed = the generator scripts + the synthetic jsonl/manifest + the JS-produced yield block + the EXIF fixture JPEG). Nothing ignores any of these today (`ml-system/.gitignore` is Python-only; `track2_transfer/` has no `.gitignore`). |
| `tests/exportTrack2CrossRuntime.test.ts` (under `fitted/`) | Additive jest suite: the real `buildCertificate` over the shared fixture must equal the committed yield block — so certificate drift fails jest while Python drift fails pytest, both against one artifact. |

**Edited (small, pointer-only):** `docs/Fitted_Spec_v2.md` §20 M6 row (build-doc pointer — done at
spec commit); §23-H53 row (at C3: the M6 re-measure embed half exists with the orientation fixture;
the W-track ingestion half stays open); `docs/plans/m5-c8-half2-runbook.md` §8 (at C6: the Look
command pointer). `fitted/tests/repoHygiene.baseline.json` floors bumped as tests land.

**NOT touched (see also the verbatim fences below):** the four sha-pinned freeze artifacts
(`ml-system/experiments/track2_transfer/preregistration.md`, `preregistration.json`,
`derive_power.py`, `power_derivation.json` — hygiene check 11 must stay green); every file under
`ml-system/experiments/h26/` (import-only — no shared-code extraction is needed, §D1);
`fitted/scripts/exportTrack2Core.cjs` and all export/app/deploy code;
`ml-system/experiments/track2_transfer/tests/test_preregistration.py` (new pins go in new files);
anything deployed (Fly stays 1 machine, untouched).

## Approach — the decided design

### D1. Location + code sharing: import H26, never fork it

The pipeline lives in `ml-system/experiments/track2_transfer/` beside the prereg it implements.
H26 modules import each other by bare name from a flat directory, so `h26_bridge.py` inserts the
h26 directory on `sys.path` and re-exports exactly the needed surface (verified against source
this session):

- `embed.py`: `load_backbone`, `embed_images`, `EmbeddingCache`, `cache_manifest_path`, `HEADLINE`
  — the frozen backbone + revision/preprocess assert pattern (`domain_probe.embed_closet` is the
  model to follow, including the mandatory `ImageOps.exif_transpose`).
- `train_head.py`: `PairwiseEdgeHead`, `checkpoint_sha256`, `type_pair_index`, `set_determinism`
  — the head is type-conditioned on the 5-value clothingType (`FIVE_TYPES` = top/bottom/dress/
  outer_layer/shoes, `data_loader.py:36`), exactly what the bundle's `engineVisible.clothingType`
  carries.
- `domain_probe.py`: `load_sealed_pairwise_head` (sha-binds the checkpoint blob to the sealed
  `selection.json`), `catalog_pair_scores` (the catalog-side cross-check).
- `evaluate.py`: `head_edge_scorer` (memoized symmetric `(i,j)→float` over frozen embeddings + the
  unordered type pair), `SEED`; `baselines.py`: `cosine_edge_scorer` (the zero-shot reference rung).
- `data_loader.py`: `Item`, `SplitData`, `make_split_data`, `build_pairwise`, `FIVE_TYPES` — the
  §4 negative construction the secondary read reuses verbatim.
- `metrics.py`: `auc_pos_neg` (Mann-Whitney, **ties = 0.5** — matches the prereg tie policy,
  verified at `metrics.py:43`), `CI`, `bootstrap_ci` (takes `alpha`; used for the secondary read's
  source-outfit unit with `alpha=0.05`).

The primary read's snapshot-blocked-within-friend bootstrap is NOT expressible with
`bootstrap_ci`'s uniform resampler, so `scoring.py` implements `blocked_bootstrap_ci` (percentile
convention identical to `metrics._percentile_ci`: `np.quantile` at `alpha/2`, `1−alpha/2`;
re-implemented in ~6 public lines rather than importing the private helper, with a test pinning the
percentile convention).

**Environment:** the pipeline runs and is tested in **`experiments/h26/.venv`** — the venv hygiene
check 15 already collects `track2_transfer/tests` with, and the torch build bound to `metrics.json`
by the bit-equality cross-check (§D7). Modules keep H26's lazy-heavy-import convention (torch/PIL
inside functions) so `--collect-only` stays cheap.

### D2. The freeze gate — a mechanism, not discipline

`gate.py` exposes one way to obtain scoring permission:

```
check_look_trigger(bundle, look, as_of, allow_no_operator=False) -> LookClearance
```

It performs, in order, all label-count (never label-score) checks:

1. **Exclusions present.** `manifest.exclusions.operatorAuthIds` must be non-empty (the runbook §8
   policy is that every existing personal account's uid is always passed) — refuse otherwise,
   unless `--allow-no-operator` is explicitly passed (legitimate only if every operator account has
   been erased; the override is recorded in the look record). Excluded users = the manifest's
   `yield.excluded.users` keys (each carries a `reason`: operator or test_account). Exclusion
   **identity** is manifest-trusted by necessity: the bundle files carry NO authIds (the exporter
   writes no users file; `training_examples.user` is a Mongo `_id`), so `track2test_*` accounts
   cannot be re-identified bundle-side — the H96/H104 jest suite pins the exporter's side, and the
   trust boundary is disclosed in the look record. Eligibility, dedup, and the cap (step 2) stay
   independently re-derived.
2. **Python re-derivation** of scoreable clusters from `training_examples.jsonl` per prereg §5
   (≥2 items ∧ every item image-resolved ∧ latest-state label ∈ {accepted, rejected};
   signature-dedup within {friend, arm}; exclusions applied; transfer-scoreable additionally
   requires a same-clothingType negative to exist at depth ≥2 in the friend's rendered-item set).
3. **Cross-runtime agreement assert:** the Python counts must equal
   `manifest.yield.scoreableClusters` exactly (integers) — **and per-user: every
   `manifest.yield.perUser` row's scoreable counts too**, since offsetting per-friend drifts
   (+1 here, −1 there) can hide inside equal totals — and the concentration shares must match
   within 1e-9 (both are IEEE doubles over the same integers). Any disagreement = a cross-runtime
   bug → hard abort, fix on sight, re-export. This runs on EVERY bundle, rehearsal included, so the
   eligibility logic can never silently fork from `buildCertificate`.
4. **The trigger floors** (from `constants.py`, pinned to the prereg): Look 1 needs both arms ≥ 25
   AND cap OK; Look 2 needs both arms ≥ 50 AND cap OK AND a committed `looks/look1_record.json`
   whose verdict is not ESTABLISHED. Below-floor → refuse with the certificate verdict echoed
   ("UNDERPOWERED — keep collecting"), exit non-zero, nothing written.
5. **Once-only ledger:** a fresh Look N refuses if `looks/lookN_record.json` exists — the only way
   to re-run a recorded look is `--verify` (reproduction mode, §D7). There is no flag that skips
   any of checks 1–5.
6. **Horizon branch:** `--as-of YYYY-MM-DD` is a required argument (no wall-clock read — the date
   is an analysis input, recorded in the record). Strictly after the frozen horizon, a below-floor
   sample becomes the prereg §2.1 **terminal** verdict
   (NOT-ESTABLISHED (underpowered) at 25≤N<50 post-Look-1, UNDERPOWERED-TERMINAL at N<25) instead
   of "keep collecting". The prereg horizon is **2026-10-31 OR the render-service decommission,
   whichever is earlier**: an optional `--decommissioned YYYY-MM-DD` moves the effective horizon
   EARLIER (recorded in the record); nothing can move it later.

`LookClearance` is constructible only inside `gate.py` (module-private class, no public
constructor); `scoring.score_bundle(...)` and `run_look`'s analysis stages require one. Tests and
the rehearsal obtain clearance **legitimately** — the synthetic fixture is built to clear the real
floors (2+ fake friends, ≥25/arm after dedup, cap OK) — so no test-only bypass exists to leak into
production use.

**Everything friend-facing happens inside the gated run — including embedding.** No pre-trigger
"warm-up" pass over friend images: embeddings are not scores, but the simplest fence to state,
audit, and test is that the pipeline touches friend bundle content only under a clearance. The
cost is minutes of CPU at Look time. (Watching `manifest.yield` stays explicitly not-a-look, per
prereg §0 — the exporter computes it without any score.)

### D3. The frozen measurand, implemented (prereg §6 — cited, not re-decided)

- **Edge score:** the sealed H26 trained pairwise type-conditioned head — checkpoint bound by
  `load_sealed_pairwise_head` (blob sha256 must equal the sealed `selection.json`
  `checkpoint_sha256`; the blob is regenerable via `train_head.py` if absent).
- **Outfit score:** **mean over the C(n,2) edges** of the outfit's items (H26 headline
  aggregation), each edge via `head_edge_scorer` (which conditions on the unordered
  `type_pair_index` of the two items' clothingTypes).
- **Embeddings:** frozen Marqo-FashionSigLIP via the H26 loader; the loaded `revision_sha` and
  `preprocess_hash` must equal the committed `embedding_manifest_fashionsiglip.json` (drift →
  abort, per `embed_closet`). `ImageOps.exif_transpose` before embedding is mandatory, with an
  orientation-6 regression fixture (prereg §6 requires it; §23-H53).
- **Ties:** `auc_pos_neg` scores ties 0.5 (verified).
- **Reference rung (reported, never gates):** `cosine_edge_scorer` mean-over-edges through the
  identical pipeline — both reads reported alongside the trained head's, so the head's marginal
  lift on real closets is visible.
- **Model weights:** loaded from the local HF cache exactly as H26 does (`open_clip`
  `hf-hub:Marqo/marqo-fashionSigLIP`); no new pinning mechanism — the revision/preprocess asserts
  make scoring against wrong weights impossible, which is stronger than any download policy.

### D4. Primary statistics (prereg §2/§7 — implemented)

- **Per-friend AUC** = `auc_pos_neg(accepted_scores_f, rejected_scores_f)`.
- **Pooled AUC** = Σ_f U_f / Σ_f (n⁺_f · n⁻_f) where U_f = AUC_f · n⁺_f · n⁻_f — exactly the
  prereg's mean over within-friend ordered (accepted, rejected) pairs; cross-friend pairs never
  form. A brute-force pairwise implementation pins the weighted form in tests.
- **CI:** percentile bootstrap, B = 10,000, **97.5% two-sided per look** (percentiles 1.25 /
  98.75). Resample unit: each friend's snapshots with replacement, count fixed per friend
  (`blocked_bootstrap_ci`); the friends themselves are never resampled → the claim stays
  cohort-conditional. `derive_power.py` is planning arithmetic (Hanley–McNeil) only — cited as
  context, never used as the analysis CI.
- **Verdict:** ESTABLISHED iff CI_low > 0.50 AND point ≥ 0.60; otherwise per the prereg §2.1
  verdict table + horizon branch.
- **LOFO sensitivity:** recompute dropping the friend with the largest pair mass n⁺_f · n⁻_f
  (§D9 freezes this reading of "largest-n"); if the pooled verdict flips across 0.50, downgrade
  ESTABLISHED → "suggestive" (never the reverse).
- **Per-friend reporting:** every friend's arm counts + own AUC in the record; the operator's
  (excluded) closet is scored and reported **separately**, never pooled, never in triggers.

### D5. Secondary read (prereg §3/§5/§7 — implemented)

Positives = transfer-scoreable accepted clusters. Per friend, build a closet-shaped `SplitData`
(items = that friend's **image-resolved** rendered items, `Item.category_id = Item.type =
clothingType`) and run H26's `build_pairwise` verbatim at the frozen `SEED`: distinct co-worn
positives, one same-category anchor-non-co-occurring negative each, exhausted pools
skip-and-count. The negative grain is clothingType — that IS the frozen certificate's
`minCategoryDepthForNegative` grain (prereg §5), coarser than H26's Polyvore fine categories and
disclosed as such in the record. Restricting the draw pool to image-resolved items is required
(an unresolvable item can never be scored) and can only shrink pools — shrinkage lands in the
skip-and-count, never a silent exclusion. Pooled pair AUC across friends; bootstrap at the
source-outfit (accepted-cluster) unit via `bootstrap_ci(alpha=0.05)`; the two-boundary directional
read {CI_low > 0.50 / CI_high < 0.70} with the 12/25 interpretation floors; reported, never gates,
never promoted.

### D6. Constants + cross-runtime pinning (the CLAUDE.md rule, applied twice)

1. **Numbers:** `constants.py` ↔ `preregistration.json`, pinned by
   `tests/test_pipeline_constants.py` (the `test_preregistration.py` pattern; that frozen test
   file itself is not edited).
2. **Eligibility behavior:** the shared synthetic fixture. `fixtures/synthetic_bundle/regen.mjs`
   invokes the REAL `buildCertificate` to produce the committed yield block; pytest asserts the
   Python re-derivation equals it; the new jest suite asserts `buildCertificate` still produces it.
   One committed artifact, both runtimes red on drift — plus the §D2 runtime assert on every real
   bundle as the backstop.

### D7. Determinism, caching, reproducibility

- **Per-bundle embedding cache** (gitignored) + a bundle embedding manifest: the backbone fields
  (asserted equal to the committed H26 embedding manifest), imageId order, and per-image sha256
  over the bundle's file bytes — the `embed.py` manifest pattern adapted to bundle images.
- **The look record carries full provenance:** bundle content hashes (manifest.json,
  training_examples.jsonl, the per-image sha set), `checkpoint_sha256`, backbone revision +
  preprocess hash, seed, B, alpha, `--as-of`, torch version + thread count, and every §D9
  micro-decision outcome (assigned snapshots, dropped-replicate count, LOFO friend). The verdict
  is reproducible from bundle + record alone.
- **Verify mode** (`--verify`): re-runs a recorded look from the same bundle and asserts the
  statistics reproduce — exact on the emitting machine.
- **Catalog cross-check preflight** (before any friend content is embedded): re-score the catalog
  test pairs through the sealed head (`catalog_pair_scores`) and compare to the emitted
  `metrics.json` point. Exact match → recorded "bit-bound" (same guarantee `domain_probe.py`
  demands). Mismatch within 1e-6 → proceed, recording both values + an env-drift caveat (a torch/
  numpy upgrade between now and Look 1 must not permanently block the Look — the sha-bound
  checkpoint + revision assert already pin the measurand). Beyond 1e-6 → abort (real drift).

### D8. Image handling: trust the certificate for counting, re-verify for scoring

The certificate's image-usable gate is the exporter's "bytes exist" notion. The pipeline
re-verifies at run time: every image referenced by a scoreable cluster must exist in `images/`,
decode, and EXIF-transpose. **Any failure aborts the entire run before any label-score is
computed** (stage order is frozen: gate → decode+embed ALL images → score). A silent per-outfit
exclusion at this stage would be a post-hoc-lookable sample choice; an abort spends no α (nothing
was scored) and the fix is a re-export / exporter bugfix. Same for a scoreable item with a null or
out-of-vocabulary clothingType (the export writes `engineVisible.clothingType` always; a violation
is a write-path bug, not a data condition).

### D9. Micro-decisions frozen here, pre-look (the prereg is silent on these; disclosed in the record)

1. **Cluster→snapshot assignment:** a deduped {friend, arm} signature's bootstrap snapshot = the
   lexicographically smallest snapshotId among the rows carrying it (deterministic from bundle
   content alone; the H26 "positive's FIRST source outfit" analogue).
2. **Which duplicate row scores:** the assigned (lexicographically smallest snapshotId) row's
   items — its `engineVisible` clothingTypes and imageRefs condition the score. (Duplicate rows
   can differ if an item was edited between renders; one deterministic representative, disclosed.)
3. **Degenerate bootstrap replicates** (a resample leaving no friend with both arms non-empty):
   recorded as NaN, dropped from the percentile, count disclosed in the record; a drop rate > 1%
   is flagged prominently.
4. **"Largest-n friend" for LOFO** = largest pair mass n⁺_f · n⁻_f (the friend with the most
   weight in the pooled statistic); ties → lexicographically smallest user id.
5. **A signature appearing in both arms** is kept once per arm (prereg §5 says so explicitly —
   listed here only because the implementation must not "resolve" the ambivalence).
6. **`labelsWithoutTrainingExample` > 0** (labels bound to redacted/missing snapshots) does not
   block a look — the counter is copied into the look record so the loss is visible.

## Edge cases

| Trigger | Behavior | Why |
|---|---|---|
| Arms 24/25, or 25/25 with cap 0.51, or single friend | Gate refuses, echoes the certificate verdict, exit ≠ 0, nothing written | The frozen Look-1 trigger; a single-friend bundle fails the cap by construction |
| Python re-derivation ≠ manifest.yield | Hard abort naming both values | Cross-runtime drift is a bug to fix on sight, never to score through |
| `looks/look1_record.json` exists, fresh `--look 1` | Refuse; point at `--verify` | Once-only α spend; re-analysis is reproduction, never a new look |
| `--look 2` with no committed Look-1 record (or Look 1 = ESTABLISHED) | Refuse | Look 2 exists only if Look 1 did not establish (prereg §2.1) |
| `--as-of` after the effective horizon (2026-10-31, or `--decommissioned` if earlier) with below-floor arms | Emit the prereg terminal verdict (NOT-ESTABLISHED underpowered / UNDERPOWERED-TERMINAL) | The horizon makes "keep collecting" terminal — the study decides even when the answer is "couldn't answer" |
| Empty `operatorAuthIds` in the bundle manifest | Refuse unless `--allow-no-operator`, which is recorded in the look record | A forgotten exclusion flag would pool the operator's self-labeled closet into the headline arms |
| Referenced image missing / undecodable; null or unknown clothingType on a scoreable item | Abort the whole run before any scoring | A per-outfit exclusion here is a post-hoc-lookable sample choice; an abort burns no α |
| Backbone revision / preprocess hash ≠ committed embedding manifest; checkpoint sha ≠ sealed selection.json | Abort | The measurand is frozen; scoring in a drifted space measures the drift, not the transfer |
| Catalog cross-check off by ≤ 1e-6 | Proceed with an env-drift caveat recorded | A torch upgrade must not permanently block the Look; the sha binds still pin the measurand |
| Catalog cross-check off by > 1e-6 | Abort | Real reproduction failure — the sealed head no longer reproduces its emission |
| A friend with an empty rejected arm | Contributes no pairs to the pooled AUC; visible in per-friend reporting | Prereg §7 per-friend reporting exists exactly so this is a visible pooled claim |
| Degenerate bootstrap replicate | NaN-drop + disclosed count (flag > 1%) | §D9.3 — frozen now so it can't be chosen at look time |

## Out of scope (explicitly NOT this plan)

- **Any M6 training work** — the trained scorer, the §23-H28 `rank()`/`RankerContext` hook, any
  fine-tune on friend data. M6 opens only per the prereg verdict branches.
- **The W-track ingestion EXIF/embedding path** (§23-H53's other half) and any CV-service work.
- **Exporter/app changes** — `exportTrack2Core.cjs`, `export_track2.mjs`, routes, models, deploys.
  The one additive jest suite touches `fitted/tests/` only.
- **Scheduling/automation of the Look** — it is a deliberate manual command (Brian's decision this
  session); the monitor and export never invoke it.
- **Recruiting, onboarding, or any collection-side change.**

## DO-NOT-TOUCH (verbatim fences from the /spec charter)

- NEVER compute any score over friend labels in the spec session or the build sessions —
  not even "to smoke-test". A premature look burns the frozen α. The first real scoring
  run over friend data IS Look 1 and happens only when a qualifying export triggers it.
- Do NOT edit ml-system/experiments/track2_transfer/preregistration.{md,json},
  derive_power.py, or power_derivation.json (hygiene check 11 sha-pins them; it must
  stay green).
- Do NOT touch fitted/ app code, the export scripts, or anything deployed (Fly stays
  1 machine, untouched).
- H26 experiment files: import from them; modify only if the plan explicitly rules a
  shared-code extraction, with the H26 suite kept green. **This plan rules: NO extraction —
  every needed symbol is already importable (§D1); H26 files are read-only for this build.**

## Checkpoint ladder (each sized for one short bounded session; light build-and-audit loop per
checkpoint — one fresh review agent; C2 and C6 reviews focus on the α-fence)

**C1 — bridge, bundle, eligibility, constants, cross-runtime fixture (no torch).**
`h26_bridge.py` (import surface only), `constants.py` + `tests/test_pipeline_constants.py`,
`bundle.py` (jsonl/manifest parsing, exclusions, the §5 re-derivation), the synthetic-bundle
generator (`regen.py` deterministic jsonl + tiny images; `regen.mjs` emitting the committed
yield block via the real `buildCertificate`), the jest cross-runtime suite. Read the real H26/
export files FIRST — this plan's cites can drift.
**DONE:** pytest (track2_transfer) green incl. constants pin + fixture equality + dedup/both-arms/
image-gate/exclusion unit tests; `npm test` green incl. the new jest suite; `npm run hygiene`
green (floors bumped in the same commit).

**C2 — the gate (no torch).**
`gate.py`: trigger checks, cross-runtime assert wiring, `LookClearance`, the once-only ledger,
Look-2 preconditions, horizon branch, operator-exclusion refusal + override.
**DONE:** every refusal in the Success-criteria list has a test that goes red if the check is
removed (mutation-grade: floor−1 refuses, cap+0.01 refuses, ledger file present refuses, …).

**C3 — the embedding leg.**
`embed_bundle.py`: decode + `exif_transpose` + frozen-backbone embed + the bundle embedding
manifest/cache; backbone-drift refusal (monkeypatched manifests); abort-on-decode-failure; the
orientation-6 regression fixture (a deterministically generated EXIF-6 JPEG committed under
`fixtures/` — NOT an H26 closet photo: none are committed and none may ever be; `h26/.gitignore`
ignores `closet/` and every image extension precisely because they are face-bearing consented
photos, "never egress to git"). Unit tests use a
fake backbone (no network/weights in pytest); the real-backbone path is the rehearsal's job.
Update the §23-H53 row: the M6 re-measure embed half now exists with its fixture; W-track half
stays open.
**DONE:** tests green with no weight download; H53 row reconciled in the same commit.

**C4 — scoring + primary statistics.**
`scoring.py`: outfit scores (fake head in tests), pooled within-friend AUC pinned against a
brute-force pairwise implementation, `blocked_bootstrap_ci` (per-friend count preservation,
seed determinism, the 1.25/98.75 percentile convention pinned, degenerate-replicate handling),
LOFO, per-friend + operator-separate reporting, the cosine reference rung plumbing.
**DONE:** mutation checks pass (flipping one label moves the AUC; swapping two friends' snapshots
changes a blocked replicate but not the point estimate; removing the point-floor check makes a
0.58-point ESTABLISHED test go red).

**C5 — the secondary read.**
`transfer_read.py`: per-friend closet-shaped `SplitData`, `build_pairwise` reuse at clothingType
grain over image-resolved pools, skip-and-count, pooled AUC at the source-outfit unit
(`bootstrap_ci`, alpha=0.05), the two-boundary read + 12/25 floors.
**DONE:** tests green, incl. an exhausted-pool skip case and a boundary-exclusion case.

**C6 — the driver, the rehearsal, ops wiring.**
`run_look.py`: stage order enforced (a test spies call order — all embeddings complete before the
first label-score), `analysis_sample.json` + look-record writers (schema incl. all §D7/§D9
provenance), verify mode, rehearsal mode (synthetic bundle end-to-end on the REAL backbone +
sealed head, plus the **local** H26 closet photos (`ml-system/experiments/h26/closet/` — gitignored,
never committed; skip this leg with a loud note if the dir is absent) through `embed_bundle` as the
real-photo leg; output to
the gitignored `rehearsal_out/`, marked `"rehearsal": true`, refused inside `looks/`). Runbook §8
gets the Look pointer; final floor bumps. **Local-artifact prereqs** (all verified present on this
machine 2026-08-23; all gitignored, so a fresh clone cannot rehearse without regenerating): the
sealed checkpoint blob (`h26/checkpoints/pairwise_edge_grid_0_seed20260629.pt`), the catalog
embedding cache (`h26/embeddings/`), and the Polyvore `h26/data/` dir for the catalog preflight —
if any is missing, regenerate per the H26 docs BEFORE the rehearsal session (hours, not Look-day
work).
**DONE (the plan's overall DONE):** `python run_look.py --rehearsal` runs end-to-end and prints a
mock look record; all suites + hygiene green; a fresh review round on the final code returns zero
load-bearing findings (convergence, not punch-list).

## Test plan

- **pytest** (`experiments/h26/.venv`, run from `ml-system/experiments/track2_transfer/`): the
  suites above; hygiene check 15's `experimentsCollected` floor (currently 327) grows with them —
  bump the floor in the same commit each checkpoint, never pin.
- **jest** (from `fitted/`): the one additive cross-runtime suite; floor (currently 995) grows.
- **Never in any test:** real export bundles, real friend rows, or network weight downloads.
  Heavy real-backbone execution lives only in the rehearsal command.
- **Mutation posture:** green proves nothing — each gate/floor test must be shown red with the
  check removed before the checkpoint closes (capture the red output).

## At-Look-time ops script (retire this section into the look session's commit when it runs)

1. A routine export (runbook §8 command, all operator uids passed) shows
   `manifest.yield.primaryRead.verdict == "DECIDABLE"`.
2. Brian runs, from `ml-system/experiments/track2_transfer/` in the h26 venv:
   `python run_look.py --bundle <export dir> --as-of <today> --look 1`
   (the runner independently re-verifies everything; a refusal means the certificate and the
   pipeline disagree — fix before looking, nothing was spent).
   **Run the Look on THE export that first read DECIDABLE — never re-export between seeing
   DECIDABLE and running the Look.** Prereg §2.1's frozen sample is "the first export in which
   both arms reach ≥ 25"; a fresher re-export would silently swap the sample. The gate cannot see
   other exports (there is no export registry), so this line is the enforcement; the look record's
   bundle hashes are the sample's identity.
3. Commit, on main, in one commit: `looks/analysis_sample.json`, `looks/look1_record.json`, and
   the doc fold-ins: flip the Spec §20 M6 row's "sole remaining entry gate" clause to the verdict;
   update the Track-2 memory + runbook §8 status line.
4. Branch on verdict (prereg §2.1): **ESTABLISHED** → the M6 re-measure entry condition is
   satisfied; open M6 planning (`/spec` the rank-hook milestone). **Not ESTABLISHED at Look 1** →
   keep collecting toward 50/arm; Look 2 repeats steps 1–3 with `--look 2`. **Terminal
   non-ESTABLISHED** → record it and pick a named next lever (recruit +K under a fresh freeze /
   reconsider the prior under a new prereg); M6 does not open on this basis.
5. Any re-analysis ever = `--verify` against the committed record; never a fresh look.

## Open questions

None. All design questions from the /spec charter are decided above (D1–D9 + the three
Brian-decided calls: manual gated Look command; rehearsal as the plan's DONE proof; this ops
script section). No new Spec §23 rows are needed: every hole surfaced during this spec is either
decided here pre-look (§D9 — deliberately plan-local, since the whole point is freezing them
before data qualifies) or already registered (H53's W-track half, H28's M6 hook).
