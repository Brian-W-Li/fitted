# M0 + M1: Substrate (Contracts, Pure Functions, Sampler)

Plan doc for the first implementation chunk of the Fitted Refactor **v1.2** spec
(`docs/Fitted_Refactor_v1.2_Spec.pdf`). Covers **M0** (contracts & pure functions)
and **M1** (the sampler / shortlister). No implementation code is written here — this
is a planning doc only.

> **Process note:** Interview completed at top level on 2026-06-09. The decisions below
> are **confirmed** (formerly recommended defaults). Brian resolved the pivotal language/home
> and hosting choices; the remaining low-stakes items were ratified at their recommended
> defaults. Former `[CONFIRM]` markers are now resolved — see §1 and §8.
>
> **Gap review folded in (2026-06-09):** a fresh-context review surfaced three gaps now
> addressed here — `RequestContext` is defined concretely (M1-3); the data-model migration
> the v1.2 seams depend on is recorded as explicit M4/M5 work (§6); the Fly.io rationale was
> corrected (§0 Decision 2). Findings that measured v1.2 against superseded deployed behavior
> (per CLAUDE.md → *Canonical sources*) were intentionally **not** folded in.
>
> **Implementation fan-out review folded in (2026-06-09, Fable):** a runtime-behavior review
> (not doc-vs-spec drift) surfaced bugs the contracts would have shipped — now fixed here and in
> `spec-resolutions.md` R1/R4/R5: (1) determinism rides only on the cold-start branch and needs
> **canonical input ordering**, not just a seed (R4, M1-1/M1-3); (2) the cache-key invariant
> made **regenerate a no-op** → two-stage caching (R1); (3) the bare `"\x1f"` seed delimiter
> **collides** → length-prefix encoding + `None` sentinel (R1, M0-5); (4) `is_valid_slotmap`
> was assigned rejects its input type can't represent → **normalizer error channel** (M0-4);
> (5) `round(cap*0.7)` split the real caps inconsistently → **integer half-up** (M1-3); plus
> `weather` must be a canonical seed bucket (R5) and `total_base==0` short-circuits (M1-4).

---

## 0. Locked decisions (record verbatim, do NOT relitigate)

### Decision 1 — Read A vs B: **Read B**

**v1.2 is the substrate, not a replacement for the ml-system ML dive.** The trained ML
shortlister will replace M1's *heuristic* signal scorer in a future **M6 milestone**,
after M4's `OutfitInteraction` log produces labeled data. So M1's sampler must build the
30%-signal-based selection slot (spec §7.3) as a clean, replaceable seam — the equivalent
of the `_score_outfit` seam in the current Python code.

### Decision 2 — Hosting: **Fly.io (Brian's own service)**

The Python substrate (`fitted_core`) deploys as **Brian's own service on Fly.io** — NOT a
reuse of teammate `theanimated01`'s Hugging Face Space.

Rationale (record verbatim):
- **No cold starts.** Run an always-on Fly.io machine (auto-stop disabled) so there is no
  spin-up latency. HF free-tier cold-starts were a real problem hit during CS 148.
  *(Correction 2026-06-09: Fly.io ended its free-resource allowance in Oct 2024, so
  "always-on" is a small paid cost, not free. The cold-start argument stands; the "free"
  framing does not. Negligible for one hobby service; revisit at real scale.)*
- **No teammate IP boundary.** The HF Space is `theanimated01`'s; this is Brian's own service.
- **No M6 model constraint.** Docker-based, with headroom for the M6 model whether it ends up
  classical ML or small-DL.

Architecture (mirrors the team's Vercel + Python-service pattern, Fly.io as the substrate):
- Python service (`fitted_core`) deployed to Fly.io — always-on, Docker.
- `fitted/app/api/recommend/route.ts` calls it via `fetch()` — wired at **M5**.
- Feature flag `USE_ML_SHORTLISTER` toggles between the Python substrate and the current
  OpenAI-only flow (A/B + kill switch).
- Health check + short `fetch` timeout → **graceful fallback to the OpenAI-only flow** when
  the Fly app is unreachable.

> **Note:** this shortlister service is **separate** from the CV service
> (`CV_SERVICE_URL` → `theanimated01`'s HF Space), which is unrelated and stays as-is.

### Milestone map (where this chunk sits)

| Milestone | Scope | Status |
|---|---|---|
| **M0** | Contracts & pure functions: §3 ids/seed, §4.1 WardrobeItem, §5 keys, §6.3 SlotMap, §18 config constants. No Mongo, no API keys. | ✅ **done** (commit `2e4c8d44`, 2026-06-13; 73 pytest green) |
| **M1** | Sampler / shortlister: §7 pool partition, per-type caps, cold-start, §7.3 70/30 sampling + session seed, §7.4 candidate scaling. Signal path **stubbed** (cold-start fallback). | **next** |
| M2 | SlotMap validation + strict JSON schema validation of GPT output (§6.3 reject rules, §8.3). In `fitted_core/`. | later |
| M3 | Ranker: comboBoost, dislike cooldown (BaseKey/FullSignature), variant cap, overuse penalty, dedup (§5.3, §11, appendix B1/B3). In `fitted_core/`. | later |
| M4 | Data-model migration in `fitted/models/*.ts` (add `ItemAffinity`, `wardrobeVersion`, `generation_logs`; see §6) + the interaction data the substrate consumes. Produces the labeled feedback data. | later |
| M5 | **Deploy `fitted_core` as a Dockerized Python service on Fly.io (always-on).** Wire `fitted/app/api/recommend/route.ts` → service via `fetch()` behind the `USE_ML_SHORTLISTER` feature flag; health check + short timeout + graceful fallback to OpenAI-only. Plus caching, seeds, daily re-seed (§3.3, appendix A4/C1). | later |
| **M6** | **Trained ML shortlister replaces M1's heuristic signal scorer at the §7.3 seam** (classical or small-DL). Redeploy to Fly; measure lift via online A/B (feature flag) + offline NDCG@k on held-out interactions. The actual ml-system dive. | later |

**Home:** M0–M3 build in `ml-system/fitted_core/` (Python, pytest, no DB, no keys). M4 spans
both repos — the schema migration lands in `fitted/models/*.ts` (TS), and the substrate
consumes the resulting interaction data. M5 introduces the Fly.io service + Next.js
integration. M6 is the trained-model swap at the M1-3 seam.

The M1 signal seam is the single most important deliverable for the long arc: it is the
hook M6 plugs the trained model into. Everything else in M0/M1 is plumbing around it.

---

## 1. Resolved decisions (confirmed 2026-06-09)

1. **Language / home — Python in `ml-system/fitted_core/` (CONFIRMED).** Why: the M6 ML model
   is Python, the existing `_score_outfit` seam is Python, and M0/M1 are pure functions
   needing no Mongo or API keys — so they unit-test cleanly with pytest and stay cohesive
   with the dive. **Online integration is in-scope** (not a deferred "maybe"): at M5 the
   substrate deploys as Brian's own Fly.io service and the TS pipeline calls it via `fetch()`
   behind the `USE_ML_SHORTLISTER` feature flag with graceful fallback (see §0 Decision 2).
   The Python↔TS boundary is a network service call, not a code port.

2. **Existing code — new modules, keep legacy as demo.** Why: clean seam separation.
   Build M0/M1 as new modules under `ml-system/fitted_core/` using the spec's 5-type
   `WardrobeItem`. Leave `ml-system/outfit_recommender.py` untouched as the legacy
   rule-based demo (it models only top/bottom/footwear and would fight the new data model).
   M6 retires it when the trained scorer lands. The demo wardrobe is **re-expressed** in the
   new schema as a pytest fixture, not migrated in place.

3. **Hash / seed — `hashlib.sha256` over a canonical string, seeding `random.Random`.**
   Why: spec §3.3 explicitly states "no security requirement," but `hash()` (Python's
   builtin) is **process-salted and non-reproducible across runs** — unusable for a seed
   that must be stable across re-renders. Use
   `int.from_bytes(sha256(canonical.encode()).digest()[:8], "big")` to derive a stable
   64-bit seed, fed to a dedicated `random.Random(seed)` instance (never the global RNG).
   The canonical string **length-prefixes each field by its UTF-8 byte count**
   (`"".join(f"{len(s.encode('utf-8'))}:{s}" ...)`), not a bare `"\x1f"` delimiter: a plain join
   collides (`join(["a","b\x1fc"]) == join(["a\x1fb","c"])`) and `occasion` (free text) can
   contain any delimiter (`sessionId` is an opaque string, `= userId` per R8), so the delimiter
   approach is unsafe. Byte length, not char count, so a reproducing runtime (M5 TS adapter)
   agrees on non-BMP text. `date=None` uses a typed sentinel distinct from `"None"`/`""`/absence.
   See `spec-resolutions.md` R1.

4. **Daily re-seed (appendix C1) — implement the hook in M0, default OFF.** Why: C1 says
   append `date` (YYYY-MM-DD) to the seed for authenticated users. The seed signature is a
   pure function — cheapest to get right once. Implement the seed wrappers (`session_seed`/`tiebreak_seed`, R1) with an optional
   `date: str | None = None` parameter; when `None`, behaves as §3.3 (no date). M0 wires the
   parameter and tests both signatures; the *decision of when to pass a date* (auth users,
   real `date.today()`) is a request-layer concern deferred to **M5**. This avoids a seed
   signature change later. **Confirmed:** build the `date` parameter now (default off).

5. **Config constants — single Python module `ml-system/fitted_core/config.py`.** Why:
   §18 mandates "all weights and thresholds defined as named constants in one config file."
   Plain module-level constants (uppercase ints/floats), not JSON/env — env-overridability is
   not a v1.2 requirement and adds parsing surface. Houses every named constant M0/M1 touch:
   `DEFAULT_K=10`, per-type caps (`CAP_TOPS=35`, `CAP_BOTTOMS=30`, `CAP_DRESSES=25`,
   `CAP_OUTER=20`, `CAP_SHOES=25`), `MAX_PROMPT_ITEMS=135`, `MAX_CANDIDATES=40`,
   `MIN_SIGNAL_THRESHOLD=5` (appendix B2), plus forward-declared
   constants other milestones own but that belong in one file: `MAX_AFFINITY=20` (A3),
   `OVERUSE_MIN_POOL=15` (B1). Forward-declared constants get a `# used in M3` comment.
   The 70/30 split is **not** a config constant — see **R6**: it lives as the sampler-owned
   `random_count(cap)` helper (`(cap*7+5)//10`), not `RANDOM_FRACTION`.

6. **M1 signal path — stubbed to cold-start (100% random), seam left for M6.** Why: real
   signal selection (§7.3's 30%) needs `affinityScore` / interaction data that **does not
   exist in the data model today** (no `ItemAffinity` collection — see the §6 data-model
   migration note) and is not produced until M4. The stub contract (§4 / M1-3) is the M6 plug
   point. This is the literal embodiment of the Read B framing.

7. **Testing bar — pytest unit coverage of every pure function, every spec-enumerated
   branch.** Why: `ml-system/` has no tests yet (CLAUDE.md mandates adding pytest with this
   work), and M0/M1 are pure functions whose entire value is correctness against the spec's
   explicit valid/invalid enumerations. Property-based tests (hypothesis) are **optional /
   nice-to-have** for the sampler's distribution and the seed's determinism (see §5).

---

## 2. File layout (real paths)

```
ml-system/
  fitted_core/
    __init__.py
    config.py            # M0 task 1  — §18 named constants
    models.py            # M0 task 2  — WardrobeItem, SlotMap, enums (§4.1, §6.2/6.3)
    keys.py              # M0 task 3  — BaseKey, FullSignature (§5)
    slotmap.py           # M0 task 4  — normalize_to_slotmap + validity (§6.3)
    seed.py              # M0 task 5  — _canonical_seed + session_seed/tiebreak_seed (§3.3, §10.4, C1)
    sampler.py           # M1 tasks   — partition, caps, 70/30 sample, scaling, RequestContext + SignalScorer seam (§7)
  tests/
    __init__.py
    conftest.py          # shared fixtures (demo wardrobe in new schema)
    test_config.py
    test_models.py
    test_keys.py
    test_slotmap.py
    test_seed.py
    test_sampler.py
  requirements.txt       # add: pytest (and hypothesis if property tests adopted)
  outfit_recommender.py  # LEGACY — untouched this chunk; retired in M6
```

`fitted_core` is a new package so the legacy `outfit_recommender.py` import path is
undisturbed. **Confirmed:** package name `fitted_core`.

---

## 3. M0 — task breakdown (ordered)

Each task: spec section → contract produced → test file.

### M0-1 — Config constants — §18 (and A3/B1/B2 forward-decls)
- **Produces:** `config.py` with every named constant M0/M1 reference (see decision §1.5).
- **Test (`test_config.py`):** assert exact spec values (`MAX_CANDIDATES == 40`,
  `MAX_PROMPT_ITEMS == 135`, sum of per-type caps `== MAX_PROMPT_ITEMS`, each per-type cap
  pinned individually (so a compensating drift can't pass the sum guard),
  `MIN_SIGNAL_THRESHOLD == 5`). This is a regression guard so a
  later edit can't silently desync caps from the documented `MAX_PROMPT_ITEMS`. (No
  `RANDOM_FRACTION` assert — the split is the sampler's `random_count` helper, R6.)
- **Effort:** ~0.5 hr.

### M0-2 — Data model — §4.1 WardrobeItem, §6.2 roles
- **Produces:** `models.py`:
  - `ItemType` enum: `top, bottom, dress, outer_layer, shoes` (spec §4.1).
  - `WardrobeItem` dataclass: `id, name, type, styleTags, colorTags, occasionTags,
    warmth (0–10), material (opt), formality (opt), imageUrl`. Tags are flexible strings
    (spec: "no enum enforcement in v1"); `type` is the only enum.
  - `Template` enum (`two_piece`, `one_piece`) and `Role` enum (`base_top, base_bottom,
    one_piece, outer_layer, shoes`) from §6.1/6.2.
  - `SlotMap` dataclass: `dress, top, bottom, outer, shoes` (each `itemId | None`) — §6.3.
- **Test (`test_models.py`):** construction with/without optional fields; `warmth` accepts
  0 and 10; `type` rejects an unknown value; tags accept arbitrary strings.
- **Wire-value validation is *not* M0's job (R12).** The dataclass keeps only two narrow guards
  (enum coercion of `type`, `warmth ∈ 0..10`); full malformed-wire-value rejection (empty ids,
  `warmth=True`, bad tag containers, one predictable error channel) belongs to the **M5 Mongo
  adapter**, where untrusted data enters. M0 is deliberately not expanded into schema validation.
- **Effort:** ~1 hr.

### M0-3 — Canonical keys — §5 BaseKey + FullSignature
- **Produces:** `keys.py`, computed **from a SlotMap** (spec: "computed from the SlotMap
  after normalization"):
  - `base_key(slotmap) -> str`: one_piece → `dressId`; two_piece → `f"{topId}:{bottomId}"`.
    Excludes outer_layer and shoes (§5.1).
  - `full_signature(slotmap) -> str`:
    `BaseKey + "|outer=" + (outerId or "none") + "|shoes=" + (shoesId or "none")` (§5.2).
  - **Preconditions (R10) — raise `ValueError`:** (1) **structurally invalid base** (no valid
    one_piece XOR two_piece) — the key functions assume an already-normalized, validated SlotMap
    (spec: "computed from the SlotMap *after normalization*"; §1 pipeline computes keys inside
    Step 3, after validation); (2) any **participating itemId** containing a reserved char (`:`,
    `|`, `=`) or equal to the sentinel `"none"`. (2) is an R1-class collision guard: the literal
    key format can't be length-prefixed (it's spec-fixed + tested), so the defense is a
    precondition. Real ObjectId-hex ids never trigger it (zero false-reject risk). See
    `spec-resolutions.md` **R10**.
- **Test (`test_keys.py`):** exact spec examples —
  - two_piece BaseKey `"abc:def"`; one_piece BaseKey `"ghi"`.
  - FullSig with outer no shoes `"abc:def|outer=ghi|shoes=none"`.
  - bare two_piece `"abc:def|outer=none|shoes=none"`.
  - one_piece full `"ghi|outer=jkl|shoes=mno"`.
  - **Key-responsibility invariant (§5.3):** same dress + different outer ⇒ same BaseKey,
    different FullSignature. Assert both, since the spec calls conflating them a bug.
  - **R10 preconditions:** `ValueError` on a structurally invalid base (e.g. empty SlotMap, or
    dress+top); `ValueError` on an itemId containing each of `:`, `|`, `=`; `ValueError` on an
    itemId equal to `"none"`.
- **Effort:** ~1.25 hr.

### M0-4 — SlotMap normalizer + validity — §6.3
- **Produces:** `slotmap.py`:
  - `normalize_to_slotmap(candidate) -> tuple[SlotMap | None, str | None]`: maps a raw candidate
    into the named-slot SlotMap, **with an error channel** (returns `(None, reason)` on a
    structurally bad candidate). **Resolved from spec §16:** the candidate is a role-tagged item
    list — `items: [{itemId, role}]`, exactly GPT's output schema — so the normalizer input
    matches the M2 producer with no adapter.
    - **Owns every reject a single-valued `SlotMap` cannot represent — duplicate role *and*
      unknown role.** Each of the five roles (`base_top`, `base_bottom`, `one_piece`,
      `outer_layer`, `shoes`) maps to exactly one SlotMap slot (`top`, `bottom`, `dress`,
      `outer`, `shoes`). So a **second item tagged with any already-seen role** — not only a
      second `base_top`/`base_bottom`, but a second `one_piece`, `outer_layer`, or `shoes` —
      would be silently dropped by last-write-wins assignment, emitting a valid-looking SlotMap
      with an item erased. The normalizer therefore **rejects a second assignment to any
      role-owned slot, and any unknown/unrecognized role, before constructing the SlotMap.**
      These states are inexpressible once collapsed, so they cannot be caught in
      `is_valid_slotmap` — they must be caught here. *(Matches spec §13's duplicate-slot reject
      and the legacy route's per-role counts at `fitted/app/api/recommend/route.ts:628-648`,
      which reject >1 bottom / base-top / one-piece / footwear and cap outer at 1 — protection
      the replacement must not lose. Reject-set authority: §13, see `spec-resolutions.md` N3.)*
  - `is_valid_slotmap(slotmap) -> tuple[bool, reason]` enforcing §6.3 over the **slot-level**
    rules (those a `SlotMap` can express):
    - **Valid:** (dress set, top/bottom null → one_piece) XOR (top+bottom set, dress null →
      two_piece), plus optional outer/shoes.
    - **Invalid (reject):** dress+top or dress+bottom (mixed templates); no base role (empty);
      duplicate itemId across slots. *(duplicate role-owned slots and unknown role are handled
      upstream in `normalize_to_slotmap` — see above.)*
  - `template_of(slotmap) -> Template`.
- **Test (`test_slotmap.py`):** one parametrized case per **valid** shape, plus one per
  **invalid** case across **both** functions — `is_valid_slotmap` rejects (mixed templates ×2,
  empty, duplicate itemId) **and** `normalize_to_slotmap` rejects (a duplicate of **each** of the
  five role-owned slots — second `base_top`, second `base_bottom`, second `one_piece`, second
  `outer_layer`, second `shoes` — plus unknown role), each asserting accept/reject and the
  reason. Splitting by owner is the point: the normalizer-owned rejects are *inexpressible* as a
  `SlotMap`, so they can only be tested through the raw role-tagged input. This is the densest
  correctness surface in M0.
- **Effort:** ~2 hr.

### M0-5 — Seed derivation — §3.3 (+ C1 hook)
- **Produces:** `seed.py` (structure per `spec-resolutions.md` R1 — one private primitive,
  two named wrappers, so the session and tie-break seeds cannot drift):
  - `_canonical_seed(...)` **private** primitive: **length-prefix** each field by its
    **UTF-8 byte length** (`f"{len(s.encode('utf-8'))}:{s}"`), join, sha256, first 8 bytes →
    int (decision §1.3). Byte length, not Python `len()`: any reproducing runtime (the M5 TS
    adapter) must agree on non-BMP text where Python char count and JS string length differ.
    `None` → typed sentinel `"-:"` (no valid byte length is negative), not `str(None)`.
  - `session_seed(sessionId, wardrobeVersion, occasion, weather, date=None) -> int` — wrapper,
    no `generationIndex`. Used by sampling (M1) and the cache key (M5).
  - `tiebreak_seed(sessionId, wardrobeVersion, occasion, weather, date=None, *, generationIndex) -> int`
    — wrapper adding `generationIndex` (used by the M3 tie-break).
  - `seeded_rng(seed) -> random.Random`.
  - **Cache-key invariant (for M5, recorded here):** the cache key must use *exactly* the
    `session_seed` inputs, including `date` when C1 is active (R1).
- **Test (`test_seed.py`):** determinism (same inputs → same int across calls); sensitivity
  (any single field change → different int, incl. the C1 `date` param and `generationIndex`);
  **wrapper/primitive delegation** — only `tiebreak_seed` *accepts* `generationIndex` (the codex
  fix: do **not** word it as "`session_seed` ignores `generationIndex`" — `session_seed` has no
  such parameter), and both wrappers equal `_canonical_seed(...)` called with the matching
  generationIndex slot (`None` for session, the value for tiebreak); **field-framing guard** —
  the length-prefix encoding makes the two ambiguous tuples differ: occasion `"a"`+weather
  `"b\x1fc"` ≠ occasion `"a\x1fb"`+weather `"c"` (a bare `"\x1f"` join would make these equal —
  this test fails against the wrong implementation); **UTF-8 byte framing** — a 1-char/4-byte
  occasion (`"💎"`) ≠ a 4-char ASCII occasion (proves byte-length, not char-length, framing);
  **`None` encoding** — `date=None` ≠ `date="None"` ≠ `date=""` ≠ `date="0"`; `seeded_rng`
  reproducibility (two RNGs from same seed emit identical sequences). **No universal
  collision-freedom property is asserted** (codex fix): length-prefix framing is injective, but
  truncating SHA-256 to 64 bits is not — only known framing ambiguities + per-field sensitivity
  are tested.
- **Effort:** ~1 hr.

**M0 subtotal: ~5.5 hr** (≈ one 4–8 hr/wk session).

---

## 4. M1 — task breakdown (ordered)

The sampler is the shortlister. It consumes a `list[WardrobeItem]` + request context, emits
the bounded pool GPT may select from, plus `candidateRequested` and logging flags.

### M1-1 — Partition by type — §7.1
- **Produces:** `sampler.partition(wardrobe) -> dict[ItemType, list[WardrobeItem]]` over the
  5 types (tops, bottoms, dresses, outer_layers, shoes). **Canonical ordering (R4):** sort each
  type's list by `item.id`, and iterate types in fixed `ItemType` enum order downstream.
  Determinism depends on input *order*, not just the seed — `random.sample` over a list in
  Mongo-return order (unsorted at M5) is non-reproducible. This is the only branch prod runs
  pre-M6, so the guarantee lives here.
- **Test:** mixed wardrobe partitions correctly; empty type → empty list (feeds §19 edge
  cases: no tops/bottoms, no dresses); **permuted-input determinism** — shuffling the input
  wardrobe yields an identically-sorted partition (and, with M1-3, identical samples).
- **Effort:** ~0.5 hr.

### M1-2 — Per-type caps + "include all if at/below cap" — §7.2, §18
- **Produces:** `sampler.apply_cap(items, cap, ...) -> list[WardrobeItem]`. If
  `count <= cap`: include all (spec: scarce categories fully represented). Else: hand off to
  the 70/30 sampler (M1-3). Surface an estimated prompt item count for logging (§7.2 / §18).
  `MAX_PROMPT_ITEMS` (=135) is an **assertion/invariant, not a truncation step**: the per-type
  caps sum to exactly 135, so the ceiling is unreachable by construction — assert it (catches a
  future cap edit that desyncs the sum) but never silently drop items to enforce it, which would
  be an order-dependent item-loss path.
- **Test:** at-cap and below-cap include all; over-cap delegates to sampler and returns
  exactly `cap` items; summed pool never exceeds `MAX_PROMPT_ITEMS` (asserted, not enforced).
- **Effort:** ~1 hr.

### M1-3 — 70/30 sampling + session seed + cold-start — §7.3, appendix B2 (**the M6 seam**)
- **Produces:** `sampler.sample_type(items, cap, rng, scorer, context) -> TypeSampleResult`,
  applied per type only when over cap. **Return is a struct, not a bare list** (codex post-M0
  review #1, 2026-06-16): a scalar `list[WardrobeItem]` cannot carry per-type mode/fallback
  reason, and R11's "logs never lie about *why* random ran" requires that each type report its
  own outcome — type A may sample on signal while type B faults to random. `TypeSampleResult`
  carries:
  - `items: list[WardrobeItem]` — the sampled selection (== `cap`).
  - `mode: "signal" | "random"` — which path ran.
  - `reason: None | "coldStartSampling" | "signalUnavailable" | "signalScorerFault"` — the
    R11 fallback reason (`None` only when `mode == "signal"`).
  - `random_count: int`, `signal_count: int` — slot sizes (signal_count 0 on a fallback).
- **Contract resolutions (codex #1 sub-questions, resolved 2026-06-16 — pin before coding):**
  - **`scorer.is_available()` is evaluated once per request, not per type.** Availability is a
    property of the scorer (model loaded or not), identical across types; per-type evaluation
    would be redundant. The entry point (M1-5) checks it once and passes the boolean down.
  - **A misbehaving `is_available()` (raises or returns non-`True`) → treat as unavailable**
    (`signalUnavailable`), never propagate. Availability is the gate; if it can't be confirmed,
    the safe state is "no signal."
  - **Finite-score validation excludes booleans.** `score()` must return a finite float;
    reject `NaN`/`±inf` (`math.isfinite`) **and** `bool` explicitly (`isinstance(x, bool)` — a
    Python bool is an int subclass and `isfinite(True)` is `True`, the R12 `warmth=True`
    precedent). Any violation → `signalScorerFault` for the whole type's signal slot.
  - **Final prompt pool order:** iterate types in `ItemType` enum order (R4); within each type,
    emit the sampled items **sorted by `id`** so the GPT prompt is byte-stable across runs (the
    random *subset* is seeded, but its iteration order must also be pinned).
  - **`RequestContext` is built by the M5 adapter and passed in, not built by the sampler.**
    The adapter owns raw→canonical normalization (R5); the entry point receives an
    already-canonical `RequestContext`. (Resolves the M1-3/M1-5 wording drift — the dataclass is
    *defined* in the sampler module but *constructed* upstream.)
  - **Signal-first selection order (R11):** when the signal branch runs, the **30% signal slot
    is picked first** as the deterministic top-`signal_count` by `(score desc, id asc)` over the
    id-sorted list (consumes no RNG); then the **70% random slot** draws `random_count` (R6)
    from the **remaining** id-sorted items via the **single shared** `random.Random` seeded by
    M0-5 (R4). Disjoint by construction; total = `cap`. Determinism needs both the seed *and*
    the input order fixed (R4).
  - **30% signal-based** via the **stubbed seam** `signal_fn` (the `SignalScorer` protocol below).
  - **Signal-branch gate (§7.3 + B2; R11):** the signal branch runs only when
    `interaction_count >= MIN_SIGNAL_THRESHOLD` (=5) **AND** `signal_fn.is_available()`.
    Otherwise the type's signal slot falls back to **100% seeded random over the id-sorted list**
    with one of three **mutually-exclusive, behavior-identical** log reasons (they sample the
    same way; only the logged cause differs, so logs never lie about *why* random ran):
    - `coldStartSampling` — `interaction_count < MIN_SIGNAL_THRESHOLD` (the only reason pre-M4;
      B2 is explicit — log whenever below threshold, **not** only at zero).
    - `signalUnavailable` — count ≥ threshold but `not signal_fn.is_available()` (M4→M6 window).
    - `signalScorerFault` — scorer available + invoked but `score()` raised or returned a
      non-finite value (NaN/±inf) → the whole type's signal slot falls back (fail-loud, not
      silent item-dropping bias).
    **Critical (R4):** every fallback uses the **same seeded RNG over the sorted list** — not
    bare `random.sample` — because pre-M6 prod *always* takes a fallback path, so the §3.1
    determinism promise rides entirely on it. Identical fallback sampling means M4's data
    arrival changes only the log label, never the outfits, until M6 (R11).
- **M6 seam contract (the most important deliverable in this chunk):**
  ```
  RequestContext (dataclass, built by the sampler entry point M1-5):
    occasion: str                  # normalized verbatim user text (R5: trim/lowercase/
                                   #   collapse-whitespace — NOT a bucket; bucketing aliases
                                   #   distinct occasions in the cache)
    weather: str                   # canonical bucket (R5) — raw live weather mutates every
                                   #   render → seed never stable; M5 adapter buckets it
    sessionId: str
    wardrobeVersion: int
    date: str | None = None       # C1 daily re-seed; None until M5 activates it
    interaction_count: int = 0     # this user's interaction count; 0 until M4 exists
    # M6 may add fields the trained scorer needs (e.g. a per-user signal handle).
    # Rule: new fields are additive only — never rename or remove the above.

  SignalScorer protocol:
    is_available() -> bool                                         # R11: model-presence gate
    score(item: WardrobeItem, context: RequestContext) -> float   # higher = more relevant
  ```
  The `occasion / weather / sessionId / wardrobeVersion / date` fields are exactly the
  `session_seed` inputs (M0-5); `interaction_count` is the only addition. The sampler already
  holds all of them, so building the context is free.
  - **M1 ships `ColdStartSignalScorer`**: `is_available()` always returns `False`, so the
    sampler always takes a fallback (seeded-random) path and the 30% branch is unreachable until
    M6 plugs in a scorer whose `is_available()` returns `True`.
  - **M6 plugs in** `TrainedSignalScorer` implementing the same protocol (trained on the M4
    data — see the §6 data-model migration note); its `is_available()` returns `True` once the
    model is loaded. No other M1 code changes.
  - Until M4 exists, `interaction_count` is **always 0**, so the 30% branch is dead by the
    **count gate**. After M4 (count can reach ≥5) it stays dead by the **`is_available()` gate**
    (R11) until M6 — the two-gate design is precisely what stops M4's data arrival from
    perturbing the seeded product. The protocol + 70/30 structure are built and tested now, so
    **M6 is a swap, not a rewrite — conditional on M4 first materializing the signal fields**
    (`affinityScore` / `interaction_count`), absent from the data model today (§6).
- **Test (`test_sampler.py`):**
  - **Fallback reasons (R11):** `interaction_count` ∈ {0, 4} → 100% random, `coldStartSampling`;
    count 5 + **unavailable** scorer (`is_available()` False) → 100% random, `signalUnavailable`;
    count 5 + available scorer that **raises / returns NaN** → 100% random, `signalScorerFault`;
    count 5 + available *fake* scorer → 70/30 split exercised (proves the seam is wired).
  - **Fallbacks are behavior-identical:** the three fallback paths produce the **same** sampled
    set for the same seed — only the logged reason differs.
  - **Signal-first order (R11):** with an available fake scorer, the signal slot = top-N by
    `(score desc, id asc)` and the random slot is disjoint, drawn from the remainder.
  - **Determinism:** same seed → identical sampled set across runs.
  - **Split math:** over-cap with cap=10 → 7 random + 3 signal (with fake scorer). Lives in the
    sampler-owned `random_count(cap)` helper (R6), not inlined at call sites. Rounding is
    **integer, half-up, float-free**: `random_count = (cap * 7 + 5) // 10`, signal = remainder
    (**revised** from `round(cap*0.7)` — Python's banker's rounding on exact half-values splits
    the real caps in *opposite* directions: `round(35*0.7)=round(24.5)=24` but
    `round(25*0.7)=round(17.5)=18`, and any TS/numpy reimpl that rounds halves up would silently
    disagree with prod). Test the **real cap values** (35→25, 30→21, 25→18, 20→14, 25→18), not
    just cap=10.
  - **No duplicates** across the random and signal sub-selections within a type.
- **Effort:** ~2.5 hr (the load-bearing task).

### M1-4 — Candidate request scaling — §7.4
- **Produces:** `sampler.candidate_requested(sampled_pool) -> int` using **post-cap** counts:
  ```
  two_piece_base = count(sampled_tops) * count(sampled_bottoms)
  one_piece_base = count(sampled_dresses)
  total_base     = two_piece_base + one_piece_base
  if total_base <= 5:  candidateRequested = total_base * 3
  else:                candidateRequested = min(MAX_CANDIDATES, total_base * 3)
  ```
  (`MAX_CANDIDATES = 40` from config.)
  **`total_base == 0` short-circuit:** tops-but-no-bottoms (or an empty pool) gives
  `total_base = 0 → candidateRequested = 0`. The entry point (M1-5) must return a
  `notEnoughItems` result **before any GPT call** rather than asking for zero candidates and
  running the pipeline on nothing (§19 edge cases: no tops/bottoms, no dresses).
- **Test:** both branches + the zero case —
  - **zero:** tops=5,bottoms=0,dresses=0 → total_base=0 → `notEnoughItems`, no candidate request.
  - tiny: tops=1,bottoms=1,dresses=0 → total_base=1 → 3 (no floor; proportionally fewer).
  - boundary: total_base=5 → 15; total_base=6 → 18.
  - ceiling: large pool where `total_base*3 > 40` → exactly 40.
  - one_piece contribution: dresses add to total_base independent of tops*bottoms.
- **Effort:** ~1 hr.

### M1-5 — Sampler entry point + logging fields — §7, §18
- **Produces:** `sampler.build_candidate_pool(wardrobe, request_context, scorer) -> SamplerResult`
  tying M1-1..M1-4 together. **Rejects a wardrobe with duplicate logical item-IDs *before*
  `partition`** (R12 — a duplicate id collapses M2's sampled-pool lookup and breaks key equality;
  M0 can't catch it because it never sees the wardrobe list). `RequestContext` (fields specified
  in M1-3) is defined here too —
  it is the request-level input the sampler builds and the `SignalScorer` seam consumes.
  `SamplerResult` carries the bounded per-type pool,
  `candidateRequested`, and best-effort log fields. **Sampling outcomes are keyed by `ItemType`,
  not a single request-level reason** (codex #1, 2026-06-16): `SamplerResult` holds the per-type
  `TypeSampleResult`s (mode + reason + slot counts from M1-3), so a log can report that tops
  cold-started while shoes faulted. A flattened request-level reason would falsify the log the
  moment two types diverge (always possible once some types are over cap and others under).
  Also carries the estimated prompt item count. Logging is **return-value data only**
  here — actual async/best-effort emission (§18) is M5's concern; M1 must not block on it.
- **Test:** end-to-end on the demo-wardrobe fixture: pool within caps, `candidateRequested`
  matches §7.4, `coldStartSampling` reason set for the zero-interaction fixture.
- **Effort:** ~1 hr.

**M1 subtotal: ~6 hr** (≈ one session).

---

## 5. Test plan (pytest)

- **Framework:** pytest under `ml-system/tests/`; add `pytest` to `requirements.txt`. Run:
  `cd ml-system && python3 -m venv .venv && source .venv/bin/activate && pip install -r
  requirements.txt && pytest`.
- **Fixtures (`conftest.py`):** the legacy demo wardrobe re-expressed in the new
  `WardrobeItem` schema, plus a larger synthetic wardrobe that exceeds every per-type cap
  (to exercise sampling), plus a zero-interaction context and a `FakeSignalScorer` for the
  30% branch.
- **Must-cover cases (spec-enumerated):**
  - **SlotMap (§6.3 / §13):** all valid shapes (one_piece, two_piece, each ± outer/shoes) and
    every invalid shape — `is_valid_slotmap`: mixed templates, empty, duplicate itemId;
    `normalize_to_slotmap`: a duplicate of each of the five role-owned slots (base_top,
    base_bottom, one_piece, outer_layer, shoes) and unknown role.
  - **Keys (§5 / R10):** the four exact FullSignature examples + the two BaseKey examples + the
    "same dress, different outer" invariant + the R10 preconditions (invalid base raises;
    reserved-char and `"none"` itemId raise).
  - **Scaling (§7.4):** `total_base <= 5` branch, `> 5` branch, the `== 5` boundary, the
    `MAX_CANDIDATES` ceiling, and a dresses-only (one_piece) case.
  - **Signal-branch gate + fallback reasons (§7.3 / B2 / R11):** `interaction_count` ∈ {0, 4} →
    100% random + `coldStartSampling`; `== 5` with unavailable scorer → `signalUnavailable`;
    `== 5` with available scorer that faults → `signalScorerFault`; `== 5` with available fake
    scorer → split path reachable. The three fallbacks sample identically (same seed → same set).
  - **Config (§18):** caps sum to `MAX_PROMPT_ITEMS`; exact constant values.
  - **Seed (§3.3 / C1):** determinism, per-field sensitivity, delimiter-injection guard.
- **Optional property-based (hypothesis) — nice-to-have, not blocking:**
  - Seed: ∀ distinct input tuples, the **canonical framing string** differs (the framing is
    injective). Do **not** assert `session_seed` ints are collision-free — the 64-bit SHA-256
    truncation is not (codex M0 clarification #3); the property belongs on the framing, not the hash.
  - Sampler: ∀ wardrobe ≥ cap and ∀ seed, `len(sample_type) == cap` and outputs are a subset
    of inputs with no duplicates.
  - **Confirmed:** example-based only for M0/M1; revisit hypothesis if the sampler's
    distribution needs it (no earlier than M6).
- **Done bar:** every pure function has a test; every spec-enumerated valid/invalid branch is
  a named test case; `pytest` green; no test requires Mongo, network, or API keys.

---

## 6. Out of scope / deferred (explicit)

- **Real signal scoring / trained shortlister → M4 (data) + M6 (model).** M1 ships only the
  cold-start (100% random) path and the `SignalScorer` seam. The 30% branch is dead by
  construction until a real scorer exists.
- **SlotMap *validation as a pipeline stage* and GPT JSON-schema validation → M2.** M0 builds
  `is_valid_slotmap` as a pure function; wiring it as "Step 3 validation before scoring"
  (§6.3, §8.3, §18 ordering) is M2.
- **Ranker: comboBoost, dislike cooldown, BaseKey variant cap, overuse penalty, dedup →
  M3** (§5.3, §11, appendix B1/B3). `OVERUSE_MIN_POOL=15` (B1) and `MAX_AFFINITY=20` (A3) are
  forward-declared in `config.py` but unused until M3.
- **Data-model migration → M4/M5 — forward migrations to support v1.2 (real, currently unscoped).**
  The deployed Mongo models (`fitted/models/*.ts`, authoritative for *data shape* per
  CLAUDE.md → *Canonical sources*) are the **starting state the refactor builds from, not
  constraints to reconcile against** — v1.2 adds the fields/collections below. M0/M1 are
  unaffected (they build on the spec's clean schema via fixtures), but these must be recorded
  so M4/M5 don't discover them late:
  - **`ItemAffinity` collection does not exist.** Spec §4.4 invents it; there is no
    `fitted/models/ItemAffinity.ts`. M4 must create it (or derive `affinityScore` at query
    time from `OutfitInteraction`). Closest existing signal is `PreferenceSummary.feedbackCount`,
    which counts feedback *events*, not per-item affinity.
  - **`wardrobeVersion` is not on `User`.** Spec §3.2 says it lives on the user record;
    `User.ts` has no such field. The seed (M0-5) takes it as a parameter, so M0/M1 are fine,
    but **M5 cannot supply a real `wardrobeVersion` without adding it to `User.ts` and
    incrementing it whenever the sampler-visible (active) wardrobe changes** (§3.2) — item
    activation, deletion of an active item, or an edit to an active item's attributes, **not**
    every raw mutation (a `needs_review` item the sampler can't see must not bump it; reconciles
    with the W-track activation rule in `spec-resolutions.md` §4).
  - **No `sessionId` / session concept exists.** The seed and cache key need it (§3.1, §14).
    Strategy decided: `sessionId = userId` always, anonymous sessions dropped
    (`spec-resolutions.md` R8); M5 implements.
  - **`type` (5-value) is a *consolidation* of the deployed app's de-facto classification, not a
    new capability.** `WardrobeItem.ts:7` is `enum ["top","bottom"]`, but the deployed app already
    handles dresses/jumpsuits/outer/shoes — via **request-time string-matching** over
    `category`/`name`/`subCategory` (`route.ts:241,550`), with first-class one-piece prompt rules
    (`route.ts:445–464`) and validation (`route.ts:638`). M4/M5 must **promote that scattered
    classification to first-class `clothingType` values + backfill**, then add a documented
    `WardrobeItemDocument → fitted_core.WardrobeItem` adapter. Reference the runtime derivation for
    the *mapping logic*, not as a behavioral baseline — and the string-grep path is a deletion-
    license candidate (CLAUDE.md → *Deletion license*; doesn't survive the M5 cutover). See
    `spec-resolutions.md` §4 for the evidence.
  - **`generation_logs` collection (§15) is new** — M4/M5 create it; logging stays
    best-effort and off the critical path.
- **Fly.io service + Next.js wiring → M5.** Deploy `fitted_core` as a Dockerized Python
  service on Fly.io (always-on); `fitted/app/api/recommend/route.ts` calls it via `fetch()`
  behind the `USE_ML_SHORTLISTER` feature flag, with a health check + short timeout +
  graceful fallback to the OpenAI-only flow. Also M5: caching, TTL, dislike cache
  invalidation (A4), daily re-seed activation (C1 — M0 builds the `date` *parameter*; M5
  decides *when to pass it*). The Python↔TS boundary is a `fetch()` service call —
  **resolved** (§0 Decision 2), not a deferred port decision.
  Spec scope: tops, bottoms, dresses, outer, shoes. No mid-layer per v1.2 §6.
- **Legacy `outfit_recommender.py` retirement → M6.** Untouched this chunk.
- **Appendix C1 daily re-seed activation, A4 dislike cache invalidation** — hooks noted,
  behavior deferred to M5 as above.

---

## 7. Effort summary (4–8 hr/wk cadence)

| Milestone | Tasks | Est. |
|---|---|---|
| M0 | config, models, keys, slotmap, seed (+ tests) | ~5.5 hr |
| M1 | partition, caps, 70/30+cold-start seam, scaling, entry point (+ tests) | ~6 hr |
| **Total** | | **~11.5 hr → ~2 sessions** |

Suggested cut: **Session 1 = M0** (all pure functions land green), **Session 2 = M1** (sampler
on top of M0's tested primitives). The M1-3 signal seam is the deliverable to get exactly
right — it is M6's plug point.

---

## 8. Resolved confirmations (interview 2026-06-09)

All former `[CONFIRM]` items are now settled; none block starting M0.

1. **Language / home (§1.1)** — ✅ Python in `ml-system/fitted_core/`, with online integration
   in-scope via a Fly.io service at M5 (§0 Decision 2).
2. **C1 `date` seed parameter (§1.4)** — ✅ build the parameter now, default off; activation
   deferred to M5.
3. **Raw candidate shape (§3 / M0-4)** — ✅ role-tagged item list `items: [{itemId, role}]`,
   resolved directly from spec §16 (GPT's output schema).
4. **70/30 rounding (M1-3)** — ✅ **revised** to integer half-up `random = (cap*7+5)//10`,
   signal = remainder (was `round(cap*0.7)`; banker's rounding split the real caps inconsistently
   and wouldn't survive a TS/numpy reimpl — see M1-3).
5. **Property tests (§5)** — ✅ example-based only for M0/M1; revisit hypothesis ≥ M6.
6. **Package name (§2)** — ✅ `fitted_core`.
