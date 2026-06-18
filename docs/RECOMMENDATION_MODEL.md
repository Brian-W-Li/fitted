> **Superseded.** This legacy recommendation-design document describes the old GPT/Gemini-era app. The
> current canonical recommendation architecture is `docs/Fitted_Spec_v2.md`; do not use this file as
> implementation guidance.

# LLM Outfit Recommendation Model - Design Document

## Overview

The recommendation model uses **GPT-4o-mini** to generate outfit recommendations from a user's wardrobe. The system uses intelligent pre-processing (shortlisting & scoring), structured prompting, and post-processing (validation) to ensure high-quality, valid outfit combinations.

---

## Recommendation Pipeline

```
User Input                    Shortlisting                  GPT-4o-mini                 Validation
───────────────────────────────────────────────────────────────────────────────────────────────────
                                                                                        
"Outdoor brunch,     ──►  Score & filter items    ──►  Generate outfit      ──►  Validate structure
 casual vibe"              (max 80 items)               combinations              & enrich response
                                                                                        
                           ┌─────────────────┐          ┌─────────────────┐         ┌─────────────────┐
                           │ Occasion: 60%   │          │ System prompt   │         │ Infer item types│
                           │ Temperature: 40%│          │ + User context  │         │ Check structure │
                           │ Category quotas │          │ + Wardrobe JSON │         │ Filter invalid  │
                           └─────────────────┘          └─────────────────┘         └─────────────────┘
```

---

## Step 1: Environment Context Detection

If user doesn't provide a temperature hint, auto-detect from event description. Uses **word-boundary matching** to avoid substring collisions (e.g. "hot" in "hotel", "park" in "spark").

| Keywords | Temperature Hint |
|----------|------------------|
| cold, winter, freezing, chilly, snow, frigid | `"cold"` |
| hot, summer, warm, humid, heat, scorching | `"hot"` |
| outdoor, outside, beach, park, picnic, hiking, hike, camping, barbecue, bbq, garden, trail | `"outdoor"` |
| indoor, inside, air condition, office | `"indoor"` |
| spring, fall, autumn, mild, cool, moderate | `"mild"` |
| (default) | `"mild"` |

**Priority order:** cold > hot > outdoor > indoor > mild. "ac" was removed from indoor (matched "beach" substring).

---

## Step 2: Shortlisting & Scoring

### Purpose

Reduce wardrobe to **max 80 items** to keep GPT context manageable while preserving relevance and diversity.

### Hard Filter

Only one hard filter - availability:
```
Keep items where: isAvailable !== false
```

### Soft Scoring (Multi-factor)

Each item receives a **combined score** based on two factors:

#### Occasion Score (60% weight)

Extract occasion buckets from event description:

| Keywords | Bucket |
|----------|--------|
| work, office, meeting, business, professional | `"work"` |
| formal, wedding, gala, black tie, elegant | `"formal"` |
| casual, relaxed, chill, hangout, friends | `"casual"` |
| date, romantic, dinner | `"date"` |
| sport, athletic, gym, workout, active | `"athletic"` |
| outdoor, hiking, picnic, beach, park | `"outdoor"` |
| (default) | `"everyday"` |

Score calculation:
| Condition | Score |
|-----------|-------|
| Item occasions match event buckets | 1.0 |
| No occasions tagged on item | 0.5 (neutral) |
| Item occasions don't match | 0.3 |

#### Temperature Score (40% weight)

| Temperature Hint | Item Condition | Score |
|------------------|----------------|-------|
| `"cold"` | Has winter/fall seasons | 1.0 |
| `"cold"` | Summer-only item | 0.4 (penalized, not excluded) |
| `"cold"` | Other | 0.7 |
| `"hot"` | Has summer/spring seasons | 1.0 |
| `"hot"` | Heavy winter coat (parka, puffer, wool) | 0.2 |
| `"hot"` | Winter-only item | 0.5 |
| `"hot"` | Other | 0.8 |
| `"mild"` / `"indoor"` / `"outdoor"` | All items | 1.0 |

#### Combined Score

```
combinedScore = (occasionScore × 0.6) + (temperatureScore × 0.4)
```

### Category-based Sampling

If wardrobe exceeds 80 items, sample by category with quotas.

**Smart categorization** uses multiple signals (not just `category` field):

| Priority | Detection Method | Category |
|----------|------------------|----------|
| 1 | layerRole="outer" OR name contains jacket/coat/blazer/parka | Outer |
| 2 | category="bottom" OR name contains pants/jeans/shorts/skirt | Bottom |
| 3 | category="one piece" OR name contains dress/jumpsuit | One-piece |
| 4 | category="footwear" OR name contains shoes/boots/sneakers | Footwear |
| 5 | category="top" OR name contains shirt/tee/blouse/sweater | Top |
| 6 | (default) | Top |

**Category Quotas:**

| Category | Max Items |
|----------|-----------|
| Tops | 25 |
| Bottoms | 20 |
| Outer layers | 15 |
| One-pieces | 10 |
| Footwear | 10 |

Within each category, items are sorted by combined score and top N selected.

---

## Step 3: Preference Summary Injection

If the user has accumulated feedback (likes/dislikes), a summarized preference profile is loaded and prepended to the prompt:

```
USER_PREFERENCES:
- Prefers neutral tops (white, grey, navy); avoids bright primary colors
- Likes simple patterns; dislikes large graphics
- Prefers jeans/chinos over shorts for casual events
- Dislikes heavy layering in warm weather
```

This biases GPT toward items matching demonstrated preferences.

*See [Preference Learning](#preference-learning) for how this summary is generated.*

---

## Step 4: GPT Prompt Construction

### System Message

```
You are an expert fashion stylist creating outfit recommendations from a user's wardrobe.

CRITICAL RULES:
- You MUST use only item IDs from the provided WARDROBE_ITEMS.
- NEVER use two tops in the same outfit - only ONE top allowed.
- NEVER use two bottoms in the same outfit - only ONE bottom allowed.
- One-piece items should NOT be combined with separate tops or bottoms.
- Every outfit MUST include exactly ONE footwear item when footwear is available in WARDROBE_ITEMS.

VALID OUTFIT STRUCTURES:

For one-piece outfits (dress, jumpsuit) — always add footwear when available:
1. One-piece + footwear
2. One-piece + mid layer + footwear (e.g., dress + cardigan + shoes)
3. One-piece + outer layer + footwear (e.g., dress + jacket + shoes)
4. One-piece + mid layer + outer layer + footwear

For top+bottom outfits (MUST have base layer top) — always add footwear when available:
1. Base top + bottom + footwear
2. Base top + mid layer + bottom + footwear
3. Base top + outer layer + bottom + footwear
4. Base top + mid layer + outer layer + bottom + footwear

IMPORTANT: For top+bottom outfits, you MUST include a base layer top.
Mid layers and outer layers are ADDITIONS, not replacements.

LAYERING GUIDANCE:
- "hot": Prefer single layers. No heavy outers.
- "cold": Add outer layer on top of base. Mid layers optional.
- "mild"/"indoor"/"outdoor": Flexible - light outer optional.

COLOR & STYLE:
- Ensure colors complement each other.
- Match formality to the occasion.
- Max 1 bold pattern per outfit.
```

### User Message

```
USER_PREFERENCES:
- Prefers neutral tops...
(if available)

EVENT_DESCRIPTION: "Outdoor brunch with friends, casual vibe"

ENVIRONMENT:
- TEMPERATURE_HINT: "mild"
- WEATHER_SUMMARY: "Sunny, 65°F" (if provided)

WARDROBE_ITEMS:
[
  {
    "id": "abc123",
    "name": "White Oxford Shirt",
    "category": "top",
    "subCategory": "button-down",
    "layerRole": "base",
    "colors": ["white"],
    "pattern": "solid",
    "seasons": ["Spring", "Summer", "Fall"],
    "occasions": ["work", "casual"],
    "notes": "Versatile everyday shirt"
  },
  ...
]

TASK:
Create 5 outfit recommendations. For each outfit:
1. Think about what formality and style the event requires.
2. Consider the temperature - does it need layering?
3. Select items that work together (colors, style, occasion).
4. Include exactly one footwear item (shoes, sneakers, boots, sandals, etc.) when available in WARDROBE_ITEMS.
5. Provide a confidence score (0-100) and brief reason.

RESPONSE FORMAT (JSON only):
{
  "outfits": [
    { "itemIds": ["id1", "id2"], "confidence": 85, "reason": "..." }
  ],
  "notEnoughItems": false,
  "message": ""
}
```

### API Configuration

```
model: "gpt-4o-mini"
temperature: 0.5          (balanced creativity)
response_format: { type: "json_object" }
```

---

## Step 5: Footwear Post-Processing

If the wardrobe has footwear but the LLM omits it from an outfit, the system injects the first footwear item into that outfit's `itemIds`. This uses item-type inference (not ID comparison) to avoid format mismatches from LLM output.

## Step 6: Outfit Validation

### Smart Item Type Inference

Each item returned by GPT is categorized using multiple signals:

```
┌─────────────────────────────────────────────────────────────────┐
│                    ITEM TYPE INFERENCE                          │
│                                                                 │
│  Input: category, layerRole, name, subCategory                  │
│                                                                 │
│  Priority order:                                                │
│  1. ONE_PIECE   ← category="one piece" OR name has dress/jumpsuit
│  2. BOTTOM      ← category="bottom" OR name has pants/jeans/shorts
│  3. FOOTWEAR    ← category="footwear" OR name has shoes/boots   │
│  4. OUTER_LAYER ← layerRole="outer" OR name has jacket/coat     │
│  5. MID_LAYER   ← layerRole="mid" OR name has cardigan/sweater  │
│  6. BASE_TOP    ← category="top" OR name has shirt/tee/blouse   │
│  7. UNKNOWN     ← fallback                                      │
└─────────────────────────────────────────────────────────────────┘
```

### Structure Validation Rules

Each outfit is validated against these rules:

**Hard Invalid Conditions:**
| Condition | Rule |
|-----------|------|
| Multiple bottoms | Max 1 bottom |
| Multiple base tops | Max 1 base top |
| Multiple one-pieces | Max 1 one-piece |
| One-piece with top/bottom | One-piece cannot have separate base top or bottom |
| Multiple footwear | Max 1 footwear |
| Missing footwear | When wardrobe has footwear, outfit must have exactly 1 |
| Too many mid layers | Max 2 mid layers |
| Too many outer layers | Max 1 outer layer |

**Valid Structure Requirements:**

For **one-piece outfits**:
- Must have exactly 1 one-piece
- Must have exactly 1 footwear when wardrobe has footwear
- Can optionally add mid layers (cardigan, sweater)
- Can optionally add outer layer (jacket, coat)
- Cannot have separate base top or bottom

For **top+bottom outfits**:
- Must have exactly 1 base top (t-shirt, shirt, blouse)
- Must have exactly 1 bottom (pants, jeans, shorts, skirt)
- Must have exactly 1 footwear when wardrobe has footwear
- Can optionally add mid layers
- Can optionally add outer layer

### Valid Outfit Combinations Table

| Type | Structure | Example | Valid |
|------|-----------|---------|:-----:|
| One-piece | One-piece + footwear | Dress + shoes | ✓ |
| One-piece | One-piece + mid + footwear | Dress + cardigan + shoes | ✓ |
| One-piece | One-piece + outer + footwear | Dress + jacket + shoes | ✓ |
| One-piece | One-piece + mid + outer + footwear | Dress + cardigan + coat + shoes | ✓ |
| One-piece | One-piece + top | Dress + t-shirt | ✗ |
| One-piece | One-piece + bottom | Dress + pants | ✗ |
| Top+Bottom | Base + bottom + footwear | T-shirt + jeans + shoes | ✓ |
| Top+Bottom | Base + mid + bottom + footwear | T-shirt + sweater + jeans + shoes | ✓ |
| Top+Bottom | Base + outer + bottom + footwear | T-shirt + jacket + jeans + shoes | ✓ |
| Top+Bottom | Base + mid + outer + bottom + footwear | T-shirt + sweater + jacket + jeans + shoes | ✓ |
| Top+Bottom | Mid + bottom (no base) | Sweater + jeans | ✗ |
| Top+Bottom | Outer + bottom (no base) | Jacket + pants | ✗ |
| Invalid | Two base tops | T-shirt + polo + jeans | ✗ |
| Invalid | Two bottoms | Shirt + jeans + shorts | ✗ |
| Invalid | Two footwear | Shirt + jeans + sneakers + boots | ✗ |

**Key rule:** Every top+bottom outfit MUST have a base layer. Mid/outer layers are additions on top, not replacements.

---

## Preference Learning

### How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│  USER FEEDBACK                                                  │
│                                                                 │
│  👍 Like outfit  ──►  OutfitInteraction { action: "accepted" }  │
│  👎 Dislike outfit ──►  OutfitInteraction { action: "rejected" }│
│                                                                 │
│  Each record stores: items[], occasion, timestamp               │
└─────────────────────────────────────────────────────────────────┘
                               │
                               │ Dashboard loads
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  TRIGGER CHECK                                                  │
│                                                                 │
│  GET /api/preferences/summarize                                 │
│  → Check if 5+ new interactions since last summary              │
│  → If yes, trigger POST in background (non-blocking)            │
└─────────────────────────────────────────────────────────────────┘
                               │
                               │ (50 most recent, last 90 days)
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  GEMINI SUMMARIZATION (gemini-2.5-flash-lite)                    │
│                                                                 │
│  Input per interaction:                                         │
│  {                                                              │
│    "action": "liked" | "disliked",                              │
│    "occasion": "brunch with friends",                           │
│    "items": [                                                   │
│      { "name": "White Tee", "category": "top", "colors": [...]} │
│    ]                                                            │
│  }                                                              │
│                                                                 │
│  Prompt: "Summarize this user's preferences in 3-5 bullets"     │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  PREFERENCE SUMMARY (stored in PreferenceSummary collection)    │
│                                                                 │
│  "- Prefers neutral tops (white, grey, navy)                    │
│   - Likes simple layering (base + jacket) for casual events     │
│   - Rejected outfits with heavy outer layers in warm weather    │
│   - Favors jeans/chinos over dress pants for casual occasions"  │
└─────────────────────────────────────────────────────────────────┘
                               │
                               │ (injected into prompt)
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  RECOMMENDATION REQUEST (/api/recommend)                        │
│                                                                 │
│  USER_PREFERENCES:                                              │
│  - Prefers neutral tops...                                      │
│                                                                 │
│  GPT biases selections toward demonstrated preferences          │
└─────────────────────────────────────────────────────────────────┘
```

### Data Available for Summarization

For each liked/disliked outfit, Gemini receives:

| Field | Description |
|-------|-------------|
| `action` | "liked" or "disliked" |
| `occasion` | Event context (e.g., "casual brunch") |
| `items[]` | Array of item details (name, category, colors, layerRole) |

**Note:** Per-item feedback (e.g., "this jacket was too heavy") is not stored. Gemini infers patterns from which complete outfits were liked vs disliked.

### When Summarization Runs

| Trigger | Condition |
|---------|-----------|
| Dashboard load | If 5+ new interactions since last summary |
| Minimum data | Requires at least 3 interactions to generate |

Summarization runs in the **background** and does not block the UI.

### Why Summarize Instead of Raw Feedback?

| Approach | Tokens | Quality |
|----------|--------|---------|
| Raw feedback (50 records) | ~3000+ | Noisy, may overfit to outliers |
| Summarized preferences | ~100 | Pattern-focused, noise reduced |

---

## Regeneration with Locked Items

When a user dislikes an outfit but wants to keep certain items:

### Process

1. User opens feedback modal on a disliked outfit
2. User marks items to **lock** (keep) and optionally marks items they **dislike**
3. User specifies what to **change** (top/bottom/outer/any)
4. User can add optional notes explaining why they disliked it
5. System saves basic interaction to `OutfitInteraction` and calls regeneration

### Prompt Additions for Regeneration

```
LOCKED_ITEMS (MUST be included in every outfit):
[
  { "id": "abc123", "name": "Blue Jeans", "category": "bottom", ... }
]

CHANGE_TARGET: "outer"
- You MUST include ALL locked items in every suggested outfit.
- Primarily change the outer items.

USER_FEEDBACK (why previous outfits were disliked):
Need something warmer on top
```

### Validation for Regeneration

Additional check: All locked item IDs must appear in every generated outfit.

### Data Persistence Note

The locked items and detailed per-item feedback are used **only for the regeneration prompt** - they are not persisted long-term. The `OutfitInteraction` record stores just:
- The outfit items
- Action: "rejected"
- Occasion context

This keeps the data model simple while still enabling intelligent regeneration.

---

## Tunable Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| maxItems | 80 | Max items sent to GPT after shortlisting |
| temperature | 0.5 | GPT creativity (0=deterministic, 1=creative) |
| maxOutfits | 5 | Number of outfits to generate |
| occasionWeight | 0.6 | Weight for occasion score in shortlisting |
| temperatureWeight | 0.4 | Weight for temperature score in shortlisting |
| topQuota | 25 | Max tops in shortlist |
| bottomQuota | 20 | Max bottoms in shortlist |
| outerQuota | 15 | Max outer layers in shortlist |
| onePieceQuota | 10 | Max one-pieces in shortlist |
| footwearQuota | 10 | Max footwear in shortlist |

---

## Summary

The recommendation model:

1. **Scores items** using occasion relevance (60%) and temperature appropriateness (40%)
2. **Shortlists** top items per category (max 80 total) to fit GPT context
3. **Injects user preferences** (learned from feedback) into the prompt
4. **Prompts GPT-4o-mini** with strict outfit structure rules
5. **Validates outputs** to ensure only valid combinations are returned
6. **Supports regeneration** with locked items for iterative refinement
