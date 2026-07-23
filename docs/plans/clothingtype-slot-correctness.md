# clothingType slot correctness — the "suit dress" mis-slot fix

> **Status: PLANNED (2026-07-22) — CONVERGED.** Decisions Fable-reviewed (2 rounds) THEN
> convergence-audited by three independent lanes (adjacent / orthogonal / forward) against the whole
> live corpus + real source, which corrected the plan on load-bearing points a single "STABLE" had
> missed (D1 is a wire change not a copy edit; B does not convert the failing friend on its own — the
> migration does; F16 is load-bearing not a ride-along; the weather dimension is dead → H71). A final
> re-audit round then caught that the D1 fold-in was itself buggy (the census was never delivered — the
> `reasonHint` early-return + no replay source) and, after the fix below, returned **CONVERGED** (a
> fresh pass with zero load-bearing findings — not a self-declared stop). Build-gate Fable go/no-go
> 2026-07-23: **GO** — two pins folded in place (§4-B inversion pin, §6-C4 mechanism; + the §4-D wire
> contract pinned). Build ahead of the next
> recruit wave. Owner: this plan
> (Track-2-adjacent, pre-recruit). Related: Spec §18 (W-track ingestion), §23-H52 (taxonomy legibility
> rung-2), §23-H70 (coord/sets), §23-H71 (dead weather dimension — registered here).

## 1. Case study — friend "Zhiyun" (real, mined from the live Atlas DB 2026-07-22)

A dress-heavy 6-item closet, all photographed, one ~46-minute session, **13 renders, 0 ratings**, no
return. Her items (name / **derived `clothingType`** / user-picked `category` / `subCategory`):

| name | clothingType | category | subCategory | reality (from photo) |
|---|---|---|---|---|
| plaid shirt | top | top | shirt | brown gingham shirt ✓ |
| **"suit dress"** | **dress** ✗ | **bottom** | **skirt** | grey pleated **mini-skirt** — the skirt half of a suit set |
| knitwear | top | top | cardigan | cream cardigan ✓ |
| "dress" | dress | one piece | — | green dress ✓ |
| blazer | outer_layer | top | coat | grey cropped blazer ✓ |
| Sweatshirt | top | top | sweatshirt | pink sweatshirt ✓ |

**One item mis-slotted, and it was her only bottom.** The AI never sees photos (CV off; the render
prompt strips `image_url` — text-only), so **the typed labels are the model's eyes** and one wrong
label silently blinds it.

**The failure is a wall with two entrances.** The whole-corpus mine (3 accounts, 20 items, 22 renders,
6 interactions) shows the same "no usable bottom → 0 outfits surfaced" wall reached two ways:
- **Mislabel (Zhiyun):** her skirt typed `dress` → engine sees 0 bottoms. Rescue-on-any-top →
  `notEnoughItems`, *"add a bottom to build an outfit around this top"* (8 of her 13 renders). Daily →
  LLM's 6 candidates all rejected `mixedTemplate/roleTypeMismatch` → 0 surfaced.
- **Genuinely absent (your `bkup` dev-as-friend account):** at 3 items (2 tops + shoes, **no bottom**)
  the identical 0-surfaced wall (`incompleteTwoPiece`); he recovered by **adding** a bottom.

So the mis-slot is *one entrance to a wall that also has a legitimate entrance*. **B (below) fixes the
mislabel entrance; D1 (the slot census) is what generalizes to both.** The empirical spine:
- **B is surgical:** replaying all 20 items through current-vs-proposed-B classifiers changes **exactly
  1 of 20** (Zhiyun's suit dress → bottom); every near-miss (bkup's "White jacket"/sub=jacket, Zhiyun's
  "blazer"/sub=coat) correctly stays `outer_layer`. Zero collateral.
- **The feedback loop works:** 6 correctly-bound interactions across the two dev accounts (with
  per-item feedback + reason codes). Whenever a clean `nSurfaced≥3` set surfaced, the user rated.
  Zhiyun's 0 is explained by empties + the futile "try again" copy — **not** a broken path.
- Integrity clean: 0 orphan images, 0 dangling interaction refs, 0 redacted rows.

## 2. Root cause (code-level)

`clothingType` (the 5-value engine slot) is derived at ingestion by `deriveClothingType` in
`fitted/lib/clothingType.ts` — an ordered first-match cascade whose rung 1 is
`if (cat==="one piece" || ONE_PIECE_KEYWORDS || isOnePieceDress) return "dress"`, where
`isOnePieceDress` fires on a bare "dress" *name* token. Her "suit dress" trips it, so **rung 1 returns
"dress" and short-circuits before rung 2 reads `category=bottom` or the `skirt` keyword** — a stylistic
name beat two explicit structural signals. Single-homed in this one TS file (no Python mirror).

**Critical: the fix is not retroactive by itself.** The render adapter reads the **stored**
`clothingType` verbatim (`mlRequestAdapter.ts:255`; it only validates the 5-value set, never
re-derives) and `deriveClothingType` is called nowhere in the render path. So changing the classifier
(B) corrects **future** ingestion only — **Zhiyun's already-stored `dress` row stays broken until the
C4 migration re-derives and PATCHes it.** The conversion lever for *her* is the migration; B's job is
(a) correct future ingestion and (b) make that migration land on `bottom`.

## 3. Design frame — why layered, not one classifier

"Suit dress" is unresolvable from the name alone (you'd need to know it's the skirt half of a set), so
no rule set escapes genuine ambiguity. Spec §23-H52 already frames it: *perception lives in the M6
visual embedding + relational edge graph; the fixed 5-type is coarse **plumbing** (outfit-slot
structure), not where perception sits.* The goal is to make the plumbing (a) correct on the systematic
cases and (b) legible + correctable on the ambiguous residue — H52's own ladder (rules → human edit →
context): **L1 rules**, **L2 human-in-the-loop visibility**, **L3 the name↔structure conflict as the
ambiguity tell**.

## 4. Decisions (resolved)

**A — Layered, not one mechanism. [SHIP]** L1 + a visibility slice of L2 + a census slice of L3 ship
now; full override, persisted conflict flag, VLM classify, coord-sets deferred. Effort caveat below is
corrected: **D1 is not a light-loop copy edit** — it carries most of the *generalizing* value and is a
wire change.

**B — Precedence fix (L1 core). [SHIP — surgical, but future-ingestion-only]** New cascade order:

1. one-piece-structural: `cat==="one piece"` ∥ `ONE_PIECE_KEYWORDS`
2. bottom: `cat∈{bottom,bottoms}` ∥ `BOTTOM_KEYWORDS` — **add `skort`, `culottes`, `capris`**
3. shoes: `cat==="footwear"` ∥ `SHOE_KEYWORDS`
4. `layerRole==="outer"` → `outer_layer`  *(deliberate human structural choice beats a name guess)*
5. **bare-dress** (`isOnePieceDress` = `BARE_DRESS && !ADJECTIVAL_DRESS`) → `dress`
6. `OUTER_KEYWORDS` → `outer_layer`  *(below bare-dress, so `[outer-noun+"dress"]` compounds win)*
7. default `top`

Principle to pin in the doc-comment: *structural signals (category equality, `layerRole`, bottom/shoe
nouns — no dress is named with "skirt"/"heels" as head noun) beat the bare-dress guess; the bare-dress
guess beats the outerwear name-keywords, because `[outer-noun+"dress"]` compounds (blazer/coat dress)
are dresses while a real outer garment with a bare non-adjectival "dress" token essentially never
occurs.* Free property (verified): `DRESS_MODIFIER_NOUNS` is derived from the rung vocabularies, so the
3 new bottom keywords auto-extend the adjectival guard ("dress capris"→bottom) and the drift-guard test
grows coverage — do **not** hand-mirror. Regression test pins the adversarial mirrors (suit dress→bottom,
blazer/coat dress→dress, dress coat→outer, sweater/shirt/wrap dress→dress, dress shoes→shoes, dress
pants→bottom, jumpsuit→dress, duster dress+layerRole=outer→outer, cargo skort→bottom), all traced clean.

**Inversion pin (build-gate fold-in).** The existing expectation in `fitted/tests/deriveWarmth.test.ts`
(~:199) pins `{category:"bottom", name:"wrap dress"} → dress` under the OLD §10.3 "name beats a coarse
category" principle, which the `clothingType.ts` doc-comment (~:96-99) also states. Under the new order
this case deliberately **INVERTS to `bottom`** — it is structurally identical to "suit dress" (bare-dress
name vs `cat=bottom`). Flip that assertion and rewrite the doc-comment's §10.3 sentence in the same
commit. The mirror-list "wrap/shirt/sweater dress→dress" entries are the **name-only** case (no
structural signal), resolved at the bare-dress rung. Do **NOT** special-case compound-dress names to keep
the old assertion green — that silently un-fixes the core case. Pin
`{name:"duster dress", layerRole:"outer"} → outer_layer` (rung 4 beats bare-dress) in the same block.

*Scope of B's conversion power (forward-lane count math, verified):* post-B Zhiyun's **daily** (8 valid
outfits) and **skirt-rescue** (6) clear the `N_SURFACED=3` floor and convert; but her **single-top
rescues** (8 of 13 renders) and **dress-rescue** still return honest **2-card "insufficient" partials** —
with 1 bottom + 0 shoes a single forced top/dress forms only 2 distinct outfits (±blazer), structurally
below the floor. **No classifier fix changes that; only more items (a 2nd bottom or shoes) do.** So B
converts the convertible modes; the rest depend on F16 (honest copy) + onboarding (§6).

**C — Visibility now; full override → W-track. [SHIP]** Pre-recruit ships **visibility only**: a
client-side *"Files as: <Bottom>"* chip on the add/edit form, computed from the same `deriveClothingType`
(pure TS import) off **live form state** (not the stored item), so the contradiction (cat=bottom/sub=skirt
vs "Files as: Dress") is visible *before* save. No PATCH change, no schema, no second enum. Deferred to
the W-track rung-2 unit: the full **override** ("Worn as: Top/Bottom/Full outfit/Layer/Shoes"), which must
land **with** a `clothingTypeSource: "derived"|"user"` provenance bit (echo user-set values only) **and**
the §23-H52 trap-guard text reconciled in the same commit.

**D — Slot census (D1) + persisted flag (D2 deferred). [SHIP D1 — re-specified as a WIRE change]**
Adjacent + orthogonal lanes proved D1 as originally written ("edit `recommendCopy.ts` + light loop") is
under-specified: the per-`clothingType` counts do not exist where the copy runs. `emptyStateMessage`
takes only `RenderFlagsLike` (no counts, `recommendCopy.ts:8-13`), `BrowserFlags` has none
(`mlSnapshotMerge.ts:431-435`), and the dashboard never fetches the full wardrobe — the counts exist
**only server-side** in `wardrobeDocs` (`mlRecommend.ts:420`). **Correct D1 is a route→wire→copy change:**
compute the slot census in `mlRecommend.ts` from `wardrobeDocs` → put it on the **live-path** `wireFlags`
(`:603`) → widen `BrowserFlags` + `RenderFlagsLike` + `emptyStateMessage`.

**Two delivery traps the naive wire hits (both must be pinned in the build, found by the convergence
re-audit):**
- **(a) `emptyStateMessage` early-returns the engine hint.** `recommendCopy.ts:33` is
  `if (healthy && f.reasonHint) return f.reasonHint` — and the engine ALWAYS sets `reasonHint` for
  every empty D1 targets (notEnoughItems → "add a bottom…"; insufficient → the F16 string). So a census
  added to the later `notEnoughItems` fallback (`:35`) is **never reached** — it would ship non-functional
  for exactly the friend it protects. The census must be **composed INTO the reasonHint branch** (augment
  line 33: return census-sentence + the engine hint), not appended as a fallback. This also automatically
  covers **both** empty branches (notEnoughItems + insufficientAfterGeneration), since both carry a hint.
- **(b) the replay/dedup paths have no census source.** `flagsFromDoc` runs on the §C.4 early-replay
  (`mlRecommend.ts:404`, which returns **before** the wardrobe fetch at `:420`) and the dedup-winner
  (`:599`, no `wireFlags`). Neither can see `wardrobeDocs`, and `doc.itemSnapshots` is the **scoped**
  rescue pool (dresses scoped out of a top-rescue) → a census from it would MISCOUNT ("0 bottoms" when
  one exists). Resolution: **the census rides `wireFlags` on the live render only** (`:603-608`,
  reaching the empty-render return at `:609`); `flagsFromDoc` leaves it undefined on the two
  census-absent paths — the §C.4 early-replay (`:405`) and the rare dedup-race loser (`:599`, a
  same-requestId concurrent double-submit whose winning twin's `:609` response *did* carry the census) —
  and `emptyStateMessage` degrades to the plain engine hint there. Acceptable because the engine hint
  alone is honest and actionable (e.g. "add a bottom…"); only the extra census sentence is dropped, on
  rare paths. No snapshot-schema field; **never compute the census from `itemSnapshots`** (scoped pool →
  miscount). The composing guard is `census ? census + hint : hint`.

**Pinned wire contract (build-gate fold-in):** the census field is
`slotCensus?: Record<ClothingType, number>` — **optional** on both `BrowserFlags` and `RenderFlagsLike`
(`flagsFromDoc` simply omits it on the two census-absent paths). Counts are computed in `mlRecommend.ts`
from the **projected** wire wardrobe (post-`projectWardrobe`, ~:456) — never raw `wardrobeDocs`: a
malformed row the projection drops must not be counted in a census the engine can't see. The
friend-facing census **sentence** is composed in `recommendCopy.ts` (friend copy stays single-homed +
unit-testable); the wire carries counts only.

**Audit weight: NOT a light loop** — trust-boundary-adjacent wire with two non-obvious delivery traps.

*Copy must serve both remedies* (the wall has two entrances): honest census + *"…if one of these is
actually a bottom, fix it in your Wardrobe — or add a bottom you don't have yet."* The mislabel-only
phrasing is a false premise for a genuinely-bottomless closet (bkup). **Anti-guilt trap-guard (§18):**
honest description only — *"We see 5 tops and 0 bottoms"*, never *"you haven't added a bottom yet."*
D2 (persisted conflict flag) → W-track; the "Files as" chip delivers the ingestion-time half.

*Honest scoping:* D1 barely helps **post-B Zhiyun** specifically — B eliminates her `notEnoughItems`
empties, and her remaining pain is the `insufficient` partial path (owned by F16). **D1 is defense for
the NEXT genuinely-bottomless friend**, which the corpus proves is a real, common case.

**E — Scope boundaries. [SHIP]** Coord/suit **sets** → §23-**H70** (M6 edge-graph, not a new type).
VLM classify stays §18 `[STAGED]`. Filter-key migration stays deferred (H52).

### Load-bearing companions (NOT ride-alongs — the convergence audit promoted these)

- **F16 — the futile "try again" [LOAD-BEARING].** Post-B, Zhiyun's most-used modes (single-top /
  dress rescue) still return 2-card `insufficient` partials, and the current hint ends *"…or try
  again"* — the exact futile re-roll she bounced on (a combinatorially-capped closet can't produce
  more by retrying). It is **two** engine constants — `_INSUFFICIENT_AFTER_GENERATION_HINT` and
  `_DAILY_INSUFFICIENT_AFTER_GENERATION_HINT` (`rescue.py:751,755`), verified to be the *complete* set
  of "try again" strings (the "try regenerating" seen in bkup's 07-19 renders is the OLD string,
  `rescue.py:746` comment — his data predates the 07-21 redeploy). Fix **both** (a half-fix leaves
  daily broken); drop "try again", say *"add a few more pieces for more looks."* Single-home = Python
  (the engine owns the string; Next surfaces it verbatim in both `emptyStateMessage` and
  `partialRenderHint`). Re-pin the pytest string assertions.
- **Live-rows migration [THE conversion lever, not a ride-along].** Because the render path reads
  stored `clothingType`, this is what actually unblocks Zhiyun. After B lands: a **read-only** diff of
  stored vs post-B re-derived `clothingType` over the live DB (all stored values are currently derived
  → clean to interpret), then a **logged re-derive-and-PATCH** migration of the flagged rows. Safe
  against the PATCH re-derive (an explicit `clothingType` in the body skips re-derivation,
  `[id]/route.ts:75-77,122`). Brian runs it (mutates the live friend corpus).
- **Win-back acceptance test → runbook §8** (out-of-session): re-invite Zhiyun post-fix; does she now
  get outfits she rates?

## 5. Beyond code — onboarding + cohort/yield (load-bearing for the recruit, forward lane)

The corpus is a brutal funnel: 3 accounts → 6 interactions; **a friend only rates when a clean
`nSurfaced≥3` set surfaces**, and 2 of 3 friend-shaped accounts hit the thin-closet wall from item #1.
The app **funnels users into rescue-first** ("build around this" is pitched as the heart), which is the
mode most likely to show a 2-card partial on a thin closet — it manufactured Zhiyun's dead-end. These
are §18-anti-guilt-sensitive **nudges, not gates**, and the friend-facing-copy ones warrant a §18-posture
Fable check before building:

1. **Steer onboarding toward DAILY first, not rescue-first.** Daily reliably clears `N_SURFACED` on a
   modest closet; single-item rescue structurally caps at 2 until the closet grows.
2. **Proactive minimum-closet nudge before generating** (≥2 tops, **≥2 bottoms, ≥1 pair of shoes**) —
   the single change that lifts *every* mode over the floor (a pair of shoes alone lifts each single-top
   rescue from 2→4 outfits). Honest nudge, never a gate (REQFIELDS-1 / §18 posture).
3. **The "≥1 dress-heavy closet" recruit target is in tension with yield** — dress-rescue is
   structurally ≤2 outfits per dress; flag so the dress-heavy recruit isn't a yield sink (they need
   bottoms + shoes too).
4. **Yield realism vs the prereg** (needs ≥25 accepted AND ≥25 rejected): at ~1–4 ratings per
   *converting* friend and a steep thin-closet penalty, 3–5 friends may miss 25+25. Carry to runbook §8
   / the prereg: recruit more closets, prompt "rate what you see," consider a closet-size floor before
   counting a friend as a data source. (Does not change the frozen decision rule — informs recruiting.)

## 6. Build ladder + rollout (corrected ordering)

- **C1 — B** (`lib/clothingType.ts` reorder + skort/culottes/capris + doc-comment principle +
  adversarial regression set + drift-guard still green). Light loop (pure function, strong test).
- **C2 — D1 census (WIRE) + C visibility chip.** The route→`BrowserFlags`→`flagsFromDoc`→copy census
  (dual-remedy, both empty branches, anti-guilt) + the "Files as" chip (live form state). **Heavier
  than light** — behavioral test over the wire, not just the copy unit.
- **C3 — F16** (both `rescue.py` constants + pytest re-pins).
- **C4 — live-rows diff + migration** — **the conversion lever.** Gated read-only diff + logged
  re-derive-and-PATCH. Heavier care (mutates live friend corpus); dry-run + before/after dump; Brian
  runs it. **Pinned mechanism (build-gate fold-in):** one tool, `fitted/scripts/migrate-clothingtype.ts`,
  run under `npx tsx` (the `wipe-db.ts` pattern) so it imports the **real** `@/lib/clothingType` — never
  a re-implemented cascade (the mirror-drift ban). Writes go via direct mongoose `$set` on `clothingType`
  **only** (the track2-script-family pattern; the HTTP PATCH route would require minting the friend's
  auth). Dry-run is the **default** (prints stored vs re-derived per row and exits without writing);
  `--apply` gates the write; per-row before/after logged; a wipe-db-style host/db printout guards the
  target.
- **Docs (same session):** register §23-H71 (below); record the W-track rung-2 obligations (override +
  `clothingTypeSource` + H52 trap-guard) as the deferred unit; add the onboarding §5 items + Zhiyun
  win-back to runbook §8; confirm §23-H52 stays RESOLVED with rung-2's *surface* half now partial.

**Rollout ordering (corrected by the forward lane):**
- The **conversion-critical lever is C4 (the migration), not B** — B alone leaves Zhiyun's stored row
  broken. Say so explicitly.
- **The Fly redeploy (F16) is NOT on the win-back critical path** — the migration works even against
  the pre-B deployed engine (it reads the stored value), and F16 is only the two hint strings.
  **Web-redeploy (B + census + chip via Vercel) + the Atlas migration is sufficient to convert her**
  daily + skirt-rescue flows.
- **But ship F16 before re-inviting her** — she'll still hit `insufficient` partials on top/dress
  rescues (the copy she bounced on), so the honest rewrite matters for the win-back even though it's
  not the conversion blocker.
- Order: **web-redeploy (B+census+chip) → C4 migrate her row → F16/Fly redeploy → re-invite.** Re-run
  the one-render `bindable:true` post-deploy gate (runbook §8). Both halves must stay in sync — the
  deployed Fly engine already lags `main` between redeploys (bkup's stale-string evidence proves it).

## 7. Register §23-H71 (done in this session's spec edit)

**H71 — the weather dimension is dead: every render resolves `weather="mild"`.** No browser geo → the
server resolver falls to `bucketFromSummary(occasion)`, and a non-weather occasion ("go traveling")
→ default "mild" (`mlRecommend.ts:160,174`); even *with* geo, SB temps bucket to mild
(`bucketFromTemp:188`). So the dimension has ~zero variance. **Load-bearing for M6** (the corpus carries
`weather` as a constant dead training feature) and for out-of-SB friend quality (climate-blind outfits;
the prompt always says "Weather: mild"). Sub-note: **warmth is the same invisible-derived pattern**
(cardigan→10, blazer→8) but it is **non-gating** — it only shifts the `option_path` compatibility
bucket (`response.py:325-358`, "bucket never gates"), never yield — so it rides as the weather hole's
degraded-dimension sub-note, not its own fix. Orthogonal to the mis-slot; needs its own Fable call
(assertive geo prompt / manual temp / stored home location). Registered, not built.

---

*Correction folded in: the earlier post-B simulation (and §1's first draft) over-claimed that
rescue-on-a-top "clears N_SURFACED" — the verified count is 2 (below the floor). Only daily and
bottom-rescue clear it; single-top/dress rescues remain honest 2-card partials.*
