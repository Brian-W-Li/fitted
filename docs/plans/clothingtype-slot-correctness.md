# clothingType slot correctness — the "suit dress" mis-slot fix

> **Status: PLANNED (2026-07-22).** Decisions A–E Fable-reviewed to convergence (2 rounds → STABLE).
> Motivated by a live friend-closet failure mined from the deployed Atlas DB. Build ahead of the next
> recruit wave — a silent mis-slot starves yield in exactly the dress-heavy stratum the M6 re-measure
> needs. Owner: this plan (Track-2-adjacent, pre-recruit). Related: Spec §18 (W-track ingestion),
> §23-H52 (taxonomy legibility, rung-2), §23-H70 (coord/sets, registered here).

## 1. Case study — friend "Zhiyun" (real, mined 2026-07-22)

A dress-heavy 6-item closet, all items photographed, one ~46-minute session, **13 renders, 0 ratings
given**, no return. The DB-mine explains all of it with a single defect.

Her items (typed name / **derived `clothingType`** / user-picked `category` / `subCategory`):

| name | clothingType | category | subCategory | reality (from photo) |
|---|---|---|---|---|
| plaid shirt | top | top | shirt | brown gingham shirt ✓ |
| **"suit dress"** | **dress** ✗ | **bottom** | **skirt** | grey pleated **mini-skirt** — the skirt half of a suit set |
| knitwear | top | top | cardigan | cream cardigan ✓ |
| "dress" | dress | one piece | — | green dress ✓ |
| blazer | outer_layer | top | coat | grey cropped blazer ✓ |
| Sweatshirt | top | top | sweatshirt | pink sweatshirt ✓ |

**One of six items is mis-slotted, and it was her only bottom.** She had correctly filed it
`category=bottom` *and* `subCategory=skirt`; the engine still typed it `dress`. Consequences (all
confirmed in snapshot `diagnostics`):

- **Rescue on any top** (plaid shirt / knitwear / sweatshirt, ~8 renders) → `notEnoughItems`, 0
  candidates, *"add a bottom to build an outfit around this top"* — the engine sees zero bottoms.
- **Daily** → the LLM's 6 candidates were **all rejected** (`mixedTemplate`/`roleTypeMismatch`), 0
  surfaced — with no bottoms it could only propose invalid combos and never cleanly fell back to
  dress-alone.
- **Rescue on the two dresses** → 1–2 valid looks surfaced, but flagged "insufficient / **try again**"
  (the `N_SURFACED=3` variety floor). She re-rolled, got the identical looks (combinatorially capped),
  and read it as broken.
- **Net: ~85% of her renders returned nothing; she rated nothing and left.** A single classifier
  precedence error → near-total yield loss for one friend.

**The load-bearing context:** the AI never sees the photos (CV off; the render prompt strips
`image_url` — text-only). So **the typed labels are the model's eyes**, and one wrong label silently
blinds it. This will recur — every closet carries a garment or two the name-classifier mis-slots
(rompers, jumpsuits, skorts, shackets, long cardigans, suit sets), and because it fails *silently*
you only find it by mining.

## 2. Root cause (code-level)

`clothingType` (the 5-value engine slot) is derived at ingestion by `deriveClothingType` in
`fitted/lib/clothingType.ts` — an ordered first-match cascade. Rung 1 is:

```
if (cat==="one piece" || ONE_PIECE_KEYWORDS || isOnePieceDress) return "dress";
```

where `isOnePieceDress` fires when the **name** contains a bare "dress" not followed by a garment
noun. Her "suit dress" name trips it, so **rung 1 returns "dress" and short-circuits before rung 2
ever reads `category=bottom` or the `skirt` keyword.** A stylistic *name* token beat two explicit
*structural* signals. The derivation is single-homed in this one TS file (no Python mirror), so the
fix is a one-runtime change with no cross-runtime drift.

## 3. Design frame — why layered, not one classifier

Brian's instinct ("a bunch of hardcoded classifiers, or something else, or both") is right that big
keyword files are how much of the world works — and rules are the correct tool for the *systematic*
part. But the case study shows the ceiling: **"suit dress" is unresolvable from the name alone** — you
would need to know it's the skirt half of a suit set, which only the human (or the photo) knows. No
rule set escapes genuine ambiguity.

Spec §23-H52 already frames the resolution: *human-like understanding lives in the M6 visual
embedding + relational edge graph; the fixed 5-type is coarse **plumbing** (outfit-slot structure),
not where perception sits.* So the goal is **not** a smarter perception engine in the type label — it
is to make the coarse plumbing (a) correct on the systematic cases and (b) legible + correctable on
the ambiguous residue. That is a layered defense-in-depth, which is also H52's own resolution ladder
(rules → human edit → context):

- **L1 — rules** (deterministic, free): fix precedence, extend coverage. Catches the systematic ~all.
- **L2 — human-in-the-loop**: surface the derived slot and let the owner see/correct it. The human is
  the ground-truth oracle for the irreducible ambiguity; the app just has to *show its guess* instead
  of silently acting on it.
- **L3 — the bridge**: name↔structure *conflict* is the ambiguity tell — trust the more-specific
  structural signal (L1), and surface the conflict to the user (L2/census).

## 4. Decisions (A–E, resolved)

**A — Layered, not one mechanism. [SHIP]** L1 + a visibility slice of L2 + a census slice of L3 ship
now; the full override, the persisted conflict flag, VLM photo-classify, and the coord-set model are
deferred (below). Effort caveat: L1 carries most of the pre-recruit value; do not build every layer to
equal depth.

**B — Precedence fix (L1 core). [SHIP]** Split the old combined outer rung and slot the bare-dress
name-guess *between* the two halves. New cascade order:

1. one-piece-structural: `cat==="one piece"` ∥ `ONE_PIECE_KEYWORDS`
2. bottom: `cat∈{bottom,bottoms}` ∥ `BOTTOM_KEYWORDS` — **add `skort`, `culottes`, `capris`**
3. shoes: `cat==="footwear"` ∥ `SHOE_KEYWORDS`
4. `layerRole==="outer"` → `outer_layer`  *(a deliberate human structural choice beats a name guess)*
5. **bare-dress** (`isOnePieceDress` = `BARE_DRESS && !ADJECTIVAL_DRESS`) → `dress`
6. `OUTER_KEYWORDS` → `outer_layer`  *(now below bare-dress, so `[outer-noun + "dress"]` compounds win)*
7. default `top`

**Principle to pin in the doc-comment:** *structural signals (category equality, `layerRole`, and the
bottom/shoe garment nouns — no dress is named with "skirt"/"heels" as its head noun) beat the
bare-dress guess; the bare-dress guess beats the outerwear name-keywords, because `[outer-noun +
"dress"]` compounds (blazer dress, coat dress) are dresses while a real outer garment carrying a bare
non-adjectival "dress" token essentially never occurs.*

*Trap-guard / free property:* `DRESS_MODIFIER_NOUNS` (the adjectival-dress guard) is **derived** from
the rung vocabularies, so the three new bottom keywords automatically extend it ("dress capris" stays
adjectival → bottom) and the existing drift-guard test grows coverage — do **not** hand-mirror them.

*Regression test set* (pin the adversarial mirrors, not just her row): `suit dress`/cat=bottom→bottom,
`blazer dress`/cat=top→dress, `coat dress`→dress, `dress coat`→outer_layer, `sweater dress`→dress,
`shirt dress`→dress, `dress shoes`→shoes-via-adjectival, `dress pants`→bottom, `black jumpsuit
dress`→dress, `wrap dress`/cat=top→dress, `duster dress`+layerRole=outer→outer_layer, `cargo
skort`→bottom.

**C — Visibility now; full override → W-track. [SHIP]** Pre-recruit ships **visibility only**: a
client-side *"Files as: <Bottom>"* chip on the add/edit form, computed from the same
`deriveClothingType` (pure TS, clean import), recomputed from **live form state** (not the stored
item), so the contradiction is visible *before* save — the moment Zhiyun would have caught
`category=bottom` / `subCategory=skirt` vs "Files as: **Dress**". No PATCH change, no schema, no second
enum.

*Deferred to the W-track rung-2 unit (not now):* the full **override** control (labeled in human words
— "Worn as: Top / Bottom / Full outfit / Layer / Shoes", never "clothingType"), which must land
**with** a `clothingTypeSource: "derived" | "user"` provenance bit (echo user-set values only — a blind
echo re-pins stale slots; no echo clobbers corrections) **and** the §23-H52 trap-guard text reconciled
in the same commit ("must echo in every PATCH" → "must echo user-set values only"). Visibility-first
resolves the echo dilemma by not writing anything yet.

**D — Fail-loud on ambiguity (split). [SHIP D1; defer D2]** **D1:** replace the `notEnoughItems`
dead-end copy with a **slot census** computed Next-side from the full wardrobe — *"We see 5 tops and 0
bottoms — if one of these is actually a bottom, fix it in your Wardrobe →"*. Highest copy-leverage
change in the set; converts eight silent dead-ends into one actionable prompt. **Copy trap-guard
(§18 anti-guilt line):** honest description only — *"We see … 0 bottoms"*, never *"you haven't added a
bottom yet."* **D2** (a persisted conflict flag on `WardrobeItem`) is deferred to the W-track; the
client-side "Files as" chip already delivers the ingestion-time half with zero schema.

**E — Scope boundaries. [SHIP]** Coord/suit **sets** (her "suit dress" is really one purchase =
blazer + skirt across N slots; the app has no set representation) → **register as §23-H70**, out of
scope (a representation question, M6/H25/H28-adjacent). VLM photo-classify stays §18 `[STAGED]` (the
owner is standing right there at ingestion — cheaper + better than a vision call). The
`category`→`clothingType` filter-key migration stays deferred (H52 mandates: only after correction
exists).

### Ride-alongs (surfaced by the review; ride this session's redeploy)

- **F16 — the futile "try again".** The insufficient-after-generation hint invites a re-roll that is
  combinatorially incapable of producing more. It is **two** engine constants —
  `_INSUFFICIENT_AFTER_GENERATION_HINT` and `_DAILY_INSUFFICIENT_AFTER_GENERATION_HINT`
  (`fitted_core/rescue.py`), both ending "or try again." **Owner decision: Python-side** (single-home:
  the engine owns the string; Next surfaces it verbatim). Drop "or try again", say *"add a few more
  pieces for more looks."* Fix **both** constants (a half-fix leaves the daily path inviting the same
  futile re-roll) and re-pin the pytest string assertions. Rides the already-scheduled Fly redeploy.
  *Keep the actionable hints unchanged* (e.g. "add a bottom to build an outfit around this top" is good
  — only the retry-inviting insufficient ones change).
- **Live-rows corpus diff (also the fix that unblocks Zhiyun).** After B lands, a **read-only** diff of
  stored vs post-B re-derived `clothingType` over the live DB surfaces every already-collected mis-slot
  (incl. hers). Since no override UI exists yet, all stored values are derived → the diff is clean to
  interpret. Fix flagged rows via a **logged re-derive-and-PATCH** migration (a future
  `clothingTypeSource` defaulting to `"derived"` means these PATCHes won't later be misread as
  human-set). Brian runs it (mutates the live friend corpus).
- **Win-back acceptance test → runbook §8.** The real acceptance test is out-of-session: invite Zhiyun
  back post-fix and confirm she now gets outfits she can rate.

## 5. Build ladder

- **C1 — B (precedence + keywords + tests).** Edit `lib/clothingType.ts` (split rungs 4/6, insert
  bare-dress at 5, add skort/culottes/capris, update the doc-comment principle). Add the adversarial
  regression set + confirm the drift-guard test still passes. `npm test` + `tsc` + eslint on touched
  files. **Light audit loop** (pure function, strong test).
- **C2 — D1 census + C visibility chip.** `lib/recommendCopy.ts` slot-census copy (honest wording) +
  wire it into the dashboard empty state; the "Files as" chip on the add/edit form (live form state).
  Jest for the copy; RTL for the chip if the harness reaches it. **Light loop.**
- **C3 — F16 (Python).** Both `rescue.py` constants + pytest re-pins. **Light loop.** (Ships on the Fly
  redeploy.)
- **C4 — live-rows diff + migration.** A gated read-only diff script (mirrors the other `track2-*`
  scripts) + a logged re-derive-and-PATCH pass. **Heavier care** — it mutates the live friend corpus;
  dry-run + before/after dump, Brian executes.
- **Docs (same session as the code they describe):** register §23-H70 (coord-sets); record the
  W-track rung-2 obligations under §18/H52 (override + `clothingTypeSource` provenance + trap-guard
  reconciliation) as the deferred unit; add the Zhiyun win-back to runbook §8; confirm §23-H52 stays
  RESOLVED with rung-2's *surface* half now partially implemented (visibility), *correct* half still
  W-track.

## 6. Rollout ordering (vs the recruit clock)

C1 → C2 → C3 land + **redeploy both halves** (web via `npx vercel --prod` from `fitted/`; service via
`fly deploy` from `ml-system/`, `fly scale show` = 1). Then C4 fixes Zhiyun's stored closet. All of
this before the next friend, because the bug class concentrates on dress-adjacent names — precisely the
≥1 dress-heavy closet the recruit plan targets and the re-measure's scoreable-cluster certificate
needs. Re-run the one-render `bindable:true` gate after redeploy (runbook §8 pre-friend re-verify).
