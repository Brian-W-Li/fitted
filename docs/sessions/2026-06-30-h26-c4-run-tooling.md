# H26 C4 — RUN-phase operator recipe (2026-06-30)

The C4 code is built + heavy-audited to convergence (see `project_h26_c4_build` memory +
`docs/plans/h26-compatibility-spike-v2.md` §15-C4). `metrics.json` is correctly not yet emitted — it
needs the RUN-phase artifacts below. This note is the exact operator recipe. All commands run from
`ml-system/experiments/h26/` with the spike venv (`.venv/bin/python`).

**Key never reaches the assistant:** the OpenAI judge runs are commands Brian executes in his own shell
where `OPENAI_API_KEY` is set. B1 spend is approved; B3 (closet) deferred by choice.

## Step 1 (B2) — trained head: cache → selection.json  ·  IN PROGRESS on Brian's terminal
```sh
.venv/bin/python build_cache_and_select.py          # ~hours, single-thread CPU (determinism contract)
```
Embeds 83,178 scorable items through frozen FashionSigLIP → `embeddings/` (gitignored) + populates the
cache-content fields of `embedding_manifest_fashionsiglip.json`, then runs the deterministic grid →
sealed `selection.json`. Smoke pre-validated: gated parquet reachable (user Brianlol30), dim 768, revision
== the C2-frozen `c56244cc` (no drift). **Split option** (avoid re-embed on a training hiccup):
`python -c "import build_cache_and_select as b; b.build_cache_only()"` then `python train_head.py`.
**On finish:** commit `selection.json` + the populated `embedding_manifest_fashionsiglip.json`; the
assistant then verifies (schema + manifest-hash bind + deterministic checkpoint sha).

## Step 2 — calibration set (your taste): calibration_set.json
```sh
.venv/bin/python make_calibration.py                # writes calibration_viewer.html (run AFTER Step 1 frees the parquet)
# open calibration_viewer.html, pick A–D per question (~60), click "Download my answers"
# MOVE the downloaded calibration_answers.json into ml-system/experiments/h26/ (it's gitignored there;
#   finalize() resolves the bare filename against this dir, not your browser's Downloads folder).
.venv/bin/python -c "import make_calibration as m; m.finalize('calibration_answers.json')"   # -> calibration_set.json
# INTRA-ANNOTATOR STABILITY (§8/§F — required): re-open calibration_viewer.html, re-answer a subset with a
#   fresh eye, download as calibration_answers_recheck.json (move it here too), then compute the agreement:
.venv/bin/python -c "import make_calibration as m; m.restability('calibration_answers.json', 'calibration_answers_recheck.json')"
#   -> write the printed rate into judge_addendum.md calibration_set.intra_annotator_agreement (a low value
#      flags a noisy labeler BEFORE it tunes the judge; the addendum schema REQUIRES a real number there).
```
Questions are drawn from valid/train → disjoint-by-construction from the test gate-B/gate-D sets (§F).
Commit `calibration_set.json` (the unlock binds it by sha + asserts id-disjointness).

## Step 3 (B3) — closet transfer probe: closet_manifest.json  ·  deferred by choice — BUT gates `emit`
> **Sequencing note:** B3 is deferred *by choice*, but `closet_manifest.json` is one of the **four unlock
> files** `emit` requires (it freezes before the A/B/D metrics unlock even though its transfer *scoring* is
> C5), so **Step 4 stops at `gate-b` while B3 is deferred** — `run_judge.py emit` fails loud
> (`closet_manifest.json is absent … kickoff B3`) and no `metrics.json` is produced until this step is done.
> The pilot + gate-b runs (→ `judge_runs.ndjson`) can proceed now; the headline `metrics.json` waits on B3.
Photograph ~15–25 real worn outfits (real context, NOT flat-lays; faces/PII blurred) under `closet/`
(gitignored). Copy `closet_input.template.json` → `closet_input.json`, list each outfit's garments with
`clothing_type` + `fine_label_human` + `photo`. Find the Polyvore `category_id` with
`python -c "import assemble_closet as a; a.suggest('shoes','boot')"`. Then:
```sh
.venv/bin/python assemble_closet.py                 # -> closet_manifest.json (schema + referential validated)
```
Commit only `closet_manifest.json` (photos stay gitignored).

## Step 4 — the live judge (your key, your terminal): pilot → freeze → gate-b → emit
```sh
export OPENAI_API_KEY=...                            # your key, your shell
.venv/bin/python run_judge.py pilot --k 3           # tune K vs your calibration labels (try a few K); BLIND to test
# then FREEZE judge_addendum.md by EDITING THE COMMITTED SCAFFOLD IN PLACE (don't author a fresh file):
#   (a) flip frozen:false->true; (b) replace EVERY remaining placeholder — the "<...>"/null per-run fields:
#       model_snapshot, k_samples, max_tokens, retry_budget, prompt_sha256,
#       calibration_set.manifest_sha256, calibration_set.intra_annotator_agreement,
#       above_chance_pilot.{image_only_fitb_point, image_only_fitb_ci_low, above_chance} (from your pilot),
#       and commit_hash; (c) leave everything else — the const temperature/arms/*_policy fields AND the
#       already-real drop_policy/payload_logging_policy/calibration_set.{source,size} — as-is. Then COMMIT
#   it BEFORE the gate-b run. (tests/test_freeze.py::test_scaffold_freezes_to_a_schema_valid_envelope
#   pins that filling exactly these per-run fields yields a schema-valid frozen envelope — the schema
#   rejects any leftover "FILL"/"<...>" placeholder or null, so a missed field fails loud at gate-b.)
#   This is now MECHANICAL, not honor-system: `gate-b` refuses unless judge_addendum.md is schema-valid
#   frozen:true AND committed-clean, and it reads the ENTIRE envelope (snapshot/K/max_tokens/retry_budget)
#   FROM the frozen addendum — there are no --snapshot/--max-tokens CLI overrides on gate-b, so the gate-B
#   run cannot silently diverge from what emit binds (§8 dated-snapshot rule).
.venv/bin/python run_judge.py gate-b --n 100        # above-chance/position-flip pilot prefix -> judge_runs.ndjson
.venv/bin/python run_judge.py gate-b --n 500        # extend if the half-width needs it (<= cap 500)
.venv/bin/python run_judge.py emit --n 500          # four-file unlock -> metrics.json (needs all four committed)
```
`gate-b` also drift-checks the prefix against the frozen `fitb_order.json` BEFORE spending a token (fail
loud on any constructor/corpus/seed drift). `emit` refuses unless `selection.json` binds + all four unlock
files (prereg.md/.json + judge_addendum.md frozen + closet_manifest.json) are committed + valid, the arm ==
frozen `image_only`, the calibration set is disjoint from the gated sets, and every `judge_runs.ndjson` row's
`model_snapshot` matches the frozen addendum. Cost: a few dollars on your key (Batch −50%; confirm
gpt-5.4-mini's per-image token accounting at run time — the ~85 tok figure is gpt-4o-era).

## After emit
`metrics.json` first materializes (test-set trained-head + judge gate-B fields). Then **C5** (domain
probe merges closet/transfer fields) and **C6** (the gate-application half prints the A∧B∧D verdict + the
mandatory §4 popularity-matched re-run). Nothing is committed by the assistant — Brian drives git.
