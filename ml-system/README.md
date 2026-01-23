# Fitted ML System - Issue #32

## What This Does

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

## Future ML Enhancement

Current system uses rules. To add ML later:

```python
# Current (rules):
def _score_outfit(self, top, bottom, shoes, occasion):
    score = 100
    if not self._colors_match(...):
        score -= 20
    return score

# Future (ML):
def _score_outfit(self, top, bottom, shoes, occasion):
    features = self._extract_features(top, bottom, shoes, occasion)
    score = ml_model.predict(features)  # ← Just change this!
    return score
```

The interface stays the same, just swap the scoring logic.

---

## Files

- `outfit_recommender.py` - Main recommendation engine
- `CV_INTEGRATION.md` - What CV team provides
- `README.md` - This file


