# H26 C4 — RUN-phase operator recipe (2026-06-30)

The C4 code is built + heavy-audited to convergence (see `project_h26_c4_build` memory +
`docs/plans/h26-compatibility-spike-v2.md` §15-C4). `metrics.json` is correctly not yet emitted — it
needs the RUN-phase artifacts below. This note is the exact operator recipe. All commands run from
`ml-system/experiments/h26/` with the spike venv (`.venv/bin/python`).

**Key never reaches the assistant:** the OpenAI judge runs are commands Brian executes in his own shell
where `OPENAI_API_KEY` is set. B1 spend is approved; B3 (closet) deferred by choice.

## Step 1 (B2) — trained head: cache → selection.json  ·  ✅ DONE (sealed + committed)
The embedding cache is built (83,178 scorable ids through frozen FashionSigLIP → `embeddings/`,
gitignored) and `selection.json` is sealed + committed with the populated
`embedding_manifest_fashionsiglip.json` — verified (schema + manifest-hash bind + deterministic
checkpoint sha; winner `grid_0`, `converged:false` at epoch 48/50 is disclosed in the memory/plan:
if gate D later misses, the frozen epoch budget is the first suspect, and bumping it is a
pre-registration decision). Re-run only on a frozen-artifact change (the unlock's
`manifest_hashes` bind will fail loud if one drifts).

## Step 2 — calibration set (§F PANEL — ≥3 diverse labelers): calibration_set.json
```sh
.venv/bin/python make_calibration.py                # regenerates calibration_viewer.html (100 questions,
                                                    #   coherence-filtered + visual-QC-excluded; local artifact)
# send the ONE calibration_viewer.html file to every panelist (>=3 people incl. you — diverse on
#   gender/style familiarity). Each: open it, pick A–D per question, or "Not sure" — NEVER guess —
#   then click "Download my answers".
# collect the downloads RENAMED per person (alice.json / bob.json / me.json) into
#   ml-system/experiments/h26/panel_answers/ — a GITIGNORED dir, so raw per-person label files can
#   never be swept into the public repo by a git add -A (paths resolve against the h26 dir you run from):
.venv/bin/python -c "import make_calibration as m; m.finalize_panel(['panel_answers/alice.json','panel_answers/bob.json','panel_answers/me.json'])"
#   -> calibration_set.json (unique-plurality consensus over confident votes; >=2 confident votes per kept
#      question; survivors floored >=50). It prints the INTER-annotator agreement (the human ceiling) —
#      that number + the panel size fill judge_addendum.md calibration_set.{inter_annotator_agreement,
#      n_annotators} at the freeze (the schema requires real values there).
```
Questions are drawn from valid/train → disjoint-by-construction from the test gate-B/gate-D sets (§F),
5-type-coherence-filtered (`coherence.py` — Polyvore boards include wear-impossible sets humans balk at)
and screened against the committed `calibration_visual_qc.json` source-corrupted-image excludes.
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
.venv/bin/python run_judge.py pilot --k 3           # tune K vs the panel's consensus labels (try a few K); BLIND to test
# then FREEZE judge_addendum.md by EDITING THE COMMITTED SCAFFOLD IN PLACE (don't author a fresh file):
#   (a) flip frozen:false->true; (b) replace EVERY remaining placeholder — the "<...>"/null per-run fields:
#       model_snapshot, k_samples, max_tokens, retry_budget, prompt_sha256,
#       calibration_set.{manifest_sha256, size, n_annotators, inter_annotator_agreement} (from finalize_panel),
#       above_chance_pilot.{image_only_fitb_point, image_only_fitb_ci_low, above_chance} (from your pilot),
#       and commit_hash; (c) leave everything else — the const temperature/arms/*_policy fields, the
#       sdk_token_param/reasoning_effort/image_detail consts, AND the already-real
#       drop_policy/payload_logging_policy/calibration_set.source — as-is. Then COMMIT
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
`model_snapshot` matches the frozen addendum. Cost: a few dollars on your key (Batch −50%; images are
pinned `detail:"low"` — ~162 tok per 300×300 Polyvore image under gpt-5.x accounting; the ~85 tok
figure was gpt-4o-era).

## After emit
`metrics.json` first materializes (test-set trained-head + judge gate-B fields). Then **C5** (domain
probe merges closet/transfer fields) and **C6** (the gate-application half prints the A∧B∧D verdict + the
mandatory §4 popularity-matched re-run). Nothing is committed by the assistant — Brian drives git.
