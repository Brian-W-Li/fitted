## Design Document

[Google Design Document](https://docs.google.com/document/d/1XsFUzTNdZgI-yt-XzN2jiorWx_H1wOgkCrTTxoEFjFY/edit?usp=sharing)

For detailed recommendation pipeline design (shortlisting, prompting, validation), see [RECOMMENDATION_MODEL.md](./RECOMMENDATION_MODEL.md).

#### High-Level System Architecture
```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              FITTED SYSTEM ARCHITECTURE                         │
└─────────────────────────────────────────────────────────────────────────────────┘

                                    ┌─────────────┐
                                    │    User     │
                                    │  (Browser)  │
                                    └──────┬──────┘
                                           │
                                           │ HTTPS
                                           ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           FRONTEND (Next.js + React)                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────┐ │
│  │   Sign In   │  │  Wardrobe   │  │    Home     │  │   History   │  │ Account │ │
│  │   Sign Up   │  │    Page     │  │  (Dashboard)│  │    Page     │  │  Page   │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘  └─────────┘ │
│         │               │               │               │               │       │
│         └───────────────┴───────────────┴───────────────┴───────────────┘       │
│                                    │                                            │
│                            Sidebar + AuthGate                                   │
└────────────────────────────────────┼────────────────────────────────────────────┘
                                     │
                                     │ API Routes
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                            BACKEND (Next.js API Routes)                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │ /api/auth/*  │  │/api/wardrobe │  │/api/recommend│  │/api/interact │         │
│  │   (sync)     │  │   (CRUD)     │  │  (GPT-4o)    │  │   (history)  │         │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘         │
│         │                 │                 │                 │                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                           │
│  │/api/cv/infer │  │/api/cv/status│  │/api/preferenc│                           │
│  │  (image AI)  │  │  (health)    │  │  es/summarize│                           │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘                           │
└─────────┼─────────────────┼─────────────────┼─────────────────┼───────────────────┘
          │                 │                 │                 │
          ▼                 ▼                 ▼                 ▼
┌─────────────────┐  ┌─────────────────────────────────────────────────────────────┐
│   Firebase      │  │                        MongoDB                              │
│   Auth          │  │  ┌─────────┐  ┌─────────────┐  ┌───────────────────┐        │
│  ┌───────────┐  │  │  │  User   │  │ WardrobeItem│  │ OutfitInteraction │        │
│  │  Google   │  │  │  │ Model   │  │    Model    │  │      Model        │        │
│  │  Email    │  │  │  └─────────┘  └─────────────┘  └───────────────────┘        │
│  └───────────┘  │  │  ┌──────────────────┐  ┌──────┴──────┐                     │
└─────────────────┘  │  │ PreferenceSummary│  │ WardrobeImage│                     │
                     │  │     Model        │  │    Model     │                     │
                     │  └──────────────────┘  └──────────────┘                     │
                     └─────────────────────────────────────────────────────────────┘
                                          │
                                          │
          ┌───────────────────────────────┼───────────────────────────────┐
          │                               │                               │
          ▼                               ▼                               ▼
┌─────────────────────┐      ┌─────────────────────┐      ┌─────────────────────┐
│     OpenAI API      │      │   Google Gemini     │      │  External CV Service│
│    (GPT-4o-mini)    │      │  (2.5-flash-lite)   │      │  (CV_SERVICE_URL)   │
│                     │      │                     │      │                     │
│  - Outfit generation│      │  - Preference       │      │  - Image analysis   │
│  - Regeneration     │      │    summarization    │      │  - Category/color   │
│    with locked items│      │    from feedback    │      │    inference        │
└─────────────────────┘      └─────────────────────┘      └─────────────────────┘
```

#### Key Features

| Feature | Description |
|---------|-------------|
| **Outfit generation** | GPT-4o-mini generates outfit combinations from shortlisted wardrobe items. Strict validation ensures valid structures (base top + bottom, one-piece, layering rules). |
| **Footwear** | When the wardrobe has footwear, every outfit must include exactly one footwear item. Post-processing injects footwear if the LLM omits it. |
| **Context detection** | Event description is parsed for temperature hints: `cold`, `hot`, `outdoor`, `indoor`, `mild`. Word-boundary matching avoids false positives (e.g. "beach" no longer misclassified as indoor). |
| **Preference learning** | Gemini summarizes user feedback (likes/dislikes) into a preference profile. Injected into the recommend prompt to bias selections. |
| **Regeneration** | Users can lock items and regenerate alternatives. Disliked items are excluded from the regenerate shortlist. |
| **CV status probe** | `/api/cv/status` checks CV service availability (3s timeout). Wardrobe add-item flow can show fallback message if CV is down. |

---

## User Interface & UX

### High-Level User Flow

```
┌──────────────────────────────────────────────────────────────────────────┐
│                           FITTED USER FLOW                                │
└──────────────────────────────────────────────────────────────────────────┘

    ┌─────────────┐
    │  New User   │
    └──────┬──────┘
           │
           ▼
    ┌─────────────┐      Already have account?      ┌─────────────┐
    │   Sign Up   │ ─────────────────────────────▶  │   Sign In   │
    └──────┬──────┘                                 └──────┬──────┘
           │                                               │
           └───────────────────┬───────────────────────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │     HOME PAGE       │
                    │  (Recommendations)  │
                    └──────────┬──────────┘
                               │
           ┌───────────────────┼───────────────────┐
           │                   │                   │
           ▼                   ▼                   ▼
    ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
    │  WARDROBE   │     │   HISTORY   │     │   ACCOUNT   │
    │             │     │             │     │             │
    │ Add clothes │     │ View liked/ │     │ Edit profile│
    │ Edit/Delete │     │ disliked    │     │ Sign out    │
    │ Upload pics │     │ outfits     │     │             │
    └──────┬──────┘     └─────────────┘     └─────────────┘
           │
           │ Items added
           ▼
    ┌─────────────────────┐
    │     HOME PAGE       │
    │                     │
    │ 1. Select occasion  │
    │ 2. Add context      │
    │ 3. Get outfits      │
    │ 4. Like/Dislike     │
    └─────────────────────┘
```

