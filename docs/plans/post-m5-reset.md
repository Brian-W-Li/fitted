# Post-M5 reset — the trust-restoration campaign

> Status: **SHAPED + ready to execute (Brian, 2026-07-08).** Precondition MET — M5 is complete
> (C8 half-1 + half-2 validated locally; [[project_m5_c8_2026_07_08]]) and was built behavior-first
> (the test-Mongo harness + D-1/D-2 round-trip guards landed at C5 — `generationSnapshotRoundTrip.test.ts`;
> so §4's top-2 silent-break risks are already CLOSED, and the inventory below needs a refresh against
> the now-live post-C8 code as the campaign's first act).
>
> **Mission (Brian's framing):** *restore trust in docs, tests, AND code, and kill documentation bloat* —
> over a few goaled sessions. The R1–R4 arc below is the spine; the mission reframes its purpose as trust,
> not just tidiness.
>
> **Audit method: combined Codex + Claude, cross-model ([[feedback_cross_model_review]]).** Every
> diagnostic/verification pass runs BOTH a Claude heavy multi-lane audit (parallel subagents on distinct
> lanes + a Fable synthesis for merit/design calls) AND a Codex pass on the same scope (Brian-run, or a
> scoped prompt this session emits for him to run and fold back), then reconciles the two ledgers —
> un-anchored eyes catch the author's blind spots, and absence-shaped defects need framing-free reviewers.
>
> **Step 0 (sequencing): decide whether to merge M5 → `main` first** (the branch is ~23 commits ahead).
> Recommended: merge, so the codebase-wide reset + the doc "military reset" (R4) reconcile against the
> canonical trunk, not a feature branch.
>
> **Bloat is measured, not vibes:** `m5-cutover.md` is ~2,260 lines (CLAUDE.md's compaction ceiling is
> 1,500); `docs/sessions/` is ~43 files / ~5,000 lines; `docs/plans/` ~12 files / ~7,400 lines. R4 owns the cut.

## 1. Why this exists — the diagnosis

The repo's tests are **unit-only**. Nobody ever scaffolded the test pyramid (unit → integration →
end-to-end/behavioral). Unit tests assert *shape against hand-written fixtures*: they pass whenever the
fixture matches the code, and say nothing about whether the *real other side* agrees or whether the
*behavior actually happens*. That is precisely how this codebase repeatedly shipped a **green suite over a
broken/drifted seam** (the `itemIds`/`items` dead affinity seam; `sessionId` absent from the wire; the
behavioral layer shipping cold). Every prior correction session — and the 2026-07-08 contract-cure commit
`c1787f7b` — was a *shape* bandaid on a *behavioral* disease.

Proof it's structural, not cosmetic: a 2026-07-08 sweep catalogued **~35 cross-layer/cross-runtime drift
surfaces** (places one fact lives in ≥2 hand-maintained representations); **~22 are fully unguarded**
(divergence → green suite). Two are **confirmed live data-loss defects** that *no* unit/shape/`validateSync`
test can catch — only a behavioral round-trip (write→read a real Mongo doc) does. See `m5-cutover.md` §J
D-1/D-2 and the inventory in §4 below.

Second, orthogonal problem Brian raised: **legibility.** As the codebase grows, holding it in one head (or
one LLM context) degrades — which itself causes the hasty, partial fixes. The ~35 drift surfaces are also
~35 duplications, so collapsing them cuts *both* drift and cognitive load. Legibility is a first-class reset
goal, not a nicety.

## 2. The principle (what replaces the bandaids)

**Behavioral integration tests derived from the ambition are the cure.** Each user-observable promise the
ambition makes gets ONE end-to-end test across real boundaries (real Mongo round-trip, real service call).
That is O(behaviors), not O(field-pairs), it's anchored to the ambition (not the code-as-built), and it
catches drift in *any* layer because it asserts the observable outcome. Shape/conformance pins (incl. the
committed `contract.py`) are **demoted to localizers** — they tell you *which* field drifted after a
behavioral test fails; they are not the guard.

Hard constraint: **you can't retrofit this onto unbuilt code.** The TS integration surface (request builder,
Mongo projection, response consumer, snapshot writer) doesn't exist until C5; there is no test-Mongo harness.
So the behavioral suite is a **C5-forward discipline** + one enabling investment (a `mongodb-memory-server`-
style harness). M5 must be finished behavior-first before the whole-codebase reset.

## 3. Proposed reset (multi-session, each with a goal) — PENDING BRIAN

Precondition **MET** (M5 done; harness + D-1/D-2 guards landed at C5 — see banner). As separate goaled
sessions (each a combined Codex+Claude audit per the banner method):

- **R0 — Diagnostic refresh + campaign ledger (do first).** Re-run the drift/trust audit against the
  now-live post-C8 code (the §4 inventory predates C5–C8; legacy is retired, D-1/D-2 guarded, one
  integration smoke exists). Combined Codex+Claude. Output: a prioritized, deduplicated
  trust-restoration ledger (docs/tests/code findings, each severity-graded + verified against source)
  that R1–R4 execute against. Don't fix in R0 — map, dedup, prioritize.

- **R1 — Legibility / architecture map.** A concise "how the whole system fits together" doc + reading order;
  identify the sprawl and the legacy/v2 dual-arm to retire post-cutover. Goal: the codebase is digestible in
  one pass. (Do this first — it makes R2–R4 cheaper and safer.)
- **R2 — Test pyramid + behavioral suite.** Formalize the harness; write the ambition-derived behavioral
  integration/e2e tests (one per promised behavior); establish the pyramid as standing policy. Goal: every
  ambition promise has a behavioral guard; most of the 35 shape surfaces become non-load-bearing.
- **R3 — Structural de-duplication.** Collapse the drift surfaces (single source of truth / generate-not-
  mirror where warranted; retire the legacy path). Goal: fewer representations → less drift AND less
  cognitive load.
- **R4 — Doc "military reset."** The ambition↔code↔docs bidirectional reconciliation, run against the now-LIVE
  behavior (not paper); compact `m5-cutover.md` (<1500) and the spec. Goal: docs state current verified truth,
  conflict-free, small.

Sequencing rationale: legibility first (so I can hold it), then the behavioral safety net (so de-dup is safe),
then de-dup, then the doc reset against a system that's both live and legible. Interleaving R2/R3 is fine.

## 4. Drift-surface inventory (2026-07-08 sweep) — reference

~35 surfaces across 6 categories: wire field sets (request GUARDED via `contract.py`; **response envelope +
`flags` UNGUARDED**), enum mirrors (clothingType/weather/action/roles across Python+TS, mostly UNGUARDED),
format rules (ObjectId/UUID/seedDate/createdAt/key-safe ids, several hand-duplicated), numeric constants
(service clamps vs Mongoose limits — the "C5 mirror obligation"), persisted-payload↔schema (the two D-1/D-2
drops), and the `templateType`-vs-`template` naming split. **Top-5 by silent-break risk:** (1) D-1
`engineFailure` drop, (2) D-2 `controls` drop, (3) service clamps vs absent Mongoose `maxlength` (closet
permanently unrenderable), (4) clothingType unknown→"top" coercion, (5) `keys.py`↔`app.py` key-safe id
hand-duplication (spend-then-fail). All are guarded by the R2 behavioral suite, not per-field pins.
