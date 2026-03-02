# Recommendation: LLM-only with free-text occasion

## Summary

- **We no longer use our own ML** (no rule-based engine, ONNX, or in-app neural/collaborative scoring) for outfit recommendations.
- **Recommendations are produced by an LLM** (e.g. GPT-4o-mini) via prompt engineering.
- **Inputs**: (1) the user’s **entire wardrobe** (items with id, name, category, colors, etc.), (2) **occasion** as **free text** — a few lines describing the event/context (e.g. “Job interview at a startup”, “Outdoor brunch with friends”), not a dropdown.

---

## Inputs

| Input | Description |
|-------|-------------|
| **Wardrobe** | Full list of the user’s clothing items (from DB), with attributes the LLM can use: id, name, category, colors, occasions, etc. |
| **Occasion** | Free-text description of the event/situation (e.g. “Casual Friday at the office”, “First date at a nice restaurant”). No fixed enum; the user writes a short description. |

---

## Flow

1. User enters **occasion** in a **textarea** (or similar) on the recommendations screen.
2. Frontend sends **POST /api/recommend** with body: `{ occasion: string }` (and optionally colorStyle or other hints).
3. Backend loads the user’s **wardrobe** from the DB, builds a **prompt** that includes:
   - The full wardrobe (e.g. as JSON or structured text).
   - The user’s occasion description: “The user described their event as: …”
4. LLM returns suggested outfits (e.g. list of item ids per outfit + short reason).
5. Backend maps ids back to items, returns `{ outfits: [...] }`; frontend displays them.

---

## Prompt design (high level)

- **System/context**: You are a fashion stylist. Use only items from the provided wardrobe.
- **Wardrobe**: Pass every item with id, name, category, colors (and later: dress vs top/bottom, layer_role for tops).
- **Occasion**: “The user needs an outfit for: \<user’s free-text\>.” So the model can reason about context and weather from natural language.
- **Output**: Structured JSON, e.g. `{ "outfits": [ { "items": ["id1", "id2", ...], "reason": "..." } ] }`.
- **Flexibility**:
  - **One-piece**: One item in `items` (e.g. dress + optional shoes if we add footwear to the prompt).
  - **Layered**: Multiple items (e.g. shirt + jacket + pants) when the wardrobe and CV support it.
  - **Classic**: Two items (top + bottom) as today.

So the LLM can recommend dresses, layered looks, or simple top+bottom from the same prompt and wardrobe.

---

## Backend

- **Single path**: Only the LLM recommendation path is used. No custom ML engine, no ONNX, no scoring in Node.
- **API**: `POST /api/recommend` body: `{ occasion: string, colorStyle?: string }`. `occasion` is required and can be multi-line.
- **Dependencies**: `OPENAI_API_KEY` (or the LLM provider you use). No ONNX or recommendation engine init.

---

## Frontend

- **Occasion**: Use a **textarea** (or multi-line input) so the user can describe the event in a few lines. Placeholder e.g. “e.g. Job interview, weekend brunch, date night…”
- **No “Use AI” / “ML vs AI” toggle**: Only one recommendation method (LLM), so remove the checkbox and any “ML Engine” vs “AI Powered” badge if desired.
- **Copy**: e.g. “Describe the event and we’ll suggest outfits from your wardrobe.”

---

## Interaction / feedback (optional)

- If you still store **OutfitInteraction** (liked/disliked) for analytics or future use, keep sending `occasion` as stored (e.g. the raw free-text string) so you can later fine-tune or analyze by occasion description.

---

## Relation to CV (dresses + layering)

- **CV** should expose **dress** and **layer_role** (see CV_DDRESSES_AND_LAYERING.md) so the wardrobe payload to the LLM includes “this is a dress” or “this is a base/outer layer”.
- The **prompt** can then instruct the LLM to use only valid combinations (e.g. one-piece vs top+bottom, base + optional outer + bottom). No change to the “LLM-only + free-text occasion” flow; just richer wardrobe data in the prompt.
