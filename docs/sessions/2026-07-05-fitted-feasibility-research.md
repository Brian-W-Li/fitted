# Fitted — Feasibility & Precedent Reality-Check (2026-07-05)

> Deep-research pass (run `wf_efcfa4b1-1c2`: 109 agents, 6 angles, 26 sources fetched, 119 claims
> extracted → **25 adversarially verified → 22 confirmed / 3 killed**; a claim dies on ≥2 of 3 refute
> votes). The workflow's auto-synthesis stage returned a placeholder stub (`summary:"test"`); this report
> is **reconstructed from the verified `logs` + per-agent extractions** in the run journal, not from that
> broken top-line. Purpose: is Fitted's ambition sound, feasible, and worth *implementing* — and does it
> flop on capturing the essence of style for the "green-shirt" person? This is the evidence input for a
> **fresh-session Fable merit review** (reading list + prompt at the bottom).

## TL;DR verdict

**Feasible, and unusually well-precedented for a portfolio project.** Every piece has published precedent,
and a **near-exact published system (Loom, 2026)** deploys essentially Fitted's architecture — a learned
compatibility prior + a *separate* structured scoring layer + closet personalization — and reports gains.
It will **not "completely flop"** on capturing style: the compatibility pieces work well above chance on the
honest split. BUT it will **not fully capture the *essence* of style** — fit / body / occasion / wear-state
live largely *outside* the item-set model and are delegated to the LLM, whose fine-grained aesthetic
judgment is itself only weak-to-moderate. The project's differentiation must therefore be **earned on
systems axes** (cost / determinism / availability), which is *exactly* what H26 measures. A no-go there is
still a clean engineering result.

---

## Q1 — Precedent for the pieces: YES, strongly (confirmed)

**Learned garment-compatibility is a real, working technique, above chance on the honest (disjoint) split:**

| Method | Disjoint AUC | Disjoint FITB | Note |
|---|---|---|---|
| Bi-LSTM+VSE (Han et al.) baseline | 0.62 | 39.4% | weak baseline |
| SiameseNet | 0.81 | 51.8% | |
| **CSN / type-aware (Vasileva ECCV 2018)** | **0.84** | **55.2%** | the technical anchor |
| **OutfitTransformer (2022)** | **0.88** | ~59% | current-ish SOTA on disjoint; 0.93 non-disjoint |
| HGNN (graph) | 0.76 | 39% | GNN variant |

Chance = 0.50 AUC / 25% FITB. **These match Fitted's H26 anchors exactly.**

⚠️ **A caveat the adversarial verifiers caught (killed 0-3):** the flashy **~92–97% FITB / 0.99 AUC** figures
floating around are the **non-disjoint** split (train/test share items — leaky). One claim asserting
"mid-60s% FITB / 0.93 AUC" as the *hard*-split ceiling was **refuted** for conflating the easy-split numbers
with the hard split. Honest disjoint ceiling ≈ **0.84–0.88 AUC / ~55–59% FITB**. (This is the same
table-confusion our own notes flag as a hallucination risk — the swarm caught it.)

**Commercial closet-app track record (secondary):** dedicated own-wardrobe apps *exist* but tend to be
**absorbed or shut down**, not survive independently — **Finery** (Casey/Decker) → acquired by Stitch Fix for
IP, Sept 2019, after ~4 yrs; **Cladwell** ("expertly styled outfits from the clothes you already own,
personalized to lifestyle" — Fitted's exact pitch) → acquired. This bears on *commercial* viability, not
technical feasibility — and Fitted is scoped as a technical-depth portfolio project, not a startup.

Sources: Vasileva ECCV 2018 (openaccess.thecvf.com); OutfitTransformer arXiv:2204.04812; Polyvore Outfits
(68,306 outfits / 261,058 items); Forbes 2019 (Finery); theygotacquired.com (Cladwell).

## Q2 — Does "outfit = set of atomic items" hold? Partially, with documented blind spots (confirmed)

The item-set abstraction **provably misses**, per the literature:
- **Body / fit** — the *same* garment is flattering or unflattering depending on body shape; some work treats
  body shape as a first-class, actively-modeled input (Hsu et al., MM 2018). Item-set compatibility ignores it.
- **Occasion / context** — confirmed **not** captured by item-set compatibility signals.
- (**Wear-state / styling** — tuck/cuff/proportion — is below item grain by construction; not in the data.)

**Is delegating that to an LLM + personalization sound?** Yes, and it's independently argued by the precedent
below — this is a *principled* division of labor, not a patch. The compatibility prior answers "do these
cohere"; the LLM handles styling/fit/occasion nuance; personalization handles individual taste.

## Q3 — Evolving fashion: real, and the design handles it the right way (confirmed)

- **A static prior IS a documented failure mode.** He & McAuley, *Ups and Downs* (WWW 2016, one-class CF):
  items measurably gain/lose "attractiveness" along visual dimensions over time.
- **Styles have life-cycles** — classic / trending / out-of-fashion / **re-emerging** (Al-Halah, *Fashion
  Forward*, ICCV 2017); best forecaster is exponential smoothing; validated horizon is **limited** (~short).
- **Quantified:** a real H&M recommender gained **35–54%** from injecting temporal/recency knowledge over a
  temporally-naive pipeline.
- **Implication for Fitted:** "static learned prior + *current* LLM + personal feedback" is **defensible
  precisely because the currency load rides on the LLM + personalization**, not the frozen prior. The prior is
  the slow-moving "do these cohere" base; trend currency is *not* its job. This **vindicates the
  temporal-validity limitation note** already in the H26 plan (the socks-in-sandals boundary).

## Q4 — Personalization: precedented; cold-start is the real constraint (confirmed)

- **Precedent:** Lin et al., *Learning Personal Tastes in Choosing Fashion Outfits* (CVPRW 2019) — a neural
  model combining each user's implicit feedback works.
- **Cold-start is a fundamental, named limitation**: no personalization until user data is collected — this
  bounds *any* feedback-driven taste system and is the sharpest per-user-data risk for a small app.
- **But the architecture is cold-start-robust by design:** the content prior + LLM work at **zero** user
  feedback (day 1), and personalization layers on as signal accrues. So cold-start degrades *quality of
  personalization*, not *basic function*.

## Q5 — Honest verdict: works vs. fails

**Strongest evidence it WORKS:**
1. **Every piece has published precedent** — prior (Vasileva/OT, 0.84–0.88 disjoint AUC), LLM styling (below),
   personalization (Lin et al.).
2. **Near-exact precedent exists (Loom, below)** and reports gains from *exactly* Fitted's hybrid shape.
3. **The division of labor maps onto each piece's documented gaps** — principled, not arbitrary.
4. **Cold-start-robust** (prior works day 1).
5. **The H26 systems thesis is the right question** given the LLM baseline is strong-but-expensive (below).

**Strongest reasons it could FALL SHORT:**
1. **The "essence of style" partly lives where the prior can't see** — fit/body/occasion/wear-state. The bet is
   the LLM covers it; but the LLM is only a **weak-to-moderate** fine-grained aesthetic scorer (below), so the
   *combined* ceiling on nuanced style is bounded. It captures "do these cohere + a styling move," not a
   master stylist's eye.
2. **Differentiation vs. "just prompt a vision LLM"** must be *earned on systems axes*, not quality — if a
   tiny prior can't beat the LLM on cost/determinism/availability at parity quality, the trained-model story
   weakens. (**H26 measures exactly this**; a no-go is still a clean result.)
3. **Trend drift** means the static prior degrades; currency is only as good as the LLM + personalization.
4. **Commercially**, closet apps have a graveyard (retention / cold-start / monetization) — out of scope for a
   portfolio project, but real if it ever aims to be a product.

## Near-exact published precedent: **Loom** (the single most reassuring finding)

**Loom: Hybrid Retrieval-Scoring Outfit Recommendation with Semantic Material Compatibility and
Occasion-Aware Embedding Priors** (arXiv 2026 preprint; in the fetched set — exact id to confirm, likely
arXiv:2602.06370 / 2605.09830). Confirmed 3-0:
- **Central argument:** purely learned compatibility embeddings (Vasileva type-aware, GNNs, OutfitTransformer)
  capture co-occurrence statistics but **cannot enforce hard fashion constraints**, so a **hybrid of learned
  retrieval PLUS a separate structured scoring/rules layer** is needed — *directly validating Fitted's
  division-of-labor thesis* (learned prior for "do these cohere" + a separate layer — for Fitted, the LLM —
  for the rest).
- **Deploys exactly Fitted's closet-personalization.**
- **Reports gains** (mean outfit score 0.179 vs. baseline).

The takeaway: a peer-reviewed-adjacent system independently converged on Fitted's exact architecture and it
works. That is stronger external validation than most student projects ever get.

## The sharpest risk, quantified: differentiation vs. GPT-4V

*An Empirical Analysis of GPT-4V's Performance on Fashion Aesthetic Evaluation* (SIGGRAPH Asia 2024,
arXiv:2410.23730): prompted as a stylist, GPT-4V **beats chance AND reasonable trained baselines zero-shot**
and aligns "fairly well" with humans — **but** its correlations are **0.117–0.519** across five test sets vs.
**human inter-rater 0.716–0.815**. So the LLM stylist is **beatable and only weakly fine-grained**, yet also
expensive / nondeterministic per edge. That is the precise seam Fitted's H26 exploits: a tiny deterministic
prior doesn't need to *out-taste* the LLM, it needs to **match it at a fraction of the cost/latency, and
deterministically** — a systems win, not a quality contest.

## Verified source set (angle → key sources)

- Compatibility benchmarks: Vasileva ECCV 2018; OutfitTransformer arXiv:2204.04812; arXiv:2404.18040;
  arXiv:1902.03646; mariya.fyi/polyvore.
- Abstraction critique: Cheng et al. survey arXiv:2003.13988; Hsu et al. MM 2018 (body shape);
  arXiv:2605.09830; dl.acm 10.1145/3637217.
- Temporal drift: He & McAuley arXiv:1602.01585; Al-Halah ICCV 2017; H&M temporal study (FLAIRS);
  arXiv:2508.02342.
- Personalization: Lin et al. CVPRW 2019; springer 978-3-030-55218-3_1.
- LLM-as-stylist: GPT-4V arXiv:2410.23730; arXiv:2502.15696; Loom (arXiv:2602.06370 / 2605.09830).

Full per-agent extractions + verdicts: run journal `wf_efcfa4b1-1c2/journal.jsonl`.

---

## Fable merit verdict (2026-07-05 — handoff below EXECUTED; verdict recorded here)

Fresh session ran the handoff as specified: full reading list read (spec whole, appendix C.0/C.1/C.8 +
critic hat, CLAUDE.md, this report, the H26 committed state), Fable seat spawned with the prompt + evidence.
Every load-bearing cite in the verdict was source-verified by the orchestrating session before recording.

**VERDICT: GO** — with one narrative-honesty condition: the taste-learning half of the promise must be told
as *designed, not demonstrated* (a zero-user fork can never accumulate the feedback volume the Lin-et-al
personalization arm needs; §20 M6 behavioral arm / §23-H9 stage it correctly, but it stays a hypothesis).

**Load-bearing reasons:**
1. **Feasibility is mostly *behind* the project, not ahead** — answered by committed measurements, not
   borrowed precedent: the paper→solo-ship chasm is what H26 C1–C4 already crossed (frozen prereg, 83k-id
   cache, trained pairwise head, and the comparator already measured — judge 54.1% consistent at N=500,
   CI-low 0.486 ≫ 0.25, ~CSN-tier). Remaining gate risk is modest (a 2025 fashion-tuned backbone need only
   match a 2018 SiameseNet, 0.81/51.8%); `converged:false` @48/50 risks a *weaker number*, not a broken
   thesis; a miss ships preregistered as a clean engineering verdict.
2. **The systems-decision reframe converts an unwinnable contest into a winnable one, evidence in hand:**
   the production-model judge is only 54.1% consistent and **flips 35.4% under order swap** — measured
   nondeterminism matching the verified GPT-4V finding (correlations 0.117–0.519 vs human 0.716–0.815).
   The §9 cost/determinism/availability table is the right headline for a systems-depth portfolio, and Loom
   (confirmed 3-0) independently validates the hybrid division of labor.
3. **The green-shirt job is an activation/trust problem, not a fine-aesthetics problem**, so the bounded
   style ceiling doesn't gut the promise: the measured **46.5% human inter-annotator agreement** shows the
   un-modeled nuance is substantially *irreducible*; the user needs believable non-clashing completions +
   one teachable StyleMove (precision-at-3 over ~10 candidates), which the prior + fenced LLM demonstrably
   deliver (Spearhead H40: 100% forced-item inclusion, 0 hallucinated ids). Fit/body stays the honest cap —
   "believable on the hanger, correctable on the body" (`not_practical`/`not_me` §16, H27 archetype prior);
   the flop only materializes if the narrative over-promises taste mastery.

**Stress-test answers (condensed):** Q1 — precedent load-bearing for the content prior (same-dataset/
split/protocol anchors); two non-fatal gaps: (a) catalog→closet transfer is the one unmeasured load-bearing
link (underpowered, report-only), (b) the personalization precedent isn't practically load-bearing at N≈1
users. Q2 — no flop for the promise as written in §1; the delegation maps each documented gap onto the
component best able to carry it. Q3 — yes, implement; value order: finish emit (nearly free) → power the
closet transfer (below) → M5 (highest-value engineering artifact; converts offline result + dormant
substrate into a deployed end-to-end system) → M6 content-prior arm only. **Hold, don't build:** B-track
boards compiler, R-track, H44 anti-capture detector, scoped-memory *behavior* — worst effort-to-evidence
ratio at N≈1; keeping them seams-only *is* the reshape, applied continuously. Terminal portfolio deliverable
= the single-user end-to-end demo (Brian's closet, his green shirt, before/after, snapshot-backed) + the §9
systems table.

**If you change one thing:** promote the catalog→closet transfer from underpowered report-only afterthought
to a **powered first-class experiment immediately after H26 emits, before the full M5+M6 spend** — extend
the B3 mechanism to **3–5 real closets** (recruit friends via the someday-launch path as closet donors,
~30–50 labeled items each), evaluated offline with the already-built H26 tooling; fold in the H40 pre-M5
believability read. Cheap relative to M5, no deploy needed, decision-grade either way: a good number
de-risks everything downstream; a bad one redirects M6 toward the actual bottleneck (closet-photo
ingestion/representation transfer) before the effort is sunk. (Post-emit + separately reported — does not
touch the frozen prereg or the current four-file unlock.)

---

## Post-verdict synthesis — simplification & feature candidates (2026-07-05, same session)

Recorded as **candidates, not decisions** — each adoption is its owning milestone's `/spec` call (M5 unless
noted), per the promise-driven-decision convention. Nothing here edits the spec; conflicts with §15/§18 are
deliberate proposals, flagged as such.

**Simplify / hold:**
1. **M5 candidate-cache → "regen = re-rank the parent snapshot"** (design call; retires spec §15 R1's TTL
   cache, so it needs the M5 `/spec` + a Fable read). The GenerationSnapshot already stores the full
   candidate funnel; a re-roll can re-rank the *parent snapshot's* candidates (client passes the parent
   `snapshotId`; Steps 4–6 rerun per request unchanged). Settles **H4** (stability promise = within the
   regen chain, which is H4's own default lean with a chain instead of a TTL), kills **H49** (cache-hit
   snapshot provenance — a re-roll snapshot references its parent explicitly), **H51** (cache locus /
   cross-runtime key reproduction — no key exists), **H17** (`forceRegenerate` — just don't pass a parent),
   and simplifies **H7** (`generationIndex` = position in the regen chain). Cost: one GPT call per fresh
   session instead of TTL reuse — negligible at N≈1. Keeps every promise the cache served: cheap re-roll,
   within-chain determinism, dislike-vanishes-on-next-render.
2. **W-track async queue + item-state machine: hold until a launch path activates.** The offline manifest
   path (`assemble_closet.py`) already feeds the closet-transfer experiment — friend closets included —
   without touching the app; the in-app data faucet the demo needs is the existing upload + a minimal
   review form. The Mongo job queue + 5-state machine serve upload concurrency that doesn't exist at N≈1.
   (The §18 *contract* — states, single bump transition — stays specced; only the build is held.)
3. **M5 trust-boundary gates: sequence last / cut-line after the demo vertical works** (still mandatory
   before any launch). They protect zero users today. **Exception: the §16 feedback-authenticity gate stays
   M5-core** — it guards training truth, not users.
4. **Spec hygiene:** `Fitted_Spec_v2.md` is at 1303 of the 1500-line ceiling; when compaction trips, the
   RESOLVED §23 rows are the compression target (one-liner + pointer, Appendix-A style).

**Cheap new artifacts (post-emit; reuse existing H26 tooling; only if the head clears its gates):**
1. **Offline orphan/coverage demo** — run the trained head over the B3 closet manifest (and each donated
   friend closet): per-item best-completion scores → "which items have no believable completions" (orphan
   detection, §11 cold-start) + a closet-coverage number. Zero UI; the green-shirt promise demonstrated on
   a *real* closet; gives the closet-transfer experiment a product-shaped readout beside AUC/FITB; drops
   straight into the writeup.
2. **Determinism figure for the §9 table** — the head scores the same FITB query identically every time;
   the judge flipped 35.4% under order swap. One figure; the systems thesis made visceral.

**Nothing to outright delete** was found in `fitted_core`/H26 — the substrate is lean; the fat is all in
not-yet-built surface, which is why the list above is "hold/simplify," not "remove."

**Narrative honesty (the verdict's condition, restated as a writeup rule):** the personalization/taste
arm is *designed, not demonstrated* — say so in every outward-facing artifact.

### Brainstorm round 2 (same session; frame corrected per Brian: the goal IS the personal, growth-focused stylist)

Candidates only — each adopts at its owning milestone's `/spec`. None touch the critical path
(B3 → emit → C6 → friend-closet transfer).

**A. Proving the taste engine (turn "designed, not demonstrated" into a planned experiment):**
1. **Pre-registered dogfood study (post-M5).** 60 days of daily use by Brian; metrics named *in advance*,
   H26-style (acceptance-rate trend, rescued-item repeat-wear, `not_me` rate over time, cooldown hits).
   Honest framing: a single-subject longitudinal case study. Cost ≈ a one-page mini-prereg + discipline;
   the snapshots/feedback rows are already the instrumentation.
2. **Persona-replay harness (offline, zero users; M5/M6-adjacent).** Define 2–3 synthetic personas with
   fixed tastes (color families / formality / boldness); drive simulated feedback through the *real*
   pipeline (interactions → projections → ranker); show ranking converges toward each persona AND
   anti-capture holds (inject one outlier dislike → profile does not yank). Circularity is fine — it's a
   *mechanism* test of rung-2/4 machinery, framed as such, not a quality claim.
3. **Friends-week (post-M5).** 2–3 of the closet donors also *use* the deployed app for a week — first
   non-owner feedback + a live onboarding-friction read, off the someday-launch friends path.

**B. Making growth feel good (product policies, near-free):**
4. **Design the first success.** The first rescue offered = the *easiest win*: the orphan with the highest
   best-completion score under the head, that fits well, appropriate to today's weather — not an arbitrary
   orphan. One ranking policy at the M5/H45 surface; maximizes first-success probability (C.1: "the first
   success should lower fear, not maximize novelty").
5. **One-tap fit flag at ingestion** (`fits great / fits weird` per item; W-track review form). The
   cheapest possible fit/body signal — no body modeling; orders rescues toward pieces that fit; the honest
   floor under the H27 archetype prior.
6. **Weekly recap digest (CLI/cron first, no UI).** Computed from snapshots + feedback: "green shirt worn
   2×; two new trusted pairings; safe cluster grew by 1." Makes growth *visible*; doubles as the dogfood
   study's auto-diary; a humble text precursor of the NORTH-STAR Progress surface (H46) with no new schema.

**C. Systems polish:**
7. **Head-checks-the-LLM (M6, once the head is on the §23-H28 rank() hook).** Use the trained head to
   sanity-check each StyleMove's claimed pairing (`changedItemIds` pair score); flag/regenerate on clash.
   The deterministic model auditing the LLM's prose — extends "backend owns structure, GPT owns style" one
   rung further, and is a distinctive systems-story beat.
8. **Golden lens matrix (M5 regression net).** Replay a small grid of golden requests
   (intent × weather × occasion) against the real-closet fixture after every M5 change — extends the
   Spearhead C6 `evaluation`/`cli` surface; catches vertical-wide drift cheaply.
9. **One-command demo.** `make demo` (or equivalent): boot service + app + seeded closet → clickable
   green-shirt flow in minutes. Portfolio reviewers don't run multi-step setups; the README clone→demo
   path is part of the deliverable.

---

## Fresh-session Fable merit review — handoff (EXECUTED 2026-07-05; kept for provenance)

Run this in a **fresh `/clear`ed session** (clean reading list, no RUN-phase weeds).

**Reading list (small, on purpose):**
1. `docs/sessions/2026-07-05-fitted-feasibility-research.md` (this file — the evidence)
2. `docs/Fitted_Spec_v2.md` — canonical spec (the lens-first personal style graph; the green-shirt promise)
3. `docs/Fitted_Spec_v2_recovered_appendix.md` — north-star notes (ambition, style-move loop)
4. `CLAUDE.md` — scope (portfolio + technical depth; not a startup)
5. Committed state: the H26 spike measured a trained item-compatibility head vs a `gpt-5.4-mini` judge on
   disjoint Polyvore (judge above-chance 54.1% FITB on the gate-B 500; the emit/verdict is pending the closet
   manifest). See memory `project_h26_c4_build`.

**Fable prompt (run via `Agent` with `model: "fable"`):**

> You are the Fable synthesis seat on an **ambition-merit** review of *Fitted*, a solo-built, portfolio-grade
> personal outfit-recommender. Judge **merit** — is the north-star ambition **good, feasible, and worth
> *implementing*** — not fidelity (whether code matches spec). Reason from the user-facing **promise**: help a
> style-stuck person wear the better outfits already hiding in their own closet — the *green-shirt* rescue
> ("I own this piece I never wear; show me how") — and *learn their taste* over time.
>
> Inputs: the attached feasibility research (`docs/sessions/2026-07-05-fitted-feasibility-research.md` —
> real, adversarially-verified precedent); `docs/Fitted_Spec_v2.md` (canonical spec); the recovered appendix
> (north-star); `CLAUDE.md` (scope); and the committed state (H26: a trained compatibility prior measured vs
> a `gpt-5.4-mini` judge on disjoint Polyvore).
>
> Stress-test **three questions specifically**, adversarially and honestly (not flattery, not manufactured
> doom):
> 1. **Feasibility of the pieces** — the research shows each piece has precedent (Vasileva 0.84–0.88 disjoint
>    AUC; GPT-4V stylist beats baselines but weakly; Lin et al. personalization; and *Loom*, a near-exact
>    published hybrid). Is that precedent load-bearing for Fitted's specific stack, or does the gap between
>    "a paper does X" and "this solo build ships X" hide a fatal problem?
> 2. **Does it flop on the *essence of style* for the green-shirt person?** The item-set prior provably can't
>    see fit/body/occasion/wear-state, and the LLM that's supposed to cover them is only a 0.1–0.5-correlation
>    fine-grained scorer. Is the delegation (prior = cohere, LLM = styling, personalization = taste) enough to
>    deliver a *genuinely useful* green-shirt experience — or does the nuance it can't model gut the promise?
> 3. **Good to implement?** For a solo dev optimizing portfolio value + technical depth (not revenue), is the
>    remaining effort (M5 cutover + M6 trained scorer) worth it given the LLM does a lot zero-shot? Where is
>    the effort best spent, and what — if anything — should be **reshaped or cut** to protect the promise?
>
> Deliver an honest **GO / RESHAPE / NO-GO** on the ambition, with the **2–3 load-bearing reasons**, and one
> concrete "if you change one thing, change this."
