# Fitted ML System

> **Two layers live here — don't confuse them:**
> - **`fitted_core/`** — the **v2 substrate** (the current focus). Pure-function contracts +
>   sampler for the GPT-orchestration refactor, built test-first under `tests/` (pytest).
>   Authoritative design: `docs/Fitted_Spec_v2.md` + `docs/plans/m0-m1-substrate.md` (M0/M1, completed) + `docs/plans/m2-validator.md` (M2, completed) + `docs/plans/m3-ranker.md` (M3, completed).
>   **M0–M3 complete — sampler substrate (partition, caps, 70/30 `SignalScorer` seam, candidate scaling, `build_candidate_pool` entry point), the M2 GPT-response validator (parse, strict schema, SlotMap/pool validation, keys + dedup, StyleMove, candidate bounds), and the M3 ranker (Step-4 filters, additive scoring, diversity, fallback ladder, deterministic tie-break). Next active work: Spearhead orphan-item rescue (`docs/plans/spearhead.md`), then M4 data migration (`docs/Fitted_Spec_v2.md` §20).**
> - **`outfit_recommender.py`** — the **legacy rule-based demo** (Issue #32, below). Kept as a
>   runnable reference only; retired at M6 when the trained scorer lands. Not the architecture.
>
> The rest of this file documents the legacy demo.

---

## Legacy demo (Issue #32)

### What This Does

Rule-based outfit recommendation system that:
1. Takes clothing items from user's wardrobe
2. Generates outfit combinations (top + bottom + shoes)
3. Scores them based on rules (color matching, patterns, occasion)
4. Returns top recommendations

---

## Quick Demo

```bash
cd ml-system
python3 outfit_recommender.py
```

Youll see outfit recommendations for different occasions.

---

## How It Works

### Input:
```python
ClothingItem(
    id="shirt1",
    category="top",
    color="#0066CC",     # For example, Lets take blue.
    pattern="solid",
    style="casual"
)
```

### Rules Applied:
1. **Color Matching**
   - Neutrals (black, white, gray) match everything
   - Max 3 different colors per outfit
   - Score: -20 if colors clash

2. **Pattern Mixing**
   - Solid + solid = OK
   - Solid + pattern = OK
   - Pattern + pattern = risky
   - Score: -15 if too many patterns

3. **Occasion Matching**
   - Casual: casual/athletic styles OK
   - Business: business/formal styles OK
   - Score: -25 if wrong occasion

### Output:
```python
Outfit(
    top=blue_shirt,
    bottom=black_jeans,
    shoes=white_sneakers,
    score=95,
    reason="colors match well, appropriate for casual"
)
```

---

## Legacy ML Note

This section describes the old demo seam only. The current v2 ML seam is `fitted_core`'s
`SignalScorer`; see `docs/Fitted_Spec_v2.md` and `docs/plans/m0-m1-substrate.md`.

```python
# Current (rules):
def _score_outfit(self, top, bottom, shoes, occasion):
    score = 100
    if not self._colors_match(...):
        score -= 20
    return score

# Legacy idea (not the v2 plan):
def _score_outfit(self, top, bottom, shoes, occasion):
    features = self._extract_features(top, bottom, shoes, occasion)
    score = ml_model.predict(features)  # ← Just change this!
    return score
```

The v2 implementation does not keep this interface; it retires the demo at M6.

---

## Files

- `outfit_recommender.py` - Main recommendation engine
- `cv-integration.md` - What CV team provides
- `README.md` - This file
