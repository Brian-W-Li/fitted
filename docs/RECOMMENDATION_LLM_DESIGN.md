## LLM Outfit Recommendation – Final Design

### 1. Goals

- **High-quality outfits** (including layering when appropriate) from the user’s own wardrobe.
- **Personalized behavior over time** based on structured like/dislike feedback.
- **Good UX**: simple “Generate outfits” flow, clear feedback controls, and minimal user friction.
- **Scalable**: works when the wardrobe is small or very large, and when there is or isn’t reliable weather data.

---

### 2. Inputs and data model

#### 2.1 Wardrobe item representation

Each wardrobe item (post-CV and manual edits) should expose at least:

- **Core identity**
  - `id: string`
  - `name: string`
- **Structure**
  - `category: "top" | "bottom" | "one piece" | "footwear"`
  - `subCategory?: string` (e.g. `t-shirt`, `jeans`, `dress`)
  - `layerRole?: "base" | "mid" | "outer"` (for tops/outerwear, optional for one-piece)
- **Style & context**
  - `colors: string[]` (hex or named colors)
  - `pattern?: string`
  - `seasons: string[]` (e.g. `["Spring", "Summer"]` or `["All"]`)
  - `occasions: string[]` (free-form tags: `"work"`, `"date night"`, `"wedding guest"`…)
  - `notes?: string` (user/CV notes; open-ended)
- **Operational**
  - `isAvailable: boolean` (include/exclude from recommendations)
  - `imagePath?: string` (for display only)

This is what we ultimately pass (shortlisted) to GPT‑4o‑mini.

#### 2.2 Event and environment inputs

For each recommendation request:

- **Event description** (required): free-text description from user, e.g.  
  `Outdoor brunch with friends in early spring, want smart casual but comfortable. Might get windy.`
- **Inferred / provided environment**:
  - Long term, use a combination of:
    - **User-provided coarse temperature** (fallback): `"Hot" | "Mild" | "Cold" | "Indoor AC"`.
    - **Real weather API**: based on user’s location + event date/time.
  - Short term (until weather integration is done), we can still use the coarse temperature hint.

We normalize this into a `temperatureHint` and an optional `weatherSummary`:

```ts
type TemperatureHint = "hot" | "mild" | "cold" | "indoor";

interface EnvironmentContext {
  temperatureHint: TemperatureHint;
  weatherSummary?: string; // e.g. "Sunny, 28°C, humid" or "Indoors, air-conditioned"
}
```

---

### 3. Shortlisting and context size

We should **not always send the entire wardrobe** to GPT‑4o‑mini, especially for large wardrobes. Instead we:

1. **Filter**:
   - Include only items where `isAvailable === true` (or missing, treated as true).
   - Optionally filter by season vs environment:
     - If `temperatureHint === "cold"`, favor items tagged with cold seasons or “All”.
     - If `"hot"`, favor warm-weather items; de-prioritize heavy outer layers.

2. **Soft bias with occasion tags** (optional, not strict):
   - Extract a small set of occasion buckets from the event text (e.g. `["work"]`, `["formal"]`, `["casual"]`) via simple keyword mapping.
   - Score items up if their `occasions` overlap any bucket; otherwise score them lower.
   - Use this score only for sampling priority, not a hard filter.

3. **Sampling / diversity**:
   - If `filteredItems.length <= threshold` (e.g. 60), send all.
   - If larger:
     - Maintain a minimal quota per structural type:
       - Tops, bottoms, one-pieces, footwear, outer layers.
     - Randomly sample within each bucket, weighted by the soft occasion score.
     - Ensure at least some items in each bucket so GPT can form varied outfits.

Final output of shortlisting:

```ts
function shortlistForLLM(
  wardrobe: WardrobeItem[],
  eventDescription: string,
  env: EnvironmentContext,
  maxItems: number
): WardrobeItem[] { ... }
```

This keeps the prompt size manageable and the item set relevant without introducing complex ranking logic.

---

### 4. Single-stage outfit + layering generation

We use **one GPT‑4o‑mini call per request** to decide:

- Whether to layer.
- Which items to use (including one-pieces).
- Why each outfit works.
- Confidence score per outfit.

#### 4.1 Prompt structure

**System message (high-level)**:

- Explain the role:
  - Expert stylist.
  - Must use only provided item IDs.
  - Must respect temperature and event context.
- Outline allowed outfit structures:
  - One-piece only (dress/jumpsuit).
  - Top + bottom.
  - Base + bottom + outer (optional mid) for cold/“needs layering” contexts.

**User message** contains:

- **Event description**
- **Environment context**:

  ```text
  TEMPERATURE_HINT: "cold" | "mild" | "hot" | "indoor"
  WEATHER_SUMMARY: "Sunny 12°C, windy" (when available)
  ```

- **Wardrobe JSON** (shortlisted items):

  ```json
  [
    {
      "id": "t1",
      "name": "White Tee",
      "category": "top",
      "subCategory": "t-shirt",
      "layerRole": "base",
      "colors": ["#ffffff"],
      "pattern": "solid",
      "seasons": ["Spring", "Summer"],
      "occasions": ["casual", "everyday"],
      "notes": ""
    }
  ]
  ```

- **Instructions** (simplified):
  - Use only IDs from `WARDROBE_ITEMS`.
  - For **hot** contexts:
    - Prefer one-pieces or light base+bottom; avoid heavy outer layers.
  - For **cold** contexts:
    - Prefer adding an **outer** (and optional mid) layer when available.
  - For **mild/indoor**:
    - Either simple outfits or light outerwear depending on style.
  - Ensure color harmony and occasion fit based on tags and event description.
  - Return up to `N` outfits with:
    - `itemIds: string[]`
    - `confidence: 0–100`
    - `reason: string`

- **Response schema**:

  ```json
  {
    "outfits": [
      { "itemIds": ["..."], "confidence": 0, "reason": "..." }
    ],
    "notEnoughItems": false,
    "message": ""
  }
  ```

We enforce `response_format: { type: "json_object" }` so we don’t have to regex the content.

---

### 5. Feedback and refinement UX

#### 5.1 Like / Dislike at outfit level

On each outfit card:

- **Like button**: thumbs-up.
- **Dislike button**: thumbs-down.

Clicking **Like**:

- Immediately logs a positive feedback event linked to:
  - `userId`, `outfitId` (or derived from item IDs), `itemIds`, event description, environment context.
- Optionally triggers a subtle UI state (`Liked` badge).

Clicking **Dislike**:

- Opens a **Feedback Modal** (see below), instead of logging a simple binary flag.

#### 5.2 Feedback Modal for dislikes (per-item selection + optional text)

When user dislikes an outfit:

1. Open a modal showing the outfit’s items in a list:
   - Each item row:
     - Thumbnail + name + category + layerRole.
     - A **toggle button**: “Disliked” (multi-select; can mark several items).
     - A small optional text box icon → expanding to allow **per-item note** like:
       - “Color too bright”
       - “Too heavy for summer”
       - “Fit is too tight”

2. Modal-level controls:
   - **Optional overall reason** field, e.g. “Too dressy”, “Too basic”.
   - **Lock toggles** for items:
     - For each item, a “Lock this piece” checkbox or pin icon.
     - This lets user say “I like the jacket, just change the rest.”

3. Actions:
   - **Save feedback only**:
     - Persist structured feedback and close.
   - **Save & Regenerate**:
     - Persist feedback.
     - Trigger a “regenerate outfits” call that:
       - Receives `lockedItemIds`.
       - Receives `dislikedItemIds`.
       - Optionally receives per-item and overall free-text comments.

We don’t need to expose all of this to GPT every time; we store it first, then use aggregated behavior in the preference summary.

---

### 6. Locking pieces and regenerating outfits

We support “lock this piece and regenerate” both via:

- The **feedback modal** (“Save & Regenerate”) for disliked outfits.
- Possibly a **quick lock** action on liked outfits (future extension).

#### 6.1 API shape

We can use a separate endpoint or extra parameters for the main endpoint:

```ts
POST /api/recommend/regenerate
{
  "eventDescription": "...",
  "environment": { "temperatureHint": "cold" },
  "lockedItemIds": ["t1", "b2"],
  "changeTarget": "outer" | "top" | "bottom" | "any"
}
```

The backend:

- Runs the same shortlisting pipeline but:
  - Optionally excludes items that are explicitly disliked for this regeneration.
- In the prompt, we add:

  ```text
  LOCKED_ITEMS: ["t1", "b2"]
  CHANGE_TARGET: "outer"

  - You MUST include all locked items in every suggested outfit.
  - You should primarily change only the CHANGE_TARGET items if possible.
  ```

- Response schema remains the same (`outfits[]` with scores + reasons).

This keeps regeneration logic entirely LLM-driven, while we control which items cannot be touched.

---

### 7. Consolidating feedback into a preference summary

We do **not** want to send raw interaction history every time. Instead, we:

#### 7.1 Store structured feedback events

For each feedback action (like or dislike):

- `userId`
- `timestamp`
- `context`: `eventDescription`, `environment`, maybe simplified occasion buckets.
- `itemIds: string[]`
- `perItemFeedback?: { [itemId: string]: { liked?: boolean; disliked?: boolean; notes?: string; layerRole?: string } }`
- `overallNotes?: string`

We store this in a `UserOutfitFeedback` collection.

#### 7.2 Periodic preference summarization

Periodically (or on-demand, e.g. nightly job or when user opens the app), we generate a **short textual preference summary** with GPT‑4o‑mini (or even a smaller model), by giving it **only a sample of recent feedback events per user**, e.g.:

- Last N feedback events (e.g. 50).
- Or a time window (last 90 days) with capping.

Prompt outline:

- System:
  - “You are summarizing a user’s clothing preferences based on feedback they gave to an outfit recommendation app.”
- User:
  - Provide a **list of feedback records**:
    - For each: items (with categories, colors, layerRoles), context, like/dislike, optional notes.
  - Ask:
    - “Summarize in 3–5 bullet points what this user tends to like and dislike (colors, fits, layering, formality, occasions, etc.). Avoid overfitting based on single examples.”

Example output:

- “Prefers neutral tops (white, grey, navy) and avoids very bright primary colors.”
- “Likes simple, non-busy patterns (solid, subtle stripes) and dislikes large graphics.”
- “Dislikes heavy layering for warm-weather events but appreciates a light jacket for evening events.”
- “Often chooses jeans/chinos over shorts for casual events.”

We store this as:

```ts
type PreferenceSummary = {
  updatedAt: Date;
  text: string; // 3–5 bullets or a short paragraph
};
```

#### 7.3 Using the summary in the main prompt

For each recommendation request we prepend:

```text
USER_PREFERENCES:
- Prefers neutral tops (white, grey, navy); avoids very bright primary colors.
- Likes simple patterns; dislikes big graphics.
- Dislikes heavy layering in hot weather; fine with a light outer layer for evenings.
```

This goes into the **system or user message** (before the event and wardrobe) so GPT‑4o‑mini can bias its choices:

- Choose items consistent with likes.
- Avoid or downgrade items consistent with dislikes.
- Decide whether to layer, partly based on these.

We don’t need to let GPT re-summarize preferences on every call; we reuse the stored summary until we run the summarization process again (e.g. daily or when enough new feedback is collected).

---

### 8. Summary

- **Layering**: handled in a **single GPT‑4o‑mini call** informed by:
  - Event description.
  - Temperature/environment hint.
  - Wardrobe items with `layerRole` and seasons.
- **Shortlisting**: filter by availability + season, optional occasion bias + sampling.
- **Feedback**:
  - Outfit-level like/dislike.
  - Dislike opens a **feedback modal** where user can:
    - Mark specific items as disliked (multi-select).
    - Optionally add item-specific and overall notes.
    - Lock items they like and regenerate around them.
- **Lock/regenerate**:
  - Extra endpoint/mode with `lockedItemIds` + `changeTarget` that tells GPT what to keep and what to change.
- **Personalization**:
  - Feedback is logged structurally.
  - Periodically summarized into a short **preference paragraph** we prepend to the recommendation prompt, instead of sending raw history.

  **The backend must validate LLM output and discard any outfits referencing items not in the shortlist or violating composition rules.**

