## Animesh – Contributions

### Product & Architecture
- **Initial product conception**: Came up with the core idea for an AI-powered outfit recommender that works from a personal wardrobe and supports visual try-on.
- **System design direction**: Drove the shift along with the team from a custom ML recommendation engine to an LLM-only pipeline (GPT API), including how we incorporate layering, environment context, and personalization.
- **CV + app integration strategy**: Defined how the external CV service, wardrobe data model, and recommendation flow should interact end-to-end.

### Wardrobe & CV Pipeline
- **First wardrobe implementation**: Built the first pass of the “add wardrobe item” flow, allowing users to manually enter clothing items.
- **Automated wardrobe with CV**: Designed and implemented the CV-driven ingestion flow to infer item attributes (category, type, colors, etc.) and populate the wardrobe automatically.
- **Photo upload + CV merge**: Merged the standalone “add a photo” flow with the CV service so uploading a photo triggers background removal, cropping, and attribute extraction as a single experience.
- **CV service deployment**: Deployed the Python CV service as a Hugging Face Space.
- **One-piece & layering support in CV**: Extended the CV schema and logic to correctly handle one-piece outfits (dresses, jumpsuits) and `layerRole` (base/mid/outer), and pushed those changes through to the app.

### Frontend Experience (Wardrobe & Dashboard)
- **Wardrobe UI v2**: Iterated on and “prettified” the wardrobe UI: improved card layout, availability toggles, tag-based occasion input, and clearer display of category, type, seasons, and layer role.
- **Visual try-on groundwork**: Took a pass at visual try-on but ended up scraping it.
- **CV bg removal**: Made it so the CV returns a bg removed image so the saved image in the wardrobe looks better.

### Recommendation & Personalization
- **LLM recommendation design**: Co-led the design idea from custom ML to GPT-based recommendations, including:
  - Shortlisting strategy (availability, occasion, temperature hint, category quotas).
  - Prompt structure for layering (top/bottom vs one-piece, valid outfit structures).
  - Handling environment context (event description + optional weather).
- **Like/Dislike feedback system**: Implemented the end-to-end feedback flow:
  - Per-outfit like/dislike actions on the dashboard.
  - History page that surfaces past accepted/rejected outfits.
  - Backend interactions API for logging feedback events.
- **Personalization summary**: Drove and implemented the personalization summary design:
  - Capturing interaction reasons (inferred “why” behind likes/dislikes).
  - Generating and updating a natural-language style profile that biases future recommendations.

### Non-Coding Contributions
- **Team coordination & design reviews**: Facilitated discussions on trade-offs (e.g., CV vs managed APIs, ML vs LLM, layering strategies) and aligned the team on a realistic but ambitious final design.
- **Documentation & spec writing**: Helped define and refine design docs (recommendation pipeline, CV behavior, personalization flow) so the implementation stayed coherent as the system evolved.
