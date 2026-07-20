# Post-deploy merit + live-truth audit — handoff prompt (next session)

> Handoff prompt authored 2026-07-20, complementing the same-day alignment-drift audit
> (commit `217a6ee3`, converged: docs/code/tests mutually consistent). Paste the block below
> into a fresh session verbatim. Delete this file (or banner it COMPLETED) once the session runs.

---

ultracode: Post-deployment merit + live-truth + dynamics audit — everything the 2026-07-20 alignment-drift audit (commit `217a6ee3`) deliberately did NOT cover. That audit converged: docs, code, and tests are mutually consistent (2 important + 4 nits, all fixed same-day; suites 784 jest / 1097 pytest / 305+1 h26 — the h26 suite needs its OWN venv, `experiments/h26/.venv`, not `ml-system/.venv`). Do NOT re-audit doc↔code↔test consistency. This session asks the three complementary questions a fidelity audit structurally cannot: are we building the RIGHT thing (Track A), is the LIVE system actually what the docs claim (Track B), and does the system hold under dynamics a static read can't see — races, load, abuse (Track C).

Read first: CLAUDE.md + docs/Fitted_Spec_v2.md (whole, incl. §20 + §23) + docs/plans/m5-c8-half2-runbook.md §8. Additional grounding for Track A ONLY: docs/Fitted_Spec_v2_recovered_appendix.md (the ambition source — normally historical-only, explicitly IN scope for merit) + ml-system/experiments/h26/results.md (esp. §9/§10) + the real committed state. Prior merit review: 2026-07-05, Fable verdict GO — but that was PRE-deployment; real closets, a live service, and the H26 NO-GO letter have all landed since. Exclusions unchanged: meetings/, team/, node_modules, .venv, retired docs (except the recovered appendix as scoped above).

## Track A — ambition-merit (are we aimed right; adversarial multi-lens, NOT fidelity)

Four lenses, each an independent agent producing the strongest steelman FOR and the strongest case AGAINST, grounded in spec/appendix/code/H26-results evidence — not vibes, not manufactured doom, not flattery:

1. **Product/promise:** is the lens-first style graph / green-shirt promise still the right north star now that the app has touched real deployment? Does the shipped daily/rescue surface actually serve that promise, or has it quietly become a generic outfit generator with the graph ambition deferred into vapor? What would a friend using it for a week say it IS?
2. **ML-feasibility:** given H26's NO-GO-by-the-frozen-letter (a power miss — CI wholly above +δ — not an accuracy miss), is the M6 entry-condition design (extend gate-B power over the frozen order + friend-closet re-measure) still the highest-information next experiment? Do the power math for the re-measure: are 3–5 closets of real feedback enough for a decidable catalog→closet transfer verdict, or are we building toward a SECOND underpowered non-answer? Check `export_track2` decidability thresholds against realistic friend engagement, numerically.
3. **Architecture/effort-allocation:** post-M5, where is effort disproportionate to promise? Interrogate honestly (verdict may be "correctly sized"): the cross-runtime contract-pin regime's marginal cost per change; a stateless Fly render service + rotation machinery for ~5 users; the unbuilt W-track CV (manual entry is the live data faucet — is ingestion friction, not model quality, the actual bottleneck to everything downstream?).
4. **Portfolio-value:** Brian's stated goal is portfolio + technical depth, with the writeup (roadmap step 7) currently deprioritized — is that deprioritization right? What does this repo demonstrate to a systems-engineering audience TODAY, what is the single missing artifact, and does the current roadmap actually produce it?

Every lens must answer: (a) **merit** — is the ambition itself still good? (b) **sequencing** — is Track2-recruit → (gate-B power ∥ embedding pipeline) → M6 still the right order? (c) the **ONE change** it would make. Then a **Fable synthesis seat**: reconcile into KEEP / CHANGE / KILL / ADD recommendations reasoned from user-facing promises, name the single highest-leverage change, and flag anywhere ≥2 lenses converged on the same doubt independently — that convergence is signal. Decision bar for Track A: would it change what Brian builds in the next month?

## Track B — live truth (close the 2026-07-20 out-of-band list; Brian at the wheel for CLIs)

Read-only where possible; never print secret values (compare hashes). If fly/vercel CLIs aren't authenticated in-session, emit the exact command list for Brian (`! <command>`) instead of skipping silently. Items, each ending CLOSED / FAILED / BLOCKED-needs-Brian:

1. `fly scale show` → exactly 1 machine (the rate-ceiling + snapshot-uniqueness assumption).
2. Live web build sha vs `origin/main` (runbook §8 records the last deploy; is the live build still what §8 claims?).
3. Vercel prod env: `USE_ML_SHORTLISTER=true`; `M5_MAX_COMPLETION_TOKENS` UNSET on BOTH Vercel and Fly (if unset, the two contract-pinned 2200 defaults are load-bearing — confirm); `ML_SERVICE_TIMEOUT_MS` unset-or-≤50000; `CV_SERVICE_URL` state matches the documented degrade.
4. `FITTED_SERVICE_KEY` ≡ `SERVICE_KEY_CURRENT` byte-equality via hash comparison.
5. `/readyz` green on the live service.
6. One gauntlet render → `bindable:true`, and `track2-erasure-check` → 0 orphans (the drivers are `TRACK2_LIVE_OK=1`-gated, spend $, and always erase after — run once, not repeatedly).
7. **TOKCAP-1 discharge (cost-approved, one render):** seed a ≥12-base-item closet via the gauntlet driver, drive one capped daily render at the live default (2200), assert finishReason `stop` + the full 12-outfit ask + zero truncation. PASS → flip the `service/config.py` + runbook §8 TOKCAP-1 text to a validated record in the same commit. FAIL → that is a real pre-friend finding: re-tune default+floor together per m5-cutover §A.6 point 3 before recruiting.

## Track C — dynamics a static read can't see (author real tests; the real-Mongo jest harness exists)

- **Races:** two simultaneous `DELETE /api/account`; account-delete during an in-flight render (the H43 guard pair under REAL interleaving, not code-trace); double-submit on "Save & add another"; concurrent feedback on the same candidate (H61 latest-state under interleaving).
- **Abuse/load on the friend surface:** model (do NOT DoS the live service) the rate ceiling under 5 concurrent friends on 1 machine (burst 5 / refill 0.2/s) — is a normal friend evening rate-limited into a bad first impression?; hostile/oversized image upload paths; a closet at `MAX_WARDROBE_ITEMS`.
- Finder agents propose the top-N missing dynamic tests ranked by blast radius; Fable verifies each is (i) not already covered and (ii) load-bearing before implementation; survivors get REAL tests (import the real units — no mirrors) landing as floor growth. Severity bar for B/C findings: load-bearing = would mislead an implementer, mis-store/corrupt data, break a downstream seam, or ship broken.

## Orchestration + output

Track A = 4 parallel lens agents → Fable synthesis. Track B = sequential, Brian in the loop (live state mutates; spends $). Track C = finders → Fable verify → implement. Output: (A) a decision memo — per-lens verdicts, the synthesized KEEP/CHANGE/KILL/ADD list, the single highest-leverage change; (B) the live-truth checklist, itemized; (C) tests landed + defects found as structured records {file, line, type, severity, claim, evidence}. Explicitly name what remains UNCOVERED even after this session — there will be something. Fold every decision into its single home (Spec §23 / runbook §8 / memory), reconcile any doc a Track-A decision touches in the same pass, and commit on main as the closing act.
