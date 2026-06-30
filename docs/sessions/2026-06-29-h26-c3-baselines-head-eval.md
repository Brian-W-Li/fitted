# H26 C3 — baselines + trained head + eval driver (handoff)

**Date:** 2026-06-29 · **Branch:** `h26-c3-baselines-head-eval` (off `h26-c2-freeze`; C1+C2+C3 stacked, not merged to main)
**Plan:** `docs/plans/h26-compatibility-spike-v2.md` §15-C3 · **Floors:** h26 **127 pytest** green / core **751** unaffected / ruff clean.

## What C3 built (all under `ml-system/experiments/h26/`)

- **`embed.py`** — added the cache *reader* (`EmbeddingCache` + `load_cache` + `_verify_cache`). Tamper-verifies the
  cache against its committed manifest (ids/content sha256, dim, dtype, dup-id, L2-norm) and **fails loud when the
  cache is not built** (the real current state). The rest of embed.py (C2) is untouched.
- **`baselines.py`** — zero-shot cosine edge scorer (the gate-A floor, §7); the category co-occurrence **leak
  detector** (`cooccurrence_leak_check` → must read 0.50/0.25/0.50, §C.6); the **item-popularity** confound
  diagnostic (edge = pop of the *varying* endpoint; outfit = mean item-pop; the pinned §C.6 score form).
- **`train_head.py`** — `PairwiseEdgeHead` (§C.1, **795,617** params) + `ItemLevelHead` (§C.2, **788,481**, the ±5%
  capacity match); pointwise BCE; the frozen 6-config Adam grid; `torch.use_deterministic_algorithms(True)` +
  seed 20260629 + single-thread → **bit-for-bit** reproducible; mechanical valid-pooled-pair-AUC argmax selection;
  sealed `selection.json` emission (schema-validated, **no metric value**, manifest-hash bound).
- **`evaluate.py`** — the **metric-computation half only**: head/cosine/item-level edge scorers → `build_pairwise`
  /`build_fitb`/`build_outfit_level` → `metrics.py` CIs (gate-A added value, gate-D outfit-AUC + FITB, the pinned
  pair-level seam diff, the popularity diagnostics) + the leak assertion, as an in-memory `MetricSuite`. **Stops
  before `metrics.json`** — no emission, no printed number (the §1 blindness boundary; C4 owns emission).
- **`fitb_order.py` + `fitb_order.json`** — the §12 **gate-B order materialization** (added after the audit; see
  below). Materializes + hashes the seed-ordered FITB question list **before any model number**.
- Tests: `tests/{synthetic,test_baselines,test_cache,test_train_head,test_evaluate,test_fitb_order}.py`.
- `requirements.txt` += `jsonschema==4.26.0` (selection.json + the C4 unlock-schema validation).
- `.gitignore` += `checkpoints/` / `*.pt` (the trained-head weight blobs are regenerable from the seed; only the
  hash ships, in `selection.json`).

## The load-bearing caveat: the embedding cache is NOT built

The session prompt stated the cache was "built and sealed" — **it is not**. `embedding_manifest_fashionsiglip.json`'s
cache-content fields are still `null` and there is no `embeddings/` dir. Building it needs Brian's gated `mvasil` HF
access + a multi-hour CPU pass over ~175k items (`embed.build_cache`). So:

- **`selection.json` is DEFERRED** — it needs the trained checkpoint, which needs the cache. The whole train→select→
  emit path is **built + tested on synthetic embedding fixtures** (the established pattern) and is **one command from
  the real artifact**: once the cache is built, `python train_head.py` writes the real, schema-valid, bit-deterministic
  `selection.json`. No fake/placeholder selection.json was committed.
- **`fitb_order.json` IS materialized + committed now** — it needs only the corpus + seed (both present), so it is a
  real C3 artifact. Generated from the real strict-disjoint test split: **13,895** full FITB questions (5 skipped),
  **500** gate-B, `order_sha256=49a842b3…`. Reproduces bit-for-bit.
- Real-data validation done this session (dataset present locally): the §4 leak detector reads **exactly**
  0.5000000000 / 0.2500000000 / 0.5000000000 on the real test split; `build_pairwise` on the real **train** split
  (the C1 crash point) is clean (93,750 edges, 0 skip). So the data path is real-run-ready modulo the cache.

## Audit (heavy loop — converged in 2 rounds)

- **Round 1** (6 parallel lanes + synthesis): correctness / fidelity / blindness / merit lanes **clean**; 4 findings
  from the test-quality + forward-compat lanes, all verified against source and fixed:
  1. **(forward)** C3 never materialized/hashed the gate-B seed-ordered FITB list — a real §12 C3 deliverable. → built
     `fitb_order.py` + committed the real `fitb_order.json` (standalone artifact; selection.schema's `manifest_hashes`
     is `additionalProperties:false`/4-field, so it can't be bound there — blindness is by commit order instead).
  2. **(tests)** sealedString rejection was never tested → added a test that `validate_selection` *raises* on a
     decimal/metric-word inside `checkpoint_id`/`config_id`.
  3. **(tests)** §C.1 feature math was pinned only by param-count + symmetry (both invariant under a feature typo) →
     added a test pinning the 5 feature blocks to their slices.
  4. **(tests, minor)** the paired-CI test only checked the point estimate → now asserts the suite's CI is
     bit-identical to `paired_auc_diff_ci` and differs from the unpaired form.
- Doc reconciled in the same pass (`§15` C3 bullet + Files list now name `fitb_order.py/.json`).
- **Round 2** (re-audit the fixes + the new module): **0 findings** across all lanes → converged.

## Next steps

1. **Build the embedding cache** (Brian's HF creds + the one-time pass): `embed.build_cache(corpus item_ids)`. This
   populates the manifest's cache fields (the config freeze is re-verified + fail-loud on drift).
2. **Materialize `selection.json`**: `python train_head.py` (loads the cache + strict-disjoint corpus, runs the grid,
   writes the sealed selection.json + the gitignored checkpoints). Commit `selection.json`.
3. Then **C4** (LLM-as-judge + the four-file unlock → first `metrics.json` emission). The C4 emission half consumes
   `MetricSuite` (field names already map 1:1 to `metrics.schema.json`) + reads `fitb_order.json` for the gate-B
   prefix; the item-level checkpoint (for the C6 seam diff) is regenerable bit-for-bit from the seed.

Sequence unchanged: C3 ✅ → C4 → C5 → C6 (then M5 is the separate live cutover). See `docs/plans/h26-compatibility-spike-v2.md`.
