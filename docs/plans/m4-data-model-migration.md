# M4 — Data-model migration (planning conductor)

> **ACTIVE — design CLOSED + scope expanded.** Sessions S1–S7 + §13 consolidation closed the original design
> (snapshot contract / interaction binding / classifier / authenticity contract / adapter mapping). A
> **post-freeze scope expansion (2026-06-26)** added the W-track data-path pull-forward, the DB wipe, the
> PreferenceSummary rip, the cascade extension, and the surgical recommend-route excision — see **§14** for
> the full list and the **C1–Cn implementation ladder** that supersedes the scattered S9-obligation lists.
> Canonical contracts live in spec **§15.1** (snapshot) + **§15.2** (adapter) + **§6.1** (clothingType + the
> CV-derived columns) + **§6.6/§16/Appendix B** (interaction binding + reducer constants + scope vocab) +
> **§18** (W-track scope split) + **§19** (deletion table). Plan retires post-implementation.
>
> **Single-home discipline.** Canonical design lives in `docs/Fitted_Spec_v2.md`; this plan holds rationale,
> tradeoffs, query/index notes, and the implementation ladder, and *points* to the spec for every canonical
> decision. §14 is the live entry point; §1–§13 are session-by-session derivation, preserved as trap-guards
> for the design decisions they locked.

## 0. Goal & the one-way-door principle

> **§14 supersedes the "+ backfill" framing throughout §0–§13.** The DB wipe (decision #5) means there is
> **no backfill** — `clothingType` and the engine columns are written natively by the rebuilt ingestion, not
> migrated onto existing rows. Read "backfill" below as the historical S2–S5 framing; the live mechanic is
> "wipe + native-write" (§14 / §19).

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
| **5** | **`clothingType`→5 migration + additive field-adds. ✅ CLOSED §10** (2026-06-25). Fallback = **default-to-top** (deployed parity; guesses surfaced in the D3 report; durable review = W-track `needs_review`, §18) — null+downstream and a new M4 review-field both rejected (§10.2). Found + resolved: the dresses debt is **two divergent string-match shapes, each duplicated across `recommend`+`regenerate`** (four request-time instances), reconciled into **one canonical TS classifier** (§10.1/§10.3); S9 verifies all four are cut at cutover (§10.6 ob. 2a). `wardrobeVersion` field added (home = `User`; bump = W-track/H6); `sessionId` stays derived (=userId, Finding E). | Idempotent + additive; raw never discarded (re-derives from raw, ignores the default-laden `clothingType`); dry-run/report mode (D3). **No ItemAffinity** (OQ2). action-enum is **S6**, not batched here. |
| **6** | **Feedback authenticity + the full authenticity contract. ✅ CLOSED §11** (2026-06-25). Full authenticity contract consolidated into spec §16 (exists ∧ owned ∧ membership ∧ items⊆candidate; OQ4 M4/M5 split confirmed). **H11 dedup = read-time reducer dedup** on `{snapshotId,candidateId,action}` in the compute-live affinity projection (append-only writes; counter-race dissolved by OQ2; `FEEDBACK_DEDUP_WINDOW` M5-tunable). Action-enum +`planned/packed/corrected` (additive only). **H37 = split `scopeTarget` + `learningDisposition`** (additive nullable fields; behavior `[STAGED]`). No Fable review (reversible, non-foreclosure). | Weight set by S2, **not** pre-assumed light. Membership-check reads shown-history → coupled to S4/S3 (consumed clean). |
| **7** | **Reconcile with reality. ✅ CLOSED §12** (2026-06-25; CV-premise corrected by §14). `fitted/models/*.ts`, deployed schema, what the M5 request adapter needs, M4↔M5 deploy sequencing, migrate-vs-delete seams. | **RESOLVED §12 (then §14):** OQ5 adapter mapping → **spec §15.2** (warmth keyword map **relocated to ingestion** per §14 — adapter is passthrough); **PreferenceSummary dropped** (OQ3); **affinity compute-live**, no `ItemAffinity.ts` (OQ2); **sequencing** = no hazard (M4b dormant; M4a ships live). |
| **8** | **Adversarial falsification.** *Distinct muscle from alignment.* Attack (a) runtime flows — edited item mid-session, deleted item with prior feedback, concurrent/duplicate feedback, re-roll, day-boundary (H10/H11); (b) the classifier on fixtures — ambiguous/null rows, the dresses-debt cases. | **→ §13.3:** runtime scenarios **routed to M5** (no live route in M4); classifier-on-fixtures folds into the S9 pytest ladder. |
| **9** | **Implementation ladder. ✅ DONE — the §14 C1–C8 ladder** (supersedes the scattered §8.11/§9.8/§10.6/§11.6 obligation lists; the §14.2 coverage was audit-verified faithful, 17/19 obligations homed + 2 correctly routed to M5). | The obligation lists below remain as the *design rationale* each checkpoint implements; §14 is the build authority. |
| **10** | **Content alignment audit.** Does the M4 design cohere with the ambition appendix, the canonical spec, the closed M0–M3 substrate, and Spearhead? Catch design contradictions + missed dependencies. | ✅ **DONE §13.1** — coheres; 1 contradiction found+fixed (§13.5). |
| **11** | **Documentation consistency freeze.** §6 checklist; only freeze when all pass; the plan doc gets `> COMPLETED <date>` and leaves the default reading list. | ✅ **design-freeze DONE §13.2** (items 1–5); `> COMPLETED` retirement header deferred to post-implementation (plan stays active for the build). |

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
| **H11** | Idempotency / transaction rules | **RESOLVED-DESIGN (S6 §11.1)** → PENDING-M5. Backfill idempotency trivial (no live data, D3); forward write-path = **read-time reducer dedup** on `{snapshotId,candidateId,action}` in the compute-live projection (append-only writes; counter-race dissolved by OQ2; `FEEDBACK_DEDUP_WINDOW` M5-tunable). Spec §16/§23. |
| **H19** | Repetition-window shown-history storage home | **Resolved-design / pending implementation.** Home is `GenerationSnapshot.shownFullSignatures` (§15.1/S3), not an interim per-user ring buffer. S4 owns the window/cap contract; M5 executes it; coupled to the S6 membership check. |
| **H29** | Snapshot must persist continuous scores + rejected/low-ranked candidates + visual (not shown/text only) | **Resolved-design / pending implementation.** §15.1 is the canonical shape; S9/M5 must implement the three trace surfaces, content-preservation invariant, raw caps, and visual seam. |
| **H37** | Add `lens` / `exception` scope vocab | **RESOLVED-DESIGN (S6 §11.4)** → PENDING-S9. **Split** `scopeTarget` (`outfit/board/routine/global/lens`) + `learningDisposition` (`normal/exception/do_not_learn`), additive nullable on `OutfitInteraction`; anomaly-scoping **behavior** stays `[STAGED]`. Spec §16/§6.6/§23. |
| **H25** (reflect) | Extensible item representation (tags now → embeddings later) | Reflect at S3/S5: scoring + snapshot consume a *representation*, never a fixed tag list. |
| **H43** (NEW) | GenerationSnapshot lifecycle: new collection not covered by `User` cascade-delete; retention/purge/redaction undefined vs immutable-training-truth | **Upgraded by §14 decision #6:** M4 no longer just *reserves* the seam — it **wires** the cascade (C7): `User` delete hard-deletes `wardrobeimages` + **redacts** GenerationSnapshot (nulls PII, preserves itemSnapshots/keys/scores). Only the long-horizon retention *policy* stays `[STAGED]`. Spec §23-H43 RESOLVED-DESIGN. |
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
  the avoided-second-door framing in §7.3. Residue (materialize-vs-live placement) **RESOLVED S7 §12.3**:
  compute-live confirmed, **no `ItemAffinity.ts` in M4**; materialize only later on measured evidence.
- **OQ3 (RESOLVED S7 §12.2 — DROP, no mine):** the deployed **`PreferenceSummary`** collection (free-text
  per-user preference blob, the rough v1 analog of the v2 StyleProfile) is unmentioned in spec §6, but **§19
  routes `PreferenceSummary.ts` for deletion** (no v2 reader). Resolved: **dropped, not mined** — empty
  migration target (D3, no real users), and the v2 successor (StyleProfile §6.2) is board/routine-derived,
  not a free-text blob, so the shape doesn't carry forward. No M4 migration; drop under the M5/M6 license.
- **OQ4 (RESOLVED S6 §11.2; confirmed S4 §9.5):** the **authenticity-gate M4/M5 split** — M4 does
  existence+ownership + content-key (`baseKey`/`fullSignature`) binding; M5 adds `{snapshotId,candidateId}`
  binding + the outfit-membership ("actually shown") check (reads the S3-fixed H19 home). M4 defines the
  *full* contract (spec §16). **Split CONFIRMED holding** — no live route for M4 to attack; the membership
  semantic is the runtime gate.
- **OQ5 (RESOLVED S7 §12.1 → canonical table spec §15.2):** the **`engineVisible` adapter-mapping gap.** §15.1
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

**The line (as drawn at S2 — SUPERSEDED for M4a by §14).** S2 scoped M4 as "persisted schema +
migration/classifier + cross-language **contracts** + the **writer contract**, all over fixtures; M5 = live
wiring + deploy + runtime gates." **The §14 scope expansion broke that for the data path:** M4a (C1–C3)
rebuilds live ingestion, wipes real (dev) Mongo, and rips the live `/account` + `/dashboard` UI. The
"never touches a live route / fixtures-only" framing now holds **only for M4b (C4–C8)** — the snapshot
substrate. Read every "fixtures-only / no live route" assertion below as M4b-scoped.

**Writer-contract precision (the subtle part — do not blur it).** M4 does **not** implement live route
wiring, but M4 **does own the writer contract.** That means M4 must define: required payload shape
(Python→TS), required vs nullable/staged fields, validation rules, indexes, example documents, trainability
rules, and the **M5 writer acceptance criteria** (the full D2 10-deliverable list, §2-D2). M5 only *executes*
that contract against the live route + does the live snapshot write.

| Bucket | Items |
|---|---|
| **IN — M4 owns** | `clothingType`→5 + backfill (fixtures); action-enum +`planned/packed/corrected`; `wardrobeVersion` **field** (storage only); `baseKey`/`fullSignature` **fields** on interaction rows; affinity **posture** (§7.3); GenerationSnapshot **schema + writer contract** (§15.1 / D2's 10 deliverables); feedback-authenticity **contract** (full contract defined; **gate functions deferred to M5 per §14 C7** — M4 adds only the binding fields); H37 scope-vocab **field**; H19 shown-history **home fixed to GenerationSnapshot** plus S4 window/cap contract; H43 redaction **seam** |
| **OUT → M5** | the **live** snapshot write + route wiring; `{snapshotId,candidateId}` binding; outfit-**membership** (actually-shown) check; request-adapter normalization; two-stage cache; `USE_ML_SHORTLISTER` cutover; `generationIndex` (H7); daily-reseed `date` (H8) |
| **OUT → other tracks** | `wardrobeVersion` **bump trigger** / activation transition (H6 → **W-track**); StyleProfile compiler + `dormant` board status (**B-track**); signed `behavioralStrength` + trained scorer (**M6**); H37 anomaly-scoping **behavior** (`[STAGED]`) |
| **DECIDED in M4, acted later** | affinity materialize-vs-live placement (OQ2 residue, S7 — deletion under M5/M6 license). *(`PreferenceSummary` moved from "acted later" to **deleted in M4** — §14 decision #3 / C3.)* |

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

**Residue (materialize-vs-live):** ✅ RESOLVED S7 §12.3 — compute-live, no `ItemAffinity.ts` in M4.

### 7.4 Session weights + the critical path

Critical path **S3 → S4 → S6** (the authenticity membership check reads shown-history → its home is decided
in S4 → its richest form is the S3 snapshot). **S5 is the one detachable light island** (additive backfill;
no cluster dependency; may sequence first).

| S | Weight | Sequencing / why |
|---|---|---|
| **S3** | **HEAVY** (may spill to 2) | the gravity well: the foreclosure + writer contract (10 deliverables) + OQ1 payload revalidation + H19's richest form + Fable review |
| **S4** | **MEDIUM-HEAVY** | runs **after/with S3**; `baseKey`/`fullSig` fields are additive (light), but the bind-to-exact-shown-outfit de-orphan loop + H19 home is real. Trap-guard F: don't reopen the §7 key format |
| **S5** | **LIGHT — ✅ CLOSED §10** | classifier fallback (default-to-top, §10.2) + the two-site reconciliation (§10.1) + dry-run/report; off the critical path; no affinity collection (§7.3) |
| **S6** | **MEDIUM — ✅ CLOSED §11** | full authenticity contract consolidated + H11 read-time-reducer dedup + action-enum +3 + H37 split scope field; no foreclosure, reversible → no Fable review (§11) |
| **S7** | **MEDIUM — ✅ CLOSED §12** | reconcile: OQ5 mapping → spec §15.2, OQ3 drop, OQ2/sequencing confirm; no Fable (reversible once §15.1 read) |
| **S8** | **MEDIUM** | adversarial falsification — distinct muscle; depends on all prior design |
| **S9** | **MEDIUM** | the C1–Cn implementation ladder |
| **S10** | **LIGHT–MEDIUM** | content-alignment audit |
| **S11** | **LIGHT** | documentation-consistency freeze (§6) |

**S8–S11 disposition — see the §13 consolidation pass.** S10 (alignment) + S11 (design-freeze) were run as
one consolidation pass (§13.1/§13.2); S8's runtime scenarios are routed to M5 (§13.3 — no live route in M4)
and its classifier-fixture surface folds into the S9 pytest ladder; the S9 C1–Cn implementation ladder
emerges as the additive/reversible M4 code is written. The next M4 session writes code, not plans.

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

The **one-way door** (§0/§7.2): the GenerationSnapshot schema + identity binding. Designed, dual-reviewed
(Codex impl + substitute-Fable arch — the CLAUDE.md dual-read), and narrow-second-pass-confirmed against
source, 2026-06-25. Per D1 the **canonical contract lives in spec §15.1**; this section holds the design
derivation, the Mongoose proposal (§8.3) + index plan (§8.8) §15.1 points back to, and the S9 implementation
obligations (§8.11). **§15.1 wins on any disagreement** — fix on sight.

> **S3 verdict: CLOSED — schema + writer-contract design locked; nothing built.** The dual review found, and
> the fold corrected, two corpus-foreclosure traps: (a) a **flat item-copy** falsifies provenance → the C+D
> `engineVisible`/`evidence` split (§8.2-D); (b) only **one of three** substrate signal-discard sites was
> named → the three-site funnel-capture obligation via additive trace siblings (Option B, §8.4). The narrow
> second pass confirmed all four shape-changing items against source. Implementation waits on S9/M5 (§8.11).

### 8.1 Snapshot purpose, granularity, authorship

**One GenerationSnapshot = one rendered response** (canonical: §15.1) — immutable training truth (§15/§21)
and the binding target for feedback (§16): resolved Lens inputs, component provenance, an immutable
feature-copy of every participating item, the full candidate funnel (generated→validated→rejected→ranked→
shown) with continuous scores + dispositions, and the shown set with positions.

- **Granularity — one snapshot per render (per `generationIndex`), not per candidate-cache pass.** Re-rolls
  share the expensive candidate stage but re-run Steps 4–6 and show a **different ordered set**; what the
  user *saw* is per-render (exposure-bias §21 + feedback binding). Each render writes its **own write-once**
  snapshot (siblings share a `candidateCacheKey`); appending render-events to a shared mutable doc would break
  immutability and invite the H11 append race. The candidate-stage duplication is provably cheap (§8.6); a
  `candidatePoolRef` dedup is a deferred, evidence-gated optimization.
- **Immutable after insert** — feedback writes `OutfitInteraction` rows that *reference* it; the only
  post-insert write is the H43 redaction seam (§8.2-K), which **MAY null PII-bearing fields** (per
  spec §15.1) while preserving keys/scores/`itemSnapshots`. No content rewriting outside that seam.
- **Authorship split (the C+D hybrid, §8.4):** Python produces everything the pipeline computes (keys,
  scores, candidate identity + dispositions, shown set, diagnostics — the §7/H15 drift-hazard content TS must
  not recompute) **and** the `itemSnapshot.engineVisible` projection; **TS** adds `itemSnapshot.evidence` and
  **persists the merged doc verbatim** via `GenerationSnapshot.ts`. **No post-Python refetch** — both layers
  derive from the single captured request context (a refetch could snapshot a mutated doc).
- **Id authorship (pinned):** `snapshotId` is **TS-issued, pre-allocated before the browser response** (so
  each shown variant carries `(snapshotId, candidateId)`); `candidateId` is **Python-issued** over the
  deterministic funnel order. M5 joins `snapshotId` onto Python's payload + clientResponse before persist.
- **M4 owns** (contract, not wiring): schema/subdoc shapes/enums/indexes/required-vs-nullable, the provenance
  boundary (§8.2-D), the content-preservation invariant (§8.2-F), the full-funnel capture obligation (§8.4),
  the client-echo contract, validation/trainability rules, the Python payload dataclass contract, and the M5
  writer acceptance criteria (the D2 10 deliverables, §2). **M5 implements** the live route/insert, the
  additive trace surface, the `{snapshotId,candidateId}` binding, and the membership check (OQ4 holds — §8.7/
  §9.5). The surfaced `OutfitVariant`s (§6.5) are the `shown` candidates; the server re-reads snapshot
  content on feedback, never trusts the echo.

### 8.2 Schema field groups (derivation; canonical contract = §15.1)

> Canonical field contract = spec **§15.1**; Mongoose shape = **§8.3**. Below is the design derivation +
> per-group load-bearing rationale, anchors kept for cross-refs. **§15.1 wins on disagreement** — fix on
> sight. camelCase = wire/Mongo (Python mirror snake_case, §8.4; `?` = nullable); owner field is **`user`**,
> not `userId`.

**A — identity:** `_id`(snapshotId, TS-preallocated, §8.1), `schemaVersion`(=1, the additive-evolution lever),
`user`, `sessionId`(=user id, Finding E), `candidateCacheKey`(groups re-roll siblings), `generationIndex`
(re-roll lever, H7), `requestId?`(**the future render-idempotency key once H7 closes** — the unique-insert
guard rides this, not `generationIndex`, §8.8), `createdAt`.

**B — request context (the Lens, §6.3):** `intent`(enum), `occasion`(verbatim), `weather`(bucket) +
`weatherRaw?`/`location?`, `constraints`(flexible `Map`, additive H36), `forcedItemId?`/`baseOutfitItemIds?`/
`routineId?`, `lens?{styleProfileId?,styleProfileVersion?,boardId?,confidence?,styleProfileSnapshot?}`,
`wardrobeVersion`(**field only**; bump=W-track/H6), `interactionCountAtRequest`(H9), `seedDate?`(H8). **The
`lens.styleProfileSnapshot?` embed seam (§6.2):** a bare `styleProfileId`/`version` ref re-creates the H10
disease if a board-version doc is later cascaded away, so the schema embeds the compiled profile (Mixed, null
until B-track), not just points at it.

**C — version / provenance — REQUIRED, non-null on every live write** (nullable provenance ⇒ unrecoverable
provenance; the backstop for the engine-vs-evidence boundary): `fittedCoreVersion`, `generator{provider,model,
temperature,promptVersion}`, `rankerConfigVersion`(a hash of the Appendix B constants), `scorer{kind:
cold_start|trained, modelId?, available}`. `promptVersion` also decodes the generator-visible subset of
`engineVisible`, so no separate `generatorVisible` store at `[NOW]`. **None of the three version constants
exist in `fitted_core` today** (absent from `__init__.py`/`config.py`) → add before the first live write (S9
ob. 1).

**D — item feature snapshots (`itemSnapshots[]`, the H10/H25 core) — the C+D provenance split (the
one-way-door correction).** A **flat verbatim copy** of the deployed item doc is **REJECTED**: a future M6
trainer can't distinguish "the engine conditioned on this" from "TS kept it for audit," so it would build
features the recommendation never saw (e.g. `pattern`/`seasons`) and do contaminated off-policy correction —
an irreversible corpus foreclosure (flat docs get written all through M5). Fix: **two namespaced buckets**
(the bucket *is* the ranking-visibility marker; no per-field bool). Per `ItemSnapshot`:
- `itemId: string` (**not** a populatable `ObjectId` ref — H10: nothing may re-hydrate a mutated live item).
- **`engineVisible`** — the **exact** `fitted_core.WardrobeItem` projection sent to Python (`name`,
  `clothingType`, `warmth`, `styleTags`/`colorTags`/`occasionTags`, `material`, `formality`, `imageUrl`) —
  the **only** ranking-visible layer, **true by construction** (stored == sent, *modulo* the documented
  snake↔camel rename `style_tags`/`color_tags`/`occasion_tags`, a bijection with no value transform).
- **`evidence`** — storage-only deployed fields the engine **never saw**: `category`, `subCategory`,
  `pattern`, `seasons`, `isAvailable`/`isFavorite`/`lastWornAt` (orphan/H21 signals, not yet engine-scored),
  `brand`, `fit`, `size`, `layerRole`, `tags`, `rawAttributes?`(bounded; no blob, §8.6), and
  `image?{imageRef?,imageVersion?,hash?}` — **refs/hash only, never the blob** (H29(c); guards H14). Image
  hash/version is a **W-track dependency** (`WardrobeImage` has none today).
- `generatorVisible?` — reserved (the `promptVersion`-decodable subset of `engineVisible` at `[NOW]`; H33
  vision generator). `embeddingRef?`/`visualFeatureRef?` — **reserved nullable** (H25; shape **NOT** locked —
  a bare-string lock is itself a foreclosure; deferred to the first writer).

**Trainability rule:** any model of what the recommendation *conditioned on* trains **only** from
`engineVisible` + the per-candidate `scoreTrace`/identity fields; `evidence`/`embeddingRef` are new-capacity
inputs that change the off-policy assumptions. Moving a field `evidence`→`engineVisible` requires a
`schemaVersion` bump.

**E — generation attempts (`generationAttempts[]`):** root/attempt-level events (invalid JSON, malformed
root, the §12 repair retry, aggregate warnings, raw-generation metadata) that **must not be forced into fake
candidates**. Per-attempt fields (`attemptId`/`attemptIndex`/`isRepair`/`parseIssue?`/`rootRejectionCode?`/
`aggregateWarningCodes`/`payloadParsed`/`candidateCountEmitted` + bounded `rawText*`, §8.6) in §8.3;
candidates link back via `sourceAttemptId`.

**F — candidate pool (`candidates[]`, one array over generated→validated→ranked→shown; H29(b) — rejected +
low-ranked must survive).** `candidateId` = **Python-issued, unique within the snapshot**, a deterministic
ordinal over the fully-traced funnel; `dropStage?`/`dropReason?` are **open, append-only code sets** (not
hard enums, so a future reason isn't a write-rejection foreclosure). Per-candidate fields (`stageReached`/
`accepted`/`shown`/`shownPosition?`/`sourceAttemptId`/`sourceIndex?`/rejection+warning codes/content
`items`+`slotMap`+`baseKey?`/`fullSignature?`/`optionPath?`/`risk?`/`styleMove?`/`rawEmitted?`/`scoreTrace?`)
in §8.3.

> **Content-preservation invariant (REQUIRED).** Every **generated, non-accepted** candidate MUST carry
> `{items+slotMap}` (reconstructed by `sourceIndex` from the attempt's parsed `outfits[]`) **or** `rawEmitted`
> — a bare `{candidateId, rejectionCodes}` is **invalid**: it loses the negative training signal, because
> `Issue` carries only `code`/`candidate_index`/`detail`, **never the rejected outfit's content**
> (`validator.py:60`). Snapshot-building must retain the parsed `outfits[]` beside the issues.

**G — scores & diagnostics.** Per-candidate `scoreTrace` is **continuous (never just the 3-way buckets) and
populated for every *scored* candidate, including scored-but-unshown** (H29(a); funnel sites #2/#3, §8.4):
`compatibility?`/`visibility?`([0,1] cold-start, the M6 seam), `rankerScore?`, signed
`scoreBreakdown?{base,combo,item,dislike,overuse,repetition,cooldown}` (N4), `signalScore?`(reserved, M6).
Request-level `diagnostics` carries the per-type `TypeSampleResult` (M6 eligibility, H9), the SamplerResult/
RankerResult/RescueResult/parse flags, and rejection/warning histograms (fields in §8.3).

**H — shown history (H19's queryable home).** Denormalized `shownCandidateIds`/`shownFullSignatures`/
`nSurfaced`/`spreadCollapsed` so the repetition-window query never unwinds `candidates[]`. `shownBaseKeys`
**dropped at S4** (§9.4: no `[NOW]` consumer; derivable from `shownCandidateIds` + `candidates[].baseKey`).
The snapshot is the raw source for the ranker's `shown_full_signatures` window (`ranker.py:191`); **S4 owns
the window/cap in the M5 reducer** (§8.8/§9.3).

**I — visual / reference preservation.** Folded into `engineVisible`/`evidence.image` + reserved nullable
`embeddingRef`/`visualFeatureRef` (§8.2-D); refs/hashes only, **never blobs**; the H25 extension seam.

**J — feedback binding support** (contract; **finalized at S4 §9.1/§9.2**). OutfitInteraction gets four
nullable binding fields (`snapshotId`/`candidateId`/`baseKey`/`fullSignature`, server-re-read,
all-present-or-all-absent); `shownPosition`/`generationIndex` are **derived from the snapshot, not
row-stored**. Client echoes `{snapshotId,candidateId}` **only**; the server re-reads the candidate and
**server-sets** `items[]`/keys, validating optional `perItemFeedback.itemId` ⊆ the candidate's items. Gate
(impl split §9.5): exists ∧ owned ∧ membership (`candidateId ∈ shownCandidateIds`) ∧ items⊆candidate.

**K — redaction seam (H43, D4; behavior `[STAGED]`).** Reserve `redacted`(default false)/`redactedAt?`/
`redactionReason?` (lineage, posture rule 3); M4 does **not** wire the `User` cascade (`User.ts:24` covers
only `wardrobeitems`+`outfitinteractions`). A rebuildable-projection affinity (OQ2) rebuilds clean after
redaction (D4/D6). **Recorded privacy-milestone intent:** the snapshot's user-context PII (`occasion`,
`location`, `weatherRaw`, `rawText`/`rawEmitted`) is structurally separable from training signal — redaction
MAY null those while preserving keys/scores/`itemSnapshots`, the designed exit for the
immutable-truth-vs-erasure tension.

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
  nSurfaced:Number, spreadCollapsed:Boolean,                                    // shownBaseKeys NOT stored — derive from shownCandidateIds+candidates[].baseKey (§9.4 / spec §15.1)
  redacted:Boolean (default false), redactedAt?:Date, redactionReason?:String
}  with { timestamps:true }
```

- **Immutability:** document write-once + a `pre(['updateOne','findOneAndUpdate','save'])` guard allowing
  mutation **only** of the redaction fields (acceptance test asserts a non-redaction update is rejected).
- **Raw-field caps:** `rawText`/`rawEmitted`/`rawAttributes` governed by a byte cap + hash + truncation flag
  + a no-image/base64/blob rule (§8.6) — the 120 KB bound is only defensible with these.
- **Cross-model gaps (routed):** `clothingType` enum → S5 (CLOSED §10); `OutfitInteraction` binding fields →
  S4 (CLOSED §9); `db.ts` `GenerationSnapshot` registration → M5 (live wiring; S7 did not absorb). Indexes: §8.8.

### 8.4 Python payload contract + the three-site funnel obligation

- **Producer:** a frozen `GenerationSnapshotPayload` dataclass (future `fitted_core/snapshot.py`; contracted
  now, built at impl). Fields = §8.2-A/B/C/E/F/G + each item's `engineVisible` (snake_case); `evidence` is
  TS's, not Python's.
- **C+D authorship (§8.2-D):** TS builds `itemSnapshots` from the single captured context **before** the
  Python call (no refetch), sends Python the exact `engineVisible` projection, and stores that same
  projection — "the engine saw it" true by construction. Python owns + returns keys/scores/dispositions/
  `candidateId`, so the §7/H15 no-drift guarantee holds; `fitted_core.WardrobeItem` is confirmed lossy
  (`models.py:106`). The request carries only the projection Python already needs.
- **The full-funnel capture obligation — THREE substrate discard sites, not one.** All three must reach the
  snapshot via an **additive, read-only** trace surface that does **not** reopen the closed
  `rescue()`/`rank()`/`build_variants()` contracts:
  1. **`rescue()`** (`rescue.py:653/656/676`) drops `rejections`/`warnings` + the raw/parsed payload → the
     rejected pool + attempt trace (H29(b)).
  2. **`rank()`** returns top-k only (`ranker.py:140`); the scored-but-unshown `_ScoredCandidate`s + their
     `ScoreBreakdown`s die → the H29(a) selection bias.
  3. **`build_variants()`** returns selected only (`response.py:559`); non-selected variants'
     `compatibility`/`visibility` die.

  **Mechanism — LOCKED: Option B (additive sibling trace APIs), NOT a return-shape change.** The closed
  `rescue()`/`rank()`/`build_variants()`/`validate_gpt_payload()` stay **byte-stable**; new `*_with_trace`/
  `*_with_audit` siblings return the richer payload and the existing functions become **thin projections** of
  them (Option A — editing a frozen return shape — rejected: it reopens the closed contract). Exact
  decomposition + tests = **S9/M5** (§8.11 ob. 2; acceptance: every closed signature + its M0–M3/Spearhead
  tests unchanged). Without all three, every M5 snapshot has continuous scores only for *shown* outfits — a
  permanently selection-biased corpus.
- **Maps from `fitted_core`:** SamplerResult / ValidationResult(+ parsed `outfits[]`) / `keys.py` /
  RankerResult + breakdowns / `response.OutfitVariant` / RescueResult / OpenAIGenerator → the diagnostics/
  funnel/keys/scores/shown/provenance fields (detailed mapping = S9). Also new at impl: the Python-issued
  `candidateId`, the three required version constants (§8.2-C), `interactionCountAtRequest`.
- **Case + id boundary (pinned):** Python snake_case → serializer camelCase, **finite floats only** (no
  `NaN`/`Infinity`), no `undefined`; item/candidate ids cross as **opaque strings** (no `ref`/`populate`,
  H10); `user` stored as `ObjectId`.

### 8.5 — (folded into 8.4)

### 8.6 OQ1 — payload-size revalidation (RESOLVED-provisional)

Worst case ≈ **120 KB** (item snapshots ≤135×~500 B + validated candidates ≤40×~700 B + rejected pool/raw +
context/provenance/shown) — **<1% of Mongo's 16 MB**; a typical rescue is single-digit KB. **The bound is
only defensible WITH raw-payload caps** (byte cap + hash + truncation flag + no-image/base64/blob on every
raw field — else verbatim raw/CV blobs break it). **Verdict: TS-write-verbatim HOLDS**, conditioned on (a)
those caps and (b) **server/client separation** — the service returns **two top-level objects**:
`clientResponse` (shown variants + `(snapshotId,candidateId)` as the only feedback identity) and a
server-only `snapshot` (full funnel + keys; never reaches the client). Next mints `snapshotId` up front
(§8.1), joins it onto both, forwards `clientResponse`, merges + persists the `snapshot`. Size never forces a
Python-direct write. **Status: PROVISIONAL** → final lock at the **S9** BSON-size guard test (§8.9/§8.11 ob. 4).

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

### 8.9 Tests needed (S9 ladder)

The S3 test plan; the implementation checkpoints are the §8.11 S9 obligations. Categories: **schema/validation
(jest)** — required-field rejection (incl. the three version fields), enum + open-code-set validation
(`dropStage`/`dropReason` against a documented list), immutability (non-redaction update rejected),
`candidateId` uniqueness within a snapshot, the **content-preservation invariant**, rejected-candidate +
continuous-`scoreTrace`(incl. unshown) persistence, `itemId`-as-string, bounded raw payload, declared indexes
+ the **non-unique** cache-key index; **membership (jest)** — accepts a shown candidate, rejects an unshown/
rejected candidate, rejects a wrong-user caller; **cross-language (pytest)** — serialization round-trip
(snake↔camel, ids as strings, ObjectId boundary, finite-floats-only), H19 query viability; **substrate
(pytest)** — the builder maps every funnel disposition (a fixture with accepted + rejected + rescue-dropped +
ranker-dropped + non-selected-variant + shown proves all three discard sites), `engineVisible` == the exact
projection sent, raw-GPT trace persistence (never fake candidates), H10 edit/delete-doesn't-alter-meaning,
graceful-degradation semantics, visual-ref-without-blob, and the OQ1 BSON-size guard.

### 8.10 S3 verdict — CLOSED 2026-06-25

> **S3 CLOSED — schema + writer-contract design locked; nothing built.** The narrow second pass confirmed
> all four shape-changing required items against source (`rescue.py:653/656/676`; `ranker.py:140`/`:380`;
> `response.py:559`/`:571-576`; `validator.py:60`; `models.py:106`; spec §6.2; version-constant absence in
> `__init__.py`/`config.py`/`generation.py`). Implementation waits on the S9/M5 checkpoints (§8.11).

- **CONFIRMED against source:** (1) provenance authorship — `engineVisible` == the exact projection sent, the
  `engineVisible`/`evidence` boundary disjoint, the trainability rule survives; (2) three-site funnel capture
  — all three sites line-verified, mechanism LOCKED to Option B (§8.4); (3) content-preservation invariant —
  `Issue` carries no content (`validator.py:60`), so snapshot-building retains the parsed `outfits[]`; (4)
  `lens.styleProfileSnapshot` seam — present, Mixed, null-until-B-track (§6.2).
- **OQ1:** TS-write SURVIVED but PROVISIONAL (~120 KB, conditioned on raw caps + server/client separation,
  §8.6); BSON-size guard → S9.
- **Consumed downstream:** S4 took the binding + the H19 window/cap (§9); S6 took the membership check + the
  OQ4 split (§11). **§15.1 spec text: LANDED.**

### 8.11 Dual-review outcome + S9 implementation obligations

The S3 design was reconciled against two convergent adversarial reviews (Codex impl + substitute-Fable arch —
the CLAUDE.md dual-read substitute). **What the review changed** (all folded into §8.2/§8.4/§15.1): the C+D
provenance split (flat item-copy → `engineVisible`/`evidence`); the three-site funnel obligation + Option B
trace siblings; `generationAttempts[]` for root/attempt events (not fake candidates); the
content-preservation invariant; required non-null version fields; pinned id authorship (snapshotId
TS-preallocated / candidateId Python-issued); the `lens.styleProfileSnapshot` embed seam; the **non-unique**
cache-key index (H7-deferred); TS-write-survives-only-with raw caps + server/client split; `dropStage`/
`dropReason` softened to open code sets; `shownBaseKeys` dropped (→S4 §9.4). **Rejected traps:** a flat
item-copy (provenance foreclosure); a per-field provenance bool (the two-bucket boundary suffices); editing
the closed return shapes for the trace (→ Option B siblings); locking the `embeddingRef` shape now (deferred
to first writer). All shape-changing items were confirmed against source in the narrow second pass (verdict
§8.10; the confirmation-prompt is retired — its content is folded here + §8.10).

#### S9 obligations (implementation-ladder checkpoints, NOT S3 blockers)

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

## 10. Session 5 outputs — `clothingType`→5 + the canonical classification rule (CLOSED 2026-06-25; reframed by §14)

> **Reframed by §14 (2026-06-26):** the DB wipe + the W-track data-path pull-forward (CV now writes
> `clothingType` natively at upload) **deletes the backfill** as a separate workstream. The §10.3
> classification rule below survives — same rule, different consumer — as the **ingestion classifier**
> (used by CV's keyword fallback when a row arrives without a confidently-classified type) and as a
> **fixture-mode tool** for the rebuilt ingestion's tests. §10.1's two-divergent-classifier diagnosis
> stays as a trap-guard (don't reintroduce divergent string-match sites). §10.6's S9-obligations are
> superseded by the §14 C-ladder.

S5 was the **detachable light island** (§7.4): additive, reversible, off the S3→S4→S6 critical path. No
one-way door → **no Fable review** (the classifier fallback is re-runnable forward-design, §7.2/D3); decision
basis = a first-principles read of the two deployed string-match sites against the closed substrate's 5-value
`ItemType`. Canonical decision single-homed into spec **§6.1**; this section holds the classification
mechanics + the two-site divergence trap-guard.

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
There are **two distinct classifier shapes** (`byCategory` shortlist + `inferItemType`), and they diverge
materially — **and each shape is copy-pasted into *both* route files**, so there are **four request-time
instances** in all (`recommend/route.ts` shown; the regen duplicates are the note below):

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

**Four instances, two files (handoff note — verified 2026-06-25).** Both shapes are duplicated in the regen
route: `byCategory` at `regenerate/route.ts:217` (one-piece `:234`) and `inferItemType` at `:551` (one-piece
`:557`, `unknown` fallback `:575`) — the same two shapes as recommend's `byCategory`(`:223`)/`inferItemType`(`:543`).
Spec §19's deletion table already lists **both** files' grep paths (`route.ts:241,550`, `regenerate :234,557`).
The canonical classifier (§10.3) replaces the *derivation*; the four request-time copies are removed at the
**M5 cutover** (recommend rewritten to read `clothingType`; regenerate deleted wholesale per R9 — §19). **S9
owns verifying all four are gone, across both route files** (§10.6 ob. 2a) — not only `recommend/route.ts`.

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
| 2 | `bottom` | `category∈{bottom,bottoms}` · `{pants, sweatpants, joggers, snowpants, jeggings, jeans, shorts, skirt, trousers, chinos, leggings}` |
| 3 | `shoes` | `category=="footwear"` · `{shoes, sneakers, boots, sandals, loafers, heels, flats}` |
| 4 | `outer_layer` | **`layerRole=="outer"`** · `{jacket, coat, raincoat, trenchcoat, blazer, parka, puffer, windbreaker, trench, overcoat}` |
| 5 | `top` | `category∈{top,tops}` · `{shirt, tee, t-shirt, blouse, polo, tank, sweater, henley, button-down, oxford}` + the mid-collapse knits `{cardigan, hoodie, fleece, vest}` |
| 6 | **default → `top`** | none matched → `top`, **listed in the report** (§10.2) |

**The `mid_layer` collapse (the in-ontology decision the divergence forced):** cardigan/hoodie/sweater/fleece/
vest have no v2 type. Rule: **explicit `layerRole=="outer"` wins** (row 4 short-circuits → `outer_layer`);
otherwise the knit collapses to **`top`** (row 5 lists them by name) — a knit worn as the only upper layer is
a valid base top, and `outer_layer` is an *optional* slot, so a misfiled true-outer still yields valid
outfits. This is a deterministic classification rule, not a "fallback."

**Trap-guard — the bare `dress` keyword (row 1) must exclude ADJECTIVAL "dress".** "dress" is both a
one-piece HEAD noun ("wrap dress", "shirt dress") and a common MODIFIER ("dress shoes", "dress shirt",
"dress pants"). A naïve whole-word `dress` match mis-partitions the **"Dress Shoes"** footwear subcategory
(a real upload-form option) as a one-piece. The principle is the **head-noun-last rule of English compounds**:
"dress X" is an X; "X dress" is a dress. The classifier matches `dress`/`dresses` as a one-piece only when it
is **not immediately followed by a garment noun**; a head-noun or standalone "dress" — including a
miscategorized "wrap dress" — still classifies as `dress` (preserving "name beats a coarse category").
`jumpsuit`/`romper`/`sundress`/`gown`/`frock` are never adjectival → matched unconditionally (the closed
compound `sundress` also dodges the `\bdress\b` boundary, like the bottoms rung's `sweatpants`). **Do not
"simplify" this back toward a category-authoritative or cascade-reorder rule** — both regress real one-pieces
("shirt dress"/"sweater dress" → top). The modifier noun set is **derived from the rung keyword arrays**
(`SHOE_KEYWORDS`/`BOTTOM_KEYWORDS`/`OUTER_KEYWORDS`) so it cannot drift out of sync; a drift-guard test
(`deriveWarmth.test.ts`) iterates those arrays asserting `"dress <rung-noun>" ≠ dress`. (`lib/clothingType.ts`
`ADJECTIVAL_DRESS`.)

**Trap-guard — re-derive from raw, never trust the stored `clothingType`.** `WardrobeItem.ts:7` defaults
**every** existing row to `"top"`, so a stored `"top"` is the schema default, not evidence. The classifier
re-derives purely from raw `category`/`name`/`subCategory`/`layerRole`; the only legacy non-default value
possible (`"bottom"`, the sole other enum member) is consistent with re-derivation anyway. This makes the
backfill **idempotent** (pure function of raw → same output on re-run) and **raw-preserving** (never writes
over `category`/`name`/`subCategory`). The dry-run/report/verify mode (D3) emits per-bucket counts + the
default-branch row list so the output is inspectable on fixtures.

**Home: TS** — the classifier writes the `WardrobeItem.clothingType` Mongoose field, so it lives in the Next
backfill (and is the legacy fallback the W-track ingestion reuses); **Python never classifies** — the
substrate consumes the already-typed `type` field. Test home + the no-drift argument: §10.6 ob. 2.

### 10.4 Additive field-adds (deliverable 3)

- **`wardrobeVersion`** — persisted **field only**, home = **`User.wardrobeVersion: int` (default 0,
  monotonic)** (a per-user active-wardrobe counter; `User.ts` has none today). **Anchored canonically in spec
  §6.3** (data-model), not only here/H6. The snapshot reads it at request time (§15.1); the M5 adapter
  supplies it to the Lens (§6.3). **The bump trigger / activation transition stays W-track/H6** — S5 must not
  be mistaken for naming it (§7.5-F). **Missing-user rule (S9):** Mongoose `default:0` covers new users;
  pre-existing user docs lacking the field **coalesce missing → 0** (`user.wardrobeVersion ?? 0`) at the
  snapshot-write/adapter read — no separate backfill pass required (target effectively empty, D3), though a
  one-shot `$set:{wardrobeVersion:0}` is an acceptable equivalent.
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

### 10.6 S5 → implementation obligations — SUPERSEDED by §14 C-ladder

The §14 scope expansion folds these into the build ladder:

- The standalone backfill harness + dry-run/report (old obligations 2/3) is **deleted**: no rows to
  backfill (DB wipe). The §10.3 rule becomes the **ingestion classifier** (§6.1) under the rebuilt POST
  handler + CV→DB wiring.
- The four request-time grep sites (old obligation 2a) are flagged for the M5 cutover deletion arm (§19);
  M4 itself doesn't touch them — the legacy recommend/regenerate routes are surgically excised of
  `PreferenceSummary` only (§14).
- Enum extension (old obligation 1) + `wardrobeVersion` field + coalesce rule (old obligation 4) survive
  as discrete C-ladder checkpoints under §14.

### S5 verdict — CLOSED 2026-06-25

Reconciled with §15.1, the deployed `WardrobeItem`/`User`, the closed substrate's `ItemType`, and the spec
posture. One finding surfaced + resolved (the two-site classifier divergence → one canonical classifier); the
one hard decision locked (fallback = default-to-top); deliverables 2–3 designed; trap-guards honored (no
ItemAffinity, no key reopen, no wardrobeVersion bump, no action-enum); H6 field-add recorded. **S5 closes the
*design*; implementation is the §10.6 ladder + S9.** Next: **S6** ✅ CLOSED — see §11.

---

## 11. Session 6 outputs — feedback authenticity + the full authenticity contract (CLOSED 2026-06-25)

Signed off 2026-06-25. S6 is the LAST node of the S3→S4→S6 critical path (§7.4). **No one-way door** — the
H11 dedup rule is M5-reversible (the interaction log stays append-only, so any dedup rule re-derives by
re-projection), the authenticity contract's hard parts were fixed by S3/S4, and H37 is a field-only add with
`[STAGED]` behavior. So **no Fable review** (Brian signed off the no-review option; the one hard decision is
source-anchored and reversible — the dual-read substitute, parallel Codex+Claude sessions, was not needed for
a reversible non-foreclosure call). Canonical decisions are single-homed into the spec (§16 dedup rule + scope
vocab + promotion rule; §6.6 the additive fields; Appendix B `FEEDBACK_DEDUP_WINDOW`; §23 H11/H37/H24); this
section is the rationale home.

### 11.0 Inbound audit (open bookend) — clean, one doc-conflict found+fixed

No S1–S5 landing conflicts with S6's surface; two couplings actively *support* S6:
- **OQ2 (compute-live) ↔ H11:** an **enabler**, not a conflict. §7.3 already wrote the thesis — an
  incrementally-updated affinity collection "is a read-modify-write that can drift… A projection cannot
  drift." S6's read-time dedup is the direct continuation.
- **S4 binding ↔ dedup key:** §9.6 handed S6 "`{snapshotId,candidateId}` is the natural dup key… S4 defers
  the dedup/concurrency rule." Building the key on the S4 binding (+`action`) is consistent, not a reopen.
- **S4 co-presence invariant ↔ dedup:** bound rows are all-four-or-none, so a `{snapshotId,candidateId,action}`
  key selects exactly the authentic corpus; legacy rows (all-absent) sit outside it.
- **Conflict found + fixed (§16):** the spec said "**S6 hardens the promotion threshold**" — but S6 is a
  field-only session, and the *numeric* threshold needs scoped memory that isn't built. Reworded: S6 hardens
  the promotion **rule** (support-gated, monotonic, one-tap-never); the **numeric** threshold stays `[NEXT]`.
  §16 + §23-H24 updated.
- **Trap-guards honored:** §7/H30 key format not reopened (S6 consumes `baseKey`/`fullSignature` *values*);
  M0–M3 + S4 binding/H19 reducer not reopened; membership IMPLEMENTATION stays M5; no `ItemAffinity.ts`.

**Ground-truth re-confirmed against source:** `OutfitInteraction.ts:30` enum =
`["generated","accepted","rejected","saved","worn","rated"]`, route writes only `accepted`/`rejected`
(`interactions/route.ts:127,299`); the S4 binding fields are **absent** from `OutfitInteraction.ts` (designed
S4 §9.1, S9 implements); the live POST trusts client `itemIds` with no existence/ownership/membership check
**and no dedup at all** (`interactions/route.ts:118-163`); `item_affinity`/`liked_full_signatures` are
declared "pre-reduced signals … already windowed" (`ranker.py:188-190`) — the reducer that produces them is
the named dedup seam; `FeedbackReason` is a vocabulary (§16), not a model.

### 11.1 THE decision — H11 duplicate-feedback dedup rule (the headline)

**Promise served:** determinism/consistency — the same user behavior always yields the same affinity, and an
accidental double-tap/retry never corrupts it.

**Mechanics (first principles).** Affinity is never stored; the M5 adapter recomputes it each request by
folding append-only `OutfitInteraction` rows into the three signal shapes the ranker consumes (`ranker.py:188`):
`liked_full_signatures` (a **frozenset** — idempotent under duplication), the cooldown buffer (a bounded
**recency** window — idempotent), and `item_affinity` (a **scalar weight per item**, capped `MAX_AFFINITY=20` —
the **one** shape that double-counts if the reducer counts rows). So OQ2 already dissolves most of old-H11:
there is **no shared counter to race** (concurrent feedback = two independent appends), and two of the three
projections are duplication-proof. The entire residue: **a duplicate row inflates the one counted projection.**

**Why the naive fix is wrong twice.** A unique index on `{snapshotId,candidateId}` can't tell a `saved` from a
later `worn` (both legitimate) → the key needs **`action`**. And even `{snapshotId,candidateId,action}` as a
*hard unique index* repeats S3's §8.8 trap: a genuine **repeat-wear** ("wore it again Friday") shares the key
and would be **wrongly rejected**, flattening the rotation signal the dive most wants. Retry-vs-repeat is a
**time/idempotency** distinction, not a binding one.

**Decision (pinned):**
- **Mechanism = read-time reducer dedup**, write path **append-only** (every tap persisted with `createdAt`,
  posture rule 3; never rejects or upserts). Dedup lives in the compute-live reducer (the `ranker.py:188`
  seam). **Unique-index-reject / upsert-last-wins rejected** — they foreclose append-only events, repeat the
  §8.8 trap, flatten repeat-wears, and would *still* need the retry-vs-repeat discriminator (only at a place
  where a wrong key loses data permanently).
- **Key = `{snapshotId, candidateId, action}`** (`action` keeps `saved`/`worn`/`rated` distinct); applied
  only to the **counted** `item_affinity` (set/recency projections need no dedup), collapsing same-key rows
  within `FEEDBACK_DEDUP_WINDOW` (Appendix B; M5-tunable) — same-key rows outside it are distinct
  repeat-events and each count.
- **Concurrent writes: a non-problem by construction** (no read-modify-write; two POSTs append two rows, the
  next projection collapses them — OQ2's counter-race dissolution). **Distinct from backfill idempotency**
  (trivial, no live data).
- **Retry-vs-repeat discriminator → M5** (as S4 left H19's numbers to M5): M4 fixes the rule/key/read-time
  locus; M5 picks the form (client idempotency token = precise; bounded time-window = zero-client-contract
  fallback) + tunes it.

**Reversibility:** the log keeps every row, so any dedup rule re-derives by re-projection — the opposite of a
one-way door. Single-homed: spec §16 (rule) + Appendix B (`FEEDBACK_DEDUP_WINDOW`) + §23-H11 (status).

### 11.2 The full authenticity contract — consolidated (OQ4 split confirmed)

S3 (§8.10) and S4 (§9.5) already fixed the hard parts; S6 consolidates and confirms single-home — **no new
design**. The full contract (canonical home = spec §16 gate + §15.1 identity binding):

> **exists ∧ owned ∧ membership ∧ items⊆candidate**, bound via `{snapshotId,candidateId}`, with
> server-re-read keys/items (never the client echo).

- **OQ4 M4/M5 split — REVISED by §14 (gate functions → M5).** *S6 originally put the existence + ownership +
  content-key fixture functions in M4; the round-3 C7 trim moved them to M5 (building fixture-only stubs the
  live route rewrites is busy-work). M4 now keeps only the binding fields + the contract.* **M5** implements
  existence + ownership + content-key (`baseKey`/`fullSignature`) binding **plus** the live
  `{snapshotId,candidateId}` echo wiring + the **"actually-shown" membership**
  check (`candidateId ∈ shownCandidateIds`, the §15.1 H19 home) + `items⊆candidate` — the runtime anti-poison
  checks that only have meaning against an untrusted client over a live endpoint. Trap-guard honored: the
  membership IMPLEMENTATION is M5, not M4.
- **§19 reconcile:** the live `interactions/route.ts` POST is the gate's target — today it persists
  client-supplied `items`/`perItemFeedback.itemId` with **no existence/ownership/membership check**
  (`:118-163`, the §19 trust-boundary gate). The gate closes that at M5; M4 supplies the binding fields + the
  fixture-level existence/ownership/content-key functions the live gate will call. No spec change — §16 + §19
  already state it; S6 confirms consistency.
- **Single-home pass:** §16 *points* to §15.1 for the membership read mechanics (does not restate); §15.1
  "Identity binding" is the snapshot-side view; §6.6 holds the row fields. No duplication introduced.

### 11.3 Action-enum extension (`planned/packed/corrected`)

**Additive only** (posture rule 1) — existing actions (`generated/accepted/rejected/saved/worn/rated`) are
**never renamed or removed**. Target enum = the deployed six **+** `planned`, `packed`, `corrected`. Semantics
(§16): `saved`/`planned` = intent not wear; `worn` = wear; `rated` = explicit rating; `corrected` is the event
that **moves a `scopeTarget`** (interlocks with §11.4). The live route writes only `accepted`/`rejected` today;
M5 wires the new actions. **S9** extends the enum on `OutfitInteraction.ts` (jest: accepts the 3 new values,
rejects a non-member; no existing value removed). Single-homed: spec §6.6 (enum) + §16 (which actions teach).

### 11.4 H37 scope-vocab field — split `scopeTarget` + `learningDisposition`

**Decision: split** (not a single merged enum). Two additive nullable fields on `OutfitInteraction`:
- **`scopeTarget`** ∈ `outfit | board | routine | global | lens` — *where* the feedback attaches. `lens` is
  H37's new value and also carries H24's implicit/default-lens default (no separate value needed).
- **`learningDisposition`** ∈ `normal | exception | do_not_learn` — *how* it is treated. `exception` = the §16
  soft exception (weather-forced/laundry/travel/illness); `do_not_learn` = the "do not learn from this" early
  control.

**Why split (first principles).** "exception/anomaly" is a **disposition**, orthogonal to the **target** axis:
a weather-forced dislike is `scopeTarget=outfit` **and** `learningDisposition=exception`. A single merged enum
`{outfit,…,exception}` forces a false choice ("exception of what?") and would need the disposition axis added
later anyway → split-now is the additive-once choice (posture rule 1). Reconciles with H24 (extends its vocab;
the `lens` value is the default scope) and anti-capture §3 (promotion = a support-gated change of `scopeTarget`;
`learningDisposition=exception` quarantines without rewriting board/routine memory).

**Field additive only; behavior `[STAGED]`** — M4 reserves the fields; the anomaly-scoping/quarantine/promote
behavior is staged. **S9** adds the two nullable fields to `OutfitInteraction.ts`. Single-homed: spec §16
(vocab + semantics) + §6.6 (the fields). Resolves H37 (was OPEN→DEFERRED-M4).

### 11.5 Holes touched
- **H11** (dedup/concurrency): **RESOLVED-DESIGN (S6)** → PENDING-M5-IMPLEMENTATION (§11.1; spec §16/§23).
- **H37** (scope vocab): **RESOLVED-DESIGN (S6)** → PENDING-S9-IMPLEMENTATION — split chosen (§11.4; spec
  §16/§6.6/§23).
- **H24** (default scope): stays RESOLVED-HERE; updated to point at the `lens` `scopeTarget` value + the
  support-gated promotion **rule** (numeric threshold `[NEXT]`). No reopen.
- **No new hole.** The retry-vs-repeat window's *numeric* value (and token-vs-time form) is an M5 tuning
  detail under the resolved H11 rule + Appendix B `FEEDBACK_DEDUP_WINDOW`, not a register entry.

### 11.6 S6 → S9 implementation obligations (carry into the C1–Cn ladder)
Recorded so the planning→implementation handoff cannot lose them (as §8.11/§9.8/§10.6 do). All additive +
reversible; the live-route pieces are M5.
1. **Action-enum extension:** `OutfitInteraction.ts` enum += `planned/packed/corrected` (additive; no existing
   value removed). jest: accepts the 3 new values, rejects a non-member.
2. **Scope-vocab fields:** add nullable `scopeTarget` (enum `outfit/board/routine/global/lens`) +
   `learningDisposition` (enum `normal/exception/do_not_learn`) to `OutfitInteraction.ts`; behavior `[STAGED]`
   (no scoring reads them yet). jest: enum validation; both default to absent/null on legacy + `[NOW]` rows.
3. **Dedup reducer (M5):** the compute-live affinity projection dedups the **counted** `item_affinity` by
   `{snapshotId,candidateId,action}` within `FEEDBACK_DEDUP_WINDOW`; set/recency projections unchanged.
   Tests: a double-tap/retry within the window counts once; two genuine repeat-events outside it each count; a
   `saved`+`worn` on the same candidate are not collapsed; concurrent inserts both persist (append-only). M5
   picks token-vs-time + tunes the window (Appendix B).
4. **Authenticity gate (M4 part = §9.8 ob. 3; M5 part):** M4's existence/ownership/content-key functions over
   fixtures (already an S4 obligation); **M5** wires the live `{snapshotId,candidateId}` echo + the
   actually-shown membership + `items⊆candidate` on `interactions/route.ts`, closing the §19 trust gap.

### S6 verdict — CLOSED 2026-06-25
Reconciled with §16, §15.1, §6.6, the deployed `OutfitInteraction`/`interactions/route.ts`, the closed
substrate's pre-reduced signals (`ranker.py:188`), and the OQ2/S4 framing. One conflict found+fixed (§16
promotion-threshold→rule); the one hard decision locked (H11 read-time reducer dedup); the full authenticity
contract consolidated + OQ4 split confirmed; action-enum + H37 field designed (both additive, behavior
`[STAGED]`); trap-guards honored (no key reopen, no membership-impl pull-in, no `ItemAffinity.ts`). **S6 closes
the *design*; implementation is the §11.6 ladder + M5.** Next: **S7** ✅ CLOSED — see §12.

## 12. Session 7 outputs — reconcile with reality (CLOSED 2026-06-25)

Scoped deliberately small (last planning session): resolve the four S7 residues against verified source,
then go code-first. **No S3–S6 decision reopened.** Inbound source-verification (read firsthand, not from
summary): `fitted_core/models.py` (the `WardrobeItem` target), `fitted/models/WardrobeItem.ts` +
`PreferenceSummary.ts` (deployed), `response.py`/`config.py` (warmth bands), `cv-integration.md`, spec
§15.1/§15/§19.

### 12.1 OQ5 — deployed→`fitted_core` adapter mapping (the headline) — RESOLVED

> **SUPERSEDED by §14 (2026-06-26).** S7 assumed the warmth derivation lived in the M5 *adapter* and that
> `material`/`formality` came from CV `metadata`. The post-freeze audit corrected both: today's CV produces
> **none** of `warmth`/`material`/`formality`/`styleTags`. The fix moved warmth derivation to the **M4
> ingestion** path (written to a column, not adapter-derived at read), made the adapter a pure passthrough
> (spec §15.2), and left `material`/`formality`/`styleTags` reserved-but-empty until the W-track CV. The
> warmth *keyword-map mechanic* below survives — same map, relocated to ingestion (C2). Read the rest of
> §12.1 as the design rationale for that map, not for where it runs.

Canonical mapping table lives in spec **§15.2**. The warmth keyword-map mechanic (preserved): garment-type
keyword (`category`/`subCategory`/`name`) → band-center `{hot 2, mild 5, cold 8}`, `seasons` as a `±2`-on-the-
0–10-scale nudge (enough to carry a center into the adjacent band), unknown → mild; deterministic + total.
Both classifiers match **whole words** (`lib/keywordMatch`) so a keyword never matches a substring of a
larger word (`tee`∌`sateen`, `coat`∌`petticoat`); the implementations are `lib/deriveWarmth.ts` +
`lib/clothingType.ts` (S9/W-track-tunable). **Why it stayed a
cheap, non-Fable call:** the `engineVisible`/`evidence` split (§15.1) preserves the raw inputs
(`seasons`/`category`/`tags`/`rawAttributes`) verbatim, `engineVisible` is correct-by-construction for
off-policy training (records exactly what the engine saw, crude or not), the ranker needs only 3-band
resolution (`response.py` `_warmth_band`), and there's no live data — so the one-way-door property that would
justify a review is absent.

### 12.2 OQ3 — PreferenceSummary: DROP, do not mine — RESOLVED

Verified `PreferenceSummary.ts` = `{ text, feedbackCount, lastFeedbackAt }` per user. No v2 reader (§19
already routes it for deletion); D3 established the migration target is effectively empty (no real users) →
nothing to mine. The v2 successor (StyleProfile, §6.2) is board/routine-derived, not a free-text blob — so
even the *shape* doesn't carry forward. **No M4 migration**; dropped under the M5/M6 deletion license. OQ3
closed.

### 12.3 OQ2 residue + M4↔M5 sequencing + migrate-vs-delete — CONFIRMED

- **Affinity placement (OQ2 residue):** compute-live confirmed; **no `fitted/models/ItemAffinity.ts` in
  M4** (§7.3). Materialize only later on measured request cost / an M6 feature-store need, *with evidence*.
  Not reopened.
- **M4↔M5 sequencing:** no ordering hazard. *(Post-§14 correction: "touches no live route / ships nothing
  runnable / sits dormant" is now true of **M4b** only — M4a's ingestion + PreferenceSummary changes ship
  live. Neither blocks M5: M4a is self-contained app changes, M4b is dormant substrate.)* M5 deploys the
  service, flips `USE_ML_SHORTLISTER`, and does the live snapshot write + adapter.
- **Migrate-vs-delete seams:** the deletion license is **M5/M6, not M4** (CLAUDE.md). M4 only *registers*
  what M5/M6 will delete: `PreferenceSummary` + the legacy preference-prose adapter (both in spec **§19**'s
  deletion table), and the four dresses string-match sites (§10.6 ob. 2a). No M4 deletions.

### S7 verdict — CLOSED 2026-06-25
The design is complete. OQ5 mapping table landed in spec §15.2 (warmth call resolved in-session, no Fable —
reversible/non-foreclosure once §15.1 is read); OQ3 dropped; OQ2 residue + sequencing + delete-seams
confirmed without reopening S3–S6. **All M4 *design* questions are now closed.** What remains is not
planning: the implementation ladder, **now consolidated into the §14 C1–C8 ladder** (which supersedes the
scattered §8.11 + §9.8 + §10.6 + §11.6 obligation lists; the §15.2 "warmth map" became C2's ingestion
derivation). **S8–S11 disposition → refined by the §13 consolidation pass**, then by the §14 scope
expansion. (M4b ships nothing runnable; M4a ships the live data-path changes — §14.)

## 13. Consolidation pass — S10 alignment + S11 design-freeze + S8-runtime routing (CLOSED 2026-06-25)

User-elected single consolidation pass in lieu of three standalone S8/S10/S11 sessions, after an
adversarial audit of this plan against the spec. Rationale: ~5/6 of S8 attacks *runtime* (the live route +
feedback path), which M4 doesn't have — those belong to M5; but S10 (alignment) and S11 (freeze) had real
residual value, proven immediately by the 3 defects this pass found+fixed (§13.5).

### 13.1 S10 — alignment cross-check (PASS)
M4 design coheres with:
- **Substrate (M0–M3):** `engineVisible` names match `fitted_core.WardrobeItem` (`models.py`); `warmth` is
  consumed by the §G weather penalty (`response.py` `_warmth_band`, 3-band); the compute-live affinity
  projection + H19 reducer feed exactly the pre-reduced `RankContext` signals (`ranker.py:188` —
  `item_affinity`/`liked_full_signatures`/`shown_full_signatures`, "never raw OutfitInteraction; already
  windowed"); `baseKey`/`fullSignature` ↔ `keys.py` `base_key`/`full_signature` (documented snake↔camel).
  No closed contract reopened.
- **Spec:** internal re-read — one substantive contradiction found+fixed (§13.5); remaining under-specs are
  by-design `[STAGED]`/`[NEXT]` (scoped-memory threshold §16; `learningDisposition` behavior; `[STAGED]`
  ontology §6.1; `embeddingRef` shape H25; `seedDate`/H8).
- **Spearhead:** the three-site funnel capture (§8.4) includes `rescue()` — the orphan-rescue trace is
  captured. Aligned.

### 13.2 S11 — design-freeze checklist (§6 items 1–5 PASS; item 6 deferred)
1. **Single-home ✓** — OQ5 table homed once in §15.2; this plan points.
2. **Cross-surface ✓** — spec §6/§15/§16/§20/§23 consistent; `docs/README.md` + `ml-system/README.md`
   correctly name M4 the active build target; `CLAUDE.md` still accurate (M4 = next active work).
3. **Naming ✓** — `GenerationSnapshot`/`baseKey`/`fullSignature`/`wardrobeVersion`/`clothingType` consistent
   across active surfaces. **`generation_logs` drift:** confined to the **retired+bannered**
   `m0-m1-substrate.md:68` (a stale forward-scope cell that also predates the no-`ItemAffinity` OQ2 call);
   **left per doc-lifecycle** (git is the archive; retired docs exempt; its banner already redirects
   forward-scope to the spec). All active surfaces are clean.
4. **Hole retirement ✓** — §23 verified for the 7 owned holes (H10/H11/H19/H29/H37 RESOLVED-DESIGN→
   PENDING-impl; H25 RESOLVED-HERE; H43 OPEN-by-design, seam reserved). H12 newly tracked (§13.3).
5. **Compaction — ⚠️ TRIPPED by the §14 expansion.** Spec is ~1257 (< 1500, fine). **This plan is now ~1700
   lines — over the 1,500 single-doc backstop** (CLAUDE.md). The overage is concentrated in the §1–§13 session
   bodies, much of which §14 now supersedes. **A compaction pass is due** — recommended after M4a lands
   (collapse the closed-design session detail to its trap-guards; §14 + the spec hold the live truth). Not a
   blocker for starting C1. (`FEEDBACK_DEDUP_WINDOW` stays a deliberately value-less Appendix B entry — M5
   sets the number.)
6. **Retirement header — DEFERRED.** The plan stays **ACTIVE** through M4 *implementation* (S9 ladder + M5).
   The `> COMPLETED` header lands post-implementation, not at design-freeze.

### 13.3 S8 — runtime attack scenarios routed to M5 (M4 has no live route to attack)
M4 builds contracts + the backfill classifier over fixtures. 5 of 6 S8 scenarios need the live
route/feedback path and are M5's to falsify; the spec already routes their holes there. Recorded so the M5
`/spec` inherits them as explicit adversarial-test obligations:

| S8 scenario | hole anchor | M5 falsification obligation |
|---|---|---|
| edited item mid-session | H10 | `itemSnapshot` immutable under live edit |
| deleted item with prior feedback | H10 | feedback meaning stable after source delete; projection rebuilds clean |
| concurrent / duplicate feedback | H11 | append-only + read-time reducer dedup under concurrency |
| re-roll | — | one-snapshot-per-render; siblings share `candidateCacheKey` |
| **day-boundary** | **H8 (OPEN)** | **H8 still needs an M5 design resolution** (UTC default) — seed/cache desync |

The **one M4-testable** S8 surface — the classifier on ambiguous/null/dresses fixtures — is captured as S9
pytest obligations (§10.6 ob. 2/2a); its design was already stress-tested at S5 (the two-divergent-
classifier bug, §10.1). **H12 (graceful-degradation arm)** flagged: §8.11 ob. 8 defers a real M5 *design*
choice (minimal valid snapshot vs legacy non-bindable response), not just a test — shapes the H19
`nSurfaced>0` filter; M5-owned, tracked here so it isn't mistaken for pure coding.

### 13.4 Session-map disposition
S8 = **routed to M5** (runtime) + folded to S9 (classifier fixtures); S10 = **DONE §13.1**; S11 =
**design-freeze DONE §13.2** (full retirement deferred to post-implementation).

### 13.5 Defects found + fixed this pass
1. **§15.1↔§15.2 `styleTags` contradiction** — reconciled at S-consolidation, then **fully overtaken by §14**:
   the post-freeze audit found **none** of `warmth`/`material`/`formality`/`styleTags` come from CV. All four
   are now persisted columns (warmth keyword-derived at ingestion; the other three reserved-empty until
   W-track CV); §15.1/§15.2/§6.1 rewritten accordingly. The old "which field is source-less" framing is moot.
2. **Stale "Next: S7"** in the §11 S6 verdict — updated to "✅ CLOSED — see §12".
3. **Overstated header banner** — "M4 DESIGN COMPLETE" → "DESIGN DECISIONS CLOSED; validation via §13".

### S-consolidation verdict — CLOSED 2026-06-25 (then expanded — see §14)
Design decisions closed (S1–S7); design-validation done (S10/S11); S8 routed to M5. The "ready for code-first
implementation" claim held, but a **pre-implementation audit (2026-06-26) expanded the scope** (DB wipe,
W-track data-path, PreferenceSummary rip, cascade) and **a second audit corrected the CV-fields premise** —
both folded into **§14**, which is now the build authority (the C1–C8 ladder). Plan stays active through
implementation.

## 14. Post-design-freeze scope expansion + C1–C8 ladder (2026-06-26)

Pre-implementation audit (multiple rounds of parallel subagents across plan, spec, and codebase) surfaced
gaps the S1–S13 design didn't see. Eight decisions resolved in a first pass; later adversarial rounds caught
a load-bearing false premise (CV does not produce the new fields), doc-consistency drift, and an over-scope
(three unfillable columns + premature cascade/gate work), all resolved in follow-up passes. **The S9
obligation lists (§8.11/§9.8/§10.6/§11.6) are superseded by the C1–C8 ladder below** — where any older
session text (§0/§3/§7/§9/§11/§12/§13 or the §16 spec contract) still says "backfill" / "fixtures-only" /
"no live route" / "warmth derived in the adapter" / "**M4 implements the authenticity-gate functions**" /
"M4 persists `material`/`formality`/`styleTags` columns" / "M4 wires snapshot redaction", **§14 wins** (those
are pre-trim; the authenticity-gate functions, the three soft columns, and the redaction-cascade wiring are
all out of M4 — see decisions #1/#6 + C7).

**M4 is split into two sub-milestones (decided 2026-06-26):**
- **M4a — the data path (C1–C3): ships partly live.** Wipe, ingestion rebuild, PreferenceSummary rip.
  These change the running app; verify by re-uploading a wardrobe. This **breaks the old "M4 touches no
  live route" invariant** (§7.1/§12.3/§13) — that invariant now applies **only to M4b**.
- **M4b — the snapshot substrate (C4–C8): ships dormant.** Version constants, the GenerationSnapshot
  model + Python trace layer, cascade + gate. Pure additive; nothing calls it until M5. This is M4 as
  originally scoped.

Land M4a first (stabilize the live changes), then M4b. The ladder already cleaves cleanly — C3 has no
dependency on C1/C2, and C4 is pure Python independent of all TS work.

### 14.1 Resolved decisions (the post-freeze deltas)

| # | Decision | Effect on M4 scope |
|---|---|---|
| 1 | **Persist only the `warmth` column** (`fitted_core` requires it non-null; `models.py:116/132`), keyword-derived at ingestion. **SCOPE-TRIMMED 2026-06-26 (audit round 3):** `material`/`formality`/`styleTags` are **deferred to the W-track** — the engine treats them optional (`models.py:121-122`), today's CV produces none, and nothing reads them before the W-track CV; they ship with that CV + the review form as one unit. The snapshot `engineVisible` contract keeps all three field-slots (adapter emits `null`/`[]`). | C1 adds only the `warmth` column + the `clothingType` widen; C2 drops the soft-field plumbing; §15.2 adapter emits `null`/`[]` for the three deferred fields |
| 2 | **Rip top/bottom-only ingestion now** | Kill `wardrobe/route.ts:149` create-coerce + the edit-coerce at `wardrobe/[id]/route.ts:75-77` (+ `:54`/`:102`) + the `"top" \| "bottom"` typing in `wardrobe/page.tsx:14` + the GET response type at `wardrobe/route.ts:61` (mapped `:87`); widen to the 5-value enum end-to-end |
| 3 | **Rip PreferenceSummary wholesale** | Delete the collection + summarize endpoint + `/account` UI section + `runPersonalizationSummarize` + the calls from `recommend/route.ts` (def `:294`, call `:436`) and `regenerate/route.ts` (def `:283`, call `:411`); plus `db.ts`/`gemini.ts`/dashboard consumers + 5 test files (C3 has the full list) |
| 4 | **Write the C1–Cn ladder before any code** | §14.2 below; supersedes the scattered S9 obligation lists |
| 5 | **Wipe the Mongo collections** (`wardrobeitems` + `outfitinteractions` + `preferencesummaries`) | No backfill classifier needed; §9.1 co-presence guard runs strict from row 0; the §10 standalone backfill harness collapses out (§10 is now the ingestion classification rule, used by CV, not a separate workstream) |
| 6 | **Cascade — trimmed (audit round 3).** `User.ts:30-31` also **hard-deletes `wardrobeimages`** (closes H14's cascade arm). The **GenerationSnapshot redaction-cascade wiring is DEFERRED to the Privacy `[STAGED]` milestone** (transaction-threading a session-less hook for data that doesn't exist on a no-users fork is premature); M4 only **reserves** the redaction schema fields (free in C5). | C7 slims to the `wardrobeimages` arm + the reserved seam; spec §22/§23-H43 reverted to SEAM-RESERVED |
| 7 | **W-track scope.** Only `warmth` + the `clothingType` widen pull into M4 (the engine-required minimum). `material`/`formality`/`styleTags` **columns** + CV fill + review surface stay a coherent W-track unit; async queue / item-state machine also W-track (§18). | C1/C2 add only `warmth` + the enum widen |
| 8 | **Recommend routes — surgical PreferenceSummary excision** | Delete only the `getOrRefreshPreferenceSummary` calls in M4; the full route rewrite stays in M5 behind `USE_ML_SHORTLISTER` |

### 14.2 The C1–C8 implementation ladder

Ordered + dependency-tracked. Each checkpoint = a coherent commit (or short series), acceptance criteria,
and a test plan. **Run C1 → C8 in order**; the dependency notes flag what genuinely blocks vs what could
parallelize. **C1–C3 = M4a (ships partly live); C4–C8 = M4b (dormant substrate).**

> **Index mechanism (applies to C1 + C5).** The codebase already auto-builds indexes: `mongodb.ts` sets
> `autoIndex:true` and `db.ts` calls `Model.init()` per model at connect. So every index declared below
> builds automatically on first boot against the wiped/empty DB — **no migration script.** The only
> obligation is to **register each new/changed model in `db.ts`'s init list** (C5 must add
> `GenerationSnapshot` there, or its indexes + immutability guard never load). (Production note: autoIndex
> should be turned off on the always-on M5 service later — an M5 concern.)

---

### M4a — data path (C1–C3, ships partly live)

#### C1 — DB wipe + schema scaffolding (TS)
**Touches:** `WardrobeItem.ts`, `OutfitInteraction.ts`, `User.ts`. Drop existing collections (a one-shot
script committed to `fitted/scripts/` so it's re-runnable on Brian's local Mongo). Then:
- `WardrobeItem.clothingType` enum → `["top","bottom","dress","outer_layer","shoes"]`; keep `default:"top"`.
- `WardrobeItem` new column: **`warmth:int (required, 0..10)` — the ONLY new data column** (`fitted_core`
  requires it). `material`/`formality`/`styleTags` columns are **deferred to the W-track** (decision #1/#7) —
  do **not** add them here.
- `User.wardrobeVersion:int (default 0, monotonic)`. Missing-user coalesce: `user.wardrobeVersion ?? 0`.
- `OutfitInteraction.action` enum += `planned`/`packed`/`corrected`.
- `OutfitInteraction` binding fields: `snapshotId:ObjectId?`, `candidateId:string?`, `baseKey:string?`,
  `fullSignature:string?` (all nullable; `pre('validate')` co-presence guard — all-present-or-all-absent).
- `OutfitInteraction` scope-vocab fields: `scopeTarget:enum?[outfit/board/routine/global/lens]`,
  `learningDisposition:enum?[normal/exception/do_not_learn]` (both nullable; behavior `[STAGED]`).
- **`OutfitInteraction` binding index** `{ snapshotId:1, candidateId:1 }` (§9.8 ob.2 — snapshot→feedback
  joins for M6 training reads). Additive; builds via autoIndex. *(This was homeless in the first ladder
  draft — it lives here, not C5, since it's an `OutfitInteraction` index.)*
- **Wipe-script safety gate (mandatory).** The wipe script can destroy real data: the reused CS148
  `.env.local` `MONGODB_URI` may point at the **shared team Atlas cluster** the deployed team app uses.
  Triple-gate: (a) require an explicit `--yes-wipe` flag; (b) refuse unless the connection **HOST** matches a
  localhost/`fitted-dev` allowlist regex **or** `FITTED_ALLOW_WIPE=1` is set; (c) print the target host +
  per-collection doc-counts and require typed confirmation of the DB name.
  - **Trap-guard (host, not db name):** authorize on the **host only** — the db NAME must NOT count, or a
    `fitted-dev`-named database on the shared team Atlas host would self-authorize the very wipe the gate
    exists to refuse. A genuine dev Atlas cluster is allowed via a `fitted-dev`-labelled host or the explicit
    `FITTED_ALLOW_WIPE=1` override. Gate (c) confirms the **actually-connected** `db.databaseName` (not the
    URI-parsed path — a path-less URI connects to Mongo's default db, which would otherwise diverge).

**Acceptance:** jest tests for every new field's validation (enum acceptance/rejection; required-field
rejection; co-presence guard rejects partial rows AND accepts all-absent legacy/empty rows; coalesce
defaults to 0); binding index present. The wipe script is idempotent (running it twice = no error) and
refuses to run against a non-allowlisted URI without the override. Closed M3/Spearhead pytest suites still
green (no fitted_core change).

**Dependencies:** none. Lands first.

---

#### C2 — Ingestion rebuild (data-path; TS)
**Touches:** `app/api/wardrobe/route.ts`, `app/api/wardrobe/[id]/route.ts` (the **edit** path), the upload
form / `app/(app)/wardrobe/page.tsx`, `lib/cvToWardrobeForm.ts`. Goal: create AND edit write a row with the
5-value `clothingType` + a valid `warmth` + the reserved soft fields.

> **CV reality + trimmed scope.** Today's CV (`cv/infer` → HF Space, mapped by `cvToWardrobeForm.ts`)
> returns only `category`/`color`/`pattern` — **not** warmth. C2 **derives `warmth` at ingestion**. The
> `material`/`formality`/`styleTags` columns are **deferred to the W-track** (decision #1) — C2 does not touch
> them; the M5 adapter emits `null`/`[]` for them.

- Delete the top/bottom coerce at `wardrobe/route.ts:149`; accept the full 5-value enum from the request body.
- **Second coerce site (don't miss it):** `wardrobe/[id]/route.ts:75-77` has the identical coerce on item
  **edit**, plus the editable-field list (`:54`) and response default (`:102`). Widen all three, or editing
  an item's type silently reverts it — the 5-value enum must survive an edit round-trip.
- Widen the client type at `wardrobe/page.tsx:14` and the GET response **type at `wardrobe/route.ts:61`**
  (field mapped at `:87`; `:172` is the POST response default — widen it too).
- `warmth`: **keyword-derive at ingestion** from `category`/`subCategory`/`name`. **This is net-new TS
  authorship** — there is no warmth keyword map in the codebase today (the Python `_warmth_band` only *bins*
  an existing 0–10 int; it does not map "parka"→8). Seed the garment→warmth map from the existing
  string-match precedent (`recommend/route.ts:179,237` has the `["parka","puffer","wool",…]` lists) but
  budget it as new work — "airtight" means "always writes a valid 0..10," not "free." Runs whenever CV omits
  warmth (today: always).

**Acceptance:** jest over POST **and** edit fixtures: dress/jumpsuit/romper → `dress`; a knit with
`layerRole=="outer"` → `outer_layer`; out-of-ontology → `top`; warmth always 0..10; an edit to
`clothingType=dress` persists `dress` (not coerced). **A thin jest integration test on the rebuilt POST**
(fixture body → row has a valid 5-value `clothingType` + a 0..10 warmth) — the one automated guard on the
live data path. Manual e2e: Brian re-uploads a test wardrobe and confirms every row has a valid
`clothingType` + warmth.

**Dependencies:** C1 (the `warmth` column + enum widen must exist).

---

#### C3 — PreferenceSummary rip (TS)
**The consumer graph is wider than the first draft listed** (audit-verified). Full touch set:
- **Delete:** `models/PreferenceSummary.ts`, `app/api/preferences/summarize/route.ts`,
  `lib/runPersonalizationSummary.ts`. Drop the `preferencesummaries` collection (C1's wipe does this).
- **`lib/db.ts`** (`:7` import, `:20` `.init()`, `:23` return from `initDatabase()`) — remove the model from
  the registration + return shape; **verify no route destructures `PreferenceSummary` from `initDatabase()`**
  before changing the return.
- **`lib/gemini.ts`** (`:30` `isValidPreferenceSummary`, `:98` `generatePersonalizationSummary`) — the
  helpers `runPersonalizationSummary` depends on; delete them (and any now-dead imports).
- **`app/(app)/account/page.tsx`** — remove the PreferenceSummary UI section + **all three summarize fetches
  (`:93`, `:197`, `:228`)**, not just the `:88` read.
- **`app/(app)/dashboard/page.tsx`** (`:671`, `:681`) — fetches `/api/preferences/summarize`. Since C3
  deletes that endpoint at M4 but §19 keeps `dashboard` until the M5 cutover, **remove the dashboard fetch in
  C3** (it's dead UI deleted at M5 anyway) so it doesn't 404 in the M4→M5 window.
- **`recommend/route.ts`** (`getOrRefreshPreferenceSummary` def `:294`, call site **`:436`**) +
  **`regenerate/route.ts`** (def `:283`, call site **`:411`**) — excise the helper **and its call** (delete
  the def alone and the call dangles → build break). Leave the rest of those routes intact (full rewrite is
  M5). *(Symbol note: the file `lib/runPersonalizationSummary.ts` exports `runPersonalizationSummarize` —
  mind the `-ize`; the recommend routes import that name.)*
- **`CLAUDE.md:73`** — the "Mongo schemas" list names `PreferenceSummary`; drop it (and optionally add
  `GenerationSnapshot`) in this commit, since C3 deletes the model file.
- **5 jest suites** reference it: `summaryRefreshThreshold.test.ts` + `geminiUtils.test.ts` are *entirely*
  about this feature (delete them); `recommendationStability.test.ts`, `regenerateExclusion.test.ts`,
  `endToEndRecommendationFlow.test.ts` mock it (remove the mocks).

**Acceptance:** `grep -rn "PreferenceSummary\|runPersonalizationSummary\|getOrRefreshPreferenceSummary\|
generatePersonalizationSummary" fitted/` returns zero hits in source **and tests**. `/account` + `/dashboard`
still render (minus the summary). Legacy recommend/regenerate still respond 200. **`npm run build` + `npm run
lint` + `npm test` all clean** (the first draft's gate omitted `npm test`, which would have failed on the 5
suites).

**Dependencies:** none file-wise (independent of C1/C2; C1's wipe handles the collection drop).

---

### M4b — snapshot substrate (C4–C8, ships dormant)

> The "M4 touches no live route / ships nothing runnable" invariant (§7.1/§12.3/§13) applies **here** — C4–C8
> are pure additive substrate; nothing calls them until M5.

#### C4 — fitted_core version constants + serializer module
**Touches:** `ml-system/fitted_core/__init__.py`, `ml-system/fitted_core/config.py`, new
`ml-system/fitted_core/snapshot_serde.py`. Goal: the cross-language wire layer the §15.1 contract needs.
- Add `fitted_core.__version__` (e.g. `"0.4.0"`); `promptVersion` constant (tags the §D prompt builder);
  `rankerConfigVersion` = sha256 over the Appendix B constants (computed at module load).
- **Versioning policy (document as a comment in `__init__.py`; this is M6 training-provenance):**
  `__version__` = **semver, hand-bumped** on any behavioral substrate change (sampler/validator/ranker/prompt
  *logic*) — coarse, release-grained. `rankerConfigVersion` = **auto** sha256 over Appendix B, so a
  one-constant tuning change `__version__` would miss is still caught. `promptVersion` = its own string,
  bumped on **any** prompt-text edit (a reword changes generations even with no code change). Failure mode is
  silent (forget to bump → two behaviorally-different corpora share a version → M6 can't separate them), so
  the comment is the guardrail.
- `snapshot_serde.py`: snake↔camel field-name maps for `engineVisible` (`style_tags`↔`styleTags`,
  `color_tags`↔`colorTags`, `occasion_tags`↔`occasionTags`); a `to_wire()` / `from_wire()` pair that
  enforces finite floats only (raises on `NaN`/`Infinity`), opaque-string ids (rejects ObjectIds at the
  Python boundary), no `undefined`.

**Acceptance:** pytest round-trip — a synthetic payload survives `to_wire()`→JSON→`from_wire()` byte-equal
(modulo float canonical form). Rejection tests: a `NaN` raises; a non-string itemId raises. Version-constant
presence test: `fitted_core.__version__` is a non-empty semver-ish string; `rankerConfigVersion` is stable
across runs but changes when an Appendix B constant moves.

**Dependencies:** none (pure Python, independent of TS work).

---

#### C5 — GenerationSnapshot model + immutability + indexes + BSON guard (TS)
**Touches:** new `fitted/models/GenerationSnapshot.ts`, `fitted/lib/db.ts` (model registration). Implement
the §8.3 Mongoose sketch verbatim (with the §15.1 wins on any disagreement):
- Sub-schemas with `_id:false`; field groups A–K per §8.2.
- **`itemSnapshot.cvModelVersion?`** (nullable, default null) — the data-path provenance seam (§15.1),
  forward-looking: once the W-track CV writes `engineVisible` features (warmth/material/formality/styleTags),
  a CV change drifts their meaning. Null at M4 (warmth is keyword-derived, not CV-written; the others aren't
  written yet), wired at the W-track CV. Cheap to reserve now, expensive to retrofit post-corpus.
- `pre(['updateOne','findOneAndUpdate','save'])` guard: rejects any update that touches a non-redaction
  field. Whitelist = `{redacted, redactedAt, redactionReason}` only.
- **Register `GenerationSnapshot` in `db.ts`'s import + `.init()` list** (the §8.3 sketch routed this to M5,
  but registering an unused model is inert — and without it the autoIndex + immutability guard never load, so
  the C5 index-presence test couldn't pass). M4 ships it dormant; M5 wires the live write. *(Supersedes the
  §8.3 "db.ts registration → M5" note.)*
- Apply the §8.8 index plan via autoIndex (see the §14.2 index-mechanism note): `{user, createdAt:-1}`,
  `{user, candidateCacheKey, generationIndex}` (**non-unique**, per the Fable/Codex demotion),
  `{user, shownFullSignatures:1, createdAt:-1}` (multikey), `{redacted, createdAt}`, `{user, redacted}`.
- Raw-payload caps: byte cap + hash + truncation flag on every raw field (`rawText`/`rawEmitted`/
  `rawAttributes`). No image/base64/blob bytes ever stored.
- **BSON-size guard test (jest):** worst-case fixture (135 itemSnapshots × ~500 B + 40 candidates ×
  ~700 B + max-raw payloads at cap) serializes under 16 MB with margin. Locks OQ1.

**Acceptance:** jest schema/validation tests; immutability guard test (a non-redaction update rejected; a
redaction update accepted); index presence test (model registered in `db.ts`, indexes built); BSON-size guard
test passes.

**Dependencies:** C1 (for the cross-model context — the binding fields on `OutfitInteraction` are now
present so the snapshot↔interaction join is well-defined). C4 (for `rankerConfigVersion` which the snapshot
stores).

---

#### C6 — fitted_core snapshot payload + trace wrappers
**Touches:** new `ml-system/fitted_core/snapshot.py`, additions to `rescue.py`/`ranker.py`/`response.py`/
`validator.py`. The §8.4 Option-B mechanism:
- `GenerationSnapshotPayload` frozen dataclass = §8.2-A/B/C/E/F/G + each item's `engineVisible`
  (snake_case). Fields are non-optional where §15.1 says "required, non-null on every live write".
- `rescue_with_trace()`, `rank_with_audit()`, `build_variants_with_trace()`,
  `validate_gpt_payload_with_trace()` siblings. The original closed signatures **must** stay byte-stable
  (the existing M3/Spearhead tests must still pass unchanged).
- Python-issued `candidateId` over the full funnel (deterministic ordinal; unique within snapshot;
  includes rejected, scored-but-unshown, non-selected-variant candidates). Lives in `snapshot.py` so it can
  be called from the trace wrappers consistently.
- The content-preservation invariant (§8.2-F): a generated-non-accepted candidate carries
  `{items, slotMap}` reconstructed from `sourceIndex` or `rawEmitted`.
- **Diagnostics population (explicit deliverable — don't let it ride "field group G").** Map
  `SamplerResult`/`RankerResult`/`RescueResult`/parse flags + the rejection/warning histograms into the
  snapshot `diagnostics{}` (§8.2-G / §8.3). This is the only §15.1 field group with no other build step; name
  it here so it isn't assumed.

**Acceptance:** pytest — every existing M3/Spearhead test passes unchanged (the closed contracts are
byte-stable); new trace-wrapper tests confirm the three discard sites are captured (a fixture with
accepted + rejected + rescue-dropped + ranker-dropped + non-selected-variant + shown proves it);
`candidateId` deterministic across a permuted-input case; content-preservation invariant enforced (a bare
`{candidateId, rejectionCodes}` builder call raises); **`diagnostics{}` populated from the result objects**
(the fixture asserts per-type sampler results + ranker/rescue flags + histograms land). A builder-drift test
(§8.11 ob.5): `engineVisible` equals the projection the payload builder emitted (in dormant M4b there is no
live "send" — "the projection" = what the builder serialized from the in-memory `WardrobeItem`), and an item
edit/delete after the payload is built does not alter the already-built `itemSnapshot`.

**Dependencies:** C4 (version constants + serializer).

---

#### C7 — `wardrobeimages` cascade (the cheap H14 arm)
**Touches:** `fitted/models/User.ts`. **Trimmed by audit round 3** — only the cheap, no-transaction arm
lands in M4.
- Extend `User.ts` cascade hook (the `deleteMany` lines at `:30-31`, inside the `pre(['deleteOne',
  'findOneAndDelete'])` query hook): on user delete, also **hard-delete `wardrobeimages`** rows. Closes
  H14's cascade arm; cheap (one more `deleteMany`, no transaction).
  - **Trap-guard (two invocation paths):** `lib/db.ts:61 deleteUserWithData` calls `User.deleteOne`, so the
    hook fires there too — verify the cascade covers both that path and any direct `User.deleteOne`.
- **DEFERRED (not M4):** the **GenerationSnapshot redaction-cascade wiring** → Privacy `[STAGED]` (the
  `updateMany` that nulls PII + the session/transaction threading; premature with zero users — §23-H43). The
  **authenticity-gate functions** (existence/ownership/content-key) → M5, where the live route makes them
  testable for real (they'd be rewritten the moment the live `{snapshotId,candidateId}` echo + membership
  check land — OQ4). M4 keeps only the §16 *contract* + the reserved redaction schema fields (in C5).

**Acceptance:** jest — a user delete hard-deletes their `wardrobeimages` (via both `User.deleteOne` and
`deleteUserWithData`); existing `wardrobeitems`/`outfitinteractions` cascade unchanged.

**Dependencies:** none hard (C5 only if you want to assert snapshots are *left intact* by the delete — an
optional regression test that the un-wired redaction seam isn't accidentally cascaded).

---

#### C8 — End-to-end fixture verification + M5 handoff doc
**Touches:** new `ml-system/tests/test_m4_e2e_fixture.py` (or wherever the existing pytest suite lives), a
short M5-handoff note at the bottom of this plan.
- **One integration test exercising the seam:** seeded `WardrobeItem` rows (post-C2 shape, with
  keyword-derived warmth) → a Python pipeline run that builds a `GenerationSnapshotPayload` (post-C6) →
  serialized through `snapshot_serde` (post-C4) → a hand-loaded `GenerationSnapshot` doc in jest's test DB →
  an `OutfitInteraction` row carrying the `{snapshotId, candidateId}` binding fields (post-C1) that
  round-trips back to the snapshot's keys. No live route, **no authenticity gate** (that's M5 now — §C7); the
  test proves the *data contract* composes end-to-end (payload → serde → doc → binding), which is what M5
  inherits.
- **M5 handoff note (appended to this plan):** what state M5 inherits (DB has X collections, Y indexes; TS
  exports model Z; fitted_core exports module W); what M5 owns (live route wiring, actually-shown
  membership, `{snapshotId,candidateId}` echo, dedup window tuning, recommend/regenerate rewrite,
  `USE_ML_SHORTLISTER` cutover).

**Acceptance:** the integration test passes. The handoff note is concrete (file paths + symbol names),
not vibes.

**Dependencies:** all prior checkpoints.

---

### 14.3 What collapses out (no longer M4 work)

- **§10 backfill workstream as a separate effort.** The §10.3 classification rule survives as the
  ingestion classifier (C2); the dry-run/report harness becomes a fixture-mode tool only.
- **§15.2 warmth derivation table.** Adapter is pure passthrough post-C2.
- **The "two divergent classifiers" diagnosis** is a trap-guard, not work — don't re-introduce divergent
  string-match sites in any future rewrite.
- **§9.1 "all-four-absent" legacy allowance** — the DB wipe means there are no legacy rows; the
  co-presence guard runs strict from row 0.
- **The four request-time grep sites in recommend/regenerate** — they survive M4 (only PreferenceSummary
  calls are excised), and are deleted at the M5 cutover as part of the wholesale route rewrite (§19).
- **Deferred by audit round 3 (out of M4, not lost):**
  - **`material`/`formality`/`styleTags` columns** → W-track, shipped with their CV + review surface as one
    unit (engine treats them optional; nothing reads them pre-CV; the snapshot contract reserves the slots).
  - **GenerationSnapshot redaction-cascade wiring** → Privacy `[STAGED]` (transaction work for zero users);
    M4 reserves the schema seam only.
  - **Authenticity-gate functions (existence/ownership/content-key)** → M5 (rewritten once the live route
    exists; M4 keeps the §16 contract). C7 shrinks to the `wardrobeimages` arm.

### 14.4 Holes touched / closed

- **H43 (cascade + redaction):** stays **SEAM-RESERVED (M4)** → redaction-wiring + retention
  `DEFERRED-Privacy[STAGED]`. M4 reserves the schema fields + closes H14's `wardrobeimages` arm but does
  **not** wire snapshot redaction (audit round 3: premature with zero users). Spec §23-H43 updated.
- **H14 (cascade arm):** `wardrobeimages` now in cascade (C7); image-replacement delete-before-commit
  ordering bug stays W-track.
- **No new hole.** The deferred columns + the deferred redaction/gate are by-design scope trims (decisions
  #1/#6/#7), each routed to an owning milestone — not gaps.

