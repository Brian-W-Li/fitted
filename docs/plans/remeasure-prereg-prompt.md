# Track-2 re-measure pre-registration — handoff prompt (next session)

> Authored 2026-07-20 by the merit+live+dynamics audit (`fd5b1448`, session note
> `docs/sessions/2026-07-20-merit-live-dynamics-audit.md`). Paste the block below into a fresh
> session verbatim. Delete this file (or banner it COMPLETED) once the session runs.
> URGENCY NOTE: friend invites are ALREADY SENT — data may start accruing any day. The rule is
> valid as long as it is frozen before anyone LOOKS at friend labels; do this session first.

---

Pre-register the Track-2 catalog→closet re-measure decision rule — the frozen-before-look document
that makes the friend-closet study decidable. This is THE gating item on the runbook §8 pre-recruit
checklist (2026-07-20 merit audit, Fable-decided): the inherited H26 healthy band is structurally
undecidable at the N≈30–60 accepted outfits a 3–5-friend cohort yields, and without a replacement
rule the study's most likely outcome is a third "underpowered/inconclusive". Friends are already
invited, so treat this as urgent: the freeze must land BEFORE any friend's labels are exported or
analyzed (data merely existing in the DB unlooked-at does not break the freeze — say so explicitly
in the doc's disclosure section).

Read first: CLAUDE.md · Spec §20 M6 row (the adopted resolution skeleton — two-boundary directional
rule, accepted-vs-rejected primary, scoreable-cluster certificate) + §23-H26/H28 ·
`docs/plans/m5-c8-half2-runbook.md` §8 (the "ask is data-shaped" block + decidability bar + yield
expectations) · `ml-system/experiments/h26/results.md` §2/§6/§9/§10 (the frozen numbers, the closet
probe's failure modes — 25/39 pairs skipped, effective-N 6, 0 strict FITB — and §9.9's
mechanical-negative weakness) · `fitted/scripts/exportTrack2Core.cjs` (the current bare
`cohortImageUsable >= 30` verdict + the training_examples row shape) ·
`docs/sessions/2026-07-20-merit-live-dynamics-audit.md` (Track A memo). Model the freeze mechanics on
H26's preregistration artifacts (`ml-system/experiments/h26/preregistration.md`/`.json`) — that
discipline is the credential being protected.

Deliverables:

1. **The prereg doc** (suggested home: `ml-system/experiments/track2_transfer/preregistration.md` +
   a machine-readable `.json`, mirroring H26's pattern), frozen by commit, containing:
   - **Primary read: accepted-vs-rejected discrimination** — AUC of the content prior's score at
     separating each friend's accepted vs rejected candidates, within-user, outfit-cluster bootstrap.
     Decidable boundary 0.5. State why this is primary (human-judged negatives fix H26 §9.9; ~doubles
     effective data; it is the deployment-relevant question).
   - **Secondary read: catalog→closet pair-AUC with a two-boundary directional rule** — report which
     of {above-chance: CI_low > 0.50, below-healthy: CI_high < 0.70} is excluded; the inherited
     CI_low≥0.70 pass condition and the 0.12 drop GATE are retired as gates (kept as reported
     points), with the structural-undecidability rationale recorded as the trap-guard.
   - **RE-DERIVE all numbers from scratch** — the audit's Hanley-McNeil half-widths (±0.127/±0.110/
     ±0.090 at N=30/40/60) and yield model (~18–35 cohort) were checked directionally, not re-derived;
     this session owns the arithmetic. Show the derivation in the doc. Decide and freeze: minimum N
     per read, the bootstrap unit (outfit cluster), per-friend design-effect handling, and what gets
     reported (never decided) below minimum N.
   - **Ground-truth + eligibility definitions**: what counts as a scoreable cluster (≥2 items, all
     images resolved, same-category negative availability, per-friend concentration cap), the
     latest-state label rule (must match §23-H61 exactly — the M6 labeler obligation), and the
     stylist-generated-then-rated proxy disclosure (this is a DIFFERENT proxy than H26's co-worn
     Polyvore truth — pre-register it as such).
   - **Freeze mechanics**: what is sha-bound, what "frozen" means operationally, the
     optional-stopping / sequential-look disclosure, and the explicit statement that DB rows
     accruing pre-freeze were never inspected.
2. **Harden the export verdict to match** (`exportTrack2Core.cjs` + `export_track2.mjs`): replace the
   bare ≥30 scalar with the scoreable-cluster certificate the prereg defines (per-friend spread,
   ≥2-item outfits, negative availability). Real behavioral tests (the jest floor grows); round-trip
   against `track2-export-roundtrip.mjs` still passes. Keep the yield readout as the ONE artifact
   (manifest-homed, no drift).
3. **Reconcile every doc the rule touches in the same commit** — Spec §20 M6 row flips from
   "prereg must be written" to "prereg FROZEN at <path>", runbook §8 checklist item 1 checks off,
   CLAUDE.md focus line updates. Zero surviving forward-looking pointers (grep "pre-register").

Method: this is a promise-driven decision session — Fable-review the decision rule before freezing
(the important-call bar; the promise at stake is the honesty/credibility of the whole friend study).
Adversarially self-check: "could this rule fail to produce a decision at pessimistic yield (N≈15)?"
must have a written answer. Suite floors (≥1098 pytest / ≥786 jest) grow, never shrink; tsc/eslint
clean; commit on main as the closing act. NOTE: a parallel session has an in-flight, UNCOMMITTED
`ml-system/experiments/h26/gate_b_extension.py` (gate-B power extension) — do not touch, commit, or
conflict with it; the H26 frozen artifacts stay byte-identical regardless.
