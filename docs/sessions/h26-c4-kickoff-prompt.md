# H26 C4 (LLM-as-judge) — kickoff prompt

> Paste the block below into a fresh session (it contains the `ultracode` opt-in).
> Authoritative spec: `docs/plans/h26-compatibility-spike-v2.md` §8/§12/§15-C4.
> The session builds + audits everything that needs nothing from Brian, then HALTS
> at the live-API / `selection.json` / closet-labels boundary (gates B1–B3).

```
Execute H26 checkpoint C4 (the LLM-as-judge) for the Fitted project, with ultracode.

═══════════════════════════════════════════════════════════════════════
READ FIRST (scope your context; do not skip — line-cites in plans drift,
so verify every cite against the real file before editing)
═══════════════════════════════════════════════════════════════════════
- CLAUDE.md — conventions. Internalize: the build-and-audit loop, the
  doc-lifecycle / single-home rule ("conflicts are bugs"), "past goes to
  commits / future stays in docs", floors-grow-never-pin, verify-before-acting.
- docs/plans/h26-compatibility-spike-v2.md — THE active plan + authoritative
  C4 spec. Read in full: §0 (frame/thesis), §1 (BLINDNESS — the dominant
  invariant), §3 (metrics), §8 (LLM-judge protocol = the C4 build spec),
  §9 (cost/determinism/availability — the headline artifact), §11 (statistics),
  §12 (gates + the four-file unlock), §14 (privacy/consent), §15 (C4 ladder
  entry + the artifact-dataflow note).
- docs/Fitted_Spec_v2.md §20 (sequencing) + §23-H26/H28 (the thesis + the
  pairwise/edge seam C4 informs).
- Memory: project_h26_c3_build (current C3 state + the registered MANDATORY-at-C6
  popularity re-run), project_h26_c2_audit, reference_openai_gpt54mini (the judge
  model — VERIFY snapshot + vision-token cost + API params at use time; note the
  temp-1-only restriction is a busted myth), reference_vasileva_polyvore_anchors
  (the honest bands), feedback_commit_on_main (COMMIT ON MAIN — do NOT branch),
  feedback_verify_before_answering, feedback_audit_ambition_merit,
  feedback_self_consistency_tests_floors, feedback_focused_deep_read_catchnet.
- Confirm the real starting state on disk: on `main`, C3 committed, h26 suite
  floor 130 passed + 1 skipped (the skip = the deferred selection.json guard),
  core ≥715. Run the h26 suite from ml-system/experiments/h26/ using its venv
  (.venv/bin/python -m pytest) before you change anything.

═══════════════════════════════════════════════════════════════════════
THE ONE INVARIANT THAT DOMINATES C4: BLINDNESS (§1)
═══════════════════════════════════════════════════════════════════════
No human-visible held-out TEST-set trained-head/judge number may exist before
judge_addendum.md is committed. The judge prompt, calibration, K-sample rule,
and determinism envelope are tuned SOLELY on a calibration set that is
(a) disjoint from the C2-frozen gate-B 500, and (b) blind to every trained-head
metric. FREEZE ORDER IS LOAD-BEARING: judge_addendum.md is committed from the
judge-ONLY calibration pilot (position-flip + verdict-agreement → K + envelope),
BEFORE any gate-B `fitb_trained − fitb_judge` comparison is computed. After the
freeze the ONLY post-hoc freedom is the deterministic prefix length N over the
already-frozen fitb_order.json — never a re-selection of questions, never a
re-tune of the judge. Any code path that materializes a test metric before the
four-file unlock, or that lets a model number influence the judge freeze, is a
BLOCKER, not a nit.

═══════════════════════════════════════════════════════════════════════
WHAT TO BUILD (build-doc §8 + §15-C4; the build doc is authoritative — follow
it, don't reinvent. Everything new lives under ml-system/experiments/h26/)
═══════════════════════════════════════════════════════════════════════
- gpt_judge.py — gpt-5.4-mini dated snapshot; NATIVE FITB@4, both orders,
  consistent-only; image-only / image+title / text-attribute arms; temp 0 +
  K-sample-and-vote; max_tokens, retry/drop, payload-logging policy. The
  per-edge continuous-score Monte-Carlo AUC arm is CUT (§8) — do NOT build it;
  gate-B is FITB-parity only. Image-logprob escape-hatch ONLY if the live
  re-check finds logprobs available (§8 found them unavailable at design time).
- judge_runs.ndjson ledger — SCALAR-ONLY committed rows (question_id, order,
  choice index, consistency/retry/drop flags, snapshot, system_fingerprint,
  payload-log hash). NO free-text rationale, NO photo-derived captions in the
  committed file; raw payloads stay gitignored (§8/§14).
- judge_addendum.md — the C4 freeze (prompt + prompt hash, dated snapshot,
  calibration manifest + hash, temp 0 + K rule, both-order policy, max_tokens,
  retry/drop, payload-logging policy, commit hash).
- evaluate.py EMISSION half — the four-file unlock validator (preregistration.md
  + preregistration.json + judge_addendum.md + schema-valid closet_manifest.json
  incl. the closet referential checks), record their git blob hashes / sha256s
  into metrics.json, and FIRST-emit metrics.json (test-set trained-head + judge
  fields; closet/transfer fields stage to C5). Bind _meta.selection from
  selection.json.
- Tests: hermetic, MOCK the OpenAI API in the unit suite (never hit the live API
  in pytest). One real-API smoke test, skipped-by-default. Cover: blindness
  (no metric emitted pre-unlock; the four-file gate refuses on a missing/invalid
  file; freeze-order), FITB both-order consistency collapse, the K-sample vote,
  parse-robustness on malformed/adversarial judge output, ndjson scalar-only
  invariant. Mutation-test the load-bearing logic (would an obvious bug go red?).

DO NOT TOUCH the frozen/hash-bound artifacts: preregistration.json/.md,
fitb_manifest.json, type_map.json, embedding_manifest_fashionsiglip.json,
fitb_order.json. Editing them breaks the freeze + the selection.json binding.

═══════════════════════════════════════════════════════════════════════
HOW TO BUILD IT (our standing build-and-audit discipline + ultracode)
═══════════════════════════════════════════════════════════════════════
- LIGHT loop per sub-step: read real files first → implement in team style →
  run h26 pytest + ruff on touched files → one fresh-context review agent →
  fix only source-verified findings → close.
- C4 is a ONE-WAY-DOOR sub-milestone (the judge freeze + the metrics.json
  unlock). At the C4 boundary run the HEAVY loop as ultracode WORKFLOWS — fan
  out parallel lanes and LOOP UNTIL A ROUND RETURNS NO LOAD-BEARING FINDING;
  later rounds must re-audit earlier rounds' fixes (fixes regress). Lanes:
    1. BLINDNESS (the dominant lane) — trace every write/print + the freeze
       order; prove no test number exists pre-unlock and the judge is blind.
    2. Correctness / edge-cases.
    3. Spec↔code fidelity vs build-doc §8/§12/§15 + the frozen preregistration.
    4. Test-quality / mutation.
    5. Security / untrusted-input — the judge PARSES LLM free-text AND egresses
       images to OpenAI: prompt-injection, parse-robustness, payload/PII/egress
       (public Polyvore catalog images here — no closet photos until C5 — but
       confirm the ledger can't leak person-describing text).
    6. Forward-compat — C5 closet merge hook, C6 gate-application half + the
       now-MANDATORY §4 popularity-matched sensitivity re-run, M5/M6 seam.
    7. Ambition-merit (separate from fidelity) — is the "tiny model vs per-edge
       LLM call" SYSTEMS thesis still the right aim, and is C4 faithfully
       building toward it? Run adversarial multi-lens + a Fable synthesis seat.
    8. Regression-of-the-fixes (once fixes exist).
  Pair the fan-out with a FOCUSED full deep-read of gpt_judge.py + the
  evaluate.py unlock path yourself — the deep read catches what the fan-out drops.
- Get a Fable review (Agent, model "fable") on the judge-protocol freeze — it's
  a one-way door; reason from the promise (determinism + cost + blindness). If
  Fable is unavailable, substitute a deep dual-read and note the basis.
- Keep canonical truth conflict-free in the same pass: when C4 lands, reconcile
  the build-doc header build-progress marker + experiments/h26/README.md status
  + spec §20/§23 + the project_h26_c3_build memory ("next C4" → "C4 done / next
  C5"). Conflicts are bugs.
- Floors grow: nothing regresses below core ≥715 / h26 130(+1 skip); new tests
  raise the floor.
- COMMIT ON MAIN (per feedback_commit_on_main) — no feature branch. Commit only
  when I (Brian) ask; I drive my own git.

═══════════════════════════════════════════════════════════════════════
STOP AND ASK ME — do not work around, do not fake, do not proceed past these
═══════════════════════════════════════════════════════════════════════
You CAN and SHOULD build + fully unit-test ALL C4 code on mocks/stubs first —
that needs none of the below. Then, at the live-run boundary, HALT and ask me
for whichever of these is outstanding (surface them as early as you can see them):

  B1. OpenAI API key + SPEND APPROVAL. The live smoke test and the judge pilot
      (~100 → ~500 Q, Batch API 50% off) cost real money on my key. Before ANY
      live API call: confirm OPENAI_API_KEY is present AND get my explicit go,
      with a rough cost estimate from the §8/§9 table.
  B2. selection.json is DEFERRED / absent. metrics.json emission binds it, and it
      doesn't exist until the embedding cache is built + train_head.py runs (my
      gated HF creds + a multi-hour pass). If you reach the real metrics.json
      unlock and selection.json is absent → STOP, tell me, and offer to prep +
      verify the exact cache-build + training commands for me to run.
  B3. closet_manifest.json not frozen. The four-file unlock requires a
      schema-valid closet_manifest.json = MY labeled worn outfits (only the
      template ships). If it's absent at unlock time → STOP and ask me to label
      my closet (I need to be at my wardrobe).
  Plus: any genuine ambiguity in the frozen contract → ask, don't guess.

═══════════════════════════════════════════════════════════════════════
DONE MEANS
═══════════════════════════════════════════════════════════════════════
- CODE phase (no deps on me): gpt_judge.py + evaluate.py emission half +
  judge_addendum.md scaffold + the ndjson ledger + a full hermetic (mocked) test
  suite, heavy-audited to convergence, docs reconciled, committed to main.
  metrics.json is NOT emitted yet (correctly blocked on B1–B3).
- RUN phase (only after I clear B1–B3): judge calibration pilot → freeze
  judge_addendum.md (blind, BEFORE any gate-B comparison) → the real metrics.json
  four-file unlock + the gate-B FITB parity number.
Report the verdict honestly — including cost actually spent and any lane that
found nothing — and tell me exactly what (if anything) you need from me next.
```
