# Wardrobe ingestion honesty pass (Track 2 friend-readiness)

> Active plan. Client-only polish of the wardrobe add/edit surface so a friend can produce
> *usable ML data* (photos + honest attributes + honest feedback) — the Track 2 data-shaped ask
> (runbook §8). Design settled 2026-07-17 via two source-grounded audits + a Fable seat; all five
> hard calls resolved below. **Scope discipline: every change lands in client copy / hierarchy /
> state / tests — no backend, no wire-shape, no derivation-seam changes.**

## The one sentence
The form should tell the friend the truth about **what the experiment needs** and **what the
system does**. Today its visual hierarchy lies: the photo (the single ML-critical input) is
optional, previewless, and un-changeable, while recommender-unused fields and CV coaching (on a
path where CV never runs) dominate.

## Ground truth (verified against source)
- **Feeds the stylist today:** `name`, `clothingType` (from Category+Type+`layerRole`, derived
  server-side), `colors`, `occasions`. `warmth` is keyword-derived at ingestion.
- **`layerRole` IS load-bearing** — `deriveClothingType` (`lib/clothingType.ts:132`) files
  `layerRole==="outer"` → `outer_layer` FIRST in order, and the route passes it
  (`app/api/wardrobe/route.ts:202`). It is the one explicit user knob over the outfit slot, and the
  safety net for outerwear (the Category dropdown has no "Outerwear" value).
- **Stored-but-UNUSED by the recommender:** `pattern`, `fit`, `brand`, `size`, `notes`. `seasons`
  only nudges warmth ±2. `material`/`formality`/`styleTags` are reserved-empty W-track columns.
- **Photo** never reaches the stylist prompt (H33) but IS the whole point of the M6/H26
  image-embedding re-measure — a photo-less item contributes zero.
- **CV is OFF in production** (`CV_SERVICE_URL` unset) → manual entry is the only real path.

## Resolved decisions (Fable seat, 2026-07-17)
- **D1 — Photo: strong-nudge (not hard-require).** Photo becomes the hero step (large preview,
  re-pick, enlarge). Saving without one is a deliberate secondary action with an **honest** label
  ("won't count toward the experiment"). Rationale: a hard block breeds fake-satisfied data (floor
  photos / abandonment) — the anti-capture failure the ambition forbids. Reinforced out-of-band by
  Brian telling friends photos are the point. *(Brian confirmed.)*
- **D2 — Collapse `pattern` + `fit`** behind a "More details (optional)" disclosure; **keep
  `layerRole` in the primary flow** with point-of-need coaching. Rewrite the guide to name the real
  load-bearing set; delete the false "CV may be wrong" coaching; kill the dead "Analyze photo" CTA.
  Wire shape unchanged (the collapsed fields still submit).
- **D3 — Leave the clothingType/category derivation seam UNTOUCHED.** Do **not** add an "Outerwear"
  category value (that is the §18 premature W-track migration, with the H52 "PATCH must echo
  clothingType" trap inside — a one-way door). The safe outerwear win is the `layerRole` coaching
  (pure copy, zero seam risk). Do not surface a read-only derived slot (read-only-wrong-with-no-fix
  is a trust hit this pass can't cash).
- **D4 — Completeness:** static experiment-framed **target hint** YES; **add-another-without-
  re-navigating** YES (highest-ROI friction removal); **category-depth nudge NO** (progress-bar
  guilt = the anti-capture line; Brian says it in person).
- **D5 — Stand up jsdom + RTL now, minimally.** Two behavioral tests only: the photo-bypass gate,
  and that collapsed fields still submit in the wire shape. Not a component-testing culture — just
  the two tests this pass needs + the harness. *(Brian confirmed.)*

## Out of scope (do NOT do)
Derivation seam / category vocabulary / coerce paths / any clothingType-surfacing-or-correcting UI
(§18 deferred W-track + H52 trap); hard photo block; live depth-nudges / progress mechanics; any
backend, route, model, or wire-shape change.

## User-facing copy = DRAFT-FOR-BRIAN
Every new user-facing string ships as an honest **working draft** and is listed in §Copy below for
Brian to tighten in his voice **before the single redeploy**. Nothing reaches a friend until he
approves it. (The escape-hatch label, the target hint, the layerRole coaching line, the guide
rewrite, the CV-off intro copy.)

## Checkpoint ladder
- **C1 — Test infra.** jsdom jest *project* for `.test.tsx` (jsx-transform override) alongside the
  node project; one trivial render test proves it. `npm test` runs both. Floors unchanged otherwise.
- **C2 — Photo hero + strong-nudge (D1).** Confirm-form photo preview (contained, re-pick, enlarge
  lightbox); no-photo save = deliberate honestly-labeled secondary action. + behavioral test:
  no-photo → primary save gated; deliberate bypass → saves with the honest label shown.
- **C3 — Honesty (D2).** Kill dead "Analyze photo" CTA + fix CV-off intro copy; collapse
  pattern/fit behind disclosure (layerRole stays primary + coached); rewrite the guide. + behavioral
  test: collapsed fields still submit in the wire shape.
- **C4 — Completeness (D4).** Static target hint; add-another-without-re-navigating.
- **C5 — Mechanical.** Form color swatch: render the color only when it's a real CSS color
  (`isHex || CSS.supports('color', c)`), else text-only (item-card parity); Enter-guard on Name;
  allow removing the last color chip; duplicate-add guard on double-tap.

Per-checkpoint: read real files first, match team style, `tsc`+`eslint`+`jest` on touched surface,
one fresh-context review, verify findings against source, mutation-verify any new load-bearing test.
Fresh-eyes convergence round at the end (zero load-bearing or keep going). Commit per checkpoint on
main; never push (Brian pushes + redeploys after approving copy).

## Copy (draft — for Brian's voice, swap before redeploy)
Every string below is a WORKING DRAFT shipped so the flow is testable; none has reached a friend
(not redeployed). Tighten in your voice, then redeploy.

**Photo (C2):**
- No-photo prompt (dashed box): "+ Add a photo" / "This is what powers the recommendations — and the
  style-matching experiment. Items without a photo still work, but won't count toward it."
- Photo-less save button: "Save without a photo" (tooltip: "This item won't count toward the
  style-matching experiment").
- Preview controls: "Change photo" / "Remove" / "Tap the photo to enlarge".

**CV-off upload step (C3):**
- Intro: "Add a clear photo of the item, then fill in a few quick details."
- Primary button: "Continue →".

**Confirm form (C3):**
- Layer-role coaching: "Jacket, coat, or blazer? Set this to Outer layer so it's matched as outerwear."
- Disclosure summary: "More details (optional)".
- Quick guide (3 tips): "Photo & colors matter most: a clear photo and the real colors are what power
  the recommendations — and the experiment." / "Category & type: pick the closest match — it sets how
  outfits are built. For a jacket or coat, set Layer role to Outer." / "Occasions / contexts: add how
  you actually wear it (e.g. gym, office, date night) to sharpen recommendations."
