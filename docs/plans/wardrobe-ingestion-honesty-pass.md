# Wardrobe ingestion honesty pass (Track 2 friend-readiness)

> **CONVERGED 2026-07-17** (C1–C5 + the color flush + the crop-guard fix landed; a fresh-eyes
> convergence round over the full diff traced 8 named doubts to safe root causes — zero load-bearing).
> Commits: b1215625, 6a8fffd7 (C1), a8157fad (C2), cdbcf6c0 (C3), f3be86dd (crop guard), a520bd11
> (C4/C5). NOT pushed / NOT redeployed — Brian tightens the §Copy drafts, then redeploys both halves.
> Remaining in-pass work: add-another (deferred, §C4). Cosmetic residuals below.

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
- **C4 — Completeness (D4).** Static target hint DONE. **Add-another-without-re-navigating DEFERRED**
  to a focused follow-up (it's a modal-lifecycle change — bulk-add flow — that deserves its own
  design + tests rather than a bolt-on at the tail of a long session; Fable ranked it high-ROI, so
  it's the top of the next-pass list, not dropped).
- **C5 — Mechanical.** Form color swatch: `swatchColor()` paints hex + real CSS names (incl.
  space-collapsed "light blue"→lightblue), else text-only (item-card parity, both use the helper);
  allow removing the last color chip (save-time validation still enforces ≥1); mono font only for
  hex labels. Enter-guard DROPPED (Enter-submit is now useful — with no photo there's no submit
  button so it can't slip a photo-less item through; with a photo it saves). Duplicate-add guard
  NOT NEEDED (the Save buttons are `disabled={saving}`, so a double-tap can't double-submit).

Per-checkpoint: read real files first, match team style, `tsc`+`eslint`+`jest` on touched surface,
one fresh-context review, verify findings against source, mutation-verify any new load-bearing test.
Fresh-eyes convergence round at the end (zero load-bearing or keep going). Commit per checkpoint on
main; never push (Brian pushes + redeploys after approving copy).

## Cosmetic residuals (convergence round — non-blocking, registered not fixed)
- The upload step shows the optimistic CV intro + a (disabled) "Analyze photo" button for the
  sub-second before the `/api/cv/status` probe resolves and flips `cvUnavailable` true. Harmless
  (button disabled until a file is picked; probe is fast; a raced Analyze fails cleanly to cvError).
- Edit of an item whose stored `imagePath` is NOT a `mongo:` path shows no thumbnail (the `<img>` is
  guarded, so no broken image) — doesn't occur in the Track 2 deployment (all paths are `mongo:`).
- A stored edit photo can be Changed but not fully cleared (Remove shows only for a newly-picked
  file). By design (edit never overwrites the stored photo unless a new one is picked).

## Copy (Brian-approved 2026-07-17, provisional "for now")
Brian reviewed the strings below and approved them as-is for the first friend rollout ("I like all
your strings for now") — provisional, may be refined later, but NOT a blocker for redeploy. Listed
here as the single home for the friend-facing copy.

**Photo (C2):**
- No-photo prompt (dashed box): "+ Add a photo" / "A photo is what the style-matching experiment
  measures — the whole point. Recommendations run on the details you enter, so an item without a
  photo still works, but won't count toward the experiment." (Corrected 2026-07-17: the photo does
  NOT feed the stylist prompt — H33, `mlRequestAdapter.ts` — so it must not claim to "power the
  recommendations"; it powers the experiment. Trap-guard: keep this distinction in any future copy.)
- Photo-less save button: "Save without a photo" (tooltip: "This item won't count toward the
  style-matching experiment").
- Preview controls: "Change photo" / "Remove" / "Tap the photo to enlarge".

**CV-off upload step (C3):**
- Intro: "Add a clear photo of the item, then fill in a few quick details."
- Primary button: "Continue →".

**Wardrobe page (C4):**
- Target hint: "For the style-matching experiment, aim for ~15 items with photos — a couple of each
  type (tops, bottoms, shoes, outerwear)."

**Confirm form (C3):**
- Layer-role coaching: "Jacket, coat, or blazer? Set this to Outer layer so it's matched as outerwear."
- Disclosure summary: "More details (optional)".
- Quick guide (3 tips): "Photo & colors matter most: a clear photo is what the style-matching
  experiment measures, and the real colors (with the name and type) power the recommendations." /
  "Category & type: pick the closest match — it sets how
  outfits are built. For a jacket or coat, set Layer role to Outer." / "Occasions / contexts: add how
  you actually wear it (e.g. gym, office, date night) to sharpen recommendations."
