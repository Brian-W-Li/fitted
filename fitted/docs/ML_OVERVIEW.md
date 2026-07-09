> **LEGACY DEPLOYED-APP REFERENCE.** This documents an old recommendation path from the CS148 app.
> Do not use it as v2 direction. For future work, use `../../docs/Fitted_Spec_v2.md` and
> `../../ml-system/fitted_core/`; for current deployed behavior, prefer reading the source code.

# What the Legacy ONNX ML Path Did (retired CS148 scoring path)

This describes the **ML recommendation path** used when the user requests outfit recommendations **without** "Use AI (GPT-4)". The API builds an engine from the user's wardrobe and optional ONNX model, then returns scored top+bottom outfit pairs.

---

## High-level flow

1. **Request** — User picks an occasion (e.g. Casual, Formal) and clicks "Get Recommendations" (ML path).
2. **Data** — Backend loads the user's wardrobe items and their past like/dislike feedback from the DB.
3. **Engine** — `OutfitRecommendationEngine` is created with:
   - wardrobe items (as `WardrobeItemML`),
   - feedback history (accepted/rejected outfit pairs),
   - optional **PairScorer** (e.g. ONNX model) for gentle reranking only.
4. **Hard filters** — Items that are clearly wrong for the occasion (category/name-derived level too far off) or season (opposite-season-only) are removed before scoring.
5. **Scoring** — Remaining top x bottom pairs are scored; rules (occasion + color) dominate.
6. **Reranking** — If ONNX is loaded, the top 30 candidates get a gentle adjustment (~5 pts max).
7. **Response** — Top-scoring outfits (up to 5) are returned with score and reasons, with diversity enforcement.

---

## 1. Item representation (embeddings)

- Each wardrobe item is turned into a **fixed-size vector (embedding)** of size **80**.
- **EmbeddingLayer** builds this from:
  - **Color(s)** — averaged embedding of each color (from a fixed palette: black, white, blue, navy, etc.).
  - **Occasions** — e.g. Casual, Business, Athletic (averaged).
  - **Seasons** — e.g. Summer, Winter (averaged).
  - **Category** — e.g. t-shirt, jeans, blazer.
- Embeddings are **deterministic** from item attributes (hash + seeded random), not learned from data. So the same item always gets the same 80-dim vector.
- A **pair** is represented by concatenating top embedding and bottom embedding = **160-dim** vector.

---

## 2. Top/bottom classification

- Items must be labeled as **top** or **bottom** to form valid outfits.
- **CategoryTaxonomy** does this by matching **category/name** against keyword sets (e.g. shirt, hoodie = top; jeans, shorts = bottom), then falling back to `clothingType` or CV metadata.
- Only top x bottom pairs are considered; same-type pairs are not.

---

## 3. Hard pre-filters (before scoring)

Before any scoring happens, items are filtered:

- **Occasion filter**: Each item’s suitability is derived from category/name keywords (e.g. tank, blazer) mapped to a level (1=athletic/loungewear, 2=casual, 3=smart casual, 4=business, 5=formal). Each occasion has an acceptable range (e.g. business=[3,5]). Items whose derived level is more than 1 level outside the range are rejected outright. This prevents tank tops from reaching business scoring and blazers from reaching athletic scoring.
- **Season filter**: Items exclusively tagged for the opposite season (e.g. summer-only in winter) are rejected.
- **Duplicate-type filter**: Pairs with both items of the same core type (e.g. hoodie+hoodie) are skipped.

---

## 4. How each outfit (top + bottom) is scored

For every (top, bottom) pair that passes hard filters, a **single score** in 0-100 is computed:

| Component        | Weight | What it does |
|-----------------|--------|--------------|
| **Occasion**    | 40%    | **ContextMatcher.matchOccasion**: Category/name-derived level + occasion tag match. |
| **Color**       | 30%    | **ColorHarmonyAnalyzer**: HSL palette with fashion-neutral awareness (navy, beige, khaki, brown count as neutrals). Rewards neutral+accent and analogous schemes; penalizes clashing saturated combos. |
| **In-memory NN** | 10%   | In-memory NeuralNetwork trained on user like/dislike feedback. Uses 160-dim pair vectors. |
| **Collaborative** | 15%  | **MatrixFactorization**: Latent factors for user and items. Trained on like/dislike feedback. |
| **Season**      | 5%     | **ContextMatcher.matchSeason**: Current season vs item's seasons. Opposite-season-only items get 0.2; matched items get 1.0. |

- If either top or bottom gets **occasion score 0**, the whole outfit score is 0 (filtered out).
- **Reasons** (e.g. "Perfect for casual", "Based on your preferences") are derived from which sub-scores are high.

---

## 5. Optional ONNX model (gentle reranker only)

- The **ONNX model** (`outfit_model.onnx`) is currently trained on **synthetic data** and is intentionally de-emphasized.
- It is **NOT** used in primary scoring. Instead, after all pairs are scored by rules + in-memory NN, the **top 30 candidates** are passed to ONNX for a gentle reranking (max ~5 point adjustment).
- This means ONNX can only slightly reorder already-good outfits; it cannot push a bad outfit to the top.
- If the model is **missing or fails**, recommendations work exactly the same (just without the rerank step).
- Once a model trained on **real user data** is available, the ONNX weight can be increased.

---

## 6. Learning from feedback

- When the user **likes** or **dislikes** an outfit, that pair is stored (e.g. in `OutfitInteraction`).
- On the **next** recommendation request:
  - **NeuralNetwork**: Trained on (top_embedding + bottom_embedding, 1 for like / 0 for dislike) via backprop (small MLP).
  - **MatrixFactorization**: Updated so (user, top), (user, bottom), and (user, pair) factors better predict the liked/disliked rating.
- Over time, the **10% neural** and **15% collaborative** parts adapt to that user's taste; **occasion**, **color**, and **season** stay rule-based.

---

## 7. What the API returns

- List of **outfits**, each with:
  - **items**: [top, bottom] with id, name, category, colors.
  - **score**: 0-100.
  - **reason**: Short text (e.g. "Perfect for casual. Based on your preferences.").
- Sorted by score; diversity is enforced so the same top/bottom doesn't dominate the list.

---

## Summary

- **Inputs**: Wardrobe items (with category, colors, occasions, seasons), occasion filter, and optional like/dislike history.
- **Hard filters**: Occasion filter (category/name) + opposite-season filter remove obviously wrong items before scoring.
- **Core scoring**: occasion (40%) + color (30%) + in-memory NN (10%) + collaborative (15%) + season (5%). Rules dominate.
- **ONNX**: Gentle reranker only (~5 pt max) on top 30 candidates. Trained on synthetic data, intentionally weak until real-data model is available.
- **Learning**: In-memory NN and matrix factorization are updated from user feedback.
- **Output**: Ranked outfit recommendations (top + bottom) with score and reasons.
