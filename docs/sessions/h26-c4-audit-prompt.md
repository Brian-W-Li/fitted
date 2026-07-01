# H26 C4 — FULL audit kickoff prompt (core + RUN tooling)

> Paste the block below into a fresh session (it contains the `ultracode` opt-in).
> Authoritative spec: `docs/plans/h26-compatibility-spike-v2.md`. This audits the ENTIRE C4 surface —
> the judge/emission core AND the RUN-phase operator tooling — with the tooling getting the heavy loop
> it never had. It needs NOTHING live (no OpenAI key, no built cache); it is static + hermetic.

```
Run a FULL, exhaustive ultracode audit of ALL of H26 checkpoint C4 — the LLM-judge/emission CORE and the
RUN-phase operator TOOLING — for the Fitted project, with ultracode. This is a one-way-door checkpoint
(the judge freeze + the metrics.json unlock) plus the tooling that egresses a real person's closet photos
to a third-party API, so audit deep and loop hard. Nothing here is committed yet (HEAD = the C3 confidence
audit b6703aa7); the entire C4 diff is the working tree — the audit defines what C4 adds on top of the
audited C3.

═══════════════════════════════════════════════════════════════════════
READ FIRST (scope your context; verify every line-cite against the real file before acting — cites drift)
═══════════════════════════════════════════════════════════════════════
- CLAUDE.md — conventions. Internalize: the build-and-audit heavy loop, verify-before-acting (read the
  cited source yourself before trusting any finding), the doc single-home rule ("conflicts are bugs"),
  "past goes to commits / future stays in docs", floors-grow-never-pin, the Fable-review-or-substitute
  rule, the focused-deep-read catch-net.
- docs/plans/h26-compatibility-spike-v2.md — THE spec. Read in full, especially §1 (BLINDNESS), §8 (judge
  protocol), §10 (domain-gap / closet probe), §11 (statistics), §12 (gates + the four-file unlock), §14
  (PRIVACY / consent — closet photos), §15 (build ladder + artifact-dataflow + the §15-C4 mechanical
  enforcements), and preregistration.md §F (calibration-set spec) / §K (unlock/build-order contract).
- docs/Fitted_Spec_v2.md §20 (sequencing) + §23-H26/H28.
- docs/sessions/2026-06-30-h26-c4-run-tooling.md — the RUN operator recipe (the exact commands Brian
  runs). Every command here MUST actually work against the code — a broken command is a finding.
- Memory: project_h26_c4_build (the C4 build + the prior 2-round heavy audit + dual-read + the RUN tooling),
  project_h26_c3_build, reference_openai_gpt54mini (the judge model), reference_vasileva_polyvore_anchors,
  feedback_commit_on_main, feedback_verify_before_answering, feedback_audit_ambition_merit,
  feedback_self_consistency_tests_floors, feedback_focused_deep_read_catchnet.
- Confirm the real starting state: on `main`, C1–C3 committed, ALL C4 uncommitted (working tree). Run the
  h26 suite from ml-system/experiments/h26/ with its venv (`.venv/bin/python -m pytest`) BEFORE changing
  anything — floor is 208 passed + 2 skipped (the deferred selection.json guard + the skip-by-default live
  judge smoke). Also run `ruff check .`. Do NOT run the OpenAI API or the multi-hour cache build (below).

═══════════════════════════════════════════════════════════════════════
EFFORT ALLOCATION — the CORE was already hardened; the TOOLING was NOT
═══════════════════════════════════════════════════════════════════════
- CORE (gpt_judge.py, evaluate.py emission half, judge_addendum.schema.json + the scaffold judge_addendum.md,
  the four-file unlock, tests/test_gpt_judge.py, tests/test_evaluate_emission.py, tests/test_freeze.py):
  got TWO heavy audit rounds + an independent dual-read; 6 findings were fixed. Give it a REGRESSION
  re-audit — re-verify those 6 fixes still hold (ledger dedup/completeness, gate-B arm enforcement, the
  two-stage inner-resample test pin, the compute_gate_b convention pin, the mechanical calibration↔gated
  disjointness, the removed require_committed backdoor + the image-byte payload redaction) — and hunt for
  anything the prior rounds missed.
- RUN TOOLING (live_content.py, make_calibration.py, run_judge.py, assemble_closet.py,
  build_cache_and_select.py, closet_input.template.json, tests/test_run_tooling.py): got only the LIGHT
  loop (build + pure-logic tests, live I/O mocked/unexercised). Give it a FROM-SCRATCH heavy audit — this
  is where the new risk lives (real closet photos + faces egressed to OpenAI, an owner-facing HTML viewer,
  a live judge CLI, the cache item-universe). Pair the fan-out with a FOCUSED line-by-line full deep-read
  of EACH tooling module yourself — the deep read is the catch-net for what the light loop dropped.

═══════════════════════════════════════════════════════════════════════
TWO CO-DOMINANT INVARIANTS
═══════════════════════════════════════════════════════════════════════
1. BLINDNESS (§1) — unchanged, now spanning the RUN flow: no human-visible held-out TEST-set trained-head
   or judge number may exist before judge_addendum.md is committed-frozen; the judge envelope is tuned
   SOLELY on the human calibration set, disjoint from the gate-B AND gate-D FITB sets, BEFORE any gate-B
   comparison; the ONLY post-freeze freedom is the deterministic prefix length N. Trace this through
   make_calibration (the draw must be disjoint-by-construction) and run_judge (pilot → freeze → gate-b →
   emit — the order must be enforceable; the pilot must not leak a trained-head number or let a model
   number influence the freeze). Any path that materializes a test metric before the four-file unlock, or
   lets a gated number influence the judge freeze, is a BLOCKER.
2. PRIVACY / EGRESS (§14) — PROMOTED to co-dominant because the tooling now touches a real person's data.
   The committed judge_runs.ndjson must stay scalar-only (no free-text rationale / photo-derived caption /
   person-describing text); raw payloads (incl. base64 images) must route ONLY to gitignored raw_payloads/
   with image bytes redacted to hashes; the closet consent gate (§14: third_party_api_processing +
   providers_photos_may_reach) must be the hard precondition for ANY closet-photo egress; closet photos +
   the owner-facing HTML viewer + closet_input stay gitignored; closet photo paths can't traverse; NO
   closet/personal image can reach make_calibration (its images are public catalog only). A path that
   could leak a closet photo or person-describing text into the public repo, or egress a photo without
   consent, is a BLOCKER.

═══════════════════════════════════════════════════════════════════════
AUDIT LANES (fan out in parallel; each verifies against the REAL source)
═══════════════════════════════════════════════════════════════════════
1. BLINDNESS (co-dominant) — the full chain incl. the RUN tooling (above). Prove make_calibration's draw
   is disjoint from the gated sets; prove run_judge's pilot→freeze→gate-b→emit order can't be subverted;
   prove emit refuses pre-freeze / pre-commit / on a calibration↔gated overlap; trace every write/print
   for a pre-unlock number.
2. PRIVACY / EGRESS / UNTRUSTED-INPUT (co-dominant) — the scalar-only ledger guard, the payload image
   redaction (does it actually fire on the OpenAI message shape?), the §14 consent code-gate posture, the
   .gitignore coverage of every personal artifact, path traversal, prompt-injection via an item
   title/attribute, and that make_calibration never touches closet images. The judge PARSES untrusted LLM
   free text AND egresses images — re-check parse robustness can't be tricked into a confident wrong choice.
3. CORRECTNESS / EDGE-CASES — ALL modules, EXTRA depth on the tooling: the calibration draw (dedup, n-cap,
   valid/train sourcing), the HTML viewer answer collection + finalize letter→index mapping + partial
   answers, the closet mapping (label→category, the null-category coarsening rule, photo hashing, duplicate
   items, outfit membership, consent/audit defaults), build_cache_and_select's item-id UNIVERSE (does it
   embed EVERY item the heads + eval + FITB + judge will ever score, incl. §4 negatives/distractors drawn
   from by_cat — is the cross-split union complete and correct?), run_judge's CLI (arg handling, ledger
   regeneration/idempotency, the K read from the frozen addendum, pilot vs gate-b vs emit wiring), and a
   regression pass on the collapse / two-stage / group_samples.
4. SPEC↔CODE FIDELITY — vs §8/§10/§11/§12/§14/§15 + §F/§K + the frozen preregistration.json/.md +
   metrics.schema.json + fitb_manifest.json. The tooling must faithfully implement §F (calibration: actual-
   human labels, disjoint, judge-only, ≥50), §10/§14 (closet: MECHANICAL same-fine-category negatives NOT
   hand-curated, taxonomy-match to the Polyvore tree, consent, face/PII redaction, label audit), §8 (arms,
   dated snapshot, temp 0, both orders, K-vote, retry/drop). Flag any drift or frozen-artifact edit.
5. TEST-QUALITY / MUTATION — the tooling's pure-logic tests: would an obvious bug go red? Mutation-test the
   load-bearing tooling logic (calibration disjointness, closet category/type validation, the cache item
   universe, finalize's mapping). Is the live-path reasoning-only coverage adequate, or should a hermetic
   test exist (e.g. a mocked-client run_judge pilot test, a make_calibration viewer-export smoke)? Name the
   specific missing mutation guards.
6. OPERATIONAL DRY-RUN / UX (a first-class lane) — actually run the hermetic suite + ruff + dry-import every
   module, and trace EACH command in docs/sessions/2026-06-30-h26-c4-run-tooling.md end-to-end against the
   code: would it work, or fail with a confusing error / wrong path / missing function / bad arg? Does
   run_judge emit find the ledger; does finalize find the questions cache; does the viewer download format
   match what finalize parses; is the recipe accurate + complete for a solo operator? A command that would
   fail or mislead Brian is a finding.
7. FORWARD-COMPAT — C5 (the closet_manifest this tooling produces is domain_probe's input; the C5 consent
   EGRESS code-gate; the C5 label-integrity clothing_type↔type_map cross-check), C6 (gate-application +
   the mandatory §4 popularity-matched re-run + the fitb_judge_gateB "question-sampling CI only" reporting
   note), M5/M6 seams. Does the tooling set up C5 without forcing rework or violating the staged
   metrics.json write-lifecycle?
8. DATA-INTEGRITY / REPRODUCIBILITY / DETERMINISM — the cache item universe completeness + fail-loud on a
   miss; the deterministic seeds (calibration seed distinct from the headline seed; cache/selection
   bit-determinism); the ledger idempotency + the K-completeness check; no silent truncation/sampling.
9. AMBITION-MERIT (separate from fidelity) — is the RUN tooling well-aimed: does it make the RUN phase
   genuinely runnable, honest, and faithful to the systems-decision thesis, without footguns for a solo
   operator? Is anything over-engineered or a trap? Run an adversarial multi-lens critique (product,
   ML-feasibility, operability, portfolio-value) with a Fable synthesis seat — if Fable is unavailable,
   substitute a deep dual-read (a first-principles pass + an independent second-pass agent that converge)
   and note the basis.
10. REGRESSION-OF-THE-FIXES — re-audit every fix THIS audit lands (fixes regress), AND re-verify the prior
    2-round heavy audit's 6 fixes + the dual-read's calibration-disjointness fix still hold.

Pair the fan-out with a FOCUSED line-by-line deep-read (yourself) of EACH tooling module —
live_content.py, make_calibration.py, run_judge.py, assemble_closet.py, build_cache_and_select.py — plus a
re-read of the evaluate.py unlock path + the gpt_judge.py collapse/two-stage.

═══════════════════════════════════════════════════════════════════════
HOW — ultracode workflows, LOOP HARDER than usual (Brian asked for extra rigor)
═══════════════════════════════════════════════════════════════════════
- Author ultracode WORKFLOWS: fan out the lanes in parallel → adversarially VERIFY each finding against the
  cited source (default to not-real if you can't reproduce the exact failure path) → keep only confirmed
  LOAD-BEARING findings, most-severe first.
- LOOP UNTIL TWO CONSECUTIVE ROUNDS return no load-bearing finding (minimum 3 rounds total — stricter than
  the usual one-clean-round bar, per Brian's request for extra depth). Each round covers similar-but-
  different ground and RE-AUDITS the prior round's fixes.
- "Load-bearing" = would mislead the operator, mis-store/corrupt/LEAK data, break blindness, egress a photo
  without consent, break a downstream seam, or ship broken / make a documented command fail. Phrasing/style
  nits never block convergence — report-and-move-on.
- VERIFY BEFORE ACTING: read the cited source yourself before every fix. Severity-grade; fix blockers +
  important; flag genuinely out-of-scope items as chips, not scope creep. When a fix diverges from the spec
  / a frozen artifact, reconcile the doc in the same pass (conflicts are bugs). DO NOT edit the frozen
  hash-bound artifacts (preregistration.json/.md, fitb_manifest.json, type_map.json,
  embedding_manifest_fashionsiglip.json, fitb_order.json) — editing them breaks the freeze.
- Floors grow: nothing regresses below h26 208(+2 skip) / core ≥715; new tests raise the floor.

═══════════════════════════════════════════════════════════════════════
STOP AND ASK — but note the audit needs NOTHING from Brian
═══════════════════════════════════════════════════════════════════════
The audit is fully static + hermetic + adversarial reasoning. DO NOT run the OpenAI API (no key present; it
costs money) and DO NOT run the multi-hour cache build. selection.json / the embedding cache /
calibration_set.json / closet_manifest.json may be ABSENT (deferred to the RUN phase) — that is EXPECTED;
audit the tooling for what it WILL do on real data, using the hermetic tests + source reasoning. Only stop
to ask on a genuine one-way-door contract ambiguity.

═══════════════════════════════════════════════════════════════════════
DONE MEANS
═══════════════════════════════════════════════════════════════════════
- A written VERDICT: a severity-graded findings ledger (most-severe first; empty if truly none), each
  finding verified against source.
- All load-bearing findings FIXED + re-verified to convergence (two consecutive clean rounds); the hermetic
  suite green (floor grew, never regressed); ruff clean.
- Docs reconciled in the same pass (build-doc §15-C4, README, spec §20/§23, the RUN session note) — no
  conflict left standing.
- A memory update (project_h26_c4_audit) + a dated session note recording the audit (rounds, lanes,
  findings, what was fixed, what held).
- Report HONESTLY — cost actually spent (should be ~$0; no live calls), any lane that found nothing, and
  exactly what (if anything) is needed next. COMMIT ONLY WHEN BRIAN ASKS (he drives his own git); do not
  branch (commit on main per feedback_commit_on_main).
```
