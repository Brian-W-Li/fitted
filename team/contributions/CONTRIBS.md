## Team Contributions Summary

This document summarizes each team member’s contributions, compiled from the individual reports in `team/contributions/contrib_<Name>.md`. It includes both coding and non-coding work (design, planning, testing, documentation, coordination).

---

### Animesh

- **Primary code areas**: Product vision, CV pipeline & HF deployment, wardrobe + dashboard UI, recommendation & personalization APIs and design.
- **Key features implemented**:
  - Original product idea; drove LLM-only recommendation design with the team (shortlisting, layering, environment context).
  - First manual wardrobe flow; CV-driven ingestion; merged photo upload with CV (bg removal, cropped save); one-piece + `layerRole` in CV and app.
  - Wardrobe UI polish (cards, availability, tag-based occasions); like/dislike flow, history, interactions API; personalization summary (inferred “why” + consolidated profile).
- **Non-coding contributions**: Team coordination, design reviews, documentation/specs (recommendation, CV, personalization).

*Source: `contrib_Animesh.md`*

---

### Brian Li

- **Primary code areas**: Frontend (accounts, auth, wardrobe), image upload into CV pipeline, cross-stack debugging, testing.
- **Key features implemented**:
  - Initial accounts page; sign-in/signup flow with Pengyu; wardrobe search/sort, skip image upload when appropriate, “delete all” wardrobe.
  - App-side image upload UI wired to wardrobe/CV pipeline.
  - Fixed recommendation/context bugs (e.g. false “indoor” from substring `ac` in “beach”); frontend–backend field mismatches; broader reliability fixes.
- **Non-coding contributions**: Product/feature ideas, refactoring suggestions, documentation for leadership/scrum.

*Source: `contrib_Brian.md`*

---

### Jenil

- **Primary code areas**: Legacy ML recommendation engine, ONNX experiment, GPT integration & chat stylist, early wardrobe UI, CV metadata, tests, deployment.
- **Key features implemented**:
  - Built recommendation engine (rules → embeddings, NN, collaborative filtering); ONNX attempt (removed for Vercel); refactored to OpenAI GPT with fashion-aware prompting and AI stylist chat.
  - UI: clickable logo home, outfit order (top → bottom → jacket), image cards, occasion options, top/bottom selector when adding clothes.
  - CV metadata integration; Jest tests for recommendation engine; Vercel deployment fixes; scrum/team setup docs.

*Source: `contrib_Jenil.md`*

---

### Matthew

- **Primary code areas**: MongoDB/schema, early OpenAI recommendation wiring, history & regenerate/lock, testing, design doc, bugfixes.
- **Key features implemented**:
  - Initial MongoDB setup and schema; early ChatGPT-based recommendations (scoring, prompting, validation).
  - History page for liked/disliked outfits; regenerate/locking to keep pieces while refreshing outfits (integrated with feedback flow).
  - Tests for history and recommendation APIs/UI; design doc for architecture; assorted UI/stack bugfixes.

*Source: `contrib_Matthew.md`*

---

### Pengyu

- **Primary code areas**: Cross-page UI polish, account & feedback, wardrobe confirm-step UX.
- **Key features implemented**:
  - Homepage, dashboard, and account consistency and readability; homepage intro copy.
  - Account rating/comment feedback with backend storage; profile photo update and account usability.
  - Wardrobe “Confirm & save” guidance for CV results; dismiss / dismiss-forever via local storage.

*Source: `contrib_pengyu.md`*

---

### Individual contribution files

| Member  | File |
|---------|------|
| Animesh | `team/contributions/contrib_Animesh.md` |
| Brian   | `team/contributions/contrib_Brian.md` |
| Jenil   | `team/contributions/contrib_Jenil.md` |
| Matthew | `team/contributions/contrib_Matthew.md` |
| Pengyu  | `team/contributions/contrib_pengyu.md` |
