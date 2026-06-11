# Fitted v1.2 — Spec Resolutions & Component Interactions

Canonical companion to `docs/Fitted_Refactor_v1.2_Spec.pdf`. The PDF is the target
architecture, but it has internal ambiguities and a few self-contradictions. **This doc
resolves them authoritatively.** Precedence: where the PDF is unambiguous, the PDF governs;
**where the PDF is silent, self-contradictory, or defines a term two ways, this doc wins.**
The PDF is not edited; this is the overlay.

**Provenance.** Resolutions below come from (a) an internal-consistency review of the PDF,
(b) a Fable design consult, and (c) Brian's decisions on 2026-06-09 (session 2). Each entry
cites the spec section it resolves and the milestone that implements it. See also
`CLAUDE.md` → *Canonical sources* and `docs/plans/m0-m1-substrate.md`.

---

## 1. Canonical pipeline order (the interaction backbone)

The spec's §9 pipeline omits where the §11.4 repetition penalty runs (finding S3). This is the
single authoritative ordering; every scoring/diversity mechanism declares its slot here. New
mechanisms must state which step they belong to before being added.

| # | Step | Produces / does | Milestone |
|---|------|-----------------|-----------|
| 1 | **Pool prep** | Partition by type, caps, 70/30 sampling, derive session seed | M1 |
| 2 | **GPT generation** | Candidate outfits as role-tagged item lists (strict JSON) | M2 |
| 3 | **Normalize + validate** | Raw → SlotMap; structural validation (§13); compute BaseKey + FullSignature; drop exact FullSignature duplicates within the pass | M0 / M2 |
| 4 | **Cooldown filter** | Drop candidates whose **BaseKey** is in the dislike cooldown buffer | M3 |
| 5 | **Scoring** | `+1.0 base + comboBoost + itemBoost − dislikePenalty` (see R2) | M3 |
| 6 | **Ranking & diversity** | BaseKey variant cap → overuse penalty → **repetition-window penalty (FullSignature)** → fallback ladder if < K → sort by score → tie-break (see R1, R3) | M3 |
| 7 | **Response** | Return outfits[] + scoreBreakdown; cache (see R1); async log | M5 |

The repetition-window penalty (§11.4) slots into Step 6 **after the overuse penalty and before
the fallback ladder**, per appendix A1's stated intent. *(Resolves S3.)*

---

## 2. Resolved design decisions

### R1 — One seed primitive, two wrappers *(resolves H1; spec §3.3, §10.4, §14)*

**Ambiguity.** §3.3 session seed = `hash(sessionId + wardrobeVersion + occasion + weather)`
(4 inputs); §10.4 tie-break seed = same `+ generationIndex` (5 inputs). Both named `seed`.

**Decision.** One **private** canonical primitive; two thin named wrappers delegate to it, so
the two seeds cannot drift and "tie-break = session hash + one extra input" is true by
construction.

```
canonical input order: sessionId, wardrobeVersion, occasion, weather, date, generationIndex

_canonical_seed(...)        # private: length-prefix each field (see encoding note below), sha256, first 8 bytes → int
session_seed(...)           # wrapper: passes date, NO generationIndex
tiebreak_seed(..., gi)      # wrapper: session inputs + generationIndex
```

- `date` is `None` until C1 (daily re-seed) is activated at M5.

**Canonical-string encoding — length-prefix, not a bare delimiter** *(supersedes the earlier
`"\x1f"`-join rule; resolves a runtime-collision bug).* A plain `"\x1f".join(...)` does **not**
prevent field-collision: `join(["a", "b\x1fc"]) == join(["a\x1fb", "c"]) == "a\x1fb\x1fc"`, so
two distinct input tuples hash to the same seed. Since `occasion` is free text and an anonymous
`sessionId` can be a client-supplied cookie, the join char *can* appear in a field. Encode each
field **length-prefixed** before joining: `"".join(f"{len(s)}:{s}" for s in fields)` (or an
equivalent unambiguous framing). This is collision-free for arbitrary field content.
- **`None` sentinel:** `date=None` serializes **distinctly from `0`, from `"None"`, and from
  absence** — use a typed marker that no real field can produce (e.g. the framing `-:` with no
  value, distinct from `4:None`). The naive `str(None) == "None"` collides with `date="None"`,
  and omitting the field entirely lands the `date` slot at the `generationIndex` position —
  reintroducing exactly the session/tie-break drift this resolution prevents.
- Use `sha256`, never Python's process-salted `hash()`.

**Cache-key invariant** *(new, from Fable — resolves the §14 gap):* the cache key uses
**exactly the `session_seed` inputs, including `date` when daily re-seed is active.** Rule:
`cache_key inputs ≡ session_seed inputs, always`. If `date` fed the seed but not the cache
key, a cache hit would return yesterday's outfits and the daily re-seed would silently never
fire. This also keeps dislike/edit cache invalidation (appendix A4, M5) coherent — anything
that should change results must change a seed/cache input.

**Regenerate vs the cache — two-stage caching** *(new — resolves a fan-out that would make
re-roll a no-op).* `generationIndex` is the only input that distinguishes a re-roll, and the
invariant above deliberately bars it from `session_seed` / the cache key. If the cache stored
the **final response**, a `/api/recommend/regenerate` hit with the same
session/occasion/weather/date would return the byte-identical outfits the user just rejected —
and pre-M6, when scoring is all `+1.0` base (no boosts until M4), `tiebreak_seed(generationIndex)`
is the *sole* source of result variety, so this is total. **Decision:** the cache stores the
**expensive upstream stage** (sampled pool + GPT candidates) keyed on `session_seed` inputs;
**Step 6 ranking runs per-request** over the cached candidates with `tiebreak_seed(...,
generationIndex)`. Re-roll reuses the cached candidates but re-ranks with a new
`generationIndex`, so it is cheap *and* genuinely different. *(M5 wires this; recorded now so
the cache shape is decided before the seed lands.)*

**Implements:** M0-5 (primitive + wrappers, length-prefix encoding, None sentinel); tie-break
wrapper used at M3; cache key + two-stage caching at M5.

### R2 — comboBoost and itemBoost stack *(resolves S2; spec §10.1, §4.4)*

**Mechanism.** `comboBoost (+2.0)` rewards a re-surfaced outfit whose **FullSignature** was
previously liked (outfit-level memory). `itemBoost (+0.1 × affinityScore per item)` rewards
outfits built from individually-favored items (item-level; `affinityScore` capped at
`MAX_AFFINITY = 20`). One like feeds both (records the FullSignature **and** +1 to each item's
affinity).

**Decision.** **Stack** — both fire on a re-liked outfit. They encode different evidence (the
look vs the pieces); stacking gives the intended ordering (an exact liked look beats a novel
remix of the same items). Keep the spec's weights for v1.

**Affinity is non-negative** *(resolves the dislike↔affinity interaction):* a dislike does
**not** decrement `affinityScore` (§4.4: "no negative affinity"). The negative side is handled
by `dislikePenalty` (Step 5) and the cooldown buffer (Step 4), so the two memories never
contradict.

**Known risk — itemBoost magnitude (deferred to eval, NOT resolved by tuning now)** *(new,
from Fable):* at the cap, a 4-item outfit's itemBoost ≈ `0.1 × 20 × 4 = +8`, which dwarfs
comboBoost (+2) and base (+1) — so for a heavy user a novel mashup of four max-affinity items
can outrank an exact previously-loved outfit, making comboBoost nearly decorative (plus a
rich-get-richer loop). Per the spec's "scalable in design, not prematurely optimised" stance,
**keep weights as-is for v1** and **measure this in the offline eval (NDCG@k, M3/M6)**.
Pre-identified levers if the data shows comboBoost drowning: lower `MAX_AFFINITY`, sublinear
affinity (log/sqrt), or per-item averaging instead of summing.

**Implements:** M3 (scoring); affinity rule at M4 (persistence); magnitude check at M3/M6 eval.

### R3 — Fallback "prefer diversity" is a tie-break-only preference *(resolves H5; spec §12)*

**Ambiguity.** Fallback Step 3 removes the BaseKey variant cap (the silhouette-diversity
mechanism); Step 4 then says "prefer silhouette diversity (mix dress + two-piece)" with no
mechanism left to do it.

**Decision.** Operationalize it as a **tie-break-only preference**: among score-tied fallback
candidates, prefer the silhouette **least represented in the result so far**, then apply the
seeded shuffle (`tiebreak_seed`). It **reorders, never excludes**, so it cannot re-starve the
fill — unlike a soft re-weight, which in a scarce wardrobe would penalize most of the remaining
candidates and quietly re-impose the cap Step 3 just removed.

- **Determinism** *(from Fable):* the precedence is *(1) least-represented silhouette so far,
  then (2) seeded shuffle within that tie* — stated explicitly so two implementers can't order
  it differently and break reproducibility.
- This may **degenerate to a no-op** if exact score ties are rare. That's acceptable; in the
  fallback regime late candidates often share identical scores (base + same relaxation penalty,
  no boosts), so ties are plausibly common exactly where this applies.

**Implements:** M3 (fallback ladder + tie-break).

### R4 — Determinism requires canonical input ordering, not just a stable seed *(new; resolves a fan-out)*

**Problem.** The §3.1 stability promise rests on the seeded RNG, but `random.sample(items, k)`
is deterministic only for a fixed seed **and a fixed input ordering** — same seed + reordered
list → different sample. Crucially, until M4 produces interaction data `interaction_count` is
always `0`, so **100% of traffic rides the cold-start 100%-random branch for the entire M1→M6
lifespan** — the seeded `sample` *is* the product. At M5 the wardrobe arrives from an unsorted
Mongo `find`, whose order is not guaranteed, so the same seed yields different outfits across
renders with nothing failing.

**Decision.** Determinism is a **contract on input ordering**, owned by the sampler:
1. Sort each per-type candidate list by `item.id` before any RNG draw.
2. Iterate types in a fixed order (the `ItemType` enum order), and use **one shared
   `random.Random`** built from `session_seed` (decided once, not per-type, so RNG-consumption
   order is fixed).
3. Test the guarantee with a **permuted-input** case: same seed + shuffled input wardrobe →
   identical output. (The in-memory-fixture determinism test alone cannot catch the break.)

**Implements:** M1-1 (partition ordering), M1-3 (sort-before-sample, shared RNG), M1 tests.

### R5 — Seed inputs must be canonical buckets, especially `weather` *(new; resolves a fan-out)*

**Problem.** `RequestContext.weather` is typed as a free `str` and is a `session_seed` input.
If M5 passes live weather text (`"72°F partly cloudy"` → `"71°F …"` minutes later), the seed
changes on every render → §3.1 stability and the cache hit-rate both collapse, with no error —
it just looks like "the seed isn't working." The deployed app already buckets to a small
`temperatureHint` set.

**Decision.** Every `session_seed` input must be **stable by contract**. `weather` (and
`occasion`) entering the seed must be a **canonical bucket from a small closed set**, not raw
sensor/free text; the raw-→-bucket normalization is owned by the **M5 request adapter**, not the
sampler. M0/M1 take the already-canonical value as a parameter.

**Implements:** contract noted in M1-3 `RequestContext`; normalization at M5.

### R6 — The 70/30 split is a sampler-owned helper, not a config constant *(new; M0-1 verification, Fable-reviewed 2026-06-10)*

**Problem.** `config.py` shipped `RANDOM_FRACTION = 0.7` (a float). The resolved split arithmetic
(plan M1-3, confirmation #4 — see also R4) is **integer, half-up, float-free**:
`random = (cap*7 + 5) // 10`, signal = remainder. That formula never references `RANDOM_FRACTION`,
so the float is dead — and a trap: `round(cap * RANDOM_FRACTION)` reintroduces the banker's-rounding
bug M1-3#4 removed (`round(35*0.7)=24` but `round(25*0.7)=18` — splits the real caps in opposite
directions; any TS/numpy reimpl that rounds halves up disagrees with prod). The cold-start branch
is the *only* path prod runs pre-M6, so the split must port bit-identically (R4).

**Decision (Fable, helper-only).** The split's contract is *behavior*, not a value. Expose **one
helper, owned by the sampler module (M1-3), not config.py**:

```python
def random_count(cap: int) -> int:
    """70/30 split per type (spec §7.3). Integer half-up — NOT round() (banker's rounding
    splits the real caps inconsistently; see R6/R4). Must port bit-identically to any reimpl."""
    return (cap * 7 + 5) // 10
```

`signal_count = cap - random_count(cap)`. `7`/`10` stay **local** to the helper.

- **No `RANDOM_NUMERATOR`/`DENOMINATOR` constants.** Exposing them adds no protection — a call
  site could write `round(cap * NUM / DEN)` and reintroduce the bug — and recreates the
  dual-source "logs lie" trap that killed `RANDOM_FRACTION`. The helper is the single legal path.
- **§18 does not apply.** §18 ("named constants in one config file") governs *tunable* knobs
  (`comboBoost`, penalties, `MAX_AFFINITY`). The 70/30 split is a **structural constant** — welded
  into §7.3 and the bit-identical-port contract; changing it changes the algorithm. §18's real
  intent (no scattered magic numbers, one findable home) is met by one occurrence in one
  documented function.
- **Placement.** `config.py`'s docstring promises "no logic," so the helper does not live there.
  The drift guard is the **value table over the real caps** (35→25, 30→21, 25→18, 20→14), which
  pins behavior better than any named constant.

**Implements (config deletion PENDING Brian's go):** delete `RANDOM_FRACTION = 0.7` from
`config.py` (add no replacement; optional one-line pointer near the caps: split math is the
sampler's `random_count`, §7.3); drop the `RANDOM_FRACTION == 0.7` assert from `test_config.py`;
M1-3 ships `random_count` + the value-table test. (Supersedes the earlier numerator/denominator
draft of this resolution.)

---

## 3. Resolved consistency findings (no design fork — recorded for implementers)

| ID | Finding | Resolution | Spec refs |
|----|---------|------------|-----------|
| **S4** | `scoreBreakdown.dislikePenalty` shown as a positive magnitude, but formula subtracts it | Store `dislikePenalty` as a **positive number**; the formula applies `− dislikePenalty`. (Same for `relaxedCooldown` COOLDOWN_PENALTY = −2.0, which is stored negative and added.) | §4.2, §10.1 |
| **S5** | Cold-start trigger: body says "zero interactions," appendix B2 says "< MIN_SIGNAL_THRESHOLD" | Adopt **B2**: cold-start (100% random) when `interaction_count < MIN_SIGNAL_THRESHOLD = 5`; log `coldStartSampling = true` whenever below threshold, not only at zero. *(Already in M1-3.)* | §7.3, §19, B2 |
| **N1/cache** | Session seed and cache key share the same 4 inputs but are conceptually distinct | See R1: cache-key inputs ≡ session-seed inputs, by rule. They may share the primitive. | §3.3, §14 |
| **N2/C1** | Appendix C1 daily re-seed (`+ date`) contradicts §3.1 "stable indefinitely" | Adopt **C1**: results refresh daily for authenticated users; "stable indefinitely" is superseded. `date` flows through `session_seed` *and* the cache key (R1). Activated at M5. *(Already in M0-5 as the `date` param.)* | §3.1, §3.3, C1 |
| **N3** | §6.3 invalid-SlotMap list vs §13 validation list overlap, §13 adds two rules | **§13 is the authoritative validation superset.** §6.3 is the normalization-time subset; the full reject set is §13 (adds "itemId not in sampled pool," "wrong base count for templateType"). | §6.3, §13 |
| **N4** | `relaxedCooldown` (per-outfit bool) vs `relaxedCooldownCount` (per-request) | No conflict — per-outfit boolean and per-request aggregate. Both kept as defined. | §4.2, §15 |

---

## 4. Open items deferred to their milestone (recorded, not resolved here)

- **itemBoost magnitude calibration** → measure in offline eval (M3/M6); levers listed in R2.
- **Appendix pre-deployment items** A4 (dislike invalidates cache), B1 (`OVERUSE_MIN_POOL`),
  A3 (`MAX_AFFINITY` cap — adopted as a constant, behavior at M3), D1 (log token usage), D2
  (rate limiting), D3 (strip `warmth` from the GPT payload) → handled at the milestone that
  owns each (mostly M3/M5). Tracked in `docs/plans/m0-m1-substrate.md` §6 and the spec
  appendix; not re-litigated here.
- **Data-model migrations** (`ItemAffinity`, `wardrobeVersion`, `sessionId`, `clothingType→type`)
  → M4/M5, per `m0-m1-substrate.md` §6.
  - **`clothingType→type` is a *consolidation*, not an addition.** The deployed app already
    supports dresses/jumpsuits — just not via the `clothingType` enum (`WardrobeItem.ts:7` is
    `["top","bottom"]`). One-piece classification is **string-matched at request time** over
    `category`/`name`/`subCategory` (`route.ts:241,550`: `["dress","jumpsuit","romper"].some(...)`),
    with first-class one-piece rules in the GPT prompt (`route.ts:445–464`) and structural
    validation (`route.ts:638` rejects one-piece + separate top/bottom). Commit
    `6b7e326e "changing cv to include dresses"` added this (CS 148 week 8). So M4/M5 must
    **promote the de-facto dress/outer/shoes classification to first-class `clothingType`
    values + backfill existing rows**, then map `WardrobeItemDocument → fitted_core.WardrobeItem`
    — replacing the scattered string-greps, not adding a new capability. Prime candidate for the
    deletion license (CLAUDE.md → *Deletion license*): the runtime string-match path does not
    survive the M5 cutover.

---

## 5. What this changes for M0/M1 (the chunk being built next)

**R1, R4, R5 touch M0/M1 directly:**
- **R1** — M0-5 builds the **private `_canonical_seed` primitive + the `session_seed` /
  `tiebreak_seed` wrappers** (not a single flat function), now with **length-prefix encoding**
  (the bare `"\x1f"` join was collision-prone) and a **typed `None` sentinel** for `date`. The
  cache-key invariant + **two-stage caching** (so regenerate isn't a no-op) are recorded for M5.
- **R4** — M1 must **sort per-type lists by id, fix type-iteration order, and share one RNG**;
  add a permuted-input determinism test. This protects the *only* branch prod runs pre-M6.
- **R5** — `RequestContext.weather`/`occasion` entering the seed are **canonical buckets**, not
  raw text; bucketing is M5's adapter, M0/M1 take the canonical value.

R2 and R3 are M3 concerns — recorded now so M3's plan inherits settled decisions rather than
re-opening them. The §1 pipeline order is the reference M2/M3 build against.
