# M4 — Data-model migration (planning conductor)

> ACTIVE PLANNING — multi-session arc, Session 5 of ~11 **CLOSED** (`clothingType`→5 backfill classifier + additive field-adds locked 2026-06-25 — §10; the detachable light island, §7.4). S3 (GenerationSnapshot schema/writer-contract) + S4 (OutfitInteraction binding fields, the de-orphan loop, the H19 reducer contract) + S5 (`clothingType` consolidation) close the *design*; implementation waits on the S9/M5 checkpoints (§8.11 + §9.8 + §10.6 S9-obligations). Canonical contracts live in spec **§15.1** (snapshot) + **§6.6/§16/Appendix B** (interaction binding + reducer constants) + **§6.1** (`clothingType` consolidation). **Next: S6 — feedback authenticity + the full authenticity contract (MEDIUM; runs after S3/S4).** This is the **in-repo conductor** for
> M4 planning: the session map, the locked framing decisions, the hole map, and the open-questions log.
> It supersedes the throwaway `~/Downloads/m4-session-plan-DRAFT.md`; from Session 2 on, the conductor
> lives here and the Downloads file can be dropped.
>
> **Single-home discipline.** Canonical design lives in `docs/Fitted_Spec_v2.md`. The GenerationSnapshot
> **contract** lands in spec **§15.1** (created in Session 3). This plan holds rationale, tradeoffs,
> query/index notes, and implementation checkpoints, and *points* to the spec for every canonical
> decision — it never restates the contract.

## 0. Goal & the one-way-door principle

M4 migrates the deployed Mongo schemas (`fitted/models/*.ts`) to support the v2 contracts the
`fitted_core` substrate already assumes: `clothingType`→5 + backfill, action-enum extension
(`planned/packed/corrected`), the `wardrobeVersion` field (`sessionId` is a derivation, not an
independent stored field), the affinity projection posture, the
**GenerationSnapshot**, `baseKey`/`fullSignature` on interactions, and the feedback-authenticity
contract. (`fitted_core` is already *ahead* of the persisted schema — e.g. `models.py` `ItemType` has
all 5 values — so most of M4 is "catch the persisted side up," not "invent a concept.")

**Depth follows reversibility.** The spec §6 data-model posture (lines ~196–214) makes most closed-set
changes **additive / reversible by default** (rule 1: additive + raw-preserving; rule 2: inferences are
drafts; rule 3: events append-only with lineage). Those need *not* be planned exhaustively. The only
changes worth slow, careful design are the **irreversible foreclosures**: discarding raw data, or
breaking/foreclosing a stored format.

**M4 has exactly ONE one-way door:** the **GenerationSnapshot schema + its identity binding.** It
survives not because of existing data (there is none — see Decision 3) but because it forecloses what
*future* snapshots can capture — a schema that omits rejected candidates / continuous scores / visual
means every snapshot written under it in M5+ is permanently missing that signal (H29).

**The `clothingType` backfill is NOT a one-way door:** no real users beforehand → no accumulated raw
data to discard, and posture rule 1 keeps `clothingType` re-derivable from raw
`category`/`name`/`subCategory`. It is reversible, re-runnable, forward-design. Everything else
(`sessionId` derivation, the `wardrobeVersion` field, the affinity projection posture, action-enum, H37
scope vocab, H19 shown-history home) is additive → lighter sessions.

**Per-session discipline** (what made Spearhead work): one hard decision per session; reason from the
user-facing promise + first principles; **Fable-review the one one-way-door call (Session 3)**; every M4
hole resolved-or-explicitly-re-deferred on the record. **Doc-discipline bookends:** *open* (this session)
with an inbound conflict/hole audit; *close* with content-alignment (S10) and documentation-consistency
(S11) as **separate** passes.

## 1. Session map (revised after Session 1)

Count is downstream of the reversibility principle, not a target. Sessions are not independent — see the
**S3↔S4↔S6 coupling** noted below.

| S | Focus | S1-decided constraints folded in |
|---|---|---|
| **1** | **Inbound audit + framing decisions.** ✅ DONE — §2/§3/§5 below. | — |
| **2** | **Boundaries + reversibility classification.** ✅ DONE — §7 below (in/out scope, the foreclosure cluster, OQ2 resolved, session weights). | Decided the **ItemAffinity scope** (OQ2 → §7.3: rebuildable projection, compute-live default); weights set respecting the S3↔S4↔S6 coupling (§7.4). |
| **3** | **GenerationSnapshot schema — THE one-way door. ✅ CLOSED §8** (design locked 2026-06-25; narrow second pass CONFIRMED the fold — §8.10/§8.11; implementation → S9/M5). Rejected/low-ranked candidates + reasons, continuous path/risk/compatibility *scores* (not buckets), visual ref/embedding (not text-only), immutability + embedded StyleProfileSnapshot, H10 interaction-time feature snapshots, `schemaVersion`. Read side: M6 training reads, de-orphan reads, feedback-binding lookups + the Mongo **index** plan. Dual-read review (Codex × substitute-Fable) + narrow second pass. | **Now also owns the M4 *writer contract*** (Decision 2 — the 10 deliverables). **Reserve a deletion/redaction seam** (Decision 4 / H43). **Revalidate payload size** before finalizing TS-writes-vs-Python-direct (Decision 2 open tension). Rejected/low-ranked payload is **server-side Python→TS only**, not client-returned. |
| **4** | **Persisted identity & binding. ✅ CLOSED §9** (2026-06-25). `baseKey`/`fullSignature` + `{snapshotId,candidateId}` additive on interaction rows; the de-orphan binding loop (server re-reads the snapshot candidate, never the echo); the **H19 reducer contract** (count-based snapshot window → dedup → truncate to the shipped `REPETITION_WINDOW_SIZE` → ordered `Sequence[str]`); `shownBaseKeys` dropped; `shownPosition`/`generationIndex` not row-stored (derive from snapshot); OQ4 M4/M5 split confirmed. | Coupled to S3 (stored identity/format/home) **and** S6 (membership + H11 dup-feedback dedup). |
| **5** | **`clothingType`→5 migration + additive field-adds. ✅ CLOSED §10** (2026-06-25). Fallback = **default-to-top** (deployed parity; guesses surfaced in the D3 report; durable review = W-track `needs_review`, §18) — null+downstream and a new M4 review-field both rejected (§10.2). Found + resolved: the dresses debt is **two divergent string-match sites** (`route.ts:231`/`:543`), reconciled into **one canonical classifier** (§10.1/§10.3). `wardrobeVersion` field added (home = `User`; bump = W-track/H6); `sessionId` stays derived (=userId, Finding E). | Idempotent + additive; raw never discarded (re-derives from raw, ignores the default-laden `clothingType`); dry-run/report mode (D3). **No ItemAffinity** (OQ2). action-enum is **S6**, not batched here. |
| **6** | **Feedback authenticity + the full authenticity contract.** Define the **full** authenticity contract here (existence + ownership + outfit-membership + bind-to-identity), even though implementation **splits M4/M5** (Finding A). Action-enum extension; H37 scope vocab (`lens`/`exception`, field additive; behavior `[STAGED]`); **H11 forward write-path concurrency** (duplicate feedback, concurrent affinity updates — real for deployed M5, distinct from the now-trivial backfill idempotency). | Weight set by S2, **not** pre-assumed light. The membership check reads shown-history → coupled to S4/S3. |
| **7** | **Reconcile with reality.** `fitted/models/*.ts`, deployed schema, what the M5 request adapter needs, M4↔M5 deploy sequencing, migrate-vs-delete seams (deletion license is M5/M6, not M4). | **PreferenceSummary** migrate-vs-delete (D3 — spec is silent on it). **Final ItemAffinity placement** (D6). **OQ5 `engineVisible` adapter-mapping gap** — the deployed→`fitted_core` mapping table (§4). |
| **8** | **Adversarial falsification.** *Distinct muscle from alignment.* Attack (a) runtime flows — edited item mid-session, deleted item with prior feedback, concurrent/duplicate feedback, re-roll, day-boundary (H10/H11); (b) the classifier on fixtures — ambiguous/null rows, the dresses-debt cases. | — |
| **9** | **Implementation ladder.** Decompose M4 into an ordered checkpoint sequence (C1–Cn), each with acceptance criteria + a test plan (pytest for substrate/migration over fixtures; jest where TS models change). Produces the "directly implementable" artifact. | **Must carry the 9 §8.11 S9-obligation checkpoints** (version constants; Option-B trace wrappers; cross-language serializer tests; raw-cap constants + BSON-size guard; itemSnapshot builder-drift tests; snapshotId/candidateId ordering; Python candidateId over the full funnel; graceful-degradation snapshot semantics; over-limit candidate preservation) **plus the S4 obligations (§9.8)** (interaction binding fields + co-presence invariant; the binding index; the M4 gate functions; the H19 reducer + its empty-snapshot/tie-break tests). |
| **10** | **Content alignment audit.** Does the M4 design cohere with the ambition appendix, the canonical spec, the closed M0–M3 substrate, and Spearhead? Catch design contradictions + missed dependencies. | — |
| **11** | **Documentation consistency freeze.** §6 checklist; only freeze when all pass; the plan doc gets `> COMPLETED <date>` and leaves the default reading list. | — |

**The S3↔S4↔S6 coupling (carry-forward from Finding A).** The feedback-authenticity gate's
**outfit-membership** check ("did we actually show this?") reads **shown-history**, whose storage home is
fixed by S3 as `GenerationSnapshot.shownFullSignatures`; S4 owns the persisted interaction fields plus the
window/cap contract the M5 reducer will execute. So the authenticity contract (S6) cannot be finalized
independently of S3/S4. S2's weighting must treat these three as a cluster, not three light sessions.

## 2. Locked framing decisions (Session 1)

Signed off 2026-06-25. Each points to where the canonical decision will be recorded; this log is the
conductor's record of *what* was decided, not a substitute for the spec.

### D1 — Doc-home / compaction

The GenerationSnapshot schema is a **durable cross-milestone contract** (M5 writes it, M6 trains on it),
same character as the keys (§7). It is expanded **in place in the spec as a new §15.1 subsection**
(field list + H29's three requirements + `schemaVersion` + identity-binding rule). **§6.6 stays a
pointer only.** This M4 plan holds the rationale / tradeoffs / query-pattern / index detail and points
back to §15.1. No separate data-model doc now (would split single-home for a budget we're nowhere near:
spec is 992 lines vs the 1,500 backstop; §15.1 is ~80–120 lines). Re-check after S3 drafts it; spin out
a dedicated reference doc only if M4's total spec edits approach ~1,300.

### D2 — Writer ownership, schema home, serialization contract  *(S3 CLOSED — C+D hybrid locked; OQ1 TS-write provisional until the S9 BSON-size guard — §8.4/§8.6/§8.11)*

- **Split:** **M4 owns the writer *contract*; M5 owns the live route wiring.** M4 is more than
  shape/storage/indexes — it owns the **provenance boundary** + **content invariant** + **funnel-capture
  obligation** (those are contract, not wiring; §8.4).
- **Storage home = a TS Mongoose model `GenerationSnapshot.ts` (M4)**, alongside the existing models —
  one Mongo-writing layer, no Mongo creds in the Python service, matches deployed architecture.
- **Authoritative shape = spec §15.1** (the cross-language contract). **Python gets a mirroring frozen
  dataclass** in `fitted_core` for *producing* the payload (M5 write) and *reading* it (M6 training).
- **Serialization contract = the C+D hybrid (§8.4):** Python produces the pipeline payload (keys/scores/
  dispositions/`candidateId`) **+ each item's `engineVisible` projection**; **TS builds `itemSnapshots`
  before the Python call from one captured context (no refetch), owns the `evidence` layer, and persists the
  merged doc verbatim — keys/scores never recomputed in TS.** Two boundary hazards pinned: **case mapping**
  (camelCase wire/Mongo ↔ snake_case Python, finite-floats-only) and **id representation** (`user` =
  `ObjectId`; all item/candidate refs = strings, no populate). **snapshotId TS-preallocated; candidateId
  Python-issued** (§8.1).

**The M4 writer contract must define (S3 deliverables):**
1. required payload shape Python → TS
2. what TS persists verbatim
3. required vs nullable/staged fields
4. server-generated fields
5. what the client may echo back
6. indexes
7. validation rules
8. example documents
9. trainability rules
10. M5 writer acceptance criteria

**Guardrail (S3-resolved):** the full **rejected/low-ranked candidate + attempt-trace** payload (H29) is
**server-side Python→TS only — NOT returned to the client** (the service returns two objects:
`clientResponse` + server-only `snapshot`, §8.6). OQ1 confirmed size is a non-issue (~120 KB worst case,
conditioned on raw-payload caps), so **TS-write holds — no Python-direct-Mongo write** (PROVISIONAL until the
**S9** BSON-size guard test — now an S9 obligation, §8.6/§8.9/§8.11).

### D3 — Migration target = effectively empty  *(decided)*

The deployed Vercel app runs the *team* repo, not this fork; no real user base accumulated against this
fork's schema. The `clothingType` backfill runs against **dev/seed fixtures**; posture rule 1 keeps
`clothingType` re-derivable from raw `category`/`name`/`subCategory`. So M4 is **forward-design, not
live-data-risk management** — no rollback/dry-run-over-live-Mongo ceremony.

**Guardrails:** the migration stays **idempotent + additive — never discards raw
`category`/`name`/`subCategory`** (posture rule 1; makes even an unexpectedly non-empty target safe).
**Keep a lightweight dry-run / report / verify mode** — the ambiguous-row classifier defines *future*
behavior that M5 depends on, so its outputs must be inspectable even on fixtures.

### D4 — Data lifecycle = deferred, but recorded  *(decided)*

Snapshots are immutable training truth (§15); retention/purge/redaction is privacy `[STAGED]` (§22,
C7/C10) and there are no real users to protect → the **full policy is deferred.** But M4 introduces a
**new collection** (GenerationSnapshot) that the existing `User` cascade-delete hook (`User.ts:24`,
deletes `wardrobeitems`+`outfitinteractions`) does **not** cover. M4 must NOT silently create an
un-cascaded collection: **register a §23 hole** (H43) **and reserve a cheap deletion/redaction seam in
the §15.1 schema** (e.g. a soft-delete/redaction marker + lineage), even though behavior stays
`[STAGED]`. Cheapened by D6's projection bias: a rebuildable affinity projection rebuilds clean after
source redaction.

## 3. Hole map (M4-owned holes — each must close resolved-or-re-deferred by S11)

Canonical status lives in spec §23; this is the working tracker. **S3 update (CLOSED):**
H10/H19/H25/H29/H43 dispositions are in §8.7 — H10 is honestly split (text-resolved / visual-seam /
W-track-dependent), H19's home is fixed to `GenerationSnapshot`, and H29 is design-resolved by §15.1
(three-site funnel capture + content invariant; live exposure is an S9/M5 obligation). Rows below reflect
the post-S3 design status and point to the implementation owner.

| Hole | What | M4 disposition |
|---|---|---|
| **H10** | Interaction-time feature snapshots; edited/deleted items rewriting old feedback's meaning | **Resolved-design / pending implementation.** GenerationSnapshot (§15.1/S3) persists immutable feature snapshots; add history tests for edited/deleted items (S8). Visual hash/version remains W-track-dependent. |
| **H11** | Idempotency / transaction rules | **Split:** backfill idempotency now trivial (no live data, D3); **forward write-path concurrency** (duplicate feedback, concurrent affinity) stays real → S6. |
| **H19** | Repetition-window shown-history storage home | **Resolved-design / pending implementation.** Home is `GenerationSnapshot.shownFullSignatures` (§15.1/S3), not an interim per-user ring buffer. S4 owns the window/cap contract; M5 executes it; coupled to the S6 membership check. |
| **H29** | Snapshot must persist continuous scores + rejected/low-ranked candidates + visual (not shown/text only) | **Resolved-design / pending implementation.** §15.1 is the canonical shape; S9/M5 must implement the three trace surfaces, content-preservation invariant, raw caps, and visual seam. |
| **H37** | Add `lens` / `exception` scope vocab | S6: add the scope-vocab **field** additively (posture rule 1); the anomaly-scoping **behavior** stays `[STAGED]`. |
| **H25** (reflect) | Extensible item representation (tags now → embeddings later) | Reflect at S3/S5: scoring + snapshot consume a *representation*, never a fixed tag list. |
| **H43** (NEW) | GenerationSnapshot lifecycle: new collection not covered by `User` cascade-delete; retention/purge/redaction undefined vs immutable-training-truth | Per D4: defer the policy (Privacy `[STAGED]`); **M4 registers the hole + reserves the schema seam.** Ties to posture rule 3 + the D6 projection bias. |
| **H6** | `wardrobeVersion`'s single bump/activation transition is unnamed (spec §23-H6) | **M4 stores the field only.** The bump trigger / activation transition stays **deferred to the W-track — NOT solved by M4.** Recorded here so the additive field-add is never mistaken for the bump semantics (S2 §7.1/§7.5-F). |

## 4. Open-questions log (carried across sessions)

- **OQ1 (RESOLVED-provisional S3, §8.6):** snapshot payload is ~120 KB worst case (<1% of Mongo's 16 MB) —
  size never forces a Python-direct write. **TS-write-verbatim holds**, conditioned on (a) raw-payload caps
  (byte cap + hash + truncation flag + no-blob rule) and (b) the service response separating the server-only
  `snapshot` from the `clientResponse`. Final lock waits on the **S9** BSON-size guard test (§8.11 obligation 4).
- **OQ2 (RESOLVED S2 — placement residue → S7):** **ItemAffinity is a rebuildable projection**, not an
  authoritative collection. Default lean **compute-live** in the M5 request adapter; materialize only later
  on measured request cost / an M6 feature-store need, **with evidence**. **Do not create
  `fitted/models/ItemAffinity.ts` in M4** unless a later session overturns this with evidence. Rationale +
  the avoided-second-door framing in §7.3. Only residue: materialize-vs-live placement (S7).
- **OQ3 (S7, Finding D3):** the deployed **`PreferenceSummary`** collection (free-text per-user
  preference blob, the rough v1 analog of the v2 StyleProfile) is unmentioned in spec §6 — migrate,
  delete, or leave? Decide at reconcile-with-reality.
- **OQ4 (S6, Finding A):** the **authenticity-gate M4/M5 split** — M4 does existence+ownership +
  content-key (`baseKey`/`fullSignature`) binding; M5 adds `{snapshotId,candidateId}` binding + the
  outfit-membership ("actually shown") check (reads the S3-fixed H19 home). M4 still defines the *full*
  contract. Confirm the split holds once S4 fixes the shown-history window/cap contract.
- **OQ5 (S7, surfaced at the §15.1 review):** the **`engineVisible` adapter-mapping gap.** §15.1
  `engineVisible` is the *post-adapter* `fitted_core.WardrobeItem` projection, but the deployed
  `WardrobeItem.ts` has **no direct source** for several of its fields: `styleTags` (deployed has only
  `tags`, no style-tags field), `warmth`, `material`, `formality`, and the renames `colors`→`colorTags` /
  `occasions`→`occasionTags`. The M5 request-adapter (§15 R12) must own these renames + derivations; S7
  reconcile-with-reality defines the **deployed→`fitted_core` mapping table** (incl. where `styleTags`/
  `warmth`/`material`/`formality` are sourced — `tags`/CV `metadata`/derived). This is an adapter mapping
  task, **not** a §15.1 contract problem (engineVisible is correctly anchored to the Python projection).

## 5. Session 1 audit hand-off (what S2 inherits)

The inbound sweep covered spec §6/§15/§16/§20/§23, the Spearhead plan, M0–M3 plan references,
`fitted/models/*.ts`, and the flagged-historical `fitted/docs/{database,ML_OVERVIEW}.md`. **No edits
were made during the audit itself** (discovery mode); the only landing edits are the two §20 tightenings
+ the H43 registration this plan authorizes. Carried-forward constraints:

- **Finding A (headline):** `feedback-authenticity gate` is mis-lumped as pure-M4 in §20. It decomposes
  as existence+ownership (M4, wardrobe-only) / content-key binding (M4 persisted fields) /
  `{snapshotId,candidateId}` binding + outfit-membership (M5, reading the S3-fixed shown-history home).
  → OQ4 + the §20 tightening.
- **Finding B:** §20 ↔ §9 snapshot-ownership ambiguity (§20 said "GenerationSnapshot" unqualified; §9
  Step 7 + line 397 say the *write* is M5). Reconcilable; resolved by the §20 tightening + D2.
- **D3 / D6 / H43:** as in §4 and §3.
- **Verified accurate (no action):** §6.1 `clothingType` story (`WardrobeItem.ts:7` enum
  `["top","bottom"]`, default `"top"`, indexed, never read by recommend routes — grep-confirmed; string
  match at `route.ts:241,550` confirmed); action-enum story; `fitted_core` ahead of the persisted schema
  (`models.py:16` `ItemType` = 5 values); `GenerationSnapshot` absent from `fitted_core` (correctly
  unbuilt); `wardrobeVersion` exists only as request-context params, no persisted home yet; `sessionId` is
  a derivation from `userId`, not an independent field-add.
- **S11 deferrals (stale, bannered-historical, not S1's to fix):** `database.md` WardrobeItem list omits
  `clothingType`/`pattern`/`layerRole`/`isAvailable` (D1-stale); OutfitInteraction list omits
  `inferredWhy`/`perItemFeedback`; `m0-m1-substrate.md` calls the snapshot `generation_logs`.

## 6. Documentation-consistency freeze checklist (S11)

- **Single-home.** Every M4 decision in exactly one authoritative place (the spec; D1 routes the schema
  to §15.1); this plan + other surfaces *point*, never restate.
- **Cross-surface sweep** — reconcile every data-model surface: `Fitted_Spec_v2.md`
  (§6/§15/§16/§20 status/§23 holes), `ml-system/README.md`, `docs/README.md`, `CLAUDE.md`
  ("Authoritative for data shape" table + milestone status), `fitted/models/*.ts`,
  `fitted/docs/database.md` (update or mark deployed-not-yet-migrated).
- **Naming reconciliation** — spec field names ↔ `fitted_core` code (`keys.py`, `response.py`,
  `models.py`) ↔ TS models agree (`GenerationSnapshot`, `baseKey`/`fullSignature`, the affinity name,
  `wardrobeVersion`, `clothingType`). Catch the `generation_logs` drift.
- **Hole retirement** — every M4 hole (H10/H11/H19/H29/H37 + reflect H25 + new H43) marked resolved or
  explicitly re-deferred in §23, with a pointer to where it was resolved.
- **Compaction-budget check** — `Fitted_Spec_v2.md` under 1,500 lines, reading list under 2,000; if the
  schema pushed it over, D1 should already have routed it elsewhere.
- **Retirement header** — this plan gets `> COMPLETED <date>` and leaves the default reading list.

## 7. Session 2 outputs — boundaries, reversibility, weights

Signed off 2026-06-25 (discovery → sign-off; OQ2's materialize-vs-live sub-fork chosen = compute-live).
Canonical status stays **here** (the working tracker); the spec fold-in is S11's job — **no spec edit this
session** (single-home discipline; OQ2 + affinity placement live in this plan until the freeze).

### 7.1 M4 in/out scope

**The line:** M4 = persisted schema + migration/classifier + cross-language **contracts** + the **writer
contract**, all over fixtures. M5 = live wiring + deploy + runtime gates. **M4 never touches a live route or
real Mongo.**

**Writer-contract precision (the subtle part — do not blur it).** M4 does **not** implement live route
wiring, but M4 **does own the writer contract.** That means M4 must define: required payload shape
(Python→TS), required vs nullable/staged fields, validation rules, indexes, example documents, trainability
rules, and the **M5 writer acceptance criteria** (the full D2 10-deliverable list, §2-D2). M5 only *executes*
that contract against the live route + does the live snapshot write.

| Bucket | Items |
|---|---|
| **IN — M4 owns** | `clothingType`→5 + backfill (fixtures); action-enum +`planned/packed/corrected`; `wardrobeVersion` **field** (storage only); `baseKey`/`fullSignature` **fields** on interaction rows; affinity **posture** (§7.3); GenerationSnapshot **schema + writer contract** (§15.1 / D2's 10 deliverables); feedback-authenticity **contract** (full contract defined; M4 *implements* existence + ownership + content-key binding); H37 scope-vocab **field**; H19 shown-history **home fixed to GenerationSnapshot** plus S4 window/cap contract; H43 redaction **seam** |
| **OUT → M5** | the **live** snapshot write + route wiring; `{snapshotId,candidateId}` binding; outfit-**membership** (actually-shown) check; request-adapter normalization; two-stage cache; `USE_ML_SHORTLISTER` cutover; `generationIndex` (H7); daily-reseed `date` (H8) |
| **OUT → other tracks** | `wardrobeVersion` **bump trigger** / activation transition (H6 → **W-track**); StyleProfile compiler + `dormant` board status (**B-track**); signed `behavioralStrength` + trained scorer (**M6**); H37 anomaly-scoping **behavior** (`[STAGED]`) |
| **DECIDED in M4, acted later** | `PreferenceSummary` migrate/delete (OQ3, S7); affinity materialize-vs-live placement (OQ2 residue, S7 — deletion under M5/M6 license) |

### 7.2 Reversibility classification — the foreclosure **cluster**

This sharpens §0's single one-way-door into a **cluster** (the framing locked in S2):

- **Main foreclosure — GenerationSnapshot schema + identity binding** (H29 + H10, reflect H25). Omitting
  rejected/low-ranked candidates, continuous scores, or the **visual/extensible representation** permanently
  starves every M5+ snapshot. The only change worth slow, careful, Fable-reviewed design (S3).
- **Riders — foreclosure-adjacent.** The *fields* are additive/reversible, but their **correctness** decides
  whether the snapshot's captured signal is usable as training labels: **(a) persisted identity binding** —
  `baseKey`/`fullSig` on interactions + the M5 `{snapshotId,candidateId}` binding; **(b) feedback trainability /
  authenticity** — the membership check + **H19** shown-history home + the authenticity contract (and
  **H25** representation extensibility folds into the main foreclosure's representation axis). Get a rider
  wrong and the one-way-door's payoff degrades even though the columns themselves are reversible.
- **Avoided second door — authoritative `ItemAffinity` collection. Rejected (§7.3).** The projection posture
  keeps M4's true foreclosure count at **one**.

| M4 change | Class |
|---|---|
| `clothingType`→5 enum | additive-reversible (rule 1) |
| `clothingType` backfill (fixtures) | reversible / re-runnable — raw `category`/`name`/`subCategory` preserved (D3) |
| ambiguous-row classifier fallback (S5) | forward-design, reversible (re-run; dry-run/verify mode inspects it) |
| action-enum +3 | additive-reversible (rule 1) |
| `wardrobeVersion` **field** | additive-reversible; **bump trigger = W-track/H6, NOT M4** |
| `sessionId` | **degenerate — no new field** (= `userId`; Finding E) |
| `baseKey`/`fullSig` on interactions | additive fields; **value format inherits §7/H30** (append-only slot rule) — a rider, **not a new foreclosure** (Finding F) |
| affinity projection posture | reversible — projection posture (§7.3); the **avoided second door** |
| H19 shown-history home | **resolved-design rider** — home fixed to `GenerationSnapshot.shownFullSignatures`; S4 only defines the window/cap contract |
| H37 scope-vocab field | additive-reversible (behavior `[STAGED]`) |
| feedback-authenticity (M4 part) | additive validation, reversible; binding **semantics** ride identity (S4) — a rider |
| H43 redaction seam | additive seam reservation (soft-delete/redaction marker + lineage) |
| **GenerationSnapshot schema + identity binding** | **THE main foreclosure (S3)** |

### 7.3 OQ2 — ItemAffinity scope: RESOLVED

**Decoupling that de-risks the whole call:** `fitted_core` consumes affinity as a **pure read-only input** —
`ranker.py:189` `item_affinity: Mapping[str, int|float]`, `:190` `liked_full_signatures: frozenset[str]`
(the comboBoost set), copied to a `MappingProxyType` at `:255`. **The substrate never owns affinity
storage** — so OQ2 cannot reopen the closed M0–M3 contract whatever we pick. OQ2 is purely a
persistence/derivation question.

**Decision:** reject the authoritative `ItemAffinity` collection. Adopt the **rebuildable-projection
posture** — affinity is a deterministic function of append-only interaction/snapshot truth, **never
authoritative state.** **Default lean = compute-live** in the M5 request adapter (build the `item_affinity`
mapping at request time from `OutfitInteraction`); **materialize only later** if a measured request cost or
an M6 feature-store need justifies it, **with evidence.** **Do NOT create `fitted/models/ItemAffinity.ts` in
M4** unless a later session overturns this with evidence.

**Why (promise = determinism/consistency):** posture rule 1 makes affinity the **derived** bucket
(interactions are the raw, irreplaceable signal); rule 3 makes the event log the truth. An authoritative
collection updated incrementally is a read-modify-write that can **drift** from the log — and that drift *is*
H11 made real (duplicate feedback, concurrent affinity updates racing the counter). A projection **cannot
drift** (recomputed from the log, consistent by construction), and **rebuilds clean after source redaction**
— the H43/D4 cheapening — instead of being its own un-cascaded collection. Reframes
`m0-m1-substrate.md:550` ("M4 must create `ItemAffinity.ts`") to **"derive, don't create a collection"**;
the retired plan keeps its old text (this conductor is the authority).

**Residue → S7:** materialize-vs-live is the only open sub-choice; default lean compute-live.

### 7.4 Session weights + the critical path

Critical path **S3 → S4 → S6** (the authenticity membership check reads shown-history → its home is decided
in S4 → its richest form is the S3 snapshot). **S5 is the one detachable light island** (additive backfill;
no cluster dependency; may sequence first).

| S | Weight | Sequencing / why |
|---|---|---|
| **S3** | **HEAVY** (may spill to 2) | the gravity well: the foreclosure + writer contract (10 deliverables) + OQ1 payload revalidation + H19's richest form + Fable review |
| **S4** | **MEDIUM-HEAVY** | runs **after/with S3**; `baseKey`/`fullSig` fields are additive (light), but the bind-to-exact-shown-outfit de-orphan loop + H19 home is real. Trap-guard F: don't reopen the §7 key format |
| **S5** | **LIGHT — ✅ CLOSED §10** | classifier fallback (default-to-top, §10.2) + the two-site reconciliation (§10.1) + dry-run/report; off the critical path; no affinity collection (§7.3) |
| **S6** | **MEDIUM** (not pre-assumed light) | runs **after S3/S4**; full authenticity contract + action-enum + H37 field + H11 forward concurrency. No foreclosure, mostly `[STAGED]`, but the contract + concurrency are real |
| **S7** | **MEDIUM** | reconcile: OQ3 PreferenceSummary, OQ2 placement residue, M4↔M5 sequencing, migrate-vs-delete seams |
| **S8** | **MEDIUM** | adversarial falsification — distinct muscle; depends on all prior design |
| **S9** | **MEDIUM** | the C1–Cn implementation ladder |
| **S10** | **LIGHT–MEDIUM** | content-alignment audit |
| **S11** | **LIGHT** | documentation-consistency freeze (§6) |

### 7.5 Findings carried forward (E/F/G)

- **E — `sessionId` is degenerate.** §6.3 (line 261) and `m0-m1-substrate.md:563` lock `sessionId = userId`
  always (anonymous sessions dropped). It's a derivation, **not a new stored field** — the §0 "sessionId
  storage" item collapses to ~zero, lightening S5.
- **F — `baseKey`/`fullSig` fields inherit the §7/H30 key-format decision** (append-only slot rule).
  **Trap-guard for S4: do not reopen the key format** — M4 stores the value, it does not redesign it.
- **G — the affinity projection's source depends on S4.** comboBoost needs *liked* FullSignatures, which
  needs feedback bound to a stored `fullSig` (S4). So affinity placement is correctly S7 (after S4), and the
  projection is only well-defined once S4's identity binding lands.

## 8. Session 3 outputs — GenerationSnapshot schema + writer contract (CLOSED 2026-06-25)

Drafted 2026-06-25; **reconciled 2026-06-25** against two adversarial reviews — a Codex
implementation/runtime review and a substitute-Fable architecture/spec/training review (the CLAUDE.md
dual-read substitute for the one-way-door call) — then **CLOSED 2026-06-25** after the narrow second pass.
This is the **one-way door** (§0/§7.2). Per D1 the canonical contract lands in spec **§15.1**; with S3 now
closed, the canonical contract now lives in spec §15.1. Status verdict in §8.10.

> **S3 verdict: CLOSED — schema + writer-contract design locked.** The reconciliation fold corrected the
> two corpus-foreclosure surfaces the dual review found — (a) the **provenance-falsifying flat/Option-B item
> authorship** → the C+D `engineVisible`/`evidence` split, and (b) only **one of three** substrate
> signal-discard sites named → the full three-site funnel-capture obligation. The narrow second pass
> (§8.11 prompt) **CONFIRMED all four shape-changing items against source** and locked the one item the fold
> left open (the trace-surface mechanism → additive sibling APIs, Option B; §8.4). **S3 closes the *design*
> only** — implementation waits on the S9/M5 checkpoints (§8.11 S9-obligations block).

### 8.1 Snapshot purpose & lifecycle

**What one GenerationSnapshot represents.** The immutable, self-contained record of **one rendered
recommendation response** — its resolved Lens inputs, the version/provenance of every component that shaped
it, an immutable feature-copy of every wardrobe item that participated, the **full candidate funnel**
(generated → validated → rejected → ranked → shown) with continuous scores and dispositions, and the shown
set with positions. It is **training truth** (§15/§21) and the **binding target** for later feedback (§16).

**Granularity decision — one snapshot per render (per `generationIndex`), not per candidate-cache pass.**
The two-stage cache (§15) shares the *expensive candidate stage* across re-rolls, but each re-roll re-runs
Steps 4–6 and shows a **different ordered set**. For exposure-bias correction (§21) and feedback binding,
what the user *saw* is per-render. Rather than appending render-events to a shared mutable doc (which breaks
immutability and invites the H11 append race), each render writes its **own complete, write-once** snapshot.
Re-roll siblings share a `candidateCacheKey` (queryable as a group) but are independently complete. The
candidate-stage duplication this implies is **provably cheap** (§8.6 OQ1: worst-case ~120 KB, <1% of
Mongo's 16 MB doc limit; a typical rescue is single-digit KB) and buys clean immutability + no cross-doc
redaction dangling. *Escape hatch (not now, evidence-gated like OQ2): if measured re-roll volume ever makes
the duplication hurt, a `candidatePoolRef` dedup is an additive future optimization.*

**Lifecycle:**
- **Created** at Step 7 (§9) on every rendered response — **M5's live write**; M4 defines the shape/contract only.
- **Immutable** after insert — feedback never mutates it (feedback writes `OutfitInteraction` rows that
  *reference* it). The **only** post-insert write is the reserved H43 redaction marker (§8.2-K), a
  deliberate lineage-preserving exception, never content rewriting.
- **Authorship is split, and the split is load-bearing (the C+D hybrid — §8.4):** Python produces
  everything the pipeline computes (keys, scores, candidate identity + dispositions, shown set, diagnostics —
  the drift-hazard content §7/H15 forbids TS from recomputing) **and** the `itemSnapshot.engineVisible`
  projection (the exact lossy `fitted_core.WardrobeItem` view the engine conditioned on). **TS** owns
  `itemSnapshot.evidence` (the storage-only deployed-doc fields the engine never saw) and **persists the
  merged document verbatim** via the `GenerationSnapshot.ts` model. **No post-Python refetch** — both layers
  derive from the **single captured request context** TS already loaded (Codex finding 2); a refetch could
  snapshot a mutated doc.
- **Id authorship (pinned — Codex finding 3 / Fable §8):** **`snapshotId` is TS-issued and *pre-allocated*
  before the browser response is sent** (mint the `ObjectId` up front), so each shown variant can carry
  `(snapshotId, candidateId)` in the client response. **`candidateId` is Python-issued** — Python owns the
  deterministic funnel order, so it stamps the ordinal id. M5 joins the TS `snapshotId` onto Python's
  payload + clientResponse before persisting/returning.
- **M4 defines:** schema, subdocument shapes, enums, indexes, required-vs-nullable, the **provenance boundary**
  (engineVisible vs evidence) + the **content-preservation invariant** (§8.2-F) + the **full-funnel capture
  obligation** (§8.4) — these are *contract*, not wiring, so they are M4's, not M5's — plus the client-echo
  contract, validation rules, the Python payload dataclass contract, trainability rules, and the **M5 writer
  acceptance criteria**. **M5 implements:** the live route wiring, the live insert, the additive trace
  surface that exposes the discarded funnel, the `{snapshotId,candidateId}` binding, and the
  outfit-membership check (OQ4 split holds — §8.7).
- **Relation to response variants & feedback:** the surfaced `OutfitVariant`s (§6.5) are the `shown`
  candidates; the response carries each shown variant's `(snapshotId, candidateId)` so the client echoes
  that identity on feedback; the server re-reads snapshot content, never trusts the echo (§8.7).

### 8.2 Canonical schema sections

> **Single-home note (post-S3-close):** the **canonical** GenerationSnapshot contract now lives in spec
> **§15.1**. §8.2/§8.3 are the *design derivation* that produced it (+ the Mongoose proposal and the
> index/query/rationale §15.1 points back to). If the two ever disagree, **§15.1 wins**; fix on sight.

camelCase = wire/Mongo names (Python mirror is snake_case — §8.4). `?` = nullable/optional.

*Naming reconciliation (Codex finding 7):* the Mongoose owner field is **`user`** (matching every existing
model), not `userId`; prose below says `user`. Other field names are camelCase wire/Mongo.

**A — identity**
- `_id: ObjectId` → the **snapshotId**, **TS-issued and pre-allocated before the browser response** (§8.1).
- `schemaVersion: int` (=1) — the additive-evolution lever; readers branch on it.
- `user: ObjectId ref User` — owner (ownership checks + the H43 cascade).
- `sessionId: string` — the seed input verbatim (= `user` id, Finding E; stored as provenance because the
  seed is derived from it, not because it's independent).
- `candidateCacheKey: string` — the §15 candidate-stage key this render used; groups re-roll siblings.
- `generationIndex: int` — the re-roll lever (H7); distinguishes siblings sharing a `candidateCacheKey`.
- `requestId?: string` — optional client/trace correlation id (M5 may populate); **the future render-level
  idempotency key once H7 closes** (§8.8 — the unique-insert guard rides this, not `generationIndex`).
- `createdAt: Date` (timestamps) — immutable insert time.

**B — request context (the Lens, §6.3)**
- `intent: enum(rescue_item|outfit_upgrade|daily|translate)`
- `occasion: string` (normalized verbatim), `weather: enum(hot|mild|cold|indoor|outdoor)` (bucket)
- `weatherRaw?: string`, `location?: string` — raw weather signal beside the bucket (posture rule 1; M5/W-track)
- `constraints: Map<string,Mixed>` — `ConstraintSet`, stored as a flexible map so additive constraint
  values (H36) never force a migration; raw-preserving.
- `forcedItemId?: string` (rescue), `baseOutfitItemIds?: [string]` (upgrade), `routineId?: ObjectId`
- `lens?: { styleProfileId?, styleProfileVersion?, boardId?, confidence?, styleProfileSnapshot? }` —
  which-version-of-me (H38); null until B-track. **`styleProfileSnapshot?` is the embed seam (Fable §2):**
  §6.2 says the StyleProfileSnapshot is "the immutable copy taken at request time and stored in the
  GenerationSnapshot" — a bare `styleProfileId`/`styleProfileVersion` ref re-creates the H10 disease if a
  board-version doc is later cascaded away, so the schema must allow embedding the compiled profile, not
  just pointing at it. Typed/`Mixed`, null until B-track produces a compiler.
- `wardrobeVersion: int` — **field only**; bump semantics are W-track/H6, **not M4**.
- `interactionCountAtRequest: int` — gates the signal branch; feeds M6 eligibility analysis (H9).
- `seedDate?: string` — the daily-reseed `date` seed input (H8; null until M5 activates).

**C — version / provenance.** **Required, non-null on every live write** (both reviews — provenance-by-version
is the backstop for the engine-vs-evidence boundary; nullable provenance ⇒ unrecoverable provenance):
- `fittedCoreVersion: string` (**required**) — substrate version. **Finding: `fitted_core` has no version
  constant today** (confirmed: absent from `__init__.py`/`config.py`); **M4/M5 must add a `__version__`
  before the first live write.**
- `generator: { provider, model, temperature, promptVersion }` — from the `OpenAIGenerator`
  (`provider="openai"`, `model="gpt-4o"`, `temperature=0.8`); **`promptVersion` is required** and tags the §D
  prompt builder (no such constant today — **add one before first write**). `promptVersion` also decodes the
  generator-visible subset of `engineVisible` (the §D-stripped attrs), so a separate `generatorVisible`
  store is unneeded at `[NOW]`.
- `rankerConfigVersion: string` (**required**) — a version/hash of the Appendix B constants the
  ranker+response consumed, so a tuning change is attributable. Cheap to compute (a hash of the config
  module); same provenance class as the two above, so also required.
- `scorer: { kind: enum(cold_start|trained), modelId?, available: bool }` — the SignalScorer in play; at
  `[NOW]` `{kind:"cold_start", available:false}`; `modelId?` nullable (null at cold start; M6 populates).

**D — wardrobe / item feature snapshots** — `itemSnapshots: [ItemSnapshot]` (the H10/H25 core).
**Provenance-split (the C+D hybrid — both reviews; the one-way-door correction).** The flat "verbatim copy
of the whole `WardrobeItemDocument`" the first draft proposed is **rejected**: a future M6 trainer reading a
flat snapshot cannot tell "the engine conditioned on this" from "TS copied this for audit," so it would
build features (e.g. `pattern`/`seasons`) the recommendation never saw and do off-policy correction against
a contaminated model — an irreversible corpus foreclosure (flat snapshots get written all through M5).
Instead, **namespace the layers**; the bucket *is* the ranking-visibility marker (no per-field bool needed):

Per `ItemSnapshot`:
- `itemId: string` (the WardrobeItem `_id` as a **string**, deliberately **not** a populatable `ObjectId`
  ref — §8.4 / H10: nothing may re-hydrate a mutated live item into an old snapshot).
- **`engineVisible: { … }`** — the **exact `fitted_core.WardrobeItem` projection M5 sent to the Python
  service** (Python snake_case: `name`, `clothingType`/`type`, `warmth`, `style_tags`, `color_tags`,
  `occasion_tags`, `material`, `formality`, `image_url`). This is what the scorer/keys/ranker conditioned on —
  **true by construction** because TS captures it from the same projection it sent, not by a
  copy-after-the-fact. *The only ranking-visible layer.* **Stored/wire camelCase names** are the explicit
  snake↔camel mapping: `name`, `clothingType`, `warmth`, **`styleTags`/`colorTags`/`occasionTags`**
  (≡ `style_tags`/`color_tags`/`occasion_tags`), `material`, `formality`, `imageUrl`. The invariant is
  **`engineVisible` stored == the projection sent, *modulo* the documented serializer key-rename** (a
  bijection, no value transform) — so provenance-by-construction survives the case mapping.
- **`evidence: { … }`** — deployed-doc fields the engine **never saw** (storage-only audit/future capacity):
  `category`, `subCategory`, `pattern`, `seasons`, `isAvailable`, `isFavorite`, `lastWornAt`, `brand`, `fit`,
  `size`, `layerRole`, `tags`, `image`. (`isAvailable`/`isFavorite`/`lastWornAt` are orphan/H21 signals, but
  the `[NOW]` engine does not score them, so they live here until a milestone makes them engine-visible.)
- **`image?: { imageRef?, imageVersion?, hash? }`** (inside `evidence`) — **stable image reference / version
  / hash, never the blob** (H29(c) visual ref; guards the H14 image-replacement data-loss). `hash`/`version`
  nullable: **`WardrobeImage` has no hash/version field today** (confirmed — only `base64`/`contentType`/
  `sizeBytes`), so true visual immutability is a **W-track dependency** (§8.7 H10 row).
- **`generatorVisible?: { … }`** — **reserved**; for `[NOW]` it is the `promptVersion`-decodable subset of
  `engineVisible` (the §D prompt strips `image_url`/`warmth`), so not separately stored. Reserved for a
  vision generator (H33).
- `embeddingRef?: string`, `visualFeatureRef?: string` — **reserved nullable** future visual/embedding refs
  (H25); not required, not produced now. *Shape (`{ref, model, dim, version}`) is **not** locked now — a
  bare-string lock is itself a foreclosure; defer the shape to whoever first writes it (W-track/M6).*
- `rawAttributes?: Mixed` (inside `evidence`) — optional verbatim raw CV/declared blob + provenance (posture
  rule 1); **bounded + no image/base64/blob** (§8.6).

**Trainability rule (folds into §15.1):** any model claiming to model what the recommendation *conditioned
on* trains **only** from `engineVisible` + the explicit per-candidate `scoreTrace`/identity fields;
`evidence`/`embeddingRef` are new-capacity inputs whose use changes the off-policy assumptions. A
`schemaVersion` bump is required to move a field from `evidence` → `engineVisible`.

**E — generation attempts (root/attempt-level trace, Codex finding 4)** — `generationAttempts:
[GenerationAttempt]`. Root/attempt-level events that **must not be forced into fake candidates**: invalid
JSON, malformed root, the §12 repair retry, aggregate warnings, raw-generation metadata. Per
`GenerationAttempt`:
- `attemptId: string` (`"a0","a1"`), `attemptIndex: int`, `isRepair: bool` (the one §12 blind re-generation)
- `parseIssue?: string` (`invalidJson`/`malformedRoot`/null-on-success), `rootRejectionCode?: string`,
  `aggregateWarningCodes: [string]` (e.g. `extraCandidatesIgnored`)
- `payloadParsed: bool`, `candidateCountEmitted: int`
- `rawTextHash?: string`, `rawTextBytes?: int`, `rawTextTruncated?: bool`, `rawText?: string` — **bounded;
  no image/base64/blob** (§8.6). Candidates link back via `sourceAttemptId`.

**F — candidate pool** — `candidates: [CandidateSnapshot]`, ONE array spanning the **generated → validated →
ranked → shown** funnel (attempt-level events live in E; H29(b) — rejected + low-ranked must survive):
- `candidateId: string` — **Python-issued, unique within the snapshot** (binding id; **not** the
  fullSignature). Deterministic ordinal over the **fully-traced** funnel (attempts ordered deterministically).
- `sourceAttemptId: string` — which `GenerationAttempt` emitted it; `sourceIndex?: int` — its position in
  that attempt's `outfits[]` (pairs it with the parse-time `Issue.candidate_index`).
- `stageReached: enum(generated|validated|ranked|shown)`, `accepted: bool`, `shown: bool`, `shownPosition?: int`
- `dropStage?: string` (open code set) — the stage it exited:
  `parse|validation|rescue_drop|step4_filter|variant_cap|ranking_cutoff|spread_selection|shown`
- `dropReason?: string` (**open, append-only code set** — softened from a hard enum per Fable, mirroring the
  `IssueCode`/`FallbackStage` string contracts so a future reason isn't a write-rejection foreclosure):
  `missing_forced_item|missing_style_move|cooldown|contextual_dislike|lock_filter|variant_cap|below_cutoff|spread_not_selected|…`
- `admittedViaFallbackStage?: enum(...FallbackStage...)`
- `rejectionCodes: [string]`, `warningCodes: [string]` — `IssueCode` wire values (empty if accepted)
- content: `items: [{itemId, role}]`, `slotMap: {dress?,top?,bottom?,outer?,shoes?}`,
  `template?: enum(two_piece|one_piece)`, `baseKey?`, `fullSignature?`, `optionPath?`, `risk?`,
  `styleMove?: {moveType, changedItemIds, oneSentence}`
- `rawEmitted?: Mixed` — raw GPT object for a candidate that failed *pre-normalization* (**bounded; no blobs**)
- `scoreTrace?: ScoreTrace` (§8.2-G)

> **Content-preservation invariant (REQUIRED — Fable §5-A / Codex).** Every **generated, non-accepted**
> candidate MUST carry at least one of {`items` + `slotMap`, reconstructed by `sourceIndex` from the
> attempt's parsed `outfits[]`} **or** `rawEmitted`. A bare `{candidateId, rejectionCodes}` with no content
> is **invalid** — it loses the negative training signal, because `Issue` carries only
> `code`/`candidate_index`/`detail`, **never the rejected outfit's content** (validator.py:60). So snapshot
> building must retain the parsed `outfits[]` beside the issues; the earlier "rawEmitted is optional, the
> funnel already preserves negative signal" claim was **false** and is retracted.

**G — scores & diagnostics.** Per-candidate `scoreTrace` (H29(a) — **continuous, never just the 3-way
buckets**; **populated for every *scored* candidate, including scored-but-unshown** — funnel sites #2/#3,
§8.4):
- `compatibility?: float`, `visibility?: float` ([0,1] cold-start content scores; the M6 seam)
- `rankerScore?: float`, `scoreBreakdown?: {base,combo,item,dislike,overuse,repetition,cooldown}` (signed, N4)
- `signalScore?: float` — **reserved nullable** for the trained M6 scorer.

Request-level `diagnostics`:
- `samplerPerType: Map<clothingType, {selectionKind, reason?, randomCount, signalCount, poolSize}>` — the
  per-type `TypeSampleResult` (cold-start vs signal vs fault, R11/R13; M6 eligibility input, H9)
- `candidateRequested: int`, `promptItemCount: int`, `notEnoughItems: bool`, `scorerAvailable: bool` (SamplerResult)
- `ranker: {fallbackStage, insufficientWardrobe, relaxedCooldownCount, lockedSurvivorCount, insufficientLockedCandidates}` (RankerResult)
- `rescue?: {notEnoughItems, insufficientAfterGeneration, spreadCollapsed, reasonHint, fallbackStage}` (RescueResult; rescue intent only)
- `parse: {parseSuccess, repairUsed, generatorCalls}` (the aggregate twin of E's per-attempt detail)
- `rejectionHistogram: Map<issueCode,int>`, `warningHistogram: Map<issueCode,int>` (cheap aggregate of the per-candidate/per-attempt codes)

**H — response / shown history (H19's queryable home)** — `shown` block, **denormalized** so the
repetition-window query never has to unwind the candidate array:
- `shownCandidateIds: [string]` (display order), `shownFullSignatures: [string]`
- `shownBaseKeys` — **DROPPED at S4** (§9.4): no `[NOW]` consumer (cooldown reads the *dislike* buffer, not
  shown-base-keys), and it is fully derivable from `shownCandidateIds` + `candidates[].baseKey`. Not stored.
- `nSurfaced: int`, `spreadCollapsed: bool`
This block is the H19 storage home: the ranker's `shown_full_signatures` window (ranker.py:191) is built by
reading `shownFullSignatures` across a user's recent snapshots; **S4 owns the windowing/cap in the M5
reducer** — the snapshot is the raw source, never the pre-windowed input (§8.8).

**I — visual / reference preservation.** Folded into `ItemSnapshot.engineVisible`/`evidence.image` + the
reserved nullable `embeddingRef`/`visualFeatureRef` (§8.2-D). Refs/versions/hashes only — **never image
blobs**. Embeddings not required now; the nullable fields are the H25 extension seam.

**J — feedback binding support** (contract, not a block — **finalized at S4, §9.1/§9.2**):
- OutfitInteraction references the four nullable binding fields `snapshotId`, `candidateId`, `baseKey`,
  `fullSignature` (server-re-read; all-present-or-all-absent — §9.1). `shownPosition`/`generationIndex` are
  **derived from the snapshot, NOT row-stored** (§9.1/§9.0).
- Client may echo: `{ snapshotId, candidateId }` **only**. The server **never trusts echoed content** — it
  re-reads the candidate from the snapshot and **server-sets** the outfit `items[]`/keys from it. Optional
  `perItemFeedback.itemId` may be client-submitted but is validated ⊆ the candidate's items.
- Server must verify (gate; impl split = §9.5): snapshot exists ∧ `user` matches caller ∧ `candidateId ∈
  shownCandidateIds` (the membership "did we actually show this?" check) ∧ `perItemFeedback.itemId` ⊆ the
  candidate's `items`.

**K — lifecycle / redaction seam (H43, D4)** — reserve only; behavior `[STAGED]`:
- `redacted: bool` (default false), `redactedAt?: Date`, `redactionReason?: string` (lineage, posture rule 3).
M4 reserves these + registers H43; it does **not** wire the `User` cascade (confirmed `User.ts:24` deletes
only `wardrobeitems`+`outfitinteractions`). A rebuildable-projection affinity (OQ2) rebuilds clean after
redaction — the D4/D6 cheapening. **Recorded intent for the privacy milestone (Fable §6, not a blocker):**
the snapshot embeds user-context PII (`occasion` verbatim, `location`, `weatherRaw`, `rawText`/`rawEmitted`),
which are *structurally separable* from training signal — so redaction MAY null those PII-bearing fields
while preserving keys/scores/`itemSnapshots`, giving the immutable-truth-vs-erasure tension a designed exit.

### 8.3 Mongoose model proposal (`fitted/models/GenerationSnapshot.ts`)

Concrete enough to implement; exact syntax is M5's. Sub-schemas with `{_id:false}` for embedded docs.

```
ScoreTraceSchema { compatibility?:Number, visibility?:Number, rankerScore?:Number,
  scoreBreakdown?:{base,combo,item,dislike,overuse,repetition,cooldown:Number}, signalScore?:Number }   // _id:false

GenerationAttemptSchema {
  attemptId:String (required), attemptIndex:Number (required), isRepair:Boolean (required, default false),
  parseIssue?:String, rootRejectionCode?:String, aggregateWarningCodes:[String] (default []),
  payloadParsed:Boolean (required), candidateCountEmitted:Number (default 0),
  rawTextHash?:String, rawTextBytes?:Number, rawTextTruncated?:Boolean, rawText?:String  // bounded; no blobs (§8.6)
}   // _id:false

CandidateSnapshotSchema {
  candidateId:String (required), sourceAttemptId:String (required), sourceIndex?:Number,
  stageReached:String enum[generated,validated,ranked,shown] (required),
  accepted:Boolean (required), shown:Boolean (required, default false), shownPosition?:Number,
  dropStage?:String,         // open code set (validate against a documented list, NOT a hard enum)
  dropReason?:String,        // open, append-only code set (Fable: avoid write-rejection foreclosure)
  admittedViaFallbackStage?:String,   // FallbackStage value
  rejectionCodes:[String] (default []), warningCodes:[String] (default []),
  items:[{ itemId:String, role:String enum[Role] }],   // itemId = STRING, not ObjectId ref (H10)
  slotMap:{dress?,top?,bottom?,outer?,shoes?:String}, template?:String enum[two_piece,one_piece],
  baseKey?:String, fullSignature?:String, optionPath?:String enum[reliable,bridge,stretch],
  risk?:String enum[safe,noticeable,bold],
  styleMove?:{moveType:String, changedItemIds:[String], oneSentence:String},
  rawEmitted?:Mixed,         // bounded; no blobs (§8.6)
  scoreTrace?:ScoreTraceSchema
  // INVARIANT (app-validated, §8.2-F): generated && !accepted ⇒ (items+slotMap) || rawEmitted present
}   // _id:false

ItemSnapshotSchema {
  itemId:String (required),
  engineVisible:{ name, clothingType:String enum[5], warmth:Number (required), styleTags:[String], colorTags:[String],  // the exact projection sent to Python,
                  occasionTags:[String], material?, formality?, imageUrl? } (required),                        // modulo snake↔camel (= fitted_core.WardrobeItem view)
  evidence:{ category, subCategory?, pattern?, seasons:[String], isAvailable:Boolean, isFavorite:Boolean,    // storage-only; NOT ranking-visible
             lastWornAt?:Date, brand?, fit?, size?, layerRole?, tags:[String],
             image?:{imageRef?:String, imageVersion?:Number, hash?:String}, rawAttributes?:Mixed },          // bounded; no blobs
  generatorVisible?:Mixed,   // reserved (promptVersion-decodable from engineVisible at [NOW])
  embeddingRef?:String, visualFeatureRef?:String   // reserved; shape NOT locked now
}   // _id:false

GenerationSnapshotSchema {
  schemaVersion:Number (required, default 1),
  user:ObjectId ref User (required, index), sessionId:String (required),
  candidateCacheKey:String (required), generationIndex:Number (required), requestId?:String,
  intent:String enum[4] (required), occasion:String (required), weather:String enum[5] (required),
  weatherRaw?, location?, constraints:Map<Mixed> (default {}),
  forcedItemId?:String, baseOutfitItemIds?:[String], routineId?:ObjectId,
  lens?:{styleProfileId?:ObjectId, styleProfileVersion?:Number, boardId?:ObjectId, confidence?:Number, styleProfileSnapshot?:Mixed},
  wardrobeVersion:Number (required), interactionCountAtRequest:Number (required), seedDate?:String,
  fittedCoreVersion:String (REQUIRED),                                          // non-null on every live write
  generator:{provider:String, model:String, temperature:Number, promptVersion:String (REQUIRED)},
  rankerConfigVersion:String (REQUIRED), scorer:{kind:String enum[cold_start,trained], modelId?:String, available:Boolean},
  itemSnapshots:[ItemSnapshotSchema] (required),
  generationAttempts:[GenerationAttemptSchema] (required),                      // root/attempt-level trace
  candidates:[CandidateSnapshotSchema] (required),
  diagnostics:{ samplerPerType:Map, candidateRequested:Number, promptItemCount:Number,
    notEnoughItems:Boolean, scorerAvailable:Boolean, ranker:{...5...}, rescue?:{...5...},
    parse:{parseSuccess,repairUsed:Boolean, generatorCalls:Number}, rejectionHistogram:Map, warningHistogram:Map },
  shownCandidateIds:[String] (default []), shownFullSignatures:[String] (default []),
  nSurfaced:Number, spreadCollapsed:Boolean,                                    // shownBaseKeys dropped at S4 (§9.4)
  redacted:Boolean (default false), redactedAt?:Date, redactionReason?:String
}  with { timestamps:true }
```

- **Immutability:** Mongoose can't hard-enforce it; document write-once + a `pre(['updateOne',
  'findOneAndUpdate','save'])` guard that allows mutation **only** of the redaction fields. Acceptance test
  asserts a non-redaction update is rejected.
- **Raw-field caps (Codex finding 5):** `rawText`/`rawEmitted`/`rawAttributes` are `Mixed` but governed by a
  schema-level byte cap + hash + truncation flag + a **no image/base64/blob** rule (§8.6) — the 120 KB
  estimate is only defensible with these.
- **Cross-model reconciliation (Codex finding 7, routed — not S3 schema edits):** `WardrobeItem.clothingType`
  is still `["top","bottom"]` (`WardrobeItem.ts:7`) → **S5**; `OutfitInteraction` lacks
  `snapshotId`/`candidateId`/`baseKey`/`fullSignature` (`OutfitInteraction.ts:23`) → **S4**;
  `initDatabase()` doesn't register `GenerationSnapshot` (`lib/db.ts:13`) → **M5/S7**.
- **Indexes:** §8.8.

### 8.4 Python payload contract

- **Producer object:** a new frozen dataclass `GenerationSnapshotPayload` (future `fitted_core/snapshot.py`
  — **contracted now, built at implementation**, not in M4-the-planning). Fields = §8.2-A/B/C/E/F/G plus
  each item's `engineVisible` projection (§8.2-D), in snake_case. The `evidence` layer is **not** Python's.
- **Authorship = the C+D hybrid (the one-way-door correction; replaces the rejected flat/Option-B draft).**
  Both reviews rejected "TS copies the whole `WardrobeItemDocument` verbatim after Python returns": a flat
  snapshot makes a future M6 trainer unable to distinguish *what the engine conditioned on* from *what TS
  kept as audit*, contaminating off-policy correction — and `schemaVersion=1` flat docs get written all
  through M5, so it's irreversible. The fix:
  - **(C) TS builds the canonical `itemSnapshots` *before* the Python call**, from the **single captured
    request context** it already loaded — **no post-Python refetch** (Codex finding 2: a refetch could
    capture a mutated doc). TS sends Python the **exact `engineVisible` projection** (the
    `fitted_core.WardrobeItem` view), and stores **that same projection** as `itemSnapshot.engineVisible`.
    "The engine saw it" is then **true by construction**, not by a hopeful after-the-fact copy.
  - **(D) Namespace-split the rest:** TS attaches `itemSnapshot.evidence` (the storage-only deployed fields).
    The bucket boundary *is* the ranking-visibility marker; no per-field provenance bool is needed.
  - Python still owns + returns keys/scores/dispositions/`candidateId` → the **no-drift guarantee (§7/H15) is
    intact** (the hazard is keys/scores, never an attribute copy), and now provenance is intact too. The
    request only carries the projection Python already needs — *not* the rejected "ship all deployed
    attributes to Python" option. `fitted_core.WardrobeItem` is confirmed lossy (models.py:106 — lacks
    `category`/`subCategory`/`isAvailable`/`isFavorite`/`lastWornAt`/`pattern`/`seasons`/image refs).
- **Maps from existing `fitted_core` objects:** `SamplerResult` (per_type, candidate_requested,
  prompt_item_count, not_enough_items, scorer_available) → `diagnostics.sampler*`; `ValidationResult`
  (candidates, **rejections, warnings**) + the **parsed `outfits[]`** → the funnel + histograms + the
  content-preservation invariant; `keys.py` `base_key`/`full_signature` → per-candidate keys; `RankerResult`
  + `RankedOutfit.breakdown`/`score` → ranked dispositions + scores; `response.OutfitVariant` → shown
  candidates; `RescueResult` flags → `diagnostics.rescue`; `OpenAIGenerator` (model, temperature,
  last_usage) → `generator` + cost.
- **The full-funnel capture obligation — THREE substrate discard sites, not one (Codex finding 1 / Fable
  §1/§5-B).** The first draft named only site #1. All three must be exposed in M5 via an **additive,
  read-only trace/audit surface** that does **not** reopen the closed `rank()`/`build_variants()`/`rescue()`
  public contracts:
  1. **`rescue()`** returns `RescueResult{ranked, variants, flags}` only — it computes
     `validate_gpt_payload(...)` at `rescue.py:653` but consumes only `.candidates` (`:656`);
     `rejections`/`warnings` and the raw/parsed payload are dropped (`rescue.py:676`). → the rejected pool
     + attempt trace (H29(b)).
  2. **`rank()`** returns `RankerResult` = **top-k `RankedOutfit`s only** (`ranker.py:140`); the
     scored-but-not-emitted `_ScoredCandidate`s (full `ScoreBreakdown`) inside `_select_fallback_pool`
     are never returned. → **scored-but-unshown continuous scores die** — exactly the H29(a) selection bias.
  3. **`build_variants()`** returns `(selected, spread_collapsed)` (`response.py:559`); the full
     `variants_by_full_signature` — every non-selected variant's `compatibility`/`visibility` — is dropped.
     → unshown variants' content scores die.

     The C6 eval harness already **re-derives** rejections/warnings by re-running `validate_gpt_payload`
     (`evaluation.py`), proving site #1 is reconstructable; sites #2/#3 need the substrate to *expose* the
     full scored pool / full variant map. **Mechanism — LOCKED (second-pass decision, 2026-06-25): additive
     sibling trace APIs (Option B), NOT a return-shape change to the closed contracts.** The closed
     `rescue()`/`rank()`/`build_variants()` (+ `validate_gpt_payload()`) stay **byte-stable**; new
     `*_with_trace`/`*_with_audit` siblings return the richer payload and the existing functions become **thin
     projections** of them (Option A — adding a field to the frozen `RankerResult`/return shape — was rejected:
     it edits the closed dataclass, which the "must not reopen the closed contract" invariant forbids).
     **Directional surface** (exact decomposition + tests owned by **S9/M5**, not M4): `rescue_with_trace()`,
     `rank_with_audit()`, `build_variants_with_trace()`, and `validate_gpt_payload_with_trace()` if needed —
     the siblings are the **sole** new public surface. **Acceptance criterion (S9):** every existing
     closed-contract signature + its M0–M3/Spearhead tests remain **unchanged** (additive-only). Without all
     three sites, every M5 snapshot has continuous scores only for *shown* outfits — the selection-biased
     corpus M6 then trains on, permanently.
- **Also new at implementation (not in `fitted_core` today):** the Python-issued `candidateId`; the
  **required** `__version__` / `promptVersion` / `rankerConfigVersion` constants (§8.2-C — must exist before
  the first live write); `interactionCountAtRequest`.
- **Case + id boundary (pinned):** Python emits **snake_case** (`candidate_id`, `full_signature`,
  `score_breakdown`, `option_path`); the service-boundary serializer converts to **camelCase** wire/Mongo,
  with **finite floats only** (no `NaN`/`Infinity`), no `undefined`. **Ids:** item/candidate ids cross as
  **opaque strings** (keys.py already assumes 24-char ObjectId hex); TS stores `user` as an `ObjectId`, but
  **all item/candidate refs inside the snapshot stay strings** (no `ref`/`populate` — H10).

### 8.5 — (folded into 8.4)

### 8.6 OQ1 — payload-size revalidation

Worst-case sizing (BSON/JSON): item snapshots ≤ `MAX_PROMPT_ITEMS`=135 × ~500 B ≈ **67 KB**; validated
candidates ≤ `MAX_CANDIDATES`=40 × ~700 B ≈ **28 KB**; rejected pool + bounded raw ≈ **20 KB**; context/
provenance/shown ≈ **8 KB**. **Total worst case ≈ 120 KB** — **<1% of Mongo's 16 MB** document limit, and
trivial as an HTTP body. A typical rescue (small scoped pool, few candidates) is **single-digit KB**.

**The 120 KB is only defensible WITH raw-payload caps (Codex finding 5).** The estimate breaks if
`rawText`/`rawEmitted`/`rawAttributes`/`metadata`/`notes` are copied verbatim or ever carry CV blobs. So the
contract requires: **byte cap + stored hash + truncation flag on every raw field, and a hard "no image /
base64 / blob" rule** (image data is always a ref, never inline — §8.2-D/E). With those, the bound holds.

**Verdict: TS-write-verbatim assumption HOLDS, conditioned on (a) the raw caps above and (b) server/client
separation.** Size never forces a Python-direct-Mongo write. The separation: the Python **service response
to Next is two distinct top-level objects** —
`{ clientResponse: {...shown variants + (snapshotId,candidateId) as the only feedback identity...}, snapshot: {...full server-only funnel + keys...} }`.
Next **mints `snapshotId` up front** (§8.1), joins it onto both, **forwards `clientResponse` to the
browser**, merges Python's `snapshot` payload with the TS-built `itemSnapshots` (§8.4), and **persists**.
The rejected/low-ranked pool never reaches the client.

Selected output (of the three): **"TS-write remains valid only if the server-only payload is separated from
the client response."** **Status: PROVISIONAL** — final lock waits on the **S9** payload-size guard test
(a real BSON-size assertion over a max-wardrobe + worst-raw-text fixture, §8.9/§8.11 obligation 4). No
Python-direct-write.

### 8.7 H10 / H19 / H25 / H29 / H43 resolution

| Hole | Problem | How this schema resolves/stages it | Fields | Status |
|---|---|---|---|---|
| **H10** | Edited/deleted items rewrite old feedback's meaning | Immutable per-item **copy** (`engineVisible`+`evidence`) embedded at request time; training/engine reads `itemSnapshots`, **never re-fetches** the live doc; refs are strings, **not** populatable | `itemSnapshots[]`, string `itemId` | **Resolved (text/history axis)** / **seam-reserved (visual)** / **W-track-dependent** — true image immutability needs a `WardrobeImage` hash/version (none today; H14 deletes-before-commit); honest split, not flat "Resolved". History tests → S8 |
| **H19** | Repetition-window shown-history has no `[NOW]` storage home | `GenerationSnapshot` **is** the home; denormalized `shownFullSignatures` makes the window query cheap without unwinding candidates (§8.8) | `shownFullSignatures`, `shownCandidateIds`, `(user,createdAt)` index | **Resolved** (home = snapshot, not interim ring buffer); **S4 owns the window/cap** in the M5 reducer (snapshot is the raw source) |
| **H25** | Item representation must extend toward visual/embedding without requiring it now | reserved nullable `embeddingRef`/`visualFeatureRef` + `evidence.image.hash`; scoring consumes a representation, never a fixed tag list; embed-ref shape **not** locked now | `embeddingRef?`, `visualFeatureRef?`, `evidence.image?` | **Resolved-seam** (reflect; embeddings produced at W-track/M6). The H25 win is real **only because** the engineVisible/evidence boundary records what the engine used (same fix as provenance) |
| **H29** | Snapshot may store only validated/shown + buckets + text | (a) **continuous** scores in `scoreTrace` **for every scored candidate incl. unshown**; (b) **rejected + low-ranked** retained in `candidates[]` + `generationAttempts[]` with `dropStage`/`dropReason`/`rejectionCodes` + the **content-preservation invariant**; (c) **visual** ref/hash + embedding seam | `candidates[].scoreTrace`, `dropStage`, `dropReason`, `rejectionCodes`, `rawEmitted`, `generationAttempts[]`, `evidence.image` | **Shape-resolved; contract-resolved only once §8.4 captures all THREE discard sites + the content invariant** (the live-capture dependency is the gate, not just "plumbing") |
| **H43** | New collection not cascade-covered; retention/redaction undefined vs immutable truth | Reserve `redacted`/`redactedAt`/`redactionReason` + recorded PII-scrub-vs-tombstone intent (§8.2-K); **behavior `[STAGED]`** (no cascade wired in M4); projection-affinity rebuilds clean post-redaction | `redacted`, `redactedAt`, `redactionReason` | **Seam reserved**, policy deferred (Privacy `[STAGED]`) |

### 8.8 Index / query plan

| Query pattern | Index | Notes |
|---|---|---|
| Feedback binding / ownership lookup by snapshotId | `_id` (default) + `{user:1, createdAt:-1}` | membership reads one doc by `_id`, asserts `user`, then scans `candidates[]` in that doc |
| **H19** repetition window (last N shown renders for a user) | `{user:1, createdAt:-1, _id:-1}` | total-ordered read (the `_id` tie-break makes same-`createdAt` order deterministic — §9.3); reads `shownFullSignatures` off the recent N **where `nSurfaced>0`** (bounded scan; empties skipped, not counted); `intent` filter optional |
| Re-roll sibling grouping | `{user:1, candidateCacheKey:1, generationIndex:1}` — **NON-unique** | **Demoted from unique (Fable/Codex):** uniqueness-as-idempotency depends on H7 (generationIndex lifecycle, deferred-M5). If `generationIndex` resets per session, a legitimate repeat request with identical inputs + `generationIndex=0` would be **wrongly rejected, losing that render's snapshot + its feedback binding**, OR an idempotent retry would conflate with a genuine later render. Grouping only for M4; **the real idempotency key is `requestId`/renderId, defined when H7 closes (M5)** |
| "Has this user been shown this outfit" / edge queries | multikey `{user:1, shownFullSignatures:1, createdAt:-1}` | content-level "shown recently" lookup off the denormalized array |
| M6 training batch read | `{redacted:1, createdAt:1}` | scan non-redacted by time; training is a batch extract |
| Redaction cascade sweep (future) | `{user:1, redacted:1}` | the H43 `[STAGED]` deletion path |

*Candidate-level `fullSignature` inside `candidates[]` gets a multikey index **only if M6 proves it queries
candidates directly** rather than batch-scanning — deferred, not now (Fable).*

### 8.9 Tests needed (added at implementation — S9 ladder)

Schema/validation (jest, TS): required-field rejection (incl. **required `fittedCoreVersion`/`promptVersion`/
`rankerConfigVersion`**); enum validation (intent/weather/clothingType/role/optionPath/risk) **and**
open-code-set validation for `dropStage`/`dropReason` against a documented list (not a hard enum);
**immutability** (non-redaction update rejected; redaction update allowed); **candidateId uniqueness within a
snapshot** (custom validator over `candidates[]`); **content-preservation invariant** (a generated +
`accepted:false` candidate with neither `items`+`slotMap` nor `rawEmitted` is rejected); shown-candidate
lookup by id; rejected-candidate persistence (rejectionCodes survive); score preservation (continuous
`scoreTrace` incl. unshown + breakdown round-trip); `itemId` stored as string (no populate); **bounded raw
payload** (over-cap `rawText`/`rawEmitted` truncated + hashed + flagged; no base64/blob); declared **indexes
present** via `schema.indexes()` and `(user,candidateCacheKey,generationIndex)` is **non-unique**. Membership
(jest/integration): accepts a shown candidate, **rejects an unshown/rejected candidate**, rejects a
wrong-user caller. Cross-language (pytest + a serialization fixture): **payload serialization round-trip**
(snake↔camel, ids as strings, ObjectId boundary, **finite-floats-only / no NaN / no undefined**); H19
shown-history query viability over a seeded set of snapshots. Substrate (pytest): the
`GenerationSnapshotPayload` builder maps every funnel disposition correctly, incl. a fixture with
**accepted + rejected + rescue-dropped + ranker-dropped (scored-but-unshown) + non-selected-variant + shown**
candidates (proves all three discard sites are captured); **`engineVisible` == the exact projection sent to
Python** (provenance-by-construction); **raw-GPT trace persistence** (invalid-JSON-then-repair, malformed
root, **over-limit `extraCandidatesIgnored` candidates preserved before validator slicing**, aggregate
warning, duplicate-fullSignature, unparseable-after-repair all land in
`generationAttempts[]`/`diagnostics`, never as fake candidates); **item edit/delete does not alter snapshot
meaning** (H10 — mutate/delete the live item, assert the embedded `itemSnapshot` + old feedback meaning
unchanged); **graceful-degradation snapshot semantics** (service timeout/schema-invalid/empty-result arms
either write a valid minimal snapshot or deliberately return a non-bindable legacy response, per the M5
fallback contract); visual ref stored without blob. Payload-size guard (the OQ1 PROVISIONAL→lock test): assert real
BSON size over a **max-wardrobe + worst-raw-text** fixture stays well under the limit.

### 8.10 S3 verdict — CLOSED 2026-06-25

> **S3 CLOSED — schema + writer-contract design locked.** The narrow second pass (§8.11 prompt) confirmed
> all four shape-changing required items were actually folded, **verified against source**
> (`rescue.py:653/656/676`; `ranker.py:140` + the `ordered[: context.k]` truncation over the
> `_ScoredCandidate`s/`:380`; `response.py:559`/`:571-576`; `validator.py:60`; `models.py:106`; spec §6.2;
> version-constant absence in `__init__.py`/`config.py`/`generation.py`). **S3 closes the GenerationSnapshot
> schema + writer-contract *design* only** — implementation still waits on the S9/M5 checkpoints (§8.11
> S9-obligations block); nothing here is built.

- **Schema status: CLOSED — design locked.** The C+D provenance split, three-site funnel capture, the
  content-preservation invariant, and the `lens.styleProfileSnapshot` seam are confirmed folded into the
  canonical spec §15.1.
- **Second-pass per-item confirmations (§8.11 prompt):**
  1. **Provenance authorship — CONFIRMED.** `engineVisible` == the exact projection sent to Python
     (true-by-construction, no refetch); its field set == `models.py:106` `WardrobeItem`; the
     `engineVisible`/`evidence` boundary is disjoint; the trainability rule (train only from `engineVisible`)
     survives.
  2. **Three-site funnel capture — CONFIRMED.** All three discard sites named + line-verified; mechanism
     **LOCKED to additive trace siblings (Option B)** — the one item the fold had left open (§8.4).
  3. **Content-preservation invariant — CONFIRMED.** `Issue` (`validator.py:60`) carries no content, so
     snapshot-building must retain the parsed `outfits[]`; the invariant is app-enforceable (§8.3/§8.9).
  4. **`lens.styleProfileSnapshot` seam — CONFIRMED.** Present, `Mixed`, null-until-B-track, honoring §6.2
     ("the immutable copy taken at request time and stored in the GenerationSnapshot").
- **OQ1: TS-write SURVIVED but PROVISIONAL** — size is a non-issue (~120 KB) **conditioned on** raw-payload
  caps + server/client separation (§8.6). Final lock waits on the **S9** BSON-size guard test (now an S9
  obligation, §8.11). No Python-direct write.
- **What S4 (identity/binding) must consume:** Python-issued `candidateId` + `baseKey`/`fullSignature` per
  candidate; `shownCandidateIds`/`shownFullSignatures` as the de-orphan/membership read path; the
  `{snapshotId, candidateId}` echo contract; **plus** the H19 window/cap ownership in the M5 reducer and the
  `snapshotId` pre-allocation ordering. Must **not** reopen the §7 key format (trap-guard F).
- **What S6 (feedback authenticity) must consume:** the membership check over `shownCandidateIds` (exists ∧
  `user` owns ∧ actually-shown); echoed-items ⊆ candidate `items`/`itemSnapshots`. Confirms the OQ4 M4/M5
  split (M4 = existence+ownership+content-key binding; M5 = `{snapshotId,candidateId}` binding + membership).
- **§15.1 spec text: LANDED.** All four required changes are folded and confirmed; S4 may proceed from the
  canonical §15.1 contract plus the S9/M5 implementation obligations below.

### 8.11 Reconciliation ledger (Codex impl review × substitute-Fable arch/spec/training review)

**Both second opinions present and reconciled.** The Codex review is the implementation/runtime second
opinion; the substitute-Fable review is the architecture/spec/training one (CLAUDE.md dual-read substitute).
They were **strongly convergent** — no contradictions; Fable's provenance/funnel findings *subsume* Codex's
feasibility findings, and Codex's runtime findings (no-refetch, snapshotId ordering, raw caps, index safety)
*sharpen* the writer contract Fable approved-with-changes.

| # | Finding | Source | Disposition | Where folded |
|---|---|---|---|---|
| 1 | Flat/Option-B item authorship falsifies provenance → C+D hybrid (engineVisible/evidence) | Fable §2/§7 (+Codex 2) | **ACCEPTED** (the one-way-door correction) | §8.1, §8.2-D, §8.3, §8.4, §8.7 |
| 2 | Only 1 of 3 substrate discard sites named; rank()#2 + build_variants()#3 also drop signal | Fable §1/§5-B (+Codex 1) | **ACCEPTED** | §8.4 (three-site obligation), §8.7-H29, §8.9 |
| 3 | `generationAttempts[]` for root/attempt events; don't fake-candidate them | Codex 4 | **ACCEPTED** | §8.2-E, §8.3, §8.9 |
| 4 | Content-preservation invariant for non-accepted candidates (Issue carries no content) | Fable §5-A (+Codex) | **ACCEPTED** | §8.2-F invariant, §8.3, §8.9 |
| 5 | Strengthen candidates: sourceAttemptId/sourceIndex/dropStage/scoreTrace/bounded rawEmitted | Codex 3 | **ACCEPTED** | §8.2-F, §8.3 |
| 6 | Pin ids: snapshotId TS-preallocated; candidateId Python-issued; echo `{snapshotId,candidateId}` | Fable §8 + Codex 3 | **ACCEPTED** | §8.1, §8.2-A/J, §8.4, §8.6 |
| 7 | `fittedCoreVersion`+`promptVersion`(+`rankerConfigVersion`) required, non-null pre-write | Fable §7 | **ACCEPTED** (extended to rankerConfigVersion) | §8.2-C, §8.3, §8.9 |
| 8 | Honest H10 status: text-resolved / visual-seam / W-track-dependent | Fable §2 | **ACCEPTED** | §8.7-H10 |
| 9 | `lens.styleProfileSnapshot?` embed seam (§6.2), null until B-track | Fable §2 | **ACCEPTED** | §8.2-B, §8.3 |
| 10 | TS-write survives only with: one captured context, no refetch, server/client split, raw caps | Codex 2/5 + Fable | **ACCEPTED** | §8.1, §8.4, §8.6 |
| 11 | Demote `(user,candidateCacheKey,generationIndex)` to non-unique until H7 closes | Fable + Codex 6 | **ACCEPTED** | §8.8 |
| 12 | §8.10 = approve-with-required-changes; §15.1 delayed; second pass required | both | **DONE** — narrow second pass run 2026-06-25; all four items CONFIRMED against source → **S3 CLOSED**, §15.1 landed | §8.10 |
| — | Soften `dropReason`/`dropStage` to open append-only code set (not hard enum) | Fable (optional) | **ACCEPTED** (cheap, posture rule 1) | §8.2-F, §8.3 |
| — | `embeddingRef` shape `{ref,model,dim,version}` not bare string — but defer, don't lock now | Fable (optional) | **SOFTENED** — recorded as "shape not locked", deferred to first writer | §8.2-D |
| — | `shownBaseKeys` has no `[NOW]` consumer | Fable §3 | **DROPPED at S4** — the "drop at S4" branch taken (derivable from `shownCandidateIds`+`candidates[].baseKey`) | §9.4 |
| — | PII scrub-vs-tombstone redaction intent | Fable §6 | **ACCEPTED (recorded intent, not built)** | §8.2-K |
| — | Per-field provenance bool on every feature | Fable §7 (self-rejected) | **REJECTED** — the engineVisible/evidence two-bucket boundary suffices; per-field is overkill | n/a |
| — | Cross-model gaps (clothingType enum, OutfitInteraction fields, db.ts registration) | Codex 7 | **ROUTED** (not S3 schema edits) — clothingType→S5, interaction fields→S4, registration→M5/S7 | §8.3 note |
| 13 | Trace-surface mechanism for sites #2/#3: additive return vs `*_with_trace` wrapper | second pass | **LOCKED — Option B** (additive sibling trace APIs; closed contracts stay byte-stable; decomposition→S9/M5) | §8.4, §8.10 |
| 14 | engineVisible camelCase tag names (`colors`/`occasions` were non-mechanical) | second pass | **ACCEPTED** — `colorTags`/`occasionTags`/`styleTags` (literal snake↔camel); `engineVisible` stored == sent modulo serializer | §8.2-D, §8.3 |

**Implementation-side second opinion: PRESENT** (Codex). Nothing in S3's closeout rests on a missing review.

**Narrow second pass: DONE 2026-06-25.** Confirmation-only re-review of the fold against the three cited
substrate files + `validator.py`/`models.py` + spec §6.2; all four shape-changing required items returned
CONFIRMED, the one open item (trace mechanism) was LOCKED (Option B), and the cosmetic naming nit was
accepted. Result: **S3 CLOSED; §15.1 landed.** Codex's implementation-feasibility notes are **S9
obligations, not S3 blockers** (the schema only needed the funnel data to be *exposable* — confirmed; *how*
it is exposed is S9/M5).

#### S9 obligations (Codex feasibility notes → implementation-ladder checkpoints, NOT S3 blockers)

S9 (the C1–Cn ladder) must carry an explicit checkpoint — each with acceptance criteria + a test plan — for
each of the following. They are recorded here so the planning→implementation handoff cannot lose them:

1. **Version constants (pre-first-write):** add `fitted_core.__version__` (`fittedCoreVersion`),
   `promptVersion` (tags the §D prompt builder), and `rankerConfigVersion` (hash of the Appendix B
   constants) — all **absent today** (`__init__.py`/`config.py` have none; confirmed). Required, non-null on
   every live write (§8.2-C).
2. **Full-funnel trace wrappers (Option B, §8.4):** `rescue_with_trace()`, `rank_with_audit()`,
   `build_variants_with_trace()` (+ `validate_gpt_payload_with_trace()` if needed) exposing the three
   discard sites. **Acceptance:** the closed `rescue()`/`rank()`/`build_variants()`/`validate_gpt_payload()`
   signatures + their M0–M3/Spearhead tests remain **unchanged** (additive-only; siblings are the sole new
   public surface).
3. **Cross-language serializer tests:** snake↔camel round-trip (incl. `style_tags`→`styleTags`,
   `color_tags`→`colorTags`, `occasion_tags`→`occasionTags`), finite-floats-only (no `NaN`/`Infinity`), no
   `undefined`, item/candidate ids as opaque strings, `user` as `ObjectId` (§8.4).
4. **Raw-payload cap constants:** byte cap + stored hash + truncation flag on every raw field
   (`rawText`/`rawEmitted`/`rawAttributes`), and the hard no-image/base64/blob rule — the OQ1 120 KB bound is
   only defensible with these (§8.6). Includes the **BSON-size guard test** (max-wardrobe + worst-raw-text
   fixture) that converts OQ1 PROVISIONAL→locked.
5. **`itemSnapshot` builder drift tests:** `engineVisible` == the exact projection sent to Python
   (provenance-by-construction); an item edit/delete after the snapshot does **not** alter the embedded
   `itemSnapshot` or old feedback meaning (H10).
6. **`snapshotId`/`candidateId` ordering tests:** `snapshotId` TS-preallocated before the browser response;
   `candidateId` Python-issued over the deterministic funnel order; M5 joins `snapshotId` onto Python's
   payload + `clientResponse` before persist/return (§8.1).
7. **Python `candidateId` assignment over the FULL funnel:** deterministic ordinal over the fully-traced
   funnel (attempts ordered deterministically), unique within the snapshot — including rejected /
   scored-but-unshown / non-selected-variant candidates, not only the shown set (§8.2-F).
8. **Graceful-degradation snapshot semantics:** M5 must choose and test the fallback arm explicitly:
   service-unreachable/timeout/schema-invalid/empty-result either writes a valid minimal GenerationSnapshot
   with empty shown arrays + diagnostics, or returns a legacy response marked non-bindable. It must not
   silently return shown variants that cannot later verify `{snapshotId,candidateId}`.
9. **Over-limit candidate preservation before slicing:** `validate_gpt_payload_with_trace()` (or the
   surrounding trace wrapper) must preserve bounded raw or normalized content for candidates that trigger
   `extraCandidatesIgnored` before the current validator truncates to `MAX_CANDIDATES`, satisfying the
   content-preservation invariant for generated-but-not-accepted candidates.

#### Narrow second S3 pass — prompt (EXECUTED 2026-06-25; verdict in §8.10, ledger row 12)

> **M4 Session 3 — narrow second pass (confirmation only).** Read `docs/plans/m4-data-model-migration.md`
> §8 (reconciled) + the three source files it cites (`ml-system/fitted_core/{rescue,ranker,response}.py`).
> Do **not** redesign; confirm only that the reconciliation closed the four shape-changing required items,
> then give a CLOSE / NOT-CLOSE verdict:
> 1. **Provenance authorship (C+D):** does §8.2-D + §8.4 guarantee `itemSnapshot.engineVisible` is *exactly*
>    the projection M5 sends to Python (true-by-construction, no post-Python refetch)? Is the
>    `engineVisible`/`evidence` boundary unambiguous, and does the trainability rule (train only from
>    `engineVisible`) survive?
> 2. **Three-site funnel capture:** does §8.4 name all three discard sites (`rescue()`#1, `rank()`#2,
>    `build_variants()`#3) **and** commit to an *additive, read-only* trace surface that does **not** reopen
>    the closed `rank()`/`build_variants()`/`rescue()` contracts? Is the mechanism (additive return vs
>    `*_with_trace` wrapper) decided or explicitly deferred-to-M5 with a named owner?
> 3. **Content-preservation invariant:** is "generated ∧ ¬accepted ⇒ (items+slotMap) ∨ rawEmitted"
>    enforceable, and does snapshot-building retain the parsed `outfits[]` to satisfy it given `Issue`
>    carries no content (validator.py:60)?
> 4. **`lens.styleProfileSnapshot` seam:** present, typed-or-Mixed, null until B-track, honoring §6.2?
>
> Also spot-check: snapshotId-preallocated/candidateId-Python-issued (§8.1); required version fields
> (§8.2-C); non-unique cache-key index + H7 coupling (§8.8); raw caps (§8.6). Output: per-item
> CONFIRMED/GAP, an overall **CLOSE S3 / SECOND-PASS-AGAIN** verdict, and — only if CLOSE — green-light to
> draft spec §15.1 from §8.2. Be adversarial about *whether the fold actually did what the first review
> demanded*, not about re-opening settled shape.

---

## 9. Session 4 outputs — persisted identity & binding (CLOSED 2026-06-25)

Signed off 2026-06-25. The S4 deltas are additive/reversible **riders** on the S3 one-way door (§7.2), not a
new foreclosure; §15.1 already carried the dual-reviewed identity-binding rule, so **no fresh Fable review** —
the only genuinely-new call (the H19 reducer) is M5-reversible and source-anchored. Critical path
**S3 → S4 → S6**: S4 fixes the interaction binding + the H19 window/cap that S6's authenticity membership
check reads. Canonical data-shape is single-homed into the spec (§6.6 interaction fields, §15.1 reducer +
shown-history, §16 gate split, Appendix B constants); this section is the rationale home.

### 9.0 Governing principle (decides every denormalization call)

**Denormalize a field onto a row or shown-array only when a `[NOW]` hot path consumes it *without already
holding the source document*; otherwise keep it single-homed and derive.** Reasoned from the
determinism/consistency promise (never duplicate immutable state you can't keep in sync — except where a hot
query would otherwise pay an unacceptable join). One rule resolves all four S4 field calls:

| Field | Hot `[NOW]` consumer without the source doc? | Call |
|---|---|---|
| `fullSignature` on interaction row | **Yes** — the compute-live affinity projection (OQ2) builds `liked_full_signatures` (comboBoost) from rows at request time; won't join each row to its snapshot (Finding G) | **store** |
| `baseKey` on interaction row | **Yes** — the dislike-cooldown buffer is built live from rows, keyed by BaseKey (§15) | **store** |
| `shownPosition` / `generationIndex` on row | **No** — only exposure-bias/training (§21) needs them, and those batch reads already load the snapshot | **derive, don't store** |
| `shownBaseKeys` on snapshot | **No** — repetition keys on FullSignature; cooldown reads the dislike buffer; variant-cap is intra-render | **drop** (§9.4) |

`shownFullSignatures` stays denormalized precisely because the H19 reducer (§9.3) is the cross-snapshot hot
query that would otherwise unwind `candidates[]` in every windowed snapshot — the §8.8 query-cost rationale.

### 9.1 Additive `OutfitInteraction` binding fields

Additive over the deployed row (`OutfitInteraction.ts`); all nullable — present **iff** snapshot-bound
(`snapshotId` present is the discriminator; pre-M5 legacy rows have none). M4 adds the fields; M5 wires the
live write.

| Field | Type | Source | Why |
|---|---|---|---|
| `snapshotId` | `ObjectId ref GenerationSnapshot` (nullable) | client echo (verified) | the binding target — which exact render (de-orphan) |
| `candidateId` | `String` (nullable) | client echo (verified) | the Python-issued ordinal within that snapshot |
| `baseKey` | `String` (nullable) | **server re-read** from the snapshot candidate | live dislike-cooldown buffer consumer |
| `fullSignature` | `String` (nullable) | **server re-read** | live comboBoost / affinity projection (Finding G) |

- `items[]` (existing): on snapshot-bound feedback the server **sets** it from the re-read candidate, never
  the client echo. Legacy rows keep client-supplied `items` (the §16 vulnerability, gated at M5).
- **NOT added:** `shownPosition`, `generationIndex` — derived from the referenced snapshot (§9.0), never
  row-stored (only exposure-bias/training reads need them, and those batch reads already load the snapshot).
- **Index (additive, approved):** `{ snapshotId: 1, candidateId: 1 }` for snapshot→feedback joins (M6
  training reads; cheap, additive, reversible). Existing `{user, createdAt}` / `{user, items}` indexes already
  cover the live affinity/cooldown projections.
- **Co-presence invariant (binding atomicity — enforce + test):** the four binding fields are
  **all-present-or-all-absent.** `snapshotId` present ⟺ `candidateId`/`baseKey`/`fullSignature` all present (a
  snapshot-bound row); all four null ⟺ a pre-M5 legacy row. A partial row (e.g. `snapshotId` without
  `candidateId`, or `candidateId` without the server-re-read keys) is **invalid** — it would poison the live
  affinity/cooldown projections that read these fields. Enforced by a Mongoose `pre('validate')` guard + an S9
  test (§9.8).

### 9.2 The de-orphan binding loop

How a later wear/like binds to the EXACT shown outfit, and why it closes the Spearhead rescue→learning loop:

1. **Render (M5):** the snapshot is written at Step 7 with `shownCandidateIds`; each shown variant carries
   `(snapshotId, candidateId)` in `clientResponse` (`snapshotId` TS-preallocated, §8.1).
2. **Feedback:** the client POSTs `action` (+ reason/rating) echoing **`{snapshotId, candidateId}` only**.
   `items` and keys are never trusted.
3. **Gate** (full contract; impl split = OQ4, §9.5): exists (load by `_id`) ∧ owned (`snapshot.user ==
   caller`) ∧ **content-key binding** (re-read the candidate from `snapshot.candidates` by `candidateId`;
   **server-set** `baseKey`/`fullSignature`/`items` from it — never the echo) ∧ **actually-shown membership**
   (`candidateId ∈ snapshot.shownCandidateIds`) ∧ any optional client-submitted `perItemFeedback.itemId` ⊆ the
   candidate's items. The identity echo is `{snapshotId,candidateId}` **only**; per-item feedback targets are
   the lone client-supplied ids, and they are subset-validated — the outfit composition itself is never echoed.
4. **Persist:** write the row with `{snapshotId, candidateId, baseKey, fullSignature, items}` all from the
   re-read candidate; `action`/`reason`/`rating` from the client.
5. **Learn (loop closes):** the compute-live affinity projection reads these rows; a *liked* `fullSignature`
   containing a **rescued orphan** → comboBoost on its pairings → the orphan gains edges → **de-orphaned.**
   Without authentic binding, a later "I wore this" can't be tied to the orphan-anchored combo and the rescue
   vertical's payoff never lands.

The **re-read rule** (server re-reads from the immutable snapshot, never trusts the echo — H10) is the
security spine: stored keys/items are authentic-by-construction.

### 9.3 H19 — shown-history window/cap reducer contract (M5 implements)

**The reducer (deterministic):**
1. Read the user's most-recent snapshots **with `nSurfaced > 0`** (empty/failed renders never consume the
   window — see the corrected bullet below), by `{user:1, createdAt:-1, _id:-1}` (total order; the `_id`
   tie-break makes same-millisecond `createdAt` collisions deterministic). Stop at `REPETITION_WINDOW_SNAPSHOTS`
   (=20) **non-empty** snapshots **or** a bounded scan cap (read at most `REPETITION_WINDOW_SNAPSHOTS × k` docs
   so a burst of empties can't make the scan unbounded; `k` small, M5-tunable).
2. Walk their `shownFullSignatures` most-recent-first; dedup keeping the first (most-recent) occurrence.
3. Truncate to `REPETITION_WINDOW_SIZE` (=10, the shipped M3 cap).
4. Return an **ordered `Sequence[str]`** — the ranker's `shown_full_signatures` input.

- **Count-based, not time-based:** a count window adapts to usage intensity ("the last things you saw"
  regardless of clock), is deterministic/testable, and is index-bounded. A time window over-penalizes heavy
  users and couples variety to wall-clock. Matches the §8.8 index plan.
- **Output type is `Sequence[str]` (ordered tuple), NOT a frozenset** — `ranker.py:191` declares
  `shown_full_signatures: Sequence[str]` and `:247` normalizes it to a `tuple` ("recency-faithful
  membership"), deliberately distinct from the frozenset *sets* (`liked_full_signatures:190` / disliked-id
  sets). The reducer must preserve order; see the §9.7 correction.
- **Cap = the existing `REPETITION_WINDOW_SIZE = 10`**, not a new constant — the M3 contract already fixes the
  sig cap (`config.py:64`; "the M4/M5 reducer owns windowing", `config.py:60`). The only NEW constant is
  `REPETITION_WINDOW_SNAPSHOTS = 20` (the snapshot-read window; provisional, M5-tunable). Both in Appendix B.
- **Re-rolls get variety for free:** siblings are separate snapshots written before the next sibling ranks →
  naturally in-window.
- **Empty/failed renders do NOT consume the window (corrected):** the read filters `nSurfaced > 0`, so a burst
  of graceful-degradation / empty snapshots (S9 obligation 8) can't flush real recent exposures out of the
  count window. The earlier "empty union, no special-casing" under-specified this; the `nSurfaced>0` filter +
  the bounded scan cap (step 1) is the contract, and it decouples the reducer from whichever
  graceful-degradation arm M5 picks.
- **Scope:** cross-intent (an exposure is an exposure); per-intent scoping is a deferred refinement.
- **Ownership:** S4 fixes the mechanism + the param shape; M5 implements the reducer and tunes the numbers. M3
  is untouched (no reopen).

### 9.4 `shownBaseKeys` — DROP

No `[NOW]` consumer (repetition keys on FullSignature; cooldown reads the dislike buffer; the variant cap is
intra-render; de-orphan re-reads `candidates[].baseKey`), and it is fully derivable from `shownCandidateIds` +
`candidates[].baseKey`. Dropped from §15.1 (additive re-add later if a cross-render BaseKey query appears).
Resolves §8.2-H's "name a consumer or drop at S4." Supersedes the `shownBaseKeys` line in the §8.3 Mongoose
sketch (per the §8.2 disclaimer: §15.1 wins).

### 9.5 OQ4 — the authenticity M4/M5 split HOLDS

- **Full contract (M4 defines):** exists ∧ owned ∧ membership ∧ items⊆candidate, bind via `{snapshotId,
  candidateId}`, persist server-re-read keys/items.
- **M4 implements** (fixture-level, additive): the binding fields + **existence + ownership + content-key
  binding** as functions over seeded snapshots/rows.
- **M5 implements** (live route): the live `{snapshotId, candidateId}` echo wiring + the **"actually-shown"
  membership** gate + items⊆candidate — the runtime anti-poison checks that only have meaning against an
  untrusted client over a live endpoint reading the live-populated `shownCandidateIds`.

Sound because M4 has no live route to attack; the membership semantic is the runtime gate. **Confirmed: the
split holds now that S4 fixed the window/cap (§9.3).** Trap-guard honored — the membership ("actually-shown")
check is M5, not M4.

### 9.6 Handoffs, conflicts, supersessions

- **Conflict found + fixed (§6.6):** §6.6 said the row "adds the lens snapshot" — duplicating immutable state
  now single-homed in the GenerationSnapshot (§15.1). Reconciled: the row stores the `{snapshotId,
  candidateId}` binding + re-read keys; the lens/feature snapshot lives only in the referenced snapshot.
- **H11 → S6:** S4's binding makes `{snapshotId, candidateId}` the natural duplicate-feedback dedup key, but
  the dedup/concurrency rule (and concurrent affinity updates) is forward write-path concurrency → **S6**, per
  the H11 split. S4 does not set it.
- **Trap-guards honored:** §7/H30 key format not reopened (S4 stores values verbatim, Finding F); the M3
  ranker contract not reopened (§9.3 reuses the shipped type + cap; §9.7).
- **Not absorbed:** the 9 S3 S9 obligations (§8.11) + the new **S4 S9 obligations (§9.8)**; OQ5 engineVisible adapter-mapping → S7; ItemAffinity
  placement (OQ2 residue) → S7; PreferenceSummary (OQ3) → S7.

### 9.7 Source-verification correction (overrides two approved provisional values)

At implementation-contract close, a source read of `ranker.py`/`config.py` corrected two details the pre-close
plan (and its approval) had carried from an imprecise conductor citation:
1. **Reducer output type:** `frozenset[str]` → **ordered `Sequence[str]`/`tuple`** (`ranker.py:191`/`:247` —
   `shown_full_signatures` is an ordered, recency-faithful window, not a set; the frozenset citation conflated
   it with `liked_full_signatures:190`).
2. **Signature cap:** a proposed new `REPETITION_SIGNATURE_CAP=200` → **reuse the shipped
   `REPETITION_WINDOW_SIZE=10`** (`config.py:64`; the M3 ranker already fixes the sig cap and "owns
   windowing"). A 200 cap would contradict the shipped ≤10 contract = a code↔spec conflict.

Both corrections are mandated by "don't reopen the closed M3 contract" + "conflicts are bugs";
`REPETITION_WINDOW_SNAPSHOTS=20` (the new snapshot-read window) is unaffected and lands as approved.

### 9.8 S4 → S9 implementation obligations (carry into the C1–Cn ladder)

The §8.11 list is the **S3-snapshot** obligation set; S4 adds its own implementation checkpoints. S9 must carry
an explicit checkpoint — acceptance criteria + a test plan — for each, recorded here so the
planning→implementation handoff cannot lose them (exactly as §8.11 does for S3). All are M5-reversible riders.

1. **Interaction binding fields:** add `snapshotId`/`candidateId`/`baseKey`/`fullSignature` to
   `OutfitInteraction.ts` (all nullable, §9.1), with the **co-presence invariant** (all-present-or-all-absent)
   enforced by a Mongoose `pre('validate')` guard + a jest test that **rejects partial rows**.
2. **Binding index:** the additive `{ snapshotId: 1, candidateId: 1 }` index (snapshot→feedback joins, §9.1).
3. **De-orphan gate (M4 part):** existence + ownership + content-key binding as pure functions over seeded
   snapshot/row fixtures (§9.2/§9.5; pytest). Server **sets** `items[]`/keys from the re-read candidate;
   optional `perItemFeedback.itemId` ⊆ candidate items. The live `{snapshotId,candidateId}` echo wiring + the
   actually-shown membership check are **M5** (§9.5).
4. **H19 reducer:** `REPETITION_WINDOW_SNAPSHOTS` in Appendix B (done); the deterministic reducer (read recent
   `nSurfaced>0` snapshots by `{user,createdAt,_id}`, bounded scan cap, dedup most-recent-first, truncate to
   `REPETITION_WINDOW_SIZE`, ordered `Sequence[str]` — §9.3). **M5 implements**; tests cover order-preservation
   (not a set), the `_id` tie-break total order, and the **empty/failed-snapshot-pollution** case (a burst of
   empties must not flush real exposures).

### S4 verdict — CLOSED 2026-06-25

Reconciled and internally consistent with §15.1, the deployed `OutfitInteraction`, and the spec. One conflict
found+fixed (§6.6), five scope items resolved, OQ4 confirmed, trap-guards honored, deferreds routed. **S4
closes the *design*; implementation is the S9 ladder + M5.** Next: **S5** ✅ CLOSED — see §10.

---

## 10. Session 5 outputs — `clothingType`→5 migration + additive field-adds (CLOSED 2026-06-25)

Signed off 2026-06-25. S5 is the **detachable light island** (§7.4): additive, reversible, off the
S3→S4→S6 critical path. No one-way door → **no Fable review** (the classifier fallback is re-runnable
forward-design, §7.2/D3); decision basis = a first-principles read of the two deployed string-match sites
against the closed substrate's 5-value `ItemType`, reasoned from the determinism/consistency promise. The
canonical decision is single-homed into spec **§6.1**; this section holds the classifier mechanics, the
two-site divergence evidence, and the S9 obligations.

**Scope confirmation (Brian, 2026-06-25):** the migration target is **dev/seed/test data, not precious
production history** (this fork has no real users — D3). So S5: align the persisted schema to the 5-type
engine, keep it simple + reversible, and move on. No null/typeless behavior, no new M4 review/confidence
fields, no rollback/live-data ceremony — durable review/confidence belongs to the W-track if/when it matters.

### 10.0 Inbound audit (open bookend) — clean

No S1–S4 landing conflicts with S5's surface:
- **§15.1 already assumes 5-value `clothingType`** (`engineVisible.clothingType: String enum[5]`, §8.3); S5
  catches the *persisted* `WardrobeItem` up to the snapshot contract — consistent, not conflicting.
- **§15.1 stores `wardrobeVersion: int (required)`**; S5 adds the persisted field, bump stays W-track/H6 —
  the "field now, bump later" split holds (the value is just constant until W-track wires the bump).
- **S4 interaction binding / key fields** — untouched (trap-guard F intact).
- **OQ5** reads `clothingType` as an adapter *source*; S5 populating it 5-valued *feeds* OQ5, no collision.
- **Wire-value precision:** the deployed enum extension is exactly `["top","bottom","dress","outer_layer","shoes"]`
  (underscore `outer_layer`) so it matches `models.py` member-name = wire-value (no translation table);
  §6.1 already specifies this.

### 10.1 The dresses-debt finding — two divergent classifiers, not one

The conductor (§5/§7.2) and spec §6.1 framed the backfill as mirroring "the string-match logic" — singular.
There are **two**, and they diverge materially:

| | `route.ts:231` (`byCategory` shortlist) | `route.ts:543` (`inferItemType` footwear-inject) |
|---|---|---|
| Cascade order | outer → bottom → one-piece → footwear → top | one-piece → bottom → footwear → outer → **mid** → top |
| Signals read | `category`, `name`, `layerRole` | `category`, `name`, `subCategory`, `layerRole` |
| Cardigan/hoodie | → **outer** | → **`mid_layer`** (no v2 type) |
| Sweater/fleece/vest | sweater → **top** (others unlisted) | → **`mid_layer`** (no v2 type) |
| **Fallback** | **default → top** (`:248`) | **`"unknown"`** (`:580`) |

Two consequences the "mirror the string-match" framing hid: (1) the sites already chose **different
fallbacks** (top vs unknown) — exactly S5's design call; (2) site #2's `mid_layer` bucket **has no v2
`ItemType`** (the 5-enum has no `mid`), so the backfill must *collapse* it. The backfill therefore can't
mirror either site — it must define **one canonical classifier** (§10.3).

### 10.2 THE design call — ambiguous-row fallback = **default-to-top** (locked)

When the canonical classifier matches none of the 5 buckets (a genuinely out-of-ontology row — scarf, belt,
empty/garbage `category`), the backfill writes **`clothingType = "top"`**.

**Reasoned from the promise (determinism/consistency) + first principles.** `clothingType` is the sampler's
partition key (the closed M1 sampler partitions the wardrobe into the 5 `ItemType` buckets; the validator's
template rules depend on it). The three candidate fallbacks fail differently:
- **default-to-top (CHOSEN):** every row always carries a valid `ItemType` → zero impact on the closed
  sampler; deployed parity (site #1); deterministic. The guess is **not laundered into apparent truth** — the
  mandated D3 dry-run/report lists every default-branch row, so it is inspectable (posture rule 2: a draft,
  surfaced); raw is preserved → re-run fixes it; durable per-field review is the W-track's existing
  `needs_review` + per-field-confidence seam (§18), not an M4 field. An out-of-ontology item is at worst a
  provisional, reported, reversible "top."
- **null + downstream (rejected):** "honest," but the closed M1 sampler partitions on the 5-value enum with
  **no null member** → forces a closed-contract change or a new adapter path (heavier than S5-LIGHT,
  trap-guard territory), and a null item is **silently dropped from candidacy** (upload it, it never appears)
  — a worse rule-2 violation than a reported guess.
- **new M4 review-flag field (rejected):** durable, but **redundant** — §18 already owns `needs_review` +
  per-field confidence, new ingestion writes `clothingType` natively with confidence, and historical rows are
  re-derivable (raw preserved). The only consumer is W-track → minting it in M4 buys nothing re-derivation
  doesn't.

default-to-top **strictly dominates** null on the promise (always-valid partition, no closed-contract reopen,
no silent drop) and dominates the new-field option on leanness (the report + the W-track seam already deliver
the inspectability/durability).

### 10.3 The canonical backfill classifier (deliverable 2)

One ordered first-match cascade, reconciling both sites; reads the **superset** of signals (`category` +
`name` + `subCategory`, plus `layerRole` for the outer short-circuit). Keyword lists are **seeded from the
union of the two deployed sites**, with one deliberate adjustment — the mid-layer knits (cardigan/hoodie/
fleece/vest) are routed to `top`, **not** `outer_layer`, per the collapse rule below (so `outer_layer` drops
cardigan/hoodie that site #1 had, and `top` gains them) — and are **provisional + S9-tunable over fixtures**:

| Order | Bucket (`ItemType`) | Match (any of) |
|---|---|---|
| 1 | `dress` | `category=="one piece"` · `{dress, jumpsuit, romper}` in cat/name/subCat |
| 2 | `bottom` | `category∈{bottom,bottoms}` · `{pants, jeans, shorts, skirt, trousers, chinos, leggings}` |
| 3 | `shoes` | `category=="footwear"` · `{shoes, sneakers, boots, sandals, loafers, heels, flats}` |
| 4 | `outer_layer` | **`layerRole=="outer"`** · `{jacket, coat, blazer, parka, puffer, windbreaker, trench, overcoat}` |
| 5 | `top` | `category∈{top,tops}` · `{shirt, tee, t-shirt, blouse, polo, tank, sweater, henley, button-down, oxford}` + the mid-collapse knits `{cardigan, hoodie, fleece, vest}` |
| 6 | **default → `top`** | none matched → `top`, **listed in the report** (§10.2) |

**The `mid_layer` collapse (the in-ontology decision the divergence forced):** cardigan/hoodie/sweater/fleece/
vest have no v2 type. Rule: **explicit `layerRole=="outer"` wins** (row 4 short-circuits → `outer_layer`);
otherwise the knit collapses to **`top`** (row 5 lists them by name) — a knit worn as the only upper layer is
a valid base top, and `outer_layer` is an *optional* slot, so a misfiled true-outer still yields valid
outfits. This is a deterministic classification rule, not a "fallback."

**Trap-guard — re-derive from raw, never trust the stored `clothingType`.** `WardrobeItem.ts:7` defaults
**every** existing row to `"top"`, so a stored `"top"` is the schema default, not evidence. The classifier
re-derives purely from raw `category`/`name`/`subCategory`/`layerRole`; the only legacy non-default value
possible (`"bottom"`, the sole other enum member) is consistent with re-derivation anyway. This makes the
backfill **idempotent** (pure function of raw → same output on re-run) and **raw-preserving** (never writes
over `category`/`name`/`subCategory`). The dry-run/report/verify mode (D3) emits per-bucket counts + the
default-branch row list so the output is inspectable on fixtures.

### 10.4 Additive field-adds (deliverable 3)

- **`wardrobeVersion`** — persisted **field only**, home = **`User.wardrobeVersion: int` (default 0,
  monotonic)** (a per-user active-wardrobe counter; `User.ts` has none today). The snapshot reads it at
  request time (§15.1); the M5 adapter supplies it to the Lens (§6.3). **The bump trigger / activation
  transition stays W-track/H6** — S5 must not be mistaken for naming it (§7.5-F).
- **`sessionId`** — stays **derived** (`= userId` always, §6.3/Finding E); **no new field** (the §0
  "sessionId storage" item is degenerate).
- **action-enum (`planned/packed/corrected`)** — **NOT S5.** It is S6's (the feedback-authenticity session,
  §1/§7.1); not batched here.
- **No new review/confidence field** (Brian; §10.2). **No `fitted/models/ItemAffinity.ts`** (trap-guard /
  OQ2 — affinity is a rebuildable projection, §7.3).

### 10.5 Holes touched

- **H6** (wardrobeVersion bump): S5 adds the *field*; bump stays **DEFERRED-W-track**. §23 H6 updated to
  record the field-add so it is never mistaken for the bump.
- **H25** (extensible representation): **not reopened** — `clothingType` is a discrete partition key,
  orthogonal to the extensible *feature* representation (tags→embeddings) already seam-reserved in §15.1.
- **No new hole.** The `mid_layer→top/outer` collapse is a *resolved* deterministic rule (§10.3) with a named
  W-track refiner (native `clothingType` + per-field confidence, §18) and is subsumed by the §6.1 `[STAGED]`
  `garmentRole` (which carries `mid`); minting a §23 entry for an already-owned staged gap would bloat the
  register.

### 10.6 S5 → S9 implementation obligations (carry into the C1–Cn ladder)

Recorded so the planning→implementation handoff cannot lose them (as §8.11/§9.8 do for S3/S4). All additive +
reversible over fixtures:
1. **Enum extension:** `WardrobeItem.ts:7` `clothingType` enum `["top","bottom"]` →
   `["top","bottom","dress","outer_layer","shoes"]` (exact underscore wire values); keep `default:"top"`
   (deployed parity / always-valid partition). jest: enum accepts the 3 new values; rejects a non-member.
2. **Canonical classifier** as a pure function (the rule §10.3); pytest cases: each of dress/jumpsuit/romper,
   a `mid_layer` knit with `layerRole=="outer"` → `outer_layer` vs without → `top`, an out-of-ontology row →
   default `top`, and the "stored `top` ignored, re-derived from raw" case. **Idempotency test** (re-run =
   same output).
3. **Dry-run / report / verify mode** (D3): per-bucket counts + the default-branch row list; inspectable on
   the seed/fixture wardrobe; no live-Mongo ceremony.
4. **`wardrobeVersion` field** on `User.ts` (int, default 0); jest: present, default 0; **no bump logic**
   (W-track).

### S5 verdict — CLOSED 2026-06-25

Reconciled with §15.1, the deployed `WardrobeItem`/`User`, the closed substrate's `ItemType`, and the spec
posture. One finding surfaced + resolved (the two-site classifier divergence → one canonical classifier); the
one hard decision locked (fallback = default-to-top); deliverables 2–3 designed; trap-guards honored (no
ItemAffinity, no key reopen, no wardrobeVersion bump, no action-enum); H6 field-add recorded. **S5 closes the
*design*; implementation is the §10.6 ladder + S9.** Next: **S6** (feedback authenticity + the full
authenticity contract — MEDIUM, runs after S3/S4).
