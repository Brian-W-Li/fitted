# H26 C3 — catch-net audit (depth pass over the committed C3)

**Date:** 2026-06-29 · **Branch:** `h26-c3-baselines-head-eval` (HEAD was `6a052b78` at audit start)
**Scope:** single-reader depth audit of C3 (baselines / trained heads / eval driver / gate-B order) — empirical
probing over the two prior parallel-fan-out audits that already converged. Floors at start: h26 **127** / core
**751** / ruff clean.

## Verdict

**No load-bearing code defects.** The three load-bearing invariants all hold, verified empirically (not just by
green tests):

- **Blindness (§1/§12):** traced every write/print in `baselines`/`train_head`/`evaluate`/`fitb_order`. The two
  C3-committed artifacts (`fitb_order.json` committed; `selection.json` deferred) carry **no metric value of any
  split** — only ids/counts/hashes/hyperparameters. `evaluate.main`/`train_head.main`/`fitb_order.main` print no
  number; `compute_metric_suite` returns in memory, writes no `metrics.json`. The valid pooled-pair-AUC drives the
  argmax in-process only.
- **Bit-determinism (the §9 headline win):** **proven cross-process** — `train_head.run()` on the synthetic
  fixture in two separate interpreters produced a byte-identical `selection.json` + `checkpoint_sha256` + item-level
  checkpoint sha + both valid AUCs. `set_num_threads(1)` + `use_deterministic_algorithms(True)` + the per-config
  re-seed are sufficient on this environment. (The existing test proved only *same*-process — that hole is now
  closed by a new test; see below.)
- **Fidelity (§C.1/§C.2/§C.4/§C.6):** head math (3104-d feature, 15×32 type-pair, `½[f(i,j)+f(j,i)]`, 795,617 /
  788,481 params), the 6-config Adam grid, the popularity score forms, and the 0.50/0.25/0.50 leak detector all
  match `preregistration.json`.

### Empirical evidence run this session
- **Cross-process determinism:** two subprocess `run()`s → identical sealed artifact (closes audit §3A).
- **Mutation battery (9/9 caught RED):** dropped `.abs()`, flipped `*`→`+`, dropped symmetrization, perturbed
  hidden width, broke the memo canonicalization key, swapped paired→unpaired gate-A, weakened the sealedString
  decimal pattern, corrupted the committed `fitb_order` hash, flipped argmax→argmin — **every** mutation turned a
  test red; repo restored clean. The suite has teeth.
- **Real-data paths (cache-free):** `build_pairwise` on the real **train** split is clean (93,750 edges / 0 skip —
  the C1 crash point); the §C.6 leak detector reads **exactly** 0.50 / 0.25 / 0.50 on the real **test** split
  (`assert_chance` passes); the committed `fitb_order.json` re-derives from the real corpus
  (`test_committed_fitb_order_reproduces_from_real_data` runs, not skipped — dataset present).
- **Sha-tripwire chain:** `data_loader.py` / `type_map.json` / `fitb_manifest.json` shas all match what
  `fitb_manifest.json` + `fitb_order.json` + `selection.json`'s `manifest_hashes` bind — **no frozen file drifted**.
  `jsonschema` in `requirements.txt` does not conflict with the embedding `dependency_lock` (different scope).

## The one change committed

- **`tests/test_train_head.py::test_training_is_deterministic_across_processes`** (new) — spawns a fresh interpreter
  that trains one config and asserts its `checkpoint_sha256` is bit-identical to an in-process train. Closes the
  documented hole (the prior reproducibility test was same-process only); the §9 bit-determinism claim is the trust
  floor, so it gets a durable cross-process guard. Floor **127 → 128**.
- **`docs/plans/h26-compatibility-spike-v2.md` §15** — added an **eval-compute-budget** risk bullet (the measured
  feasibility finding below) + clarified the test-isolation bullet (repo-root `pytest` caveat). Forward-looking,
  non-frozen, single-home.

## Findings flagged (not fixed — frozen artifacts / C4-owned)

1. **[minor — frozen-doc accuracy] Pair count cites the wrong split.** `preregistration.md:310` and
   `data_loader.py:367` (the `build_pairwise` docstring) say "38 of **44,759** test pairs"; **44,759 is the
   `strict_disjoint=False` (near-disjoint) count** — the frozen *headline* (`strict_disjoint=True`) split has
   **44,627** distinct positive pairs (measured this session). The "38 recurring" claim is correct for both; only
   the denominator names the wrong split. **Not load-bearing** (no code/gate/test computes against 44,759; the
   cluster-unit decision it supports — pair, not source-outfit — is valid). **Flagged, not fixed:**
   `preregistration.md` is a one-way-door freeze and `data_loader.py` is sha-tripwired
   (`fitb_manifest.constructor_source_sha256`), so a fix cascades a re-freeze of `fitb_manifest.json` +
   `fitb_order.json`. Human decision: accept 44,759 as a disclosed near-disjoint reference, or re-measure + re-freeze.
   **RESOLVED 2026-06-29 (re-measure + re-freeze):** verified `strict_disjoint=True` = **44,627** pairs / 38 recur,
   `strict_disjoint=False` = 44,759 / 38 recur (the 38 are coincidentally identical). Corrected both homes to
   **44,627** + a `strict-disjoint` trap-guard; re-froze `data_loader.py` sha into `fitb_manifest.json` +
   regenerated `fitb_order.json` (`order_sha256` unchanged 49a842b3… — behavior-neutral); added a hermetic
   `fitb_order` provenance-binding guard. Done pre-model-number, so the freeze's "before any model number" property
   is preserved. Floor 128→129.

2. **[C4 budgeting — measured] Offline eval is ~50 min/pass, ~2.5 hr with the 3-seed footnote.** A full real-data
   `compute_metric_suite` is dominated by the frozen **B = 10,000 cluster bootstrap** (~5 min per pair-level AUC CI
   — `scipy.rankdata` over ~89 k pooled scores × 10 k replicates, ×~8 CIs ≈ 40 min) and the **batch-1
   `head_edge_scorer`** (215,086 distinct edge forwards at ~1 ms ≈ 7 min). **Feasible — no OOM, ~1 GB** — but not
   "free"; the §C.7 3-seed robustness footnote triples it. Two deferrable speedups (recorded in §15): a batched
   pre-pass via the existing `train_head.score_edge_tensors`, and a vectorized AUC bootstrap (must reproduce the
   same B = 10,000 numbers; `metrics.py` is frozen → re-freeze). **Not a C3 blocker.**

3. **[minor — nit] `selection.json.early_stop_epoch` holds `best_epoch`** (the selected checkpoint's epoch), not the
   epoch early-stopping triggered; when `converged=False` (full budget) the name is doubly loose. Pure provenance
   (selection.json feeds no gate), schema-valid, no metric leak. A clarifying field name/comment would help; the
   schema is a C2 freeze artifact, so left for the human.

## Observations (non-blocking)
- **Repo-root `pytest` collects the spike and errors** on its heavy deps. Pre-existing (the spike tests predate C3);
  the documented invocations (`cd ml-system && pytest` → 751; `cd experiments/h26 && pytest` → 128) are correctly
  isolated via `testpaths = tests`. Noted in §15.
- **No test pins `best_state` == the *best* epoch's weights** (vs the final epoch's) — the determinism test can't
  catch a best→final regression. The code is correct; optional future hardening (needs a controlled AUC trajectory).
- **Item-level checkpoint has no committed sha binding** (only the pairwise head is in `selection.json`). Acceptable:
  it is regenerable bit-for-bit from the seed, and `test_param_counts_match_the_frozen_mirror` guards its shape.

## State at handoff
- Floors: h26 **128** / core **751** (unaffected — only a test file + the build doc changed) / ruff clean.
- C3 remains correct + blindness-preserving + bit-deterministic + faithful to §C.1–C.6 and the §23-H28 seam plan
  (PairwiseEdgeHead = the additive pairwise hook; ItemLevelHead = the ablation arm; no `fitted_core` seam landed).
- Sequence unchanged: C3 ✅ → build the embedding cache → materialize `selection.json` → C4.
