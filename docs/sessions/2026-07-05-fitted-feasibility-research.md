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

## Fresh-session Fable merit review — handoff

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
