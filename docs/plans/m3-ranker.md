# M3: Ranker (cooldown · scoring · variant cap · overuse · repetition · fallback · regen controls)

> **`[NOW]` — drafted 2026-06-20.** Implementation roadmap for pipeline **Steps 4–6** (§9, detailed in §14).
> Built from the frozen decision ledger `docs/sessions/2026-06-20-m3-ledger.md` (two spec-readiness passes:
> Q1–Q4, N1–N16, naming). **Treat the ledger's Q/N rows as locked**; this plan turns them into an
> unambiguous build order. **`docs/Fitted_Spec_v2.md` is canonical and wins on any conflict**; this doc is
> implementation guidance, not product truth.
>
> Plan doc only — **no code or tests are written here.** The one spec change this change-set carries is the
> two new constants (`OVERUSE_PENALTY=0.5`, `REPETITION_PENALTY=1.0`) added to `Fitted_Spec_v2.md` §14 +
> Appendix B (single-home: this plan points to them, never restates the values).

---

## Goal

Turn M2's `list[ValidatedCandidate]` into the final ranked `outfits[]` (≤ K): apply per-request hard filters
(cooldown / contextual dislike / lock), score with the humble additive behavioral layer, enforce diversity
(variant cap → overuse → repetition), walk the fallback ladder when short of K, and tie-break
deterministically — emitting a per-outfit signed `ScoreBreakdown` and the state flags M5 needs. Pure
substrate: **no DB, no GPT, no IO, no candidate creation.** M3 only drops and reorders.

## Success criteria (verifiable)

- `pytest -q` green for a new `ml-system/tests/test_ranker.py`; full suite still passes (M0–M2 untouched).
- A public `rank(candidates, context) -> RankerResult` exists; `len(result.outfits) ≤ context.k`, and
  survivors are sorted by final score with the §14 deterministic tie-break.
- **Determinism:** identical inputs → identical output; a permuted `candidates` input → identical output
  (permutation-invariance); only `generation_index` changes the tie-break ordering of equal-score outfits.
- **Breakdown integrity (N4):** for every emitted outfit, `outfit.score == sum(signed deltas in breakdown)`
  — asserted as a property test across cases.
- **Dominance (§5):** each scoring term has a breakdown entry **and** a test proving it cannot dominate when
  it should not — with the one documented exception (4-item `itemBoost ≈ +8` can exceed `comboBoost +2`,
  §11), pinned as a visible eval-tracked case, not hidden.
- The mutation-hardening list in §12 each has a test that **fails** the naive mutant.
- `OVERUSE_PENALTY=0.5` and `REPETITION_PENALTY=1.0` appear in `Fitted_Spec_v2.md` §14 + Appendix B and in
  `config.py`; the other 10 M3 constants carry their existing Appendix B values.

---

## 1. Status & scope

**M3 owns** pipeline **Steps 4–6** (§9 `:337-339`), detailed in **§14** (`:520-548`):

- **Step 4 — cooldown / per-request filters:** drop candidates whose **BaseKey** is in the dislike cooldown
  buffer; apply regen **locks** + **contextual dislikes**; emit the lock-starvation diagnostic (N3).
- **Step 5 — scoring:** `score = BASE_SCORE + behavioralSignal − dislikePenalty`, additive humble layer (R2).
- **Step 6 — ranking & diversity:** BaseKey variant cap → overuse penalty → repetition-window penalty →
  fallback ladder if < K → sort by score → tie-break.

**Inputs.** `rank` consumes `list[ValidatedCandidate]` from M2 (`validator.py:74-91`: `source_index`,
`slot_map`, `template`, `base_key`, `full_signature`, `style_move`) plus a `RankerContext` of **pre-reduced
signals** (Q4 / H19): never raw `OutfitInteraction` rows. M3 does membership/flat math over already-windowed
collections (N14).

**Home:** purely additive. New `ml-system/fitted_core/ranker.py` + `ml-system/tests/test_ranker.py`;
12 constants into `ml-system/fitted_core/config.py`; the two new constants into `Fitted_Spec_v2.md`
§14 + Appendix B. No `models.py` change (see §4 *Module placement*). No DB, no OpenAI, no service wiring.

**M3 does NOT own** (ledger §7 — guard against creep): GPT/parse/JSON-repair (M2/M5); relaxing M2 validation
(validation never relaxes, even under fallback — §13); candidate creation (M3 only drops/reorders);
`optionPath`/`risk`/graph-role/rescue path-risk metrics (M5/rescue-spec, H20); learned-scorer/graph behavior
(M6); DB/cache/`generationIndex` lifecycle/`GenerationSnapshot` (M4/M5, H7); the request adapter /
normalization / API lifecycle (M5); UI; legacy `route.ts` / `outfit_recommender.py` deletion (license
activates M5/M6). Shown-history and affinity **storage** stay out (H19/M4) — M3 takes them as inputs.

---

## 2. Canonical references (read these; do not restate them)

| Spec section | What M3 needs from it |
|---|---|
| **§9** `:331-343` | Pipeline order — Step 4 (cooldown/filters), Step 5 (scoring), Step 6 (ranking/diversity). M5 owns Step 0/7 and the regen Steps-1–3 re-entry. |
| **§14** `:520-548` | The full M3 contract: cooldown buffer, score formula, diversity order, fallback ladder, tie-break, regen controls (R9). |
| **§11** `:420-425` | The humble additive mechanism: `itemBoost (+0.1 × affinity, cap 20)`, `comboBoost (+2.0 on re-liked FullSignature)`; the known 4-item itemBoost > comboBoost risk (eval-tracked, not tuned blind). |
| **§7** `:283-287` | **BaseKey** (core silhouette) = cooldown + variant-cap + tie-break diversity key; **FullSignature** = repetition / comboBoost key. Never conflate. |
| **§15** `:555-572` | `tiebreak_seed(…, generationIndex)`; `generationIndex` is the sole re-roll input; the seed/cache contract M3's tie-break rides on. |
| **§5** `:39-40` | "Every ranking term has a score-breakdown entry and a test proving it cannot dominate when it should not." The `ScoreBreakdown` + dominance-test mandate. |
| **§20** `:727` | Ladder — M3 = ranker; confirms the boundary M3 must not cross. |
| **§23 H7/H19/H20** | H7: `generationIndex` lifecycle is M5's (M3 *requires* it, no default). H19: shown-history is a pure input (no M3 storage). H20: path/risk/score are Python-only, assigned at M5 response, not M3. |
| **Appendix B** `:842-851` | Constant home. 10 of M3's 12 constants already live here; this change-set adds the 2 new ones. |

Existing substrate M3 builds on: `models.{SlotMap, Template, StyleMove, WardrobeItem}`,
`validator.ValidatedCandidate`, `seed.tiebreak_seed`, `seed.seeded_rng`, `config.*`. Package error-model
convention (`__init__.py`): **expected data failures → return value; caller-contract violations → raise.**
M3 follows it (N14 oversize-window guard raises; empty input returns — N15).

---

## 3. Public API decision

Pin the surface narrow (mirrors M2 Decision D1). **One public function** plus the result/context types callers
must name:

```python
def rank(candidates: Sequence[ValidatedCandidate], context: RankerContext) -> RankerResult:
    """Steps 4–6 over M2-validated candidates. Pure: no DB, no GPT, no IO.
    Returns ≤ context.k ranked outfits + per-outfit ScoreBreakdown + the state flags
    M5 needs (fallback stage, insufficient-wardrobe, lock-starvation diagnostic).
    Never creates a candidate; never relaxes M2 validation."""
```

Public = `rank`, `RankerContext`, `RankerResult`, `RankedOutfit`, `ScoreBreakdown`, `FallbackStage`.
**Everything else is `_private`** (`_apply_cooldown`, `_score`, `_variant_cap`, `_overuse_set`,
`_repetition_penalty`, `_fallback_ladder`, `_tiebreak`, …). No convenience wrapper until a concrete M5 caller
proves it necessary.

---

## 4. Result / context model (N4, N7, N9, N11, N16)

```python
# --- all in ranker.py (M3-local result plumbing; see Module placement below) ---

class FallbackStage(Enum):                  # the deepest relaxation rung reached (N11)
    none             = "none"
    overuse_relaxed  = "overuseRelaxed"
    variant_cap_relaxed = "variantCapRelaxed"
    cooldown_relaxed = "cooldownRelaxed"
    insufficient     = "insufficient"

@dataclass(frozen=True)
class ScoreBreakdown:                        # signed deltas, summing to `score` (N4)
    base: float                              # +BASE_SCORE
    combo: float                             # +COMBO_BOOST or 0
    item: float                              # +Σ itemBoost (clamped, N10)
    dislike: float                           # −dislikePenalty (signed, N4)
    overuse: float                           # −overusePenalty (signed)
    repetition: float                        # −repetitionPenalty (signed)
    cooldown: float                          # = COOLDOWN_PENALTY (−2.0, already signed) when cooldown-relaxed, else 0

@dataclass(frozen=True)
class RankedOutfit:
    source_index: int                        # carried from ValidatedCandidate (NOT a tiebreak — N6)
    slot_map: SlotMap
    template: Template
    base_key: str
    full_signature: str
    style_move: Optional[StyleMove]
    score: float                             # final ranking score (== sum of breakdown deltas)
    breakdown: ScoreBreakdown
    relaxed_cooldown: bool                   # this outfit re-admitted via cooldown relax (N11, §14)

@dataclass(frozen=True)
class RankerResult:
    outfits: list[RankedOutfit]              # ≤ k, final order
    fallback_stage: FallbackStage            # deepest rung reached (N11)
    insufficient_wardrobe: bool              # final count < k, incl. 0 (N11/N15)
    relaxed_cooldown_count: int              # per-request aggregate (N4/N11 — distinct from per-outfit bool)
    locked_survivor_count: int               # candidates surviving the lock filter (N3)
    insufficient_locked_candidates: bool     # locks requested AND survivor count < k (N3)
```

`RankerContext` carries the seed fields, the required `generation_index`, `k`, and the **pre-reduced**
signal inputs (ledger §5 naming). Use `@dataclass(kw_only=True)` — both for the `generation_index`
required-after-defaults ordering (N7) and the same adjacent-same-typed-field hazard `seed.py` guards with
keyword-only args (`occasion`/`weather`):

```python
@dataclass(frozen=True, kw_only=True)
class RankerContext:
    # seed inputs (for tiebreak_seed — §15)
    session_id: str
    wardrobe_version: int
    occasion: str
    weather: str
    date: Optional[str] = None
    generation_index: int                    # REQUIRED, no default (N7, H7) — a real int; see guard below
    k: int = DEFAULT_K                        # N16; M5 may override
    # pre-reduced signals (Q4/H19 — never raw OutfitInteraction; already windowed, N14)
    item_affinity: Mapping[str, int] = field(default_factory=dict)       # itemId → affinityScore
    liked_full_signatures: frozenset[str] = frozenset()                  # comboBoost set
    shown_full_signatures: Sequence[str] = ()                            # repetition window (≤ REPETITION_WINDOW_SIZE)
    recent_disliked_base_keys: Sequence[str] = ()                        # cooldown buffer (≤ COOLDOWN_BUFFER_SIZE)
    recent_disliked_item_ids: Sequence[str] = ()                         # soft-penalty window (≤ DISLIKE_WINDOW_SIZE)
    contextual_disliked_item_ids: frozenset[str] = frozenset()          # regen hard filter
    locked_item_ids: frozenset[str] = frozenset()                       # regen lock filter
```

**`generation_index` guard (N7/H7).** The field has **no default**, so a *missing* `generation_index` is a
`TypeError` at construction. But a bare annotation does not reject `None` or a `bool` (Python's `bool` is an
`int` subclass), and `generation_index` is the sole re-roll lever feeding `tiebreak_seed` — a silently-wrong
value corrupts the §15 determinism promise with nothing failing. So `RankerContext.__post_init__` validates
it explicitly, mirroring M2's `_resolve_candidate_requested` (`validator.py:494-518`): reject `None` and
`bool` **before** the `int` check (`isinstance(True, int)` is `True`, so a bool slips an int-first guard),
then require a real `int`. Each → `TypeError`. (Range/lifecycle — lower bound, increment, reset — is M5's,
H7; M3 only insists on a real int.)

**Module placement.** All six types live in **`ranker.py`**, not `models.py` — mirroring M2, which homed its
result plumbing (`ValidationResult`, `Issue`, …) in `validator.py` and put only the cross-layer-shared
contracts (`IssueCode`, `StyleMove`) in `models.py`. Nothing *below* `ranker.py` imports these, so there is no
circular-import / layering reason (the D7/D7b driver) to push them down. If M4/M5 later needs one as a shared
contract, promote it then. **`RankerResult` is not a "Snapshot"** — that name is reserved for M4/M5 (N9).

---

## 5. Config constants M3 adds (single home — Appendix B / config.py)

Already present: `MAX_AFFINITY=20` (`config:38`), `OVERUSE_MIN_POOL=15` (`config:39`), `DEFAULT_K=10`
(`config:14`).

M3 adds these to `config.py` (values from Appendix B `:844-849`, **except the two new ones**):

| Constant | Value | Sign convention | Spec |
|---|---|---|---|
| `BASE_SCORE` | `+1.0` | added | §14, AppxB |
| `COMBO_BOOST` | `+2.0` | added on re-liked FullSignature | §11/§14 |
| `ITEM_BOOST_WEIGHT` | `+0.1` | × clamped affinity, added | §11/§14 |
| `DISLIKE_PENALTY` | `0.5` | magnitude, **subtracted** (S4) | §14 |
| `COOLDOWN_PENALTY` | `-2.0` | stored **negative, added** (S4) | §14, AppxB |
| `OVERUSE_PENALTY` | `0.5` **(NEW)** | magnitude, subtracted (S4) | §14 + AppxB **this change-set** |
| `REPETITION_PENALTY` | `1.0` **(NEW)** | flat magnitude, subtracted (S4) | §14 + AppxB **this change-set** |
| `OVERUSE_THRESHOLD` | `0.40` | survivor-fraction gate | §14, AppxB |
| `BASEKEY_VARIANT_CAP` | `2` | max per BaseKey | §14, AppxB (text "max 2") |
| `DISLIKE_WINDOW_SIZE` | `20` | window length guard (N14) | §14 (`M=20`), AppxB |
| `COOLDOWN_BUFFER_SIZE` | `10` | window length guard (N14) | §14, AppxB |
| `REPETITION_WINDOW_SIZE` | `10` | window length guard (N14) | §14, AppxB |

The two **NEW** constants are added to `Fitted_Spec_v2.md` §14 + Appendix B in this same change-set. The
S4 sign discipline is load-bearing: `COOLDOWN_PENALTY` is stored negative and **added**; every other penalty
is stored as a positive magnitude and **subtracted** — the `ScoreBreakdown` then holds the *signed* delta
(N4). A mutant that stores `COOLDOWN_PENALTY` positive (or subtracts it) must fail a test (§12).

---

## 6. Pipeline (Steps 4–6) in implementation order

`rank` runs this exact order. Each candidate-level drop continues the loop; M3 never raises on candidate data.

1. **Window guards (N14).** Assert `len(shown_full_signatures) ≤ REPETITION_WINDOW_SIZE`,
   `len(recent_disliked_base_keys) ≤ COOLDOWN_BUFFER_SIZE`, `len(recent_disliked_item_ids) ≤
   DISLIKE_WINDOW_SIZE`. Oversize → `ValueError` (caller-contract: the reducer owns windowing; M3 does no
   truncation — `sampler.py:457` assert precedent). This is the one place M3 raises on its signal inputs.
2. **Empty/degenerate short-circuit (N15).** `candidates == []` → an empty `RankerResult` with `outfits=[]`,
   `fallback_stage=FallbackStage.insufficient`, `insufficient_wardrobe=True`, `relaxed_cooldown_count=0`,
   `locked_survivor_count=0`. The lock diagnostic is **not suppressed on the empty path** (N3): zero
   candidates cannot satisfy a requested lock, so `insufficient_locked_candidates = (locked_item_ids
   non-empty AND locked_survivor_count(=0) < k)` — i.e. `True` whenever locks were requested and `k > 0`
   (the same formula as step 3, with the survivor count pinned to 0). **Never raises** (M2 "empty is valid"
   precedent).
3. **Step 4 — per-request hard filters** (each drives its own path — N8; none silently drops a lock — N3):
   - **Cooldown:** drop candidates whose `base_key ∈ recent_disliked_base_keys` (BaseKey, §7 — filters a
     disliked silhouette across all outer/shoe variants).
   - **Contextual dislike:** drop candidates with any filled-slot item ∈ `contextual_disliked_item_ids`
     (hard filter — N8). Distinct from the soft `recent_disliked_item_ids` (Step 5).
   - **Lock:** if `locked_item_ids` non-empty, keep only candidates whose filled-slot ids ⊇ `locked_item_ids`.
     Record `locked_survivor_count` = survivors of this filter; set `insufficient_locked_candidates =
     (locked_item_ids non-empty AND locked_survivor_count < k)`. **M3 reports; M5 owns the constrained
     Steps-1–3 re-entry** (N3) — M3 never fabricates a locked outfit, never silently drops a lock.
4. **Step 5 — scoring** (per surviving candidate; over **all filled slots** dress/top/bottom/outer/shoes — N13):
   - `base = BASE_SCORE` (+1.0).
   - `combo = COMBO_BOOST if full_signature ∈ liked_full_signatures else 0` (full-outfit edge, §11).
   - `item = Σ_slots ITEM_BOOST_WEIGHT × min(item_affinity.get(id, 0), MAX_AFFINITY)` — absent item → 0;
     **clamp inside M3** (N10), never trust an over-cap input.
   - `dislike = DISLIKE_PENALTY × |{filled-slot ids} ∩ set(recent_disliked_item_ids)|` — **flat**: each
     disliked item counts once regardless of how many times it appears in the window (§14 "flat, not
     accumulated"). Stored positive, **subtracted**.
   - Step-5 score = `base + combo + item − dislike`. Negative scores are valid (ranking is relative, §14).
5. **Step 6 — diversity.**
   - **Variant cap (N5):** per `base_key`, keep the **top-`BASEKEY_VARIANT_CAP`(2)** candidates by **Step-5
     (pre-penalty) score**; drop the rest. (Keep *highest*-2, not bottom-2.)
   - **Overuse set (N1/N2/Q1):** over the **post-variant-cap candidate survivors**, compute **once** the set
     of itemIds appearing in **more than `OVERUSE_THRESHOLD`(0.40)** of those survivors — **only when
     survivor count > `OVERUSE_MIN_POOL`(15)** (else empty set; small pools unpenalized, B1). Then
     `overuse = OVERUSE_PENALTY × |{filled-slot ids} ∩ overuse_set|`, subtracted. Computed once; the fallback
     ladder rung-1 **drops** the penalty, never recomputes the set (N2).
   - **Repetition (Q2):** `repetition = REPETITION_PENALTY(1.0) if full_signature ∈ set(shown_full_signatures)
     else 0` — **flat**, recency-invariant, subtracted. (A combo `+2` outfit that repeats nets `+2 − 1 = +1`,
     still positive — Q2.)
   - Running score now = Step-5 score `− overuse − repetition` (`+ cooldown` only for cooldown-relaxed
     outfits, step 6 below). Every term is a signed `ScoreBreakdown` delta; `score == Σ deltas` (N4).
6. **Fallback ladder** (strict order — §14; validation §13 **never** relaxes; locks/contextual dislikes
   **never** relax — N3). Evaluate the post-variant-cap survivor count against `k`; relax in order until
   `≥ k` or exhausted, recording the deepest rung as `fallback_stage`:
   `none → overuse_relaxed → variant_cap_relaxed → cooldown_relaxed → insufficient`.
   - `overuse_relaxed`: drop the overuse penalty (score-only; the overuse set is never recomputed — N2).
   - `variant_cap_relaxed`: lift the BaseKey cap (re-admit the 3rd+ per BaseKey) — this changes the count.
   - `cooldown_relaxed`: re-admit cooldown-dropped candidates, setting `ScoreBreakdown.cooldown =
     COOLDOWN_PENALTY` (already `−2.0`, the signed delta — **not** negated; the deltas must sum exactly to
     `score`, S4/N4), set their `relaxed_cooldown=True`, and increment `relaxed_cooldown_count` (the
     per-request aggregate — distinct from the per-outfit bool, N4/N11).
   - Exhausted and still `< k` → `insufficient`, `insufficient_wardrobe=True`, return fewer (N11/N15).
7. **Sort + tie-break (N6/N12).** Sort by final score **descending**. Break ties greedily:
   (a) canonical pre-order each equal-score group by `full_signature` (permutation-invariance — N6); then
   (b) prefer the candidate whose **silhouette = `base_key`** (N12, §7 "core silhouette") is **least-represented
   in the output so far** (R3 — reorders, never excludes); then
   (c) seeded shuffle via `seeded_rng(tiebreak_seed(…, generation_index=context.generation_index))`.
   **Never** `source_index` as a tiebreak (N6 — that would make a re-roll reproduce the same order and kill
   the `generation_index` variance).
8. **Truncate to `k`** and build `RankedOutfit`s with their `ScoreBreakdown`. Return `RankerResult`.

---

## 7. Scoring & breakdown contract (N4, §5)

The `ScoreBreakdown` is the debuggability contract (§5): **one signed delta per term**, summing to `score`.
Property test: `outfit.score == base + combo + item + dislike + overuse + repetition + cooldown` for every
emitted outfit, across the full case matrix (N4). Sign storage per §5 / Appendix B (S4): `COOLDOWN_PENALTY`
stored negative and added; `DISLIKE_PENALTY` / `OVERUSE_PENALTY` / `REPETITION_PENALTY` stored as positive
magnitudes and subtracted — the breakdown's `dislike`/`overuse`/`repetition` deltas are therefore **negative**.

**Dominance tests (§5).** Each term gets a test that it cannot dominate when it should not — e.g. a single
`comboBoost (+2)` cannot outrank a candidate with strictly more positive evidence and no penalties; a
`dislikePenalty` is bounded by item count; `cooldown (−2.0)` sinks a relaxed outfit below an unrelaxed peer
of equal pre-cooldown score. **Documented exception (not a bug — §11):** at the affinity cap a 4-item
`itemBoost (~+8)` can exceed `comboBoost (+2)`. This is pinned as a **visible, eval-tracked** case (offline
eval levers: lower cap / sublinear affinity / per-item averaging), **not hidden** by a test that pretends it
can't happen.

---

## 8. Windowing & the reducer boundary (N14)

The reducer (M4/M5) owns windowing: it hands M3 the already-windowed `shown_full_signatures` (≤10),
`recent_disliked_base_keys` (≤10), `recent_disliked_item_ids` (≤20). M3 does **membership / flat math only**
and **guards** `len ≤ window constant`, raising on violation (package convention; `sampler.py:457`
precedent). M3 never truncates — silent truncation would hide an upstream reducer bug and make the window
size ambiguous across the Python/TS boundary.

> **Overridable at review (ledger §4):** the one internal-contract call with a defensible alternative is
> "M3 truncates the windows itself" instead of "reducer windows + M3 guards." Pinned to **reducer-windows +
> M3-guard**; flagged here so it can be flipped at implementation review without re-opening the others.

---

## 9. Edge cases

| Trigger | Behavior | Why |
|---|---|---|
| `candidates == []` (or all filtered out) | Empty `RankerResult`, `insufficient_wardrobe=True`, `fallback_stage=insufficient`, **no raise**; the lock diagnostic is still set (`locked_survivor_count=0`, `insufficient_locked_candidates=True` when locks requested and `k>0`) (N15/N3) | M2 "empty is valid" precedent; M5 owns the zero-candidate UX, but the lock-starvation signal is never suppressed |
| Survivor pool exactly 15 | Overuse **not** applied (gate is `> OVERUSE_MIN_POOL`, strict) | §14/Q1 — small pools unpenalized (B1); test the 15/16 boundary |
| An item in exactly 40% of survivors | **No** overuse penalty for it (gate is `> OVERUSE_THRESHOLD`, strict) | §14/Q1 — exactly-40% is not "more than 40%" |
| Same BaseKey, different FullSignature (dress + different outer) | Both can survive the variant cap (cap is top-2 per BaseKey); they are distinct outfits | §7 — never collapse on BaseKey |
| `generation_index` missing / `None` / `bool` | `TypeError` each — missing fails the no-default field; `None`/`bool` fail the `__post_init__` guard (bool rejected before the int check, since `isinstance(True, int)` is `True`); a real `int` is required | N7/H7 — M5 must supply; the sole re-roll input cannot be silently defaulted or mistyped |
| Window input longer than its constant | `ValueError` | N14 — reducer-contract violation surfaced loudly |
| `item_affinity` value > `MAX_AFFINITY` | Clamped to `MAX_AFFINITY` inside M3 | N10 — never trust an over-cap input |
| `locked_item_ids` set but 0 candidates contain all of them | `locked_survivor_count=0`, `insufficient_locked_candidates=True`, and **empty or fewer-than-k** output — **never substitute non-lock outfits, never fabricate a locked outfit, never silently drop a lock** | N3 — locks are never silently dropped; M5 decides the constrained re-entry |
| Re-roll (same inputs, `generation_index` bumped) | Equal-score ties **reorder**; non-tied order stable | N6 — `generation_index` is the only re-roll lever (H7) |
| Cooldown relaxed under fallback | Re-admitted outfits carry `relaxed_cooldown=True` and `ScoreBreakdown.cooldown = COOLDOWN_PENALTY (−2.0)` (the signed delta, not negated); `relaxed_cooldown_count` aggregates | §14/N11 — the per-outfit bool and per-request count are both kept (N4) |
| Combo `+2` outfit whose FullSignature is in the shown window | Nets `+2 − 1 = +1` (still positive) | Q2 — repetition is a soft flat penalty, not a hard drop |

---

## 10. Test plan (pytest — `ml-system/tests/test_ranker.py`)

Example-based (matches M0–M2; revisit hypothesis ≥ M6). Small fixtures: a handful of `ValidatedCandidate`s
with known keys + a `RankerContext` builder. Assert on **scores, breakdown deltas, order, and the result
flags** — never on prose. Staged per checkpoint (§11):

- **Filters:** cooldown drops by BaseKey (across variants); contextual dislike drops by item; locks keep only
  superset outfits; lock-starvation diagnostic set correctly; the three disliked inputs never conflate (N8).
- **Scoring:** base/combo/itemBoost(clamped, over all slots)/dislike(flat) each verified; `score == Σ
  breakdown deltas` property test (N4); dominance tests (§5) + the eval-tracked 4-item exception.
- **Diversity:** variant cap keeps **top-2** (not bottom-2); overuse gate at 15/16 and threshold at exactly
  40%; overuse set computed once and not recomputed across fallback (N2); repetition flat/recency-invariant.
- **Fallback:** ladder walks `none→overuse→variant_cap→cooldown→insufficient` in order; `relaxed_cooldown`
  + `relaxed_cooldown_count`; `insufficient_wardrobe` incl. 0 (N15); locks/contextual dislikes never relax.
- **Tie-break/determinism:** permutation-invariant; re-roll reorders ties; `source_index` never a tiebreak;
  least-represented-BaseKey-so-far is greedy (not a static sort); seeded shuffle reproducible.
- **Windowing:** oversize window → `ValueError`; at-limit window → OK (N14).

---

## 11. Implementation checkpoints (small green-test commits)

| # | Commit | Lands |
|---|---|---|
| C0 | *plan/spec only* | **this doc** + the two new constants in `Fitted_Spec_v2.md` §14/AppxB (no code) |
| C1 | config + result/context model | 12 constants in `config.py`; `FallbackStage`, `ScoreBreakdown`, `RankedOutfit`, `RankerResult`, `RankerContext`; `rank` signature + the empty/degenerate short-circuit (N15) + window guards (N14) |
| C2 | Step-4 filters + lock diagnostic | cooldown / contextual-dislike / lock filters; `locked_survivor_count` + `insufficient_locked_candidates` (N3/N8) |
| C3 | Step-5 scoring + breakdown | base/combo/itemBoost(clamp)/dislike(flat); signed `ScoreBreakdown`; `score == Σ deltas` + dominance tests (N4/N10/N13/§5) |
| C4 | Step-6 diversity | variant cap (top-2 pre-penalty, N5); overuse (gate/threshold/once, N1/N2/Q1); repetition (flat, Q2) |
| C5 | fallback + tie-break + assembly | ladder + flags (N11); sort + greedy tie-break + seeded shuffle (N6/N12); truncate to k |
| C6 | hardening + closeout | §12 mutants; `__init__.py` "M0–M2"→"M0–M3"; `README.md` status flip; `> COMPLETED` banner |

Test-first within each checkpoint (the result/context model pinned in tests before behavior). Effort
(4–8 hr/wk cadence): C1 ~1.5h · C2 ~1.5h · C3 ~2h · C4 ~2h (densest — overuse gate/denominator) ·
C5 ~2h (tie-break determinism) · C6 ~1.5h. **Total ~10.5h → ~2 sessions.**

---

## 12. Mutation hardening (each must fail a naive mutant — ledger §8)

`>=15` for the overuse gate (must be `>15`) · `>=0.40` threshold (must be `>0.40`) · `source_index` as final
tiebreak (kills re-roll) · recomputing the overuse set after a fallback relax (N2) · re-deduping
FullSignature in M3 (M2 already did it — M3 never re-dedups) · relaxing locks or contextual dislikes under
fallback (N3) · variant cap keeping **bottom**-2 · sign-flip on `COOLDOWN_PENALTY` (positive / subtracted) ·
**accumulating** (not flat) `dislikePenalty` · diversity tie-break as a **static sort** instead of
"least-represented-so-far" greedy · clamping affinity *outside* M3 (trusting an over-cap input) · defaulting
`generation_index` · truncating an oversize window instead of raising.

---

## 13. Risks / out of scope (must not creep in — ledger §7)

No GPT/parse/JSON-repair (M2/M5). No relaxation of M2 validation — **validation never relaxes**, even under
the fallback ladder (§13). No candidate creation — M3 only drops/reorders, never adds. No
`optionPath`/`risk`/rescue path-risk metric (M5/rescue-spec, H20). No learned-scorer/graph behavior (M6, the
`SignalScorer` seam is M1/M6, not M3). No DB/cache/`generationIndex` lifecycle/`GenerationSnapshot` (M4/M5,
H7). No request adapter / normalization / API lifecycle (M5). No UI. No legacy `route.ts` /
`outfit_recommender.py` deletion (license activates M5/M6). Shown-history and affinity **storage** stay out
(H19/M4) — M3 takes them as pre-reduced inputs (Q4).

---

## 14. Open questions

**None block drafting** (ledger §4). One item carried forward for the implementation review:

1. **N14 alternative** — "M3 truncates its own windows" vs the pinned "reducer windows + M3 guards"; pinned
   to the latter, flippable at review (§8).

**Not open — locked (N1).** The overuse pool is **post-variant-cap candidate survivors, no wardrobe input**.
This change-set already tightened §14's overuse clause from "small **wardrobes**" to "small **pools**" to
match, folded into the `OVERUSE_PENALTY` semantics. Recorded here as settled, not for re-confirmation.
