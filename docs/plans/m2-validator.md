# M2: GPT-response validator (parse + schema + SlotMap + keys + dedup + StyleMove)

> **Status: `[NOW]` — C1–C4 implemented and committed; C5 next (2026-06-20).** `validator.py` and
> `test_validator.py` exist. Landed: strict parser, result/issue model, root-envelope validation, the
> per-candidate schema + forbidden-field pass, SlotMap normalization + structural + sampled-pool
> validation (Decision D7 applied to `slotmap.py`), and BaseKey/FullSignature computation + exact-FullSignature
> dedup — the first checkpoint to emit accepted candidates — **294 pytest green**. Next checkpoint: C5 (StyleMove warnings).
> This plan turns `docs/Fitted_Spec_v2.md` (canonical) + `docs/CODEX_HANDOFF.md` (Codex's historical M2
> audit) into an unambiguous implementation roadmap. **Canonical spec wins on any conflict;** this doc is
> implementation guidance, not product truth.

Plan doc only — **no code or tests are written here.** The §13 compute-before-dedup wording was fixed
in `Fitted_Spec_v2.md` (commit `40f7cb50`) so §9 Step 3 and §13 now agree on the implementable order.

Routing note: `CLAUDE.md` / `docs/README.md` / `ml-system/README.md` still point "current substrate
plan" at the retired `m0-m1-substrate.md`. That cleanup is **deferred** (prior audit parking lot) and is
*not* part of M2 — left untouched here on purpose.

---

## 1. Status & scope

**M2 owns** the first strict LLM-output boundary (pipeline Steps 2→3, §9): turn a raw GPT response string
into a list of structurally-valid, deduplicated, keyed candidate outfits plus a structured issue log.
Concretely:

- GPT-response JSON **parsing** (pure; no network, no repair).
- Strict **root-envelope** validation (`{"outfits": [...]}` exactly).
- **Candidate / item schema** validation (allowed fields only; forbidden GPT fields rejected).
- **SlotMap normalization integration** — wires the existing M0 `normalize_to_slotmap` / `is_valid_slotmap`.
- **Sampled-pool membership** (`itemId ∈ sampled pool`).
- **Key computation** — `base_key` + `full_signature` via the existing M0 `keys.py`.
- **Exact-`FullSignature` dedup** within the pass.
- **StyleMove boundary validation** — warning-only (drop, never reject the outfit).

**M2 does NOT own** (hard non-goals — §12, M2 milestone boundary):
ranking · scoring · `optionPath`/`risk` · graph role labels (`anchor`/`bridge`/`experiment`) ·
compatibility/`behavioralStrength` · cooldown/freshness/exposure · fallback decisions ·
cache/`generationIndex` · `GenerationSnapshot` · feedback · forced-item/rescue/lock machinery ·
the rescue "actually changed/added item" semantic (no baseline outfit exists in M2) · any M3/M5/Spearhead
behavior · legacy `outfit_recommender.py` or `route.ts` deletion.

**M1 inputs available** (from `sampler.py`, already shipped): `SamplerResult.pool`
(`dict[ItemType, list[WardrobeItem]]` — what GPT was allowed to select from), `candidate_requested: int`,
`not_enough_items: bool`. The normal flow short-circuits to `notEnoughItems` **before any GPT call** when
`candidate_requested == 0`, so M2 never legitimately sees a `0` request (see §6).

**Home:** purely additive — `ml-system/fitted_core/validator.py` + `ml-system/tests/test_validator.py`,
plus a new `StyleMove` dataclass and a shared `IssueCode` enum **in `models.py`** (the lowest shared layer —
see §4 *Module placement* and Decision D7/D7b). No DB, no OpenAI, no service, no Next.js wiring.

---

## 2. Canonical references (read these, do not restate them)

| Spec section | What M2 needs from it |
|---|---|
| **§7** | BaseKey / FullSignature definitions + the **R10 reserved-char/sentinel precondition** (raises `ValueError`). M2 catches that as `keyPreconditionFailed`. |
| **§8** | SlotMap structure; the **three-owner validation split** (normalizer / `is_valid_slotmap` / Step-3 pool check). M2 is the Step-3 owner of `itemId ∉ pool`. |
| **§9** | Pipeline order — **Step 2** (GPT generation) and **Step 3** (normalize + validate; compute keys; drop exact FullSignature dups). M2 = Step 3. |
| **§12** | **The M2 GPT response schema** — strict root, allowed candidate/item/styleMove fields, and the explicit **forbidden-field list**. The contract M2 enforces verbatim. |
| **§13** | Normalize + validate behavior; StyleMove boundary validation (H23); invalid-JSON → `invalidJson`; the one repair attempt belongs to the network caller, **not** M2. |
| **§20** | Milestone ladder — confirms M2 = validation stage, M3 = ranker, the boundary M2 must not cross. |
| **§23 H20 / H23** | H20: path/risk/score are Python-only, never GPT — anchors the forbidden-field list. H23: `StyleMove.changedItemIds ⊆ outfit items`, else dropped via warning. |

Existing M0/M1 symbols M2 builds on: `models.Role` (5 values), `models.SlotMap`, `models.WardrobeItem`,
`slotmap.normalize_to_slotmap`, `slotmap.is_valid_slotmap`, `slotmap.template_of`, `keys.base_key`,
`keys.full_signature`, `sampler.SamplerResult`. The package error-model convention (`__init__.py`):
**expected data failures → error channel; caller-contract violations → raise.** M2 follows it exactly.

---

## 3. Public API decision

Pin the surface narrow (handoff-confirmed). Two public functions:

```python
def parse_gpt_json(raw: str) -> ParseResult:
    """Strict JSON parse. Malformed string *content* → ParseResult.issue = invalidJson
    (never raises on bad data). A non-`str` `raw` is caller misuse → raises TypeError.
    Also rejects (as invalidJson) the two non-strict cases json.loads accepts by default:
    duplicate object keys and NaN/Infinity tokens. Does NOT validate the envelope
    (that is validate_gpt_payload's job)."""

def validate_gpt_payload(
    payload: object,
    sampled_pool: Sequence[WardrobeItem],
    candidate_requested: int | None = None,
) -> ValidationResult:
    """Validate an already-parsed payload against the §12 schema, the sampled pool,
    and the §7/§13 key/dedup rules. Returns structured candidates + rejections + warnings."""
```

**Decision D1 — narrow surface.** Public = `parse_gpt_json`, `validate_gpt_payload`, and the result/issue
types callers must name (`ParseResult`, `ValidationResult`, `ValidatedCandidate`, `Issue`, `IssueCode`,
`StyleMove`). **Everything else is `_private`** (`_validate_candidate`, `_validate_item`,
`_validate_style_move`, `_build_pool_index`, `_compute_keys`, …). **Do NOT expose a public-ish
`validate_gpt_schema`** — keep schema steps private; promote one only if a concrete M3/M5 caller needs it.

**Decision D2 — two functions, not one.** Parsing is separated from envelope validation so the "invalid
JSON vs malformed object" boundary is testable in isolation and the network/repair caller (M5) can attempt
its **one** §12 JSON-repair between the two. No convenience `validate_gpt_response(raw, …)` wrapper unless a
caller proves it necessary.

**Decision D2b — strict parse (untrusted-boundary hardening).** `parse_gpt_json` is the first guard on
adversarial GPT output, so it enforces strict JSON beyond `json.loads`'s defaults: an `object_pairs_hook`
rejects **duplicate object keys** at any depth (default last-wins could hide a forbidden or malformed member
before validation sees it), and a `parse_constant` hook rejects **`NaN`/`Infinity`/`-Infinity`** — both →
`invalidJson` (neither is "strictly valid JSON" per §12). A non-`str` `raw` raises `TypeError`
(caller-contract, per §6 / the `__init__.py` convention); malformed *string content* returns `invalidJson`
(data). *(Both are canonically homed in §12: `NaN`/`Infinity` violate its "strictly valid JSON only", and
the duplicate-key rule is now stated there explicitly.)*

---

## 4. Result model & issue-code model

**Decision D3 — explicit dataclasses, codes not prose.** Downstream M3/M5 must depend on stable codes, not
tuples or human strings. Tests assert on `IssueCode` (and `candidate_index` where useful), **never** on
`detail` text. **`IssueCode` is an append-only contract:** member *values* are exactly the table strings
below; never rename or repurpose one without a downstream migration (M3/M5 may persist or branch on them).

```python
# --- in models.py (lowest shared contract layer; importable by slotmap.py AND validator.py) ---
class IssueCode(Enum):
    ...   # camelCase string values, mirroring the existing log-label style ("coldStartSampling")

@dataclass(frozen=True)
class StyleMove:                      # new; additive (D7b — home is models.py)
    move_type: str
    changed_item_ids: list[str]
    one_sentence: str

# --- in validator.py (M2 result plumbing; imports down into models.py, never the reverse) ---
class Severity(Enum):
    rejection = "rejection"
    warning   = "warning"

@dataclass(frozen=True)
class Issue:
    code: IssueCode
    candidate_index: Optional[int]   # index in the original `outfits` array; None for root/aggregate
    detail: Optional[str] = None     # human debug aid only — NEVER asserted in tests

@dataclass(frozen=True)
class ValidatedCandidate:
    source_index: int                # position in the original `outfits` array
    slot_map: SlotMap
    template: Template
    base_key: str
    full_signature: str
    style_move: Optional[StyleMove]   # present iff a valid StyleMove was supplied; else None (+ warning)

@dataclass(frozen=True)
class ParseResult:
    payload: Optional[object]         # parsed JSON value on success
    issue: Optional[Issue]            # invalidJson on failure

@dataclass(frozen=True)
class ValidationResult:
    candidates: list[ValidatedCandidate]
    rejections: list[Issue]
    warnings: list[Issue]
```

**Module placement (D7/D7b).** `IssueCode` and `StyleMove` live in **`models.py`** — the lowest shared
contract layer, alongside `ItemType`/`Role`/`Template`. D7 (owner-emits-code) requires `slotmap.py` to
*return* `IssueCode`s, so the enum **cannot** live in `validator.py`: that would force `slotmap.py` to import
`validator.py` while `validator.py` imports `slotmap.py` — a circular import and an M0→M2 layering inversion.
Homing it in `models.py` keeps the dependency arrow one-way (`slotmap.py` and `validator.py` both import
*down* into `models.py`). Everything else above (`Severity`, `Issue`, `ValidatedCandidate`, `ParseResult`,
`ValidationResult`) is M2-specific result plumbing in `validator.py`.

**Severity is a function of the code, not a stored field** — one source of truth, no drift between a stored
severity and which list an issue lands in. It is exposed through a `severity_of(code)` helper over a
module-level `_SEVERITY: dict[IssueCode, Severity]` in `validator.py`, **not** persisted on `Issue`. The
table below *is* that mapping; `rejections`/`warnings` membership follows it exactly.

### Issue-code table (the stable contract)

| Code | Severity | Locus | Fires when |
|---|---|---|---|
| `invalidJson` | rejection | root | `raw` is not parseable JSON (from `parse_gpt_json`) |
| `malformedRoot` | rejection | root | payload not an object, **or** root has any key other than `outfits` (strict envelope) |
| `invalidOutfits` | rejection | root | `outfits` missing, or present but not a list |
| `invalidCandidateShape` | rejection | candidate | a candidate entry is not a JSON object |
| `unknownCandidateField` | rejection | candidate | candidate has a key ∉ `{items, styleMove}` and ∉ forbidden set |
| `forbiddenGptField` | rejection | candidate | candidate/item carries a §12-forbidden field (score, rank, optionPath, risk, …) |
| `invalidItems` | rejection | candidate | `items` missing or not a list (an **empty** `items: []` is *not* a schema reject — it normalizes to `emptyBase`, N3) |
| `invalidItemShape` | rejection | candidate | an item entry is not a JSON object |
| `unknownItemField` | rejection | candidate | item has a key ∉ `{itemId, role}` and ∉ forbidden set |
| `invalidItemId` | rejection | candidate | `itemId` missing, not a string, or empty string |
| `invalidRole` | rejection | candidate | `role` missing or not a string (**schema-level** presence/type) |
| `unknownRole` | rejection | candidate | `role` is a string but not one of the 5 `Role` values (**normalizer-owned**) |
| `duplicateRoleSlot` | rejection | candidate | a second item fills an already-assigned role slot (**normalizer-owned**) |
| `mixedTemplate` | rejection | candidate | dress combined with top/bottom (`is_valid_slotmap`) |
| `emptyBase` | rejection | candidate | no base role / optionals-only (`is_valid_slotmap`) |
| `incompleteTwoPiece` | rejection | candidate | top xor bottom only (`is_valid_slotmap`) |
| `duplicateItemId` | rejection | candidate | same itemId in more than one slot (`is_valid_slotmap`) |
| `itemOutsideSampledPool` | rejection | candidate | an itemId ∉ the sampled-pool id set (**M2 Step-3 owned**) |
| `duplicateFullSignature` | rejection | candidate | this FullSignature already appeared earlier in the pass |
| `keyPreconditionFailed` | rejection | candidate | `base_key`/`full_signature` raised `ValueError` (R10 reserved char / sentinel / invalid base) |
| `invalidStyleMoveShape` | **warning** | candidate | `styleMove` present but malformed: non-object, unknown/forbidden field, or a §12 field violation — `moveType`/`oneSentence` missing/non-string/**empty**, or `changedItemIds` missing/non-array/**empty**/with a non-string or empty-string entry |
| `styleMoveItemOutsideOutfit` | **warning** | candidate | `changedItemIds ⊄ outfit item ids` (H23) |
| `duplicateStyleMoveChangedIds` | **warning** | candidate | `changedItemIds` contains duplicates |
| `extraCandidatesIgnored` | **warning** | aggregate | more candidates supplied than `candidate_requested` (one aggregate warning) |

**Rejection vs warning, stated plainly:** every code above is a **rejection** (drops that candidate, or —
for `invalidJson`/`malformedRoot`/`invalidOutfits` — the whole root, yielding zero candidates) **except**
the four StyleMove/aggregate codes, which are **warnings** (the candidate survives; only the StyleMove or
the surplus is dropped).

**Decision D4 — `invalidRole` vs `unknownRole` are split by owner** (handoff "delegate unknown role to
`normalize_to_slotmap`"). The schema pass checks role *presence + string-ness* (`invalidRole`); the
normalizer owns *bad value* (`unknownRole`) and *duplicate slot* (`duplicateRoleSlot`). Together they cover
the "missing/non-string/unknown role" requirement without M2 re-implementing role knowledge.

**Allowed/forbidden field sets** (from §12, pin as module-level frozensets):
- root: `{"outfits"}` · candidate: `{"items", "styleMove"}` · item: `{"itemId", "role"}` ·
  styleMove: `{"moveType", "changedItemIds", "oneSentence"}`.
- forbidden (mirrors §12's enumeration **verbatim** — §12 is the single home, keep in sync):
  `{score, rank, optionPath, risk, anchor, bridge, experiment, edge, compatibility,
  behavioralStrength, freshness, exposure, cooldown, fallback, imageUrl, warmth,
  matchedTraits, missingTraits, diagnosticReason}`.
- **Precedence:** an unexpected key on the forbidden set → `forbiddenGptField` (sharper diagnostic); any
  other unexpected key → `unknownCandidateField` / `unknownItemField`. A forbidden/unknown key *inside
  `styleMove`* is a **warning** (`invalidStyleMoveShape`, drop the StyleMove), never a candidate rejection.

---

## 5. Missing `styleMove` decision

**Decision D5.** `styleMove` is optional (§12).

- **Missing `styleMove` → valid, no warning.** `ValidatedCandidate.style_move = None`. Do not warn; do not
  reject. Absence is the common, correct case.
- **Present-but-invalid `styleMove` → dropped + one warning**, candidate stands. `style_move = None`, plus
  the matching warning code (`invalidStyleMoveShape` / `styleMoveItemOutsideOutfit` /
  `duplicateStyleMoveChangedIds`).
- **Invalid `styleMove` must never reject an otherwise-valid candidate** (H23, §13). The outfit's
  structural validity is independent of its styling prose.

---

## 6. Invalid `candidate_requested` decision

**Decision D6 — caller-contract semantics** (mirrors the package convention: caller misuse raises; matches
the existing `sampler._reject_duplicate_ids` and `_is_finite_score` bool-rejection precedents). Order the
guard as type-first, then value:

| Input | Behavior |
|---|---|
| `None` | **No bound** — validate all candidates. |
| positive `int` | **Upper bound** — validate the first N (see §7 ordering); extras → `extraCandidatesIgnored` warning. |
| `bool` (`True`/`False`) | **`TypeError`.** `bool` is an `int` subclass; reject explicitly (R12 `warmth=True` precedent). |
| non-`int` (float, str, …) | **`TypeError`.** |
| `0` | **`ValueError`.** Normal flow short-circuits to `notEnoughItems` before GPT, so `0` here is caller misuse. |
| negative `int` | **`ValueError`.** |

`TypeError` for wrong *type*, `ValueError` for wrong *value* — consistent and conventional. These raise
(they are not data-driven issues); only well-typed payload/candidate problems become `Issue`s.
**Implementation order:** test `isinstance(x, bool)` **before** the `int` check — `isinstance(True, int)` is
`True`, so a bool slips through an int-first guard (mirror `_is_finite_score`'s bool short-circuit).

**Production passes the real bound.** A production caller passes `SamplerResult.candidate_requested` (always
`≤ MAX_CANDIDATES=40` per §10/§22), so the cap is enforced end-to-end. `None` is an **explicit
unbounded/test mode** — convenient for unit tests, but production M2 must not pass it (an unbounded GPT
response would bypass the §10/§22 candidate cap).

---

## 7. Validation flow (implementation ordering)

`validate_gpt_payload` runs this exact order. **A malformed root returns zero candidates and does NOT
partially validate nested candidates** (§13).

1. **Resolve `candidate_requested`** (§6) — raise on misuse; else `None`-unbounded or an int bound.
2. **Build the pool index** (§8) — flatten `sampled_pool` to an id set; **duplicate ids → `ValueError`**.
3. **Root envelope** — payload is an object, has exactly key `outfits`, `outfits` is a list. Any failure →
   the matching root rejection (`malformedRoot` / `invalidOutfits`), **return immediately, no candidates.**
4. **Apply the upper bound** — if a bound is set and `len(outfits) > bound`, take the first `bound`
   candidates and emit **one** `extraCandidatesIgnored` warning. Ignored extras must not affect accepted
   candidates, their warnings/rejections, or dedup state.
5. **Per candidate** (in order; a bad candidate never stops later candidates — §13):
   1. **Candidate schema** — object? allowed/forbidden keys? `items` a list (an **empty** list is allowed
      here — it falls through to `emptyBase` at 5.4, N3; only missing/non-list → `invalidItems`)?
   2. **Item schema** — each item an object; allowed/forbidden keys; `itemId` non-empty string; `role`
      present + string. (Unknown role *value* deferred to the normalizer in 5.3.)
   3. **Normalize → SlotMap** — `normalize_to_slotmap` (owns `unknownRole`, `duplicateRoleSlot`).
   4. **`is_valid_slotmap`** — owns `mixedTemplate` / `emptyBase` / `incompleteTwoPiece` / `duplicateItemId`.
   5. **Sampled-pool membership** — every slot itemId ∈ pool id set, else `itemOutsideSampledPool`.
   6. **Compute keys** — `base_key` + `full_signature`; wrap their `ValueError` as `keyPreconditionFailed`
      (must not escape).
   7. **Dedup** — if this `full_signature` was already accepted this pass → `duplicateFullSignature`
      (drop); else record it and keep the candidate.
   8. **StyleMove** (warning-only, last) — validate shape, then `changedItemIds ⊆ outfit ids`, then no
      duplicate changed ids. Valid → attach; the **first failing check** emits its one warning and drops the
      StyleMove (`style_move=None`). **Never affects 5.1–5.7** — the candidate still stands.
6. **Return** `ValidationResult(candidates, rejections, warnings)`.

Any candidate-level rejection in 5.1–5.7 stops *that* candidate (first failing check wins — one `Issue`,
with `candidate_index`); the loop continues to the next candidate.

**Empty `outfits` is valid.** `{"outfits": []}` passes the root envelope (it *is* a list) → zero candidates,
**no rejection** (distinct from `invalidOutfits`, which is missing/non-list). M5 owns the zero-candidate
fallback (out of M2 scope); M2 only reports the empty result.

**Empty `items` is not a schema reject.** A candidate with `items: []` passes schema (5.1), normalizes to an
empty SlotMap (5.3), and is rejected as `emptyBase` by `is_valid_slotmap` (5.4) — the §8/N3 owner of
empty-base (pinned by `test_slotmap.py::test_normalize_empty_list_defers_emptiness_to_is_valid`, and
`normalize_to_slotmap([]) == (SlotMap(), None)`). M2 must **not** pre-empt it as `invalidItems`; that would
duplicate a reject the SlotMap layer already owns (single-home rule).

**Result ordering (determinism).** `candidates` are in accepted input order (dedup keeps the *first*
occurrence, so survivors stay in input order). `rejections` and `warnings` are in **encounter order** — each
candidate's issue is appended as the loop reaches it (5.1–5.8); the single `extraCandidatesIgnored` warning
is emitted at the bound step (4), so it precedes any per-candidate warning. Stable order keeps the result
reproducible for downstream snapshots/logging.

---

## 8. `sampled_pool` contract

**Decision D8.**
- `sampled_pool` is a **flat `Sequence[WardrobeItem]`** — the caller (M5 adapter / tests) concatenates
  `SamplerResult.pool.values()` in `ItemType` enum order. M2 flattens it to an **id set** (`{it.id for it
  in sampled_pool}`) once, up front (flow step 2).
- Candidate ids are validated **only against the sampled pool**, never the full wardrobe (the pool is the
  bounded set GPT was shown; §8/§12).
- **Duplicate ids in `sampled_pool` are caller-contract misuse → `ValueError`** (mirrors
  `sampler._reject_duplicate_ids`, R12: a duplicate id collapses the membership lookup and breaks key
  equality). A clean M1 path can never produce this; raising surfaces the upstream bug loudly.

The contract is **flat `Sequence[WardrobeItem]`, no variant** — a caller holding the sampler's per-type
`SamplerResult.pool` flattens `pool.values()` before calling `validate_gpt_payload`. M2 never accepts the
per-type mapping; one shape keeps the contract unambiguous.

---

## 9. Dedup contract

**Decision D9** (§7, §13, handoff):
- **Exact `FullSignature` duplicates only.** Two candidates collide iff their `full_signature` strings are
  identical.
- **Same `BaseKey`, different `FullSignature` survives** — e.g. same dress, different outer is two distinct
  outfits (§7 invariant). Never dedup on `BaseKey`.
- **First structurally-valid keyed candidate wins.** The first candidate to reach step 5.7 with a given
  `full_signature` is kept; later identicals → `duplicateFullSignature`.
- **StyleMove validity does not affect dedup.** Dedup happens (5.7) *before* StyleMove validation (5.8). So
  if duplicate A (invalid StyleMove) precedes duplicate B (valid StyleMove): **A is kept** (its StyleMove
  dropped with a warning), **B is rejected** as `duplicateFullSignature`. Order of appearance — not StyleMove
  quality — decides the winner.
- **Key `ValueError` → structured `keyPreconditionFailed` rejection, never an escaping exception.** Compute
  keys inside a guard; convert R10 precondition failures to the code.

---

## 10. Test plan (pytest, `ml-system/tests/test_validator.py`)

Example-based (matches `m0-m1-substrate.md` §5: example-based for M0/M1; revisit hypothesis ≥ M6).
**Assert on `IssueCode` and `candidate_index`, never on `detail` prose.** A small `sampled_pool` fixture
(a handful of `WardrobeItem`s with known ids) plus inline JSON strings carry most cases. Staged so each
checkpoint (§11) lands its own green tests:

- **Stage A — parser + root envelope + result model.** Invalid JSON → `invalidJson`. Valid JSON.
  **Strict parse:** duplicate object keys → `invalidJson`; `NaN`/`Infinity`/`-Infinity` tokens →
  `invalidJson`; non-`str` `raw` → `TypeError`. Root not an object → `malformedRoot`. Extra root key →
  `malformedRoot`. Missing `outfits` / `outfits` not a list → `invalidOutfits`. **Empty `outfits: []` →
  valid root, zero candidates, no rejection** (distinct from `invalidOutfits`). Malformed root → **zero
  candidates, no nested validation**. `ParseResult` / `ValidationResult` shape.
- **Stage B — candidate/item schema + forbidden fields.** Non-object candidate → `invalidCandidateShape`.
  Unknown candidate key → `unknownCandidateField`. **Forbidden fields — table-driven, enumerating every
  §12 forbidden name verbatim** (`score`, `rank`, `optionPath`, `risk`, `anchor`, `bridge`, `experiment`,
  `edge`, `compatibility`, `behavioralStrength`, `freshness`, `exposure`, `cooldown`, `fallback`,
  `imageUrl`, `warmth`, `matchedTraits`, `missingTraits`, `diagnosticReason`) → each `forbiddenGptField`.
  `items` missing/non-list → `invalidItems` (**empty `items: []` is NOT here — see Stage C**). Non-object
  item → `invalidItemShape`. Unknown item key → `unknownItemField`. `itemId` missing/non-string/empty →
  `invalidItemId`. `role` missing/non-string → `invalidRole`. **Candidate-by-candidate:** one bad candidate,
  one good candidate → good one survives.
- **Stage C — SlotMap integration.** `unknownRole` (string but not a `Role`) and `duplicateRoleSlot`
  (normalizer-owned). `mixedTemplate`, `emptyBase`, `incompleteTwoPiece`, `duplicateItemId`
  (`is_valid_slotmap`-owned). **Empty `items: []` → `emptyBase`** (passes schema, normalizes to an empty
  SlotMap, rejected by `is_valid_slotmap` — the N3 owner; **not** `invalidItems`). Valid one-piece,
  two-piece, ±outer, ±shoes produce **no structural rejection (pass-through)** — accepted-candidate
  emission (with `template` + keys) is Stage E / C4; C3 emits no `ValidatedCandidate`s.
- **Stage D — sampled-pool membership.** Item ∈ pool produces **no pool rejection**; item ∉ pool →
  `itemOutsideSampledPool`. Validates against the pool, not a wider wardrobe. **Duplicate ids in
  `sampled_pool` → `ValueError`.**
- **Stage E — keys + FullSignature dedup.** **The first stage that emits accepted `ValidatedCandidate`s**
  (they require `base_key` + `full_signature`, computed here). BaseKey/FullSignature computed correctly
  (cross-check the §7 examples). Exact-FullSignature duplicate → second dropped (`duplicateFullSignature`).
  Same BaseKey, different FullSignature (e.g. different outer) → **both survive**. Reserved-char / `"none"`
  itemId → `keyPreconditionFailed` (no escaping `ValueError`).
- **Stage F — StyleMove validation.** Missing styleMove → valid, **no warning**, `style_move=None`. Valid
  styleMove → attached. Malformed styleMove → `invalidStyleMoveShape` (warning, candidate stands), including
  the §12 **non-empty** cases: empty `moveType`/`oneSentence`, empty `changedItemIds: []`, and a
  non-string/empty-string `changedItemIds` entry. `changedItemIds ⊄ outfit` → `styleMoveItemOutsideOutfit`
  (warning). Duplicate changedItemIds → `duplicateStyleMoveChangedIds` (warning). **Invalid styleMove never
  rejects the candidate.**
- **Stage G — `candidate_requested` boundary.** `None` → all validated. Fewer than bound → valid (not an
  error). Exactly bound. More than bound → first N validated + one `extraCandidatesIgnored`; **extras do not
  affect accepted candidates / dedup state.** `0` → `ValueError`; negative → `ValueError`; `bool` →
  `TypeError`; non-int → `TypeError`.
- **Stage H — mutation-hardening** (from the handoff's adversarial list — each must have a test that *fails*
  a naive mutant): accepting unknown/forbidden fields · treating `candidate_requested` as exact · extras
  affecting accepted candidates · invalid StyleMove rejecting a valid outfit · accepting `changedItemIds`
  outside the outfit · failing to reject a duplicate FullSignature · deduping by BaseKey · skipping pool
  membership · checking global ids instead of the pool · throwing on candidate-level bad data instead of
  recording an issue · partially validating a malformed root · computing keys before structural/pool
  validation · letting a key `ValueError` escape · last-write-wins on a duplicate role slot · first-duplicate
  loses when it has the worse StyleMove · classifying empty `items: []` as `invalidItems` instead of routing
  it through normalization to `emptyBase` at the SlotMap layer.

---

## 11. Implementation checkpoints (small commits)

Each checkpoint is a self-contained green-test commit. Test-first within each (the result/issue model is
pinned in tests before behavior, per the handoff).

| # | Commit | Lands |
|---|---|---|
| C0 | *plan/spec only* | **this doc** (no code) |
| C1 ✅ | result model + parser/root | `IssueCode`, `Issue`, `ParseResult`, `ValidationResult`, `ValidatedCandidate`, `StyleMove`; `parse_gpt_json`; root-envelope validation. Stage A green. **Done (committed).** |
| C2 ✅ | candidate/item schema | allowed/forbidden field enforcement; `items`/`itemId`/`role` schema; candidate-by-candidate isolation. Stage B green. **Done (committed).** |
| C3 ✅ | SlotMap + pool | wire `normalize_to_slotmap`/`is_valid_slotmap`; structural codes (Decision D7); pool-membership + duplicate-pool-id guard — structural/pool **rejections only; emits no accepted candidates**. Stages C–D green. **Done (committed).** |
| C4 ✅ | keys + dedup | `base_key`/`full_signature` integration; `keyPreconditionFailed`; exact-FullSignature dedup; first-wins ordering; **first checkpoint to populate `ValidationResult.candidates`**. Stage E green. **Done (committed).** |
| C5 | StyleMove warnings | `StyleMove` validation, warning-only drop; missing-styleMove decision. Stage F green. |
| C6 | boundary + hardening + closeout | `candidate_requested` semantics (Stage G); Stage H mutants; flip `__init__.py` "M0/M1"→"M0–M2"; add `> COMPLETED` banner to this plan. |

**C3/C4 boundary (locked 2026-06-20).** C3 performs SlotMap normalization, sampled-pool membership, and the
structural/pool **rejections** only — it emits **no** accepted `ValidatedCandidate`s. **C4 is the first
checkpoint that populates `ValidationResult.candidates`**, because a `ValidatedCandidate` requires
`base_key` + `full_signature` (both computed at C4). C3 tests therefore assert candidate **rejections** and
structural **pass-through (no rejection)**, never accepted-candidate emission.

Effort (4–8 hr/wk cadence): C1 ~1.5h · C2 ~1.5h · C3 ~2h (densest — the structural-code decision) ·
C4 ~1.5h · C5 ~1h · C6 ~1.5h. **Total ~9h → ~1.5 sessions.**

---

## 12. Risks / non-goals (what must not creep in)

- **No ranking/scoring/path/risk/graph/compatibility/fallback** — those are M3 (§9 Steps 4–6) and Python-only
  (H20). M2 emits no scores and no ordering beyond preserving input order.
- **No cache / `generationIndex` / `GenerationSnapshot` / feedback** — M4/M5.
- **No forced-item / rescue / lock semantics**, and **no rescue "actually changed/added item" check** — M2
  has no baseline outfit, so it enforces only `changedItemIds ⊆ outfit` (H23). The §6.5 semantic is later
  rescue/ranker code.
- **No JSON repair / network** — `parse_gpt_json` is pure; the single §12 repair attempt is the M5 caller's.
- **No legacy deletion** — `outfit_recommender.py` / `route.ts` untouched (deletion license activates M5/M6).
- **No prose assertions in tests** — codes only, or the result model silently drifts.
- **No widening the public API** — resist exposing schema helpers; M3/M5 consume `IssueCode` + the result
  dataclasses, nothing more.

---

## Resolved decisions (D7, D7b) — locked 2026-06-19

Both are **decided** and now **applied** (D7 → C3, D7b → C1). They record the implementation choice each
checkpoint carried out.

- **Decision D7 — structural-code home: owner-emits-code (LOCKED).** The structural rejects
  (`mixedTemplate` / `emptyBase` / `incompleteTwoPiece` / `duplicateItemId` / `unknownRole` /
  `duplicateRoleSlot`) are *owned* by `slotmap.py` (`normalize_to_slotmap` / `is_valid_slotmap`), which today
  returns a prose `reason` string. **The SlotMap owner will emit/return stable structural `IssueCode`s for
  its own validation failures** — so `validator.py` neither duplicates SlotMap rules nor classifies prose.
  This is the single source of truth for those codes, and the **one** place M2 reaches into M0. **Applied at
  C3** (commit `7094a4b3`): `slotmap.py` changed its second return element from `str` to `IssueCode` (the
  `.value` stays human-readable), and the existing `test_slotmap.py` substring asserts moved to
  `is IssueCode.x`. Rationale: single-ownership (handoff) + M2 is the first stable-code consumer
  (handoff parking lot). The rejected alternative (freeze M0, classify in `validator.py`) was **not** taken —
  it would either duplicate the §8 rules or couple M2 to prose.
  - **Layering consequence — `IssueCode` lives in `models.py`, not `validator.py`.** Because `slotmap.py`
    must *return* `IssueCode`s, the enum has to sit in a module `slotmap.py` already imports. If it lived in
    `validator.py`, `slotmap.py` would import `validator.py` while `validator.py` imports `slotmap.py` — a
    circular import / M0→M2 inversion. `models.py` is the lowest shared contract layer, so both `slotmap.py`
    and `validator.py` import `IssueCode` from it one-way (see §4 *Module placement*).
- **Decision D7b — `StyleMove` dataclass home: `models.py` (LOCKED).** The `StyleMove` dataclass was added to
  `ml-system/fitted_core/models.py` at C1 (commit `2f8f4959`) — a core data contract reused by the M3 ranker
  and M5 response layer, added as a purely additive new symbol (no change to existing `models.py` contracts).
  It does **not** live in `validator.py`.

No spec contradictions were found that block this plan — the only canonical-doc nit (§13 clause order) was
already fixed in commit `40f7cb50`.
