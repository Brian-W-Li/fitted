# Track-2 catalog→closet re-measure — PRE-REGISTRATION (freeze-before-look)

> **FROZEN 2026-07-20, before any friend label was looked at.** This file is the single design
> home for every choice that could otherwise be made after seeing a friend's accept/reject data —
> the statistics, the measurand, the eligibility gates, and the decision rule. Once a friend label
> is analyzed, nothing here may change; it is a **one-way door**, modeled on
> `experiments/h26/preregistration.md` (the discipline that made the H26 NO-GO credible).
>
> **Machine-readable mirror:** `preregistration.json` carries the frozen constants; the export
> certificate (`fitted/scripts/exportTrack2Core.cjs` `CERTIFICATE`) mirrors the eligibility floors
> and is pinned equal by `tests/test_preregistration.py`. If prose and JSON ever disagree, **this
> file is the human authority and the divergence is a bug to fix on sight.**
>
> **What this re-measures.** H26 (`experiments/h26/results.md`) trained a pairwise content-
> compatibility prior on catalog photos (Polyvore-disjoint) and — as a *reported, not gated* finding —
> probed its transfer to ONE real closet: closet pair-AUC **0.5625 [0.2857, 0.7500]** at
> effective-N = 6 worn outfits, against an in-domain catalog ceiling of **0.7315**. That single-
> wardrobe read was too underpowered to decide anything and was demoted to an **M6 re-measure entry
> condition** (Spec §20 M6 row). This document is that re-measure's frozen rule, to be applied to a
> 3–5 friend cohort collected through the live app.
>
> **Why a new rule and not H26's band.** The inherited "healthy band" (`CI_low(AUC_closet) ≥ 0.70`
> floor ∧ `CI_high(drop) ≤ 0.12`) is **structurally undecidable at any cohort N a friend study can
> reach** — proven arithmetically in §9. Keeping it would guarantee a third "underpowered /
> inconclusive," which is why the 2026-07-20 merit audit (Fable-decided) required this replacement
> before recruiting.

---

## 0. What "frozen before look" means here (the disclosure section)

- **Data may already exist in the database, unlooked-at, and that does not break the freeze.** Friend
  invites went out before this file was written; rows may be accruing. The freeze binds the moment a
  friend's **accept/reject label (or any score derived from it) is first read or exported for
  analysis**, not the moment a row is written. No `label`/`action`/`feedback` field, and no
  compatibility score over friend data, has been read at freeze time. The routine Track-2 yield
  readout Brian runs while collecting (`export_track2.mjs` → `manifest.yield`) **never computes the
  compatibility score** (§6) — it certifies sample *eligibility and count* only — so watching it is
  explicitly **not** "looking at the result."
- **The freeze is by git commit.** The freeze commit's SHA is the timestamp; `preregistration.json`
  and the export `CERTIFICATE` are committed together and pinned equal by test.
- **No optional stopping.** The analysis is a two-look group-sequential design with a fixed trigger
  and a pre-registered horizon (§2). There is no "look again until it passes."
- **The secondary read can never be promoted to primary post-hoc** (§3), even if it happens to read
  better; and the primary's sample exclusions are fixed here (§5), so none can be chosen after labels
  exist.

---

## 1. The question, and the two reads

**Question:** does the universal content-compatibility prior (the H26 trained pairwise head, §6)
carry signal on **real friend closets** — messy phone photos, real garments — as opposed to clean
catalog flat-lays?

Two reads answer it, with different roles:

| Read | Role | Negatives | Boundary | Gates M6? |
|---|---|---|---|---|
| **PRIMARY — accepted-vs-rejected discrimination** (§2) | **decision-relevant** | the friend's own **rejected** candidates (human-judged) | **0.50 (chance)** | **yes** — its ESTABLISHED verdict satisfies the M6 re-measure entry condition |
| **SECONDARY — catalog→closet pair-AUC, two-boundary directional** (§3) | **reported continuity** with H26 | mechanical same-fine-category corrupted (H26's) | {0.50, 0.70} | **no** — reported, never gates |

The primary read is the decision instrument; the secondary preserves apples-to-apples comparability
with the H26 credential (same negatives, same bootstrap unit, same boundaries as the inherited band)
and is where "did it transfer against the *same* yardstick H26 used" is answered, at last honestly
boundaried.

---

## 2. PRIMARY read — accepted-vs-rejected discrimination (the decision)

**Definition.** For each friend, compute the AUC of the frozen content prior's **outfit score**
(§6) at separating that friend's **accepted** candidate outfits from that friend's **rejected**
candidate outfits. Pool **within-user** concordant pairs across friends into a single headline AUC:

> pooled AUC = mean over all same-friend ordered pairs (accepted_i, rejected_j) of
> [ 1 if score(acc_i) > score(rej_j); 0.5 if equal; 0 if less ].

Cross-user pairs never enter (a friend's accept bar is personal; pooling raw scores across users
would mix distributions). Report every friend's own AUC + arm counts alongside the pooled headline.

**Why this is the primary read (freeze rationale):**
1. **Human-judged negatives fix H26's mechanical-negative weakness.** H26 §9.9: a same-fine-category
   "negative" may be genuinely compatible, just never co-worn — so its "errors" are partly on the
   proxy, not the prior. A **rejected** candidate is a negative the friend actually disliked.
2. **~Doubles the information per friend** — rejected candidates, unused by the transfer read, become
   the negative arm.
3. **It is the deployment-relevant question.** M6's scorer re-ranks *stylist-generated* candidates
   for a user; "does compatibility signal help rank accepted above rejected among stylist outputs"
   is exactly that job (§4 range-restriction reframe).

**Decidable boundary = 0.50.** Unlike the inherited 0.70 floor (unpassable — §9), the chance
boundary is reachable at cohort N given a moderate effect (§9.4: true AUC 0.65 → 26/arm).

### 2.1 The analysis trigger, looks, and verdicts (no optional stopping)

Two pre-specified looks, family-wise α = 0.05 split Bonferroni → **each look reads the 97.5%
two-sided percentile-bootstrap CI** (percentiles 1.25 / 98.75; §7):

- **Look 1** is taken at the **first export** in which **both** primary arms reach **≥ 25 scoreable
  clusters** (§5) **and** the concentration cap holds (§7). That export's snapshot-ID set is recorded
  as the frozen analysis sample at that moment (`analysis_sample.json`).
- **Look 2** is taken at the **first export** reaching **≥ 50 scoreable clusters per arm** (cap
  holding), **only if Look 1 did not return ESTABLISHED**.

**Verdicts (terminal in every branch):**

| Condition | Verdict |
|---|---|
| At Look 1 or Look 2: `CI_low(pooled AUC) > 0.50` **AND** point estimate ≥ **0.60** | **ESTABLISHED (for this cohort)** — M6 re-measure entry **satisfied** |
| Look 2 reached, CI straddles 0.50 (or point < 0.60) | **NOT-ESTABLISHED (well-powered null)** — M6 does not open on this basis |
| Horizon reached with 25 ≤ N < 50/arm and Look 1 did not establish | **NOT-ESTABLISHED (underpowered)** — read was taken at limited N, did not clear; next levers below |
| Horizon reached with N < 25/arm | **UNDERPOWERED-TERMINAL** — the cohort could not power the question |

**The point-estimate floor (≥ 0.60) is load-bearing:** it prevents a barely-above-chance prior
(true AUC ≈ 0.55–0.58) from being declared ESTABLISHED merely by collecting enough data to shrink
the CI at large N. ESTABLISHED requires both statistical separation from chance **and** a
practically meaningful effect.

**The horizon (the expiry that makes "keep collecting" terminal):** **2026-10-31, or the render-
service decommission, whichever is earlier.** Before the horizon, an under-floor sample reads
"UNDERPOWERED — keep collecting"; **at** the horizon it becomes the terminal verdict above. This is
the deliberate analogue of H26's N = 500 cap: the study **decides even when the honest answer is "we
could not answer,"** rather than sitting in open-ended limbo.

**Named next levers on any non-ESTABLISHED terminal verdict** (so the verdict is actionable, not a
dead end): (a) recruit +K friends and re-open a fresh freeze; (b) the H26 gate-B power extension
(`results.md` §10 — an independent M6 lever); (c) reconsider the prior (e.g. fine-tune on friend
data) — a new experiment, separately pre-registered.

**ESTABLISHED is cohort-conditional, symmetric with the null.** The block bootstrap (§7) does not
resample the 3–5 friends, so its CI covers **within-friend** variance only. The claim is always "the
prior transfers **for this cohort**," never "the prior transfers" — the same hedge the NOT-
ESTABLISHED branch carries.

---

## 3. SECONDARY read — catalog→closet transfer, two-boundary directional (reported, never gates)

Continuity with H26: **same** mechanical same-fine-category-corrupted negatives, **same** source-
outfit bootstrap unit, computed on the friend cohort's **accepted** outfits (the positives). This is
the read the inherited band tried to gate; here it is **reported only**.

**Two-boundary directional rule.** Report which of these the closet-AUC 95% CI excludes:
- **above-chance:** `CI_low(AUC_closet) > 0.50` — the prior carries real signal on real closets.
- **below-healthy:** `CI_high(AUC_closet) < 0.70` — the prior is measurably below the catalog band.

Three informative outcomes: above-chance ∧ below-healthy = "signal present but degraded"; above-
chance ∧ not-below-healthy = "consistent with healthy"; neither excluded (CI straddles 0.50) = "not
distinguishable from chance at this N." **The inherited `CI_low ≥ 0.70` pass floor and the
`drop ≤ 0.12` gate are RETIRED as gates** (kept as reported points), with §9's structural-
undecidability derivation as the trap-guard: the 0.70 floor's pass bar sits **above the catalog
ceiling** at every reachable N, so reading it as a gate is theater.

**Interpretation floors:** report the point at any N; attempt the two-boundary read only at **≥ 12
scoreable accepted source-outfits** (doubling H26's effective-N = 6); treat a boundary exclusion as
**decided** only at **≥ 25 source-outfits**; between 12 and 25 it is "suggestive, coverage-
caveated" (percentile-bootstrap coverage below ~25 clusters is weak — H26 §H).

**No post-hoc promotion.** Even if the secondary reads better than the primary, it is **never**
promoted to the decision. Its negatives are mechanical (the very weakness the primary fixes); its
role is comparability, fixed here.

---

## 4. Ground truth, the proxy, and the range-restriction reframe

**The primary label is a proxy, and a *different* proxy than H26's.** H26's ground truth was co-worn-
ness on Polyvore (a compatibility proxy). Here the label is **a human accept/reject on a stylist-
generated outfit** — a **taste + compatibility blend**, not pure compatibility and not co-wear. A
compatibility prior evaluated against a taste-inclusive label has a **ceiling < 1.0 by construction**
(it cannot capture personal taste). The primary is therefore pre-registered as a **discrimination**
read ("does compatibility signal help rank accepted above rejected"), **never** as "measures
compatibility accuracy."

**The sharper confound, and its honest reframe (range restriction).** The stylist already filters
for compatibility, so **both** arms are drawn from the high-compatibility tail — a truncated range
that **deflates** AUC toward 0.50. A skeptic could say a red-light indicts the measurement, not the
prior. Pre-registered reframe: the primary measures the prior's **marginal discrimination beyond the
stylist's implicit filter** — which is *precisely* the prior's M6 production job (re-rank stylist
candidates). If it cannot separate accepted from rejected **among stylist outputs**, it adds no
production value regardless of its "true" compatibility accuracy. The taste direction (a friend
rejecting a compatible-but-boring outfit) is disclosed noise that **only deflates** — so it can
sink a real effect toward the null but can never manufacture a false ESTABLISHED. Both effects make
ESTABLISHED **conservative** and mean a NOT-ESTABLISHED must be read as "no marginal value beyond the
stylist, for this cohort," not "the prior is worthless."

---

## 5. Eligibility — the scoreable-cluster certificate (frozen; the export mirrors it)

An outfit (a training-example candidate) is not scoreable merely by existing. Gates, per read:

- **pairwise-sized:** ≥ 2 items (a pairwise/outfit compatibility score needs an edge).
- **image-usable:** every item's image resolved (the measure is an image embedding; an unresolved
  photo contributes zero — H26 §6).
- **labeled:** latest-state action ∈ {accepted, rejected} per **§23-H61** exactly (most-recent action
  per `{snapshotId, candidateId}`, `createdAt` desc, `_id` tie-break; only accepted/rejected
  participate). Shown-but-unrated candidates are in **neither** arm.
- **primary-scoreable** = pairwise-sized ∧ image-usable ∧ labeled. **The primary arm is NOT filtered
  by same-category-negative availability** — that is a transfer-read condition only, and leaking it
  into the primary sample would be a post-hoc-lookable exclusion.
- **transfer-scoreable** = primary-scoreable ∧ accepted ∧ **a same-fine-category corrupted negative
  exists** in that friend's closet (≥ 1 clothingType in the outfit with ≥ 2 items of that type in the
  friend's rendered-item set; H26 skipped 25/39 pairs for lack of one).

**Lineage dedup (frozen):** scoreable counts **dedup by item-set signature within {friend, arm}**, so
re-rolled near-identical outfits (correlated children of one `parentSnapshotId`) do not inflate N. A
signature appearing in both arms is legitimate (genuine ambivalence) and kept once per arm.

**Author exclusion:** the operator's own closet (Brian-as-friend-#0, identified by the known
operator Firebase authId) is **excluded from the headline pool** and reported separately — a self-
labeled arm is a real bite of a 3–5-person sample.

The export (`exportTrack2Core.cjs` `buildCertificate`) computes these counts and emits the
`primaryRead`/`transferRead` state per the frozen floors. It **certifies the sample; it never scores
it.**

---

## 6. The frozen measurand (the scorer pipeline — freeze the score, not just the statistics)

A statistical freeze downstream of an unfrozen score is theater. Pinned before any label look:

- **Scorer (headline):** the **H26 trained pairwise type-conditioned edge head** — the committed
  artifact `experiments/h26/selection.json` checkpoint `grid_0` (sha `a172be27…`), 795,617 params,
  scored exactly as H26 froze it (`preregistration.md` §C.1).
- **Backbone / embedding:** Marqo-FashionSigLIP, `open_clip` `hf-hub:Marqo/marqo-fashionSigLIP`,
  **revision `c56244cc94f92419e8369fa71efdaf403b124ce8`**, L2-normalized image embeddings, dim 768,
  preprocess sha256 `fb80278db5fd5efcddc5a736a9095f34ed28da48e270cce5e12df162248404f6` (H26 §D).
- **Outfit aggregation:** **mean over the C(n,2) type-conditioned edges** (H26 headline; not min, not
  max — those give different AUCs).
- **Tie handling:** AUC ties score **0.5** (Mann-Whitney; H26 §A).
- **EXIF (mandatory — §23-H53):** call `ImageOps.exif_transpose` (or equivalent) before embedding —
  the Track-2 corpus is orientation-mixed, and un-transposed phone photos roughly halve the signal
  (H26 §6, the 0.4375 → 0.5625 bug). A regression fixture on an orientation-6 image is required.
- **Image-resolution failure:** an outfit with any unresolved image is not scoreable (§5) — it is
  excluded, never scored on a partial item set.
- **Reference rung (reported, not the headline):** zero-shot FashionSigLIP cosine, same embeddings —
  H26's deployable fallback; report its primary/secondary reads alongside so the trained head's
  marginal lift on real closets is visible.

---

## 7. Statistics freeze

- **Pooled ROC-AUC**, never per-outfit-averaged.
- **Cluster bootstrap, percentile, B = 10,000** (matching H26 §H).
- **Primary bootstrap unit:** the **snapshot, blocked within friend** — resample each friend's
  snapshots with replacement (keeping the friend's snapshot count fixed), carry all labeled
  candidates of the resampled snapshots, recompute the pooled within-user AUC. This propagates within-
  snapshot and within-friend correlation. The 3–5 friends are **not** resampled (too few to
  bootstrap) — hence the cohort-conditional claim (§2.1).
- **Secondary bootstrap unit:** the **source outfit** (H26's transfer unit exactly).
- **CI level:** primary looks read the **97.5% two-sided** percentile CI (Bonferroni over 2 looks,
  §2.1); the secondary reads the standard **95%** CI.
- **Concentration cap (frozen):** a decided primary arm may not be **> 50%** one friend
  (`perFriendConcentrationCap = 0.5`). A single-friend "cohort" fails this by construction — the read
  stays UNDERPOWERED until ≥ 2 friends share each arm within the cap.
- **Leave-one-friend-out sensitivity (frozen):** recompute the pooled verdict dropping the largest-n
  friend; if that flips the verdict across 0.50, **downgrade ESTABLISHED → "suggestive"** (never the
  reverse). Pre-empts the "one prolific friend carried it" re-analysis.
- **Per-friend reporting (frozen):** report every friend's arm counts + own AUC, so a high-accept
  friend's near-empty rejected arm is **visibly** a pooled claim, not hidden.

---

## 8. Freeze mechanics

- **SHA-bound at the freeze commit:** this file, `preregistration.json`, and the export `CERTIFICATE`
  block (pinned equal by `tests/test_preregistration.py`), plus the re-derivation `derive_power.py`
  and its `power_derivation.json`.
- **Inherited from H26 (already sha-bound there):** the scorer checkpoint, backbone revision,
  preprocess hash, aggregation, tie policy (§6) — this file references them; it does not re-freeze
  them.
- **At analysis time:** the analyst records `analysis_sample.json` (the frozen snapshot-ID set at
  Look 1's trigger), the look number, and both looks' CIs — no metric is written before its look's
  trigger fires.
- **Optional-stopping disclosure:** exactly two looks (§2.1), α split Bonferroni, horizon-terminal
  (§2). No third look, no δ-widening, no boundary reinterpretation.
- **Pre-freeze rows disclosure:** any friend rows in the DB at freeze time were never inspected (§0).

---

## 9. The re-derived power arithmetic (owned this session; reproducible via `derive_power.py`)

Hanley & McNeil (1982) large-sample AUC SE, balanced n_pos = n_neg = N,
Q1 = A/(2−A), Q2 = 2A²/(1+A); 95% half-width = 1.96·SE. (The audit's ±0.09–0.13 numbers were
directional; these are re-derived from scratch. A real cluster bootstrap reads **at least** this
wide — clustering only inflates SE — so Hanley-McNeil is the *optimistic* precision bound, the honest
direction for a "can this even decide?" argument.)

### 9.1 Half-width table (95% CI, balanced)
| AUC \ N | 12 | 20 | 25 | 30 | 40 | 60 | 120 |
|---|---|---|---|---|---|---|---|
| 0.60 | 0.230 | 0.177 | 0.158 | 0.144 | 0.124 | 0.101 | 0.071 |
| 0.65 | 0.223 | 0.171 | 0.153 | 0.139 | 0.120 | 0.098 | 0.069 |
| 0.70 | 0.213 | 0.163 | 0.146 | 0.133 | 0.115 | 0.093 | 0.066 |

At AUC 0.70: **0.133 / 0.115 / 0.093 at N = 30 / 40 / 60** — confirms the audit's directional band.

### 9.2 Why the inherited `CI_low(AUC_closet) ≥ 0.70` floor is STRUCTURALLY unpassable
Passing needs point ≥ 0.70 + half_width. Against the catalog ceiling **0.7315** (a domain-shifted
closet cannot beat the in-domain catalog):

| N | half-width @0.70 | required point to pass | vs catalog ceiling 0.7315 |
|---|---|---|---|
| 30 | 0.133 | **0.833** | exceeds → unpassable |
| 60 | 0.093 | **0.793** | exceeds → unpassable |
| 120 | 0.066 | **0.766** | exceeds → unpassable |

The pass bar sits above the theoretical best case at **every** reachable N (still 0.766 at N = 120).
The floor cannot pass; reading it as a gate guarantees a NO-GO regardless of the data.

### 9.3 Why the inherited `CI_high(drop) ≤ 0.12` read fails even at a PERFECT transfer
drop = AUC_catalog − AUC_closet, two independent bootstraps; the catalog term is powered (half-width
≈ 0.003), so half-width(drop) ≈ half-width(closet). At **true drop 0**: CI_high = 0 + half-width(drop)
> 0.12 for **all N ≤ 30** (impossible), and passes only **~54%** of the time at N = 40 (drop_point
scatter). A perfect transfer fails the ≤ 0.12 read outright below N = 40.

### 9.4 The replacement is decidable at achievable N (conditional on a moderate effect)
Minimum balanced-N per arm for `CI_low(AUC) > 0.50` (idealized point = true AUC):

| true AUC | 0.70 | 0.65 | 0.62 | 0.60 | 0.58 | 0.55 |
|---|---|---|---|---|---|---|
| min N/arm | 14 | 26 | 42 | 62 | 98 | 254 |

At the cohort-achievable ~25–35/arm the chance boundary is decidable **iff** the true effect is
moderate (AUC ≳ 0.63). A weak effect (≤ 0.58) yields NOT-ESTABLISHED/UNDERPOWERED at cohort N — an
**honest decision**, not a threshold accident. (This table is the 95% planning bound; the operating
looks read the **97.5%** Bonferroni CI (§2.1), which is stricter — so at 25/arm ESTABLISHED requires
an observed AUC a little above the 0.65 knife-edge, ~0.67+; the ≥ 0.60 point floor never binds before
the CI does at 25/arm. The 25/arm floor thus already encodes an implicit moderate-effect demand.) This is the honest limit of the design, stated up
front: it is decidable *conditional on the prior actually working*; a prior that barely beats chance
is, correctly, not certifiable on a friend cohort.

### 9.5 Adversarial self-check — does the rule DECIDE at pessimistic yield (N ≈ 15/arm)?
Yes. At 15/arm the sample never reaches the 25/arm Look-1 trigger, so at the horizon the verdict is
**UNDERPOWERED-TERMINAL** (§2.1) — a pre-registered terminal state meaning "this cohort could not
power the question," with named next levers. It is **not** H26's open-ended "inconclusive": H26's
limbo was a gate *failure* with no path; here the terminal verdict names the path (recruit more / the
gate-B lever) and the decision reads (ESTABLISHED / NOT-ESTABLISHED) are reachable because the
boundary is 0.50, not the unpassable 0.70. Every branch terminates.

---

## 10. Yield model + provenance

**Provenance (freeze honesty):** the yield figures below were derived from the app's design and the
H26 attrition rate, plus **row-volume counts only** from the live DB — no `action`/`feedback`/label
field was ever read, and no compatibility score was computed.

Per friend (~15 items, a few weeks): **~8–15 image-usable accepted outfits**; cohort-wide **~30–60**.
After the §5 scoreability attrition (≥ 2 items, images resolved, signature-dedup — H26 lost ~70% of
worn outfits to scoreable clusters, though a category-deeper closet than H26's menswear-summer one
loses less): **~18–35 scoreable accepted clusters cohort-wide**, plus a comparable **rejected** arm
(dislikes are onboarded as a habit — runbook §8). The primary read's 25/arm Look-1 floor is thus
reachable by a healthy 3–5 friend cohort and out of reach for a thin one — which is exactly the
signal the "recruit more" lever responds to.

---

## 11. What M6 inherits

- **A decidable transfer verdict**, terminal in every branch (ESTABLISHED / NOT-ESTABLISHED /
  UNDERPOWERED-TERMINAL), replacing H26's structurally-undecidable band.
- **The M6 re-measure entry condition is satisfied iff the primary read returns ESTABLISHED.** A
  NOT-ESTABLISHED (well-powered or underpowered) is a real decision that M6-on-this-basis does not
  open; the named levers (recruit / gate-B extension / re-train) carry forward.
- **The frozen measurand** (§6) is reusable as-is; the export certificate (§5) is the live
  decidability watch.
- **The H26 gate-B power extension** (`results.md` §10) remains an **independent** M6 lever — this
  transfer read does not subsume it.

---

*Frozen artifacts committed with this file (the freeze set): `preregistration.json`,
`derive_power.py`, `power_derivation.json`. The export mirror
`fitted/scripts/exportTrack2Core.cjs` `CERTIFICATE` is pinned equal by
`tests/test_preregistration.py`. `analysis_sample.json` is written later, at Look 1's trigger — not
at this freeze commit.*
