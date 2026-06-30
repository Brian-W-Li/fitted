# H26 C2 — freeze handoff (2026-06-29)

Handoff for a fresh session to finish **C2 of the H26 compatibility spike**: author + commit the
pre-registration FREEZE. The metric harness + embedding loader are done; the freeze is the
remaining (one-way-door) piece. Canonical plan: `docs/plans/h26-compatibility-spike-v2.md`
(read §1, §3, §4, §6, §8, §11, §12, §15 closely — the freeze copies their frozen choices).

## C2 status
- ✅ `ml-system/experiments/h26/metrics.py` + `tests/test_metrics.py` (pooled AUC, outfit-level AUC,
  FITB@4, cluster bootstrap w/ paired+unpaired diff CIs). The metric definitions the prereg cites.
- ✅ `embed.py` + `tests/test_embed.py` (FashionSigLIP frozen via open_clip; gated-parquet image
  source; `build_cache` + `embedding_manifest`; matched-base/generic/FashionCLIP2 ablation rungs).
- ✅ `closet_manifest.template.json` + `closet_category_reference.json` (94-category picker).
- ✅ `requirements.txt` dependency lock; `README.md` status.
- ⬜ **FREEZE (this session's job)** — see below.
- **State: 56 spike tests green, ruff clean, UNCOMMITTED on `main` (dirty tree).** Branch
  (`h26-c2-...`) before committing. The isolated venv is `ml-system/experiments/h26/.venv`
  (torch/open_clip/datasets/stats installed; an HF token is present in env for the gated repo).

## Verified facts (measured — DO NOT re-assume)
- FashionSigLIP loads via open_clip `hf-hub:Marqo/marqo-fashionSigLIP`.
- **Embedding dim = 768**, float32, L2-normalized (norm 1.0).
- **Revision SHA = `c56244cc94f92419e8369fa71efdaf403b124ce8`** (read from the local HF cache, the
  actually-loaded revision).
- **Preprocess sha256 = `fb80278db5fd5efcddc5a736a9095f34ed28da48e270cce5e12df162248404f6`**;
  transform = Resize(224, bicubic, antialias) → ConvertMode → ToTensor → Normalize(0.5,0.5,0.5).
- These are also recorded in `requirements.txt` (the dependency-lock comment) and reproduced by
  `embed.load_backbone(...)`.

## Decisions ALREADY MADE (Brian, this session) — bake into the prereg
1. **Popularity-confound headline protocol = same-fine-category + BLIND diagnostic.** Keep
   same-fine-category + anchor-no-cooccurrence as the frozen headline (Vasileva-comparable); the
   item-popularity-only baseline is a pre-registered diagnostic with a BLIND margin (set before any
   number); if it clears the margin, `results.md` labels the headline "popularity-confounded
   (disclosed)" + a popularity-matched-negative sensitivity re-run. **NOT** popularity-matched-as-
   headline. (§4.)
2. **Closet = prep-template-now / label-before-C4.** Template + picker are written. Brian's closet
   is currently small (~10 outfits, summer break away from his main wardrobe); a female-wardrobe
   reference is **optional stretch** (dress-type coverage + external validity, NOT power) he'll "see
   if he can get." The transfer is **reported, not gated** + the M6 re-measure entry condition, so a
   small/underpowered closet is acceptable (wide CI + scarcity-dropping, disclosed). The closet
   manifest freezes **before the C4 unlock**, not necessarily with the prereg — so it does NOT block
   authoring the prereg. (§10/§12.)
3. **FITB allocation = gate D full held-out FITB / gate B seed-ordered ≤500 (prefix-selected at
   C4).** (§12.)

## Owned analyst pins (author with build-doc defaults; RATIFY with Brian before committing —
they are one-way pre-registration commitments)
- **Machine-readable prereg format:** sidecar `preregistration.json` (no YAML dep; evaluate.py
  parses JSON; sibling manifests already JSON).
- **Edge head:** 2-layer MLP on `[e_i⊕e_j, |e_i−e_j|, e_i*e_j]` (768-d inputs) + learned **15-way
  unordered type-pair embedding**; **symmetrized** `½[f(i,j)+f(j,i)]`; pin hidden width (lean ~256,
  GELU).
- **Item-level ablation head:** 2-layer MLP `g(emb)→scalar`, hidden width set so params within
  **±5%** of the pairwise head; same optimizer/grid/epochs/early-stop/valid-split.
- **Objective:** pointwise BCE (margin-ranking BPR = ablation-only).
- **Optimizer/grid:** Adam, a small LR grid, fixed epoch budget, valid-AUC early stop,
  `torch.use_deterministic_algorithms(True)` + committed seed.
- **Family-wise correction:** Holm over the ablation family (gates A/B/D scoped out).
- **Blind popularity margin:** set BEFORE measuring (e.g. pair-level item-popularity-only AUC > 0.55
  ⇒ disclosed + sensitivity re-run). Edge AND outfit-level (§4).
- **Committed seed:** one integer constant.
- **STL/CTL build-or-drop yield threshold** (optional/non-gating).

## FREEZE artifacts to author (all under `ml-system/experiments/h26/`, before any model number)
- `preregistration.md` — replace the C1 skeleton: §1 headline cell + §12 A/B/D gate block (δ=5) +
  the frozen analyst pins above + the reported-transfer band (0.70 / drop 0.12). Single home; §§3–11
  explain mechanics, don't re-decide.
- `preregistration.json` — machine-readable sidecar `evaluate.py` parses (gate thresholds +
  headline-cell values).
- `fitb_manifest.json` — eligibility, held-out-item rule, distractor rule, seed, gate-B vs gate-D
  allocation (rules + seed, not materialized questions).
- `embedding_manifest_fashionsiglip.json` — **config now** (dim/SHA/preprocess hash/normalization/dependency
  lock); the cache-content hashes (per-image, cache hash) STAGE to C3 when the full pass runs (the
  pass reveals no compatibility number, so deferring it does not touch the freeze's blindness). Note
  the naming: `build_cache` writes `embedding_manifest_<key>.json`; the prereg references the
  headline `_fashionsiglip` one as canonical.
- `metrics.schema.json` — the `metrics.json` field set (skeleton at C2, finalized C6): the §15
  artifact-dataflow fields, each with a CI.
- `closet_manifest.json` — NOT now; Brian labels before C4 (template ready).
- `type_map.json` — already frozen at C1.

## Process (Fable unavailable)
- **Dual-read substitute** for the important calls: a deep first-principles review in-session +
  an independent second pass, both converging before a call locks (record the substitute basis).
- **Heavy-audit loop** (the one-way door earns it): parallel lanes — ambition-merit, correctness/
  edge-cases, spec↔code fidelity, test-quality, forward-compat to C3–C6, security/untrusted-input,
  and (once fixes exist) regression-of-the-fixes. **Loop until a round returns no load-bearing
  findings.** Verify every finding against source before acting.
- **Conflicts are bugs:** reconcile the build doc in the same pass if a freeze choice diverges.
