# 2026-07-02 whole-system audit — handoff (implementation-ready)

> **Audience:** any follow-up session (including a low-reasoning-effort one). Everything here was
> **verified against source on 2026-07-02**; line numbers are from commit `8411df26`. The audit was
> report-only — **none of the fixes below are applied yet.**
>
> **Audit verdict:** `H26 in progress with known follow-ups`. H26's code, frozen artifacts, blindness
> enforcement (§1), §4 negative-sampling, ledger integrity, privacy/egress, and the prereg amendment
> discipline are **sound** — no blindness breach, no privacy leak, no corrupt frozen artifact, no
> defect that corrupts a gated number. `fitted_core` is **clean on contract fidelity** (all 16 modules,
> serde↔TS: no drift). The app's big auth holes are all **already registered in spec §19** (M5-owned).
> Suites at audit time: core pytest **751**, h26 **244 + 1 skip**, jest **375**, `next build` OK.
>
> **Verified clean — do NOT re-audit these (2026-07-02, source-verified):** H26 §4 negatives (incl.
> multi-anchor FITB + outfit-level construction + split scoping), the four-file unlock + blindness
> teeth end-to-end, ledger keep-last dedup/exactly-K/scalar-only, judge API contract
> (`max_completion_tokens`/`reasoning_effort:none`/`detail:low`/both-orders/plurality collapse),
> payload image-byte redaction, `.gitignore` coverage (git check-ignore verified), prereg .md↔.json
> value agreement, freeze-before-model-numbers git ordering, prereg amendments (all pre-pilot, gates
> untouched, selection re-bind documented), h26 ruff clean; fitted_core contract fidelity (pipeline
> order, sampler R6/R11, validator §12/§13, ranker §14, rescue H22, response §G, snapshot/serde↔TS
> field walk — no drift), determinism (no global RNG, no builtin hash, stable float summation);
> app NoSQL-injection shapes, image path traversal, cross-user writes on token-verified routes,
> hot-path indexes, GenerationSnapshot update-immutability guard, cascade completeness (H43
> exclusion intentional), wipe/seed rails (triple-gated), `.env.sample` completeness.
>
> *Verification basis (so "clean" is not over-trusted):* the H26 unlock/blindness/ledger/judge/
> redaction items + prereg diffs/git-ordering were **read directly by the auditing session** (full
> files); §4 negatives (`data_loader.py:359-470`), sampler R6/R11/caps, fitted_core RNG/hash
> hygiene, app query scoping (`findById` sweep), and the prereg gate literals were **lane-verified
> AND directly spot-checked** (all held); the remaining fitted_core items (ranker §14 / rescue H22 /
> response §G / serde↔TS walk) and wipe/env items are **lane-verified with exact cites,
> corroborated by the 751 mutation-hardened green tests + the prior committed heavy audits**
> (M3/M4/Spearhead/C-series) — not re-read line-by-line this session. If a future finding contradicts
> one of THOSE entries, re-audit that entry rather than assuming this list wins.
>
> *Findings basis:* every High and Medium finding in this file (all PART B tasks; PART D's
> imagePath/interactions-itemIds/PATCH-validators/OpenAI-module-scope/maxOutfits items;
> `generation.py:100-101` max_tokens; the `error.message` 500 egress; the `User.ts:21` email
> unique index behind the auth/sync DoS; the missing GenerationSnapshot delete guard
> (`GenerationSnapshot.ts:481-483` covers update/replace/save only); `verify_fitb_order`'s
> self-trusted seed; the modal/edit-photo/sessionStorage/redirect-race/UTC-datetime UI items) was
> **directly re-read at the cited lines by the auditing session and confirmed**. The Minor register
> is lane-reported at report-and-move-on tier — sanity-plausible but not individually re-read;
> verify each cite before acting on it.
>
> *Experiment-validity addendum (verified before folding in):* the `K=1` risk is real:
> `gpt_judge.two_stage_paired_fitb_diff_ci` re-collapses each bootstrap replicate from `_resample`
> over the K forward/K reverse samples, and `_resample` on a length-1 list is constant, so K=1
> carries **zero** judge-run variance and makes plurality stabilization inert. The FITB popularity
> exposure is also real: `data_loader.build_fitb` picks the answer from a real outfit (`rng.choice(ids)`)
> but draws distractors uniformly from same-category non-co-occurring items (`_draw_same_cat`), while
> `baselines.py` / `evaluate.py` only implement popularity diagnostics for pair/outfit AUC
> (`popularity_edge_scores`, `popularity_outfit_scores`), not FITB. The resulting changes below do
> **not** move frozen gates or edit the preregistration; they tighten the RUN parameter choice and
> results interpretation. The no-go convergence caveat is also source-backed: `selection.json`
> seals `grid_0` with `converged:false`, `early_stop_epoch:48`, and `epoch_budget:50`, while the
> H26 plan header already flags a future gate-D miss as epoch-budget-suspect. Treat this as a
> writeup caveat, not permission to refit or amend silently.
>
> *RUN-protocol addendum (verified before folding in):* the operator-protocol findings are real. In
> `make_calibration.finalize_panel`, filename stems become labeler ids and are committed under
> `per_labeler_skip_rate`, with duplicate stems silently overwriting earlier files. In `evaluate`
> `materialize_metrics_json`, the expensive re-train happens before `validate_unlock_files` and before
> `read_ledger`, while `metrics.json._meta` records no `judge_runs.ndjson` sha and `emit` does not
> require the ledger committed-clean. In `assemble_closet`, `_consent.owner_id` is copied verbatim from
> `closet_input.json`. In `run_judge`, `pilot --snapshot` is optional even though gate-b/emit later bind
> the frozen addendum snapshot. These are protocol/integrity guardrails; they do not alter frozen gates.

## Hard rules for the implementing session

1. **NEVER edit these frozen artifacts:** `preregistration.md`, `preregistration.json`,
   `fitb_manifest.json`, `fitb_order.json`, `type_map.json`, `selection.json`,
   `embedding_manifest_fashionsiglip.json`. (The `judge_addendum.md` **prose** may be edited while it
   is still a `frozen:false` scaffold — Task 4 does — but never its envelope values except at the
   sanctioned RUN-phase freeze.)
2. **No paid/live API calls.** Never call OpenAI/Gemini/HF-download. The hermetic suites need no
   network. `OPENAI_API_KEY` must NOT be exported when running pytest (see Task 1 for why).
3. Python for H26 = `ml-system/experiments/h26/.venv/bin/python` (NOT conda base). `openai==2.44.0`
   IS installed + pinned there (an older memory note saying otherwise is stale).
4. Test counts are **floors that grow, never pins**: after these tasks expect h26 ≥ 244 green
   (+ new tests), core ≥ 751, jest ≥ 375.
5. Verify commands after H26 edits: `cd ml-system/experiments/h26 && .venv/bin/python -m pytest -q`
   and `cd ml-system && .venv/bin/python -m pytest -q`.

---

## PART B — Immediate fixes (do these now, in order; commit on main)

> **Low-effort routing (read before starting).** Tasks 1, 2, 3, 4 (docs), 5 (docs), 6, and Task 8's
> code parts (8A/8B/8C) are small, exact, mechanical edits — safe for a low-effort session. **Task 7
> is NOT:** 7A is an operator K-decision + runbook wording (made at the RUN phase, PART C step 3), 7B
> is a genuine new-diagnostic build for the emit/results phase, and its wording guardrails are
> `results.md` content. **Task 8D and the "Operator-only guardrails" paragraph are RUN conventions,
> not committable code.** All of those already live in PART C — a low-effort PART B pass lands the
> code/doc edits and leaves Task 7 + the operator rules for the RUN phase.

### Task 1 (HIGH): make the gate-b ordering test hermetic + guard the live ledger

**Problem.** `ml-system/experiments/h26/tests/test_run_tooling.py:303-313`
(`test_cmd_gate_b_refuses_scaffold_before_any_spend`) calls the REAL `rj.cmd_gate_b(SimpleNamespace(n=100))`
with no path injection. Today it stops at the freeze gate only because the committed `judge_addendum.md`
is `frozen:false`. **The moment the RUN-phase operator legitimately freezes + commits the addendum,
running pytest will:** pass the freeze gate → load the real corpus → reach
`run_judge.py:147-148` → **`os.remove(GATE_B_LEDGER)` deletes the real `judge_runs.ndjson`**
(destroying paid, possibly not-yet-committed judge results) → construct the live
`ParquetContentProvider` + `OpenAIJudgeClient` → and, if `OPENAI_API_KEY` is exported, **spend real
tokens** re-scoring 100×K×2 questions.

**Fix (two independent parts):**

1a. In `run_judge.py`, function `cmd_gate_b` (line ~128): change the first line
    `env = require_frozen_envelope()` → `env = require_frozen_envelope(root_dir=ROOT_DIR)`.
    (Reason: the bare call uses the *def-time default*, which monkeypatching `rj.ROOT_DIR` cannot
    change; passing the module global explicitly makes it call-time patchable. Everything else in
    `cmd_gate_b` already reads `ROOT_DIR`/`GATE_B_LEDGER` as call-time globals.)

1b. In `tests/test_run_tooling.py`, rewrite `test_cmd_gate_b_refuses_scaffold_before_any_spend` to be
    hermetic: copy the committed scaffold `judge_addendum.md` AND `judge_addendum.schema.json` into
    `tmp_path`; `monkeypatch.setattr(rj, "ROOT_DIR", str(tmp_path))` and
    `monkeypatch.setattr(rj, "GATE_B_LEDGER", str(tmp_path / "judge_runs.ndjson"))`; then assert
    `pytest.raises(SystemExit, match="FROZEN")` on `rj.cmd_gate_b(SimpleNamespace(n=100))`.
    The SystemExit fires at schema validation (frozen:false), before any git/corpus/client work, so
    the tmp dir needs nothing else. The file already has `_frozen_addendum_dir`/`FakeGit` helpers to
    crib from.

1c. In `run_judge.py cmd_gate_b`, replace the bare `os.remove(GATE_B_LEDGER)` (lines ~147-148) with a
    guard: if the ledger exists and `RealGit(ROOT_DIR).identity(GATE_B_LEDGER).committed` is False,
    raise `SystemExit` telling the operator to commit (or move) `judge_runs.ndjson` before re-running
    gate-b; only delete when the file is absent or committed-clean (git then preserves the old run).
    Import `RealGit` from `evaluate` (already imported in `require_frozen_envelope`). Add a test:
    tmp ledger + `monkeypatch.setattr(rj, "RealGit", lambda root: FakeGit(committed=False))` →
    expect the SystemExit. (Note `evaluate.RealGit.identity` on an *untracked* file returns
    `committed=False` — that is the case that must refuse.)

### Task 2 (MEDIUM): make the two RUN-success-hostile tests two-state

**Problem.** Two tests are written to FAIL exactly when the RUN phase succeeds, with no documentation
that this is expected — a follow-up session may "fix" them by un-freezing the addendum or deleting
`metrics.json` (both catastrophic).

2a. `tests/test_freeze.py:223-237` (`test_committed_judge_addendum_is_still_a_scaffold`) asserts
    `env["frozen"] is False` unconditionally. Rewrite two-state, using
    `test_embedding_freeze_agrees` (same file, lines 134-161) as the pattern: if
    `env["frozen"] is False` → keep the current scaffold assertions; else (post-freeze state) →
    assert the envelope validates against `judge_addendum.schema.json`
    (`evaluate._validate_against_schema` or jsonschema directly) — the schema's non-placeholder
    consts do the work. Rename to `test_committed_judge_addendum_is_scaffold_or_validly_frozen`.

2b. `tests/test_evaluate.py:176-182` (`test_compute_metric_suite_writes_no_metrics_json`) asserts
    `metrics.json` does not exist at the package root — goes red after a legitimate `emit`. Change it
    to assert **this call writes nothing**: record `os.path.exists(path)` (and `os.path.getmtime` if
    it exists) before `compute_metric_suite(...)`, and assert existence+mtime unchanged after.

### Task 3 (MEDIUM): warn about `emit`'s multi-hour wall-clock

**Problem.** `run_judge.py cmd_emit` → `evaluate.materialize_metrics_json` (evaluate.py:851) calls
`train_run(cache, corpus, seed=seed, write=False)`, which **re-trains BOTH heads over the full
6-config grid** (12 trainings × up to 50 epochs, single-thread by contract) *before* the ~50-min
metric suite + B=10,000 bootstraps. Nothing warns the operator; they will assume it hung.

**Fix (minimal, do this):** in `cmd_emit` (run_judge.py:182-189), before calling
`materialize_metrics_json`, print a warning: re-derivation of both heads over the frozen 6-config
grid (hours, single-thread) + ~50-min metric suite; do not interrupt.
**This is the SAME single warning as Task 8B's** — Task 8B adds the unlock/ledger preflight that must
run *before* this warning fires. Implement once, in this order: preflight (Task 8B) → this warning →
`materialize_metrics_json`. Do not emit two warnings.
**Optional (do NOT attempt casually):** a checkpoint fast path (load
`checkpoints/pairwise_edge_grid_0_seed20260629.pt`, verify `train_head.checkpoint_sha256` equals the
sealed `selection.json` sha, skip retraining) is sound for the pairwise head but the **item-level**
head has no sealed sha to verify against — resolving that needs a design decision; leave it unless a
high-effort session takes it up.

### Task 4 (MEDIUM, docs only): disambiguate the two "~100-Q pilots"

**Problem.** The docs use "the ~100-Q pilot" for TWO different runs, in the exact phase running now:
- `docs/plans/h26-compatibility-spike-v2.md` §8 ("Judge-above-chance check", ~line 568) + §12
  (~line 799 "the ~100-Q pilot is itself the first prefix of the same order") mean the **gate-B
  100-prefix**, which the built teeth only allow POST-freeze (`run_judge.py gate-b` refuses an
  unfrozen addendum).
- `judge_addendum.md`'s freeze-order step 2 puts the "above-chance pilot" BEFORE the step-3 freeze,
  and the envelope's `above_chance_pilot` block is filled at freeze time — those numbers can only
  come from the **calibration pilot** (`run_judge.py pilot`, whose `pilot_summary` prints
  `correct_vs_polyvore` — the judge-vs-Polyvore-answer readout on the ~100 panel questions).

**Fix:** in plan §8/§12, the addendum prose (scaffold — editable), and the Step-4 section of
`docs/sessions/2026-06-30-h26-c4-run-tooling.md`, name them distinctly:
**"calibration pilot"** = pre-freeze, ~100 panel questions, fills the envelope's
`above_chance_pilot` from `pilot_summary`'s judge-vs-Polyvore numbers; **"gate-B pilot prefix"** =
post-freeze, first 100 of `fitb_order.json`, the scale-up/half-width check only. Also add one
sentence to the addendum's freeze-order section documenting the flow explicitly (above-chance comes
from the calibration pilot; the gate-B prefix never feeds the freeze). Schema answer (verified
2026-07-02): `above_chance_pilot` is NOT in the schema's root `required` list, but its properties are
typed (number/number/boolean), so the scaffold's placeholder block fails validation unless filled —
fill it from the calibration pilot at freeze time (the freeze round-trip test at
`test_freeze.py:262` already models exactly this). State that in the addendum prose.

### Task 5 (MEDIUM, docs only): fix the twice-stale `ml-system/README.md` status line

`ml-system/README.md:7` still says "H26 … C1–C3 committed; next C4" (a full checkpoint behind; this
exact line has now drifted twice). Replace the inline H26 status with a pointer:
"status lives in `experiments/h26/README.md` + the plan header (`docs/plans/h26-compatibility-spike-v2.md`)."
Sibling one-liner: `docs/README.md:10`'s RUN chain reads "panel calibration → judge pilot → gate-b →
emit" — insert the load-bearing "**→ blind addendum freeze**" step between pilot and gate-b (CLAUDE.md
and spec §20/§23-H26 both have it).

### Task 6 (LOW, small hardening — same session if cheap, else skip):

- `evaluate.py:374-401` `_prereg_md_json_agree`: the `str(g["A"]["threshold"])` → `"0.0"` literal
  check is **vacuous** ("0.05" contains "0.0" as a substring, so it can never fail). Replace with a
  distinctive gate-A phrase check or delete that entry with a comment.
- `fitb_order.py:92-103` `verify_fitb_order` re-derives using `order["seed"]` (the file's own field)
  — a seed-swapped file self-verifies. Backstopped by both real consumers (run_judge + evaluate
  rebuild with their own `SEED` and compare prefixes), but add
  `assert order["seed"] == fitb_manifest["seed"]` inside `verify_fitb_order`, and add a freeze test
  pinning the four module SEED constants (`evaluate.SEED`, `run_judge.SEED`, `fitb_order.SEED`,
  `train_head.SEED`) all equal `preregistration.json["headline_cell"]["seed"]` (only train_head's is
  currently pinned).
- `make_calibration.py:273-279` `finalize_panel`: uses plain `json.load` — swap to
  `data_loader.load_json_strict` (duplicate keys in a hand-collected panel file would silently
  last-win into a sha-frozen freeze input).
- `evaluate.py` emission: record the consumed `judge_runs.ndjson`'s sha256 into `metrics.json._meta`
  as `judge_ledger_sha256` (binds the emitted numbers to the exact ledger; currently unbound).
  **Same edit as Task 8B — implement it once, there; this bullet is the "why", Task 8B is the "where".**
- `ml-system/tests/` (core, one test): add an **absolute golden vector** test pinning the exact item
  ids `fitted_core.sampler.build_candidate_pool` emits for one fixed over-cap wardrobe + context.
  All current sampler determinism tests self-compare via `random.Random.sample`, whose algorithm is
  NOT guaranteed stable across Python versions (only `random()` is) — this is the cross-version
  canary the H13 CI work needs. Pattern: the seed golden test (`test_seed.py:78-87`).
- `run_judge.py cmd_gate_b` (optional): a resume mode that appends only missing
  `(question_id, order, sample_index)` cells instead of delete-and-rescore — the keep-last dedup +
  exactly-K machinery already supports it; today extending N=100→500 re-pays the first 100 (cost-only,
  a few dollars).

### Task 7 (HIGH, experiment validity): make K non-vacuous + quantify FITB popularity exposure

> **Not a PART B mechanical edit — do NOT attempt in a low-effort session.** 7A is an operator
> decision (choose K≥2) + runbook wording, made at the RUN phase (PART C step 3); 7B is a new
> diagnostic to build during the emit/results phase; the "Results wording guardrails" are `results.md`
> content that does not exist yet. Nothing here is a small code recipe. It is kept in PART B only as
> the record of *what must be true before the RUN freeze/results* — routed by owner, not executed in
> this session. All of it is already carried in PART C.

**Problem A — K=1 silently voids a headline robustness claim.** The gate-B two-stage bootstrap is
supposed to propagate judge temp-0 run-to-run drift: `gpt_judge.two_stage_paired_fitb_diff_ci`
cluster-resamples questions, then re-collapses the judge from a resample of that question's K forward
and K reverse samples. At **K=1**, `_resample([x])` can only return `[x]`, so the inner judge-variance
stage is constant and the plurality vote is a single sample. The handoff's previous "start at K=1"
tip therefore conflicts with the design's claim that gate-B propagates judge-run variance and uses
K-sample stabilization.

**Fix / operator rule.** Before freezing `judge_addendum.md`, choose **K >= 2**; prefer **K=3** if
cost/latency is acceptable. If Brian explicitly overrides to K=1, the results writeup must drop or
weaken every claim that the parity CI propagates judge-run variance or that the judge verdict is
K-sample stabilized. Do not schema-hardcode this without Brian confirming the budget tradeoff; the
required change for the immediate RUN is the frozen envelope choice + docs/runbook wording.

**Problem B — FITB has a popularity shortcut that the current diagnostics do not quantify.** In
`data_loader.build_fitb`, the correct answer is a real outfit item (`rng.choice(ids)`), so high-outfit
frequency items are more likely to become answers; the three distractors are uniform same-category
draws from eligible non-co-occurring items. A "pick the most popular candidate" rule can therefore beat
chance on FITB without compatibility signal. The preregistered popularity diagnostic currently covers
pair-level and outfit-level AUC (`AUC_pop_edge`, `AUC_pop_outfit`) but **not** FITB.

**Fix / reporting rule.** Add or compute a **most-popular-candidate FITB diagnostic** over the same
full FITB questions (split outfit-frequency; deterministic tie handling via the existing FITB tie
rule). Report it next to the existing edge/outfit popularity diagnostics. This is diagnostic only:
do **not** move gates, do **not** edit frozen preregistration artifacts. A "clean GO" interpretation
requires the mandatory popularity-matched A/D sensitivity re-run to agree with the headline gates; if
it does not, the mechanical gate result can still be reported, but the headline must stay
"popularity-confounded (disclosed)" rather than "confound-clean".

**Results wording guardrails.** Even if A∧B∧D pass, the defensible claim is: a small trained
pairwise content-compatibility head over frozen FashionSigLIP clears the preregistered Polyvore-D
systems bar and is non-inferior within 5 FITB points to the **image-only `gpt-5.4-mini` forced-choice
judge** on that benchmark, supporting the cost/latency/determinism case for a deterministic scorer.
Avoid "beats GPT", "as good as the production stylist", "matched the 2018 baseline" (say
"approximately / in the neighborhood"), "proves real-closet transfer", and "measures compatibility"
without the co-worn/not-co-worn proxy caveat. If H26 no-goes because **gate D misses**, do not write
"the approach cannot clear the floor" without the training-budget caveat: the sealed winner is
`converged:false` at epoch 48/50, so a D miss is confounded between the approach ceiling and the
pre-frozen 50-epoch budget. Bumping epochs is a preregistration/design decision, not a silent fix.

### Task 8 (HIGH/MEDIUM, RUN protocol): close operator PII/provenance/time-burn gaps

**Problem A — panelist filenames leak into the committed calibration artifact.**
`make_calibration.finalize_panel` derives labeler ids from each answer filename stem and
`assemble_panel` writes those ids into `calibration_set.json["per_labeler_skip_rate"]`. The raw
`panel_answers/` files are gitignored, but real names in filenames would survive in a public,
sha-bound unlock artifact. Duplicate stems also silently overwrite in the `per_labeler` dict.

**Fix.** In code, fail loud on duplicate stems and map stems to opaque ids (`labeler_1`,
`labeler_2`, ...) before writing `calibration_set.json`; if preserving a local name->id mapping is
needed, keep it outside git. At minimum, the RUN convention is: rename downloads to opaque ids only
(`p1.json`, `p2.json`, `p3.json`), never real names/emails/initials.

**Problem B — `emit` refuses bad unlocks only after hours of work, and the judge ledger is not
provenance-bound.** `materialize_metrics_json` re-derives both heads and computes the metric suite
before `emit_metrics` calls `validate_unlock_files`; a missing ledger is read near the end. The
existing Task 6 sha bullet is necessary but incomplete: `emit` should also refuse an uncommitted or
dirty `judge_runs.ndjson` before any retrain.

**Fix.** In `cmd_emit` / `materialize_metrics_json`, preflight before the expensive retrain:
`validate_unlock_files(ROOT_DIR)`, assert `judge_runs.ndjson` exists, assert
`RealGit(ROOT_DIR).identity(GATE_B_LEDGER).committed`, then print the multi-hour warning (this IS the
Task 3 warning — one warning total, printed only after the preflight passes). Also record
`judge_ledger_sha256` in `metrics.json._meta` so every gate-B number binds to the exact committed
ledger bytes — **this is the same `metrics.json._meta` sha as Task 6's last bullet; implement it once,
here, under this field name (do not add a second sha field).**

**Problem C — committed closet metadata can leak a real owner id.** `assemble_closet` copies
`owner_id` / `consent.owner_id` verbatim into committed `closet_manifest.json["_consent"]["owner_id"]`.

**Fix.** RUN convention: use an opaque owner token (`owner_a`, `owner_01`), never a name/email.
Cheap code guard: reject owner ids containing whitespace or matching an email-like pattern.

**Problem D — the calibration pilot snapshot can diverge from the frozen judge snapshot.**
`run_judge.py pilot --k ...` defaults the snapshot from CLI code, but `gate-b` and `emit` bind the
snapshot from `judge_addendum.md`. If Brian pilots one snapshot and freezes another, K was tuned on a
different judge.

**Fix.** Run `pilot` with the exact intended `--snapshot`, verify that snapshot is still served, and
freeze `judge_addendum.md` with the same string. Select K by `human-agreement` only;
`correct_vs_polyvore` is the above-chance readout, not the K-selection target.

**Operator-only guardrails.** After sending the viewer, do not rerun `make_calibration.py` or edit
`calibration_visual_qc.json` before `finalize_panel` unless you intentionally redistribute the new
viewer. Send `calibration_viewer.html` privately to named panelists; do not host it publicly because
it embeds Polyvore image data URIs. For B3, redact closet-photo faces/PII before `assemble_closet`
hashes the bytes, and if B3 stalls use the documented blind unlock-split amendment rather than a stub
manifest.

**After Tasks 1-8:** run both pytest suites (expect all green, h26 floor grows), `ruff check` on the
h26 dir, then commit on main (docs+ml-system work — no branch needed).

---

## PART C — the RUN phase itself (Brian's manual steps; unchanged, tooling verified ready)

Do **Tasks 1-2 BEFORE the addendum freeze step** below (else the pytest trap in Task 1 fires).

1. Send `calibration_viewer.html` (local, gitignored, 100 coherent Qs) to ≥3 diverse panelists; each
   picks A-D or "Not sure", downloads answers.
2. Collect renamed per-person files into gitignored `panel_answers/`; run `finalize_panel([...])` →
   commit `calibration_set.json` (needs ≥50 surviving consensus questions).
3. **Calibration pilot** (Brian's `OPENAI_API_KEY`, his shell): `run_judge.py pilot --k <K>` for a
   few K; pick by human-agreement + stability. Use **K >= 2** so the two-stage bootstrap's judge
   resample is non-vacuous; prefer **K=3** if the cost/latency is acceptable. If Brian knowingly
   chooses K=1, results.md must drop the judge-run-variance / K-sample-stability claims.
4. **Freeze `judge_addendum.md`** (frozen:true, real hashes, K, snapshot, above-chance numbers from
   the calibration pilot) + commit. Blind: no trained-head number exists to look at.
5. `run_judge.py gate-b --n 100` → check above-chance + flip rate → extend `--n 500` if warranted →
   commit `judge_runs.ndjson`.
6. Assemble the closet (B3): photos + labels → `assemble_closet.py` → commit `closet_manifest.json`.
7. `run_judge.py emit --n <N>` (budget hours — Task 3) → `metrics.json` → then C5 (domain probe), C6
   (results.md + gates).

**Timebox (merit-lane recommendation, Fable-audited):** the whole RUN ≈ 1 calendar week. If B3 (closet)
is the last blocker for >2 weeks, the sanctioned fallback is a **blind, documented unlock-split
amendment** (decouple A/B/D emission from the transfer probe) — fallback only, not the plan. Gate-B is
a knife-edge by design (~4.8pt CI half-width at N=500 vs δ=5); a no-go ships as a clean preregistered
result, but a **gate-D no-go** must disclose the `selection.json` convergence caveat (`converged:false`
at epoch 48/50) rather than overclaiming that the approach itself hit a ceiling. After emission, the
**writeup is co-equal**: 1-page `results.md` leading with the §9 table + a portfolio README telling
the freeze story with commit hashes. Two one-line disclosures for `results.md`:
(a) FashionSigLIP's training data may share distribution with Polyvore-style product imagery — the
disjoint split guards item leakage, not backbone familiarity (fine for the systems claim; say it);
(b) the prereg §D "~175k items" one-time-pass estimate was pre-exclusion — the scorable cache is
83,178 (never edit the frozen prereg for this). Add the experiment-validity guardrails from Task 7:
state the actual K; report the judge's absolute FITB and human ceiling next to parity; print the
most-popular-candidate FITB diagnostic; print the popularity-matched A/D sensitivity; and keep every
parity sentence scoped to the image-only forced-choice judge, not the production stylist.

**Stop/go before freezing `judge_addendum.md`:**
- Tasks 1 and 2 landed before any `frozen:true` commit.
- `calibration_set.json` is committed, has >=50 consensus questions and >=3 labelers, and labeler ids
  are opaque. Grep `per_labeler_skip_rate` before committing.
- Panel answers came from the distributed viewer; no post-distribution redraw/QC edit unless the new
  viewer was redistributed. No duplicate answer filename stems.
- K >= 2 (prefer K=3), selected by human-agreement + acceptable flip rate, not by Polyvore correctness.
- Pilot snapshot exactly matches the snapshot being frozen; `above_chance_pilot` comes from the
  calibration pilot, and `inter_annotator_agreement` is copied from `calibration_set.json`.

**Stop/go before gate-b:**
- Frozen addendum is schema-valid and committed-clean.
- Run `gate-b --n 100` first; only extend if the judge is clearly above chance and flip/drop rates are
  acceptable.
- Commit `judge_runs.ndjson` after each paid prefix (`--n 100`, then `--n 500` if run). Do not run
  pytest in this window until Task 1 is applied.
- The scored prefix must pass the `fitb_order.json` drift tripwire.

**Stop/go before emit:**
- Preflight unlock files and ledger before the expensive retrain: all unlock files committed-clean,
  `judge_runs.ndjson` exists and is committed-clean, and `emit --n` equals the scored ledger prefix.
- `closet_manifest.json` is real, not a stub; `_consent.owner_id` is opaque; photos were redacted
  before assembly/hash.
- No `OPENAI_API_KEY` is needed for `emit`; use the H26 `.venv/bin/python`, not conda base.

**Stop/go before `results.md`:**
- Apply the C6 gate logic and near-gate rule; do not infer GO/no-go from raw C4 CIs alone.
- Report the mandatory popularity-matched A/D sensitivity and the most-popular-candidate FITB
  diagnostic.
- State K, judge absolute FITB, human ceiling, and the two-stage `gate_B_diff_*` parity CIs.
- If gate D missed, include the convergence caveat (`converged:false` at epoch 48/50).
- Include the two fixed disclosures: FashionSigLIP backbone familiarity and prereg "~175k items" vs
  the actual 83,178 scorable cache.

---

## PART D — Deferred register (do NOT implement now; pull into the owning milestone)

**M5 /spec agenda (new items this audit adds to the §19/§23 register):**
- No daily-intent orchestrator exists in `fitted_core` — rescue is the ONLY vertical
  (`config.py:155`); M5 must scope its cutover surface (rescue-only vs build a daily prompt builder).
- `rescue()` cannot receive M5 reducer outputs (`RescueRequest` carries no affinity/shown-signature
  fields; `rescue.py:244-251` pins `interaction_count=0`) — additive widening needed for re-roll.
- `wardrobe/[id]/route.ts:67`: **drop `imagePath` from the PATCH whitelist** (cross-user image
  laundering via the unauthenticated image route; only the upload route should write it).
- `wardrobe/[id]` PATCH: reject empty `name`/`category` (update validators are off by default —
  blankable required fields degrade warmth/type re-derivation).
- `interactions/route.ts:157-163`: POST stores unverified `itemIds`; GET's populate (`:67-75`)
  returns foreign items' name/colors/imagePath — cross-user READ primitive + M6 training-data
  pollution. Reuse the ownership filter the Gemini branch already has (`:178`).
- `recommend/route.ts:7-9` module-scope `new OpenAI(...)` throws at import with no key → the 503
  guard at `:320-325` is dead code. The M5 rewrite must lazy-construct the client. Also: no
  completion-token cap; `maxOutfits` unclamped/uninterpolated-unchecked (`:310`).
- `auth/sync` + the `email` unique index (`User.ts:21`) = signup DoS/account-squatting consequence
  of the registered no-auth hole.
- `GenerationSnapshot` deletes are unguarded (immutability hooks cover updates only) — candidate
  §23 hole: a `pre(["deleteOne","deleteMany"])` rejection would complete the one-way door.
- H28 seam-rung notes: the ranker sees only ids (hook needs an items-by-id input); `ScoreBreakdown`
  is a closed 7-field shape pinned in 4 homes (ranker/_breakdown_total, snapshot._breakdown_dict, TS
  schema, N4 tests) — budget the 8th field; `rank_with_audit` re-runs the pipeline (hook must be
  cheap/deterministic ×2). TS `candidates[].admittedViaFallbackStage` has no Python producer.
- Cross-runtime: `sortOutfitItems` (`dashboard/page.tsx:150-197`) re-implements the condemned
  string-matching — delete at M5; version `DASHBOARD_STORAGE_KEY` at cutover.
- **`fitted_core/generation.py:100-101` sends legacy `max_tokens`** — the SAME GPT-5.x idiom trap as
  the recommend-route one, but in code M5 KEEPS (the `OpenAIGenerator` seam). Default model is
  gpt-4o so nothing breaks today; when M5 picks the service's generator model, map to
  `max_completion_tokens` (crib `gpt_judge.OpenAIJudgeClient`). Sibling: `evaluation.MODEL_PRICING`
  (`evaluation.py:298-304`) has no `gpt-5.4-mini` entry → cost reports read n/a.
- `recommend/route.ts:627-628` + `regenerate/route.ts:623-624` return raw `error.message` in 500
  bodies (OpenAI/Mongoose/driver text, can include cluster hostnames) — a NOW-existing info-leak
  channel; every other route returns a fixed string. One-line fix if touched pre-M5; the rewrite
  must not copy it.
- Already in spec §19's trust-boundary register (M5-owned; re-verified accurate 2026-07-02 — listed
  here only so this file is a complete index): `auth/sync` no token check; `account` POST/PATCH
  trusts body `firebaseUid` (PII read/write); `images/[imageId]` unauthenticated IDOR (+ it is the
  only route with NO try/catch — malformed id → unhandled 500); `cv/infer` unauthenticated proxy,
  no size cap.

**UI (only if demoing pre-M5; all verified real):**
- Add-item modal discards ALL input on failed save (`wardrobe/page.tsx:403-425` — `onClose()` runs
  because the page-level `onSave` swallows errors into `setError` and returns). Worst W-track bug.
- Edit flow can never attach/replace a photo (`:300` isEdit + `:401` fileToUpload=null + `:839`
  `{!isEdit && ...}` gate); the edit-upload branch at `:1358-1372` is unreachable.
- `handleLogout` (`dashboard/page.tsx:662-672`) never clears `fitted_dashboard_state` sessionStorage
  → user B in the same tab sees user A's outfits.
- Signup race: `RedirectIfAuthenticated.tsx:21-27` redirects on auth-state flip while
  `/api/auth/sync` is still in flight; a failed sync strands a new user with no Mongo doc.
- `datetime-local` min/max computed via `toISOString()` (UTC) at `dashboard/page.tsx:959-960` —
  blocks same-evening events for US timezones.
- Single-item delete has no confirm; `handleClearWardrobe` (`:1042-1076`) is dead duplicate code.
- Lint: 26 `no-explicit-any` errors in 4 test files + 2 in `wardrobe/page.tsx:1478`; `tsc --noEmit`
  has 24 errors all in `tests/` (duplicate impls across test files). Cleanup-tier.

**Docs (next spec-compaction pass):** the h26 README status blob (line 4) duplicates the build-doc
header ~600 words (single-home violation); `recommend/route.ts:450` cites in the plan are off by one
(actual 449); prereg §D's "~175k items" one-time-pass estimate was pre-exclusion (cache = 83,178) —
disclose in results.md, never edit the frozen prereg; spec §19/§20/§23 carry dated review-history
annotations ("Codex read 2026-06-27" etc.) that the lifecycle rule assigns to commits — strip the
pure provenance, keep the trap-guards.

**Minor register (Low, report-and-move-on — kept ONLY so this session's findings aren't lost; fix
opportunistically, never as dedicated work):**
- UI: `getRecommendations` dep array omits `geoCoords` (`dashboard/page.tsx:726` — late location fix
  silently goes weatherless); `outfitDislikedItems` is index-keyed and never remapped after
  regenerate-replace (`:609/:823/:877`); dead feedback UI behind `{false && ...}` (`:327/:338/:353` —
  `overallNotes` collected, never sent); history GET silently caps at past-month + 50 with no UI
  label; history remove/move failures are console-only; vestigial `localStorage("userId")` (set,
  never read); `imageUrlFromPath` triplicated (dashboard:135/wardrobe:80/history:17) + token-fetch
  boilerplate ~12×, no shared `apiFetch` helper.
- App: wardrobe POST/PATCH have no field length caps (interactions/account do); `account` PATCH
  accepts a ≤3MB base64 photo into `User.metadata` riding every GET (doc-bloat footgun); wardrobe
  GET unpaginated; `cascadeDeleteUserData` keys on `getQuery()._id` (a delete by `{authId}` skips
  the cascade) AND has no API caller (account deletion is unreachable — dormant by design, decide a
  surface at M5/Privacy); regenerate `lockedItemIds`/`changeTarget` unvalidated (self-500s, dies at
  M5); recommend `:598` dereferences `outfit.itemIds.every` unguarded (LLM-shape crash, dies at M5);
  locked item dropped by the 80-item shortlist quota → empty regen results (dies at M5); FIREBASE
  misconfig surfaces as misleading 401s; `GEMINI_API_KEY`/`GEMINI_MODEL` absent from CLAUDE.md's env
  table (route degrades gracefully).
- fitted_core: `_filled_slot_ids` triplicated with a set-vs-tuple return divergence
  (ranker:277/response:225/rescue:554); `evaluation.py` imports 8 private `rescue._*` helpers
  (de-facto API); `BelievabilityRubric` has no consumer; `snapshot_serde._OPAQUE_VALUE_KEYS` comment
  overstates ("every Map/Mixed field" — diagnostics blocks deliberately excluded); `snapshot.py:523`
  hardcodes `intent="rescue_item"` (inline M5 note exists); no public `payload → wire` helper (the
  proven call is `to_wire(dataclasses.asdict(payload))`, pinned only in `test_snapshot.py:221`);
  spec §14 doesn't mention the `overuse_relaxed` rung is score-only/never-terminal (code documents
  it; add a half-sentence at the next §14 edit); TS `candidates[].admittedViaFallbackStage` has no
  Python producer.
- Lint/type debt: 26 `no-explicit-any` in 4 jest files + 2 in `wardrobe/page.tsx:1478` (a ~1,500-line
  component); `tsc --noEmit` = 24 errors all in `tests/` (duplicate impls across files); dead
  `handleClearWardrobe` duplicate (`wardrobe/page.tsx:1042-1076`).

## PART E — next prompts, in order

1. "Implement the PART B code/doc edits of `docs/sessions/2026-07-02-full-audit-handoff.md` (Tasks 1,
   2, 3, 4, 5, 6, and Task 8's 8A/8B/8C code guards), run both pytest suites + ruff, and commit on
   main." (Safe for a low-effort session — those recipes are exact. **Skip Task 7 and Task 8D / the
   "Operator-only guardrails" — they are RUN-phase decisions, handled in prompt 2 / PART C.**)
2. The RUN phase (PART C — Brian-manual, with Claude assisting per step).
3. After emission: "Write `results.md` + the portfolio freeze-story README per PART C's writeup note,
   then start the C5 domain probe."
4. Optionally, the PART F audit below — lower priority than 1-3; natural slot alongside the C6
   writeup (the trim mostly lands at M5 and the spec compaction has a natural slot after H26 emits,
   when its §20/§23 rows change anyway).

---

## PART F — what the 2026-07-02 audit did NOT cover (+ the ready-to-run prompt)

Covered: H26 fidelity, fitted_core fidelity, API security, UI/ops, cross-doc STATUS consistency
(status homes + ~12 cite spot-checks), ambition/merit. **Never audited by any recorded session:**
(1) a ruthless file-by-file trim inventory (the merit lane cleared deletion only at subsystem
level); (2) the spec's INTERNAL §-by-§ self-consistency — Appendix B constants vs inline values vs
`fitted_core/config.py`, §6 field lists vs §15.1 vs `fitted/models/*.ts`, tag-vs-reality — plus
compaction prep (spec at 1,303 of the 1,500-line ceiling); (3) dependency hygiene (npm audit /
unused deps / the two requirements.txt vs the two .venvs / H13 lower-bound pins). Also untouched,
lower value: jest-side mutation-strength assessment; retired-doc body trimming beyond banners.

Ready-to-run prompt for a fresh session (verbatim):

```
Run a ruthless scope-and-trim + internal-spec-consistency + dependency-hygiene audit of Fitted.

READ FIRST: CLAUDE.md, then docs/sessions/2026-07-02-full-audit-handoff.md IN FULL — its
"Verified clean" list is do-not-re-audit ground (note its verification-basis paragraphs), and its
PART D register already holds known findings; do NOT re-report anything in it. This audit covers
what that one deliberately did not.

HARD RULES: report-first — propose deletions, do not delete (any deletion under fitted/ is a
design call per CLAUDE.md; deletion elsewhere still gets Brian's sign-off). Never touch the frozen
H26 artifacts (preregistration.*, fitb_manifest.json, fitb_order.json, type_map.json,
selection.json, embedding manifest). No paid/live API calls, no network installs. Do not run
pytest with OPENAI_API_KEY exported. Hermetic checks only.

LANE 1 — Ruthless scope-and-trim. Build a file-by-file inventory of the repo (skip node_modules,
.venv, meetings/, team/ — the last two are archives, leave them). For every file/dir, classify:
KEEP (load-bearing now) / M5-DELETE (dies at the USE_ML_SHORTLISTER cutover per spec §19/§20 —
name it in the M5 kill-list) / DELETE-NOW (dead weight nothing references: dead code, orphaned
assets, retired-doc bodies beyond their banners, duplicate status prose, unused scripts) /
TRIM (alive but carrying dead sections). Justify each DELETE-NOW with evidence nothing imports/
links/cites it (rg the symbol/filename). Deliverable: a proposed-deletion ledger with per-item
evidence, expected line savings, and risk.

LANE 2 — Spec INTERNAL consistency + compaction prep. Read docs/Fitted_Spec_v2.md whole (1,303
lines; ceiling 1,500). Check it against ITSELF: Appendix B constants vs the values §10/§14/§16
state inline and vs the actual values in ml-system/fitted_core/config.py; §6 data-model field
lists vs §15.1's snapshot contract vs fitted/models/*.ts; §23 hole statuses vs the sections they
cite; [NOW]/[NEXT]/[STAGED] tags vs reality. Then produce a compaction plan: which sections carry
evolution-narrative/dated-review-history to strip (keep trap-guards), what merges, estimated
post-compaction line count. Do not apply the compaction — plan only, conflicts-found list first
(conflicts are bugs; list them for fix-on-sight approval).

LANE 3 — Dependency hygiene (hermetic). fitted/: npm audit (offline ok if registry needed, note
it), depcheck-style unused-dependency reasoning from imports vs package.json, lockfile sanity.
ml-system/: the two requirements.txt vs what the two .venvs actually have (pip list), lower-bound
pins vs the H13 pre-M5 reproducibility hole, any dep only one dead script uses.

FINDING STANDARD: severity + file:line + evidence + concrete action + owner (now / M5 / compaction
session). Verify every claim against source before reporting. End with: the DELETE-NOW ledger,
the M5 kill-list, the spec conflicts list, the compaction plan, and the top 3 highest-value trims.
Write the whole report to docs/sessions/<date>-scope-trim-audit.md and commit it; change nothing
else.
```
