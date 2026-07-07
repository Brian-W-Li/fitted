# M5 spec — targeted senior-engineer evaluation (post-broad-audit)

**Paste this whole file as the first message of a fresh session.**

---

You are a skeptical senior/staff engineer doing a **targeted** design review of the M5 cutover spec
(`docs/plans/m5-cutover.md`), which supersedes the canonical spec `docs/Fitted_Spec_v2.md` on conflict.
A **broad audit already ran** and converged: every file:line citation was verified against source, internal
self-consistency was fixed (the H28 seam-locus contradiction, an H48 over-claim, a §15.1 conflict, the jest
floor), and all §23 hole characterizations were confirmed faithful. **Do not repeat the broad audit.** Do not
re-verify citations wholesale, do not re-list holes, do not grade prose.

Your job is the opposite of broad: pick each **specific decision or mechanism** below, and — like a senior
engineer who has to own this in production — **trace exactly what happens when the triggering case occurs**,
then deliver an **opinionated verdict**. The question is not "is the spec internally consistent" (it is). The
question is **"is this decision actually correct, and will it do the right thing when a real user/request/
failure hits it?"**

## Rules of engagement

- **Source-grounded, always.** Read the real `fitted_core`/model/route code before asserting behavior. A
  claim without a file:line you personally read is a guess — mark it as one. Never trust a prior summary
  (including this prompt's framing) as authoritative; verify.
- **Challenge every decision equally — including the author's and the prior reviewer's.** D1–D7 are Brian's
  calls; the H48 "preserve as a pre-diversity collection" default was the prior review session's call. Both
  get the same skepticism. If a decision is wrong, say so plainly and propose the corrected decision. If it's
  right, say *why* it's right (the mechanism you traced), not "looks fine."
- **Opinion required, hedging banned.** Each probe ends in one of: **SOUND** (traced, correct, here's the
  evidence) · **NEEDS-CHANGE** (here's the exact defect + the exact spec edit) · **WRONG** (the decision
  itself is misaimed; here's what to do instead). "Depends / could go either way" is only acceptable with a
  named decision criterion and a recommended default.
- **Scale the depth to the stakes.** Go deepest on P1, P2, P4, P5 (most likely to hide a wrong decision).
  P3, P6, P7, P8 are important but likely-fine — confirm or break them, don't pad.
- **Zero-user context is real but not a free pass.** "No real users yet" excuses a *scaling* deferral; it
  does **not** excuse a mechanism that does the wrong thing for the one user (Brian) driving the demo, or a
  corpus-integrity bug (the corpus is the M6 deliverable).

## Reading list

`docs/plans/m5-cutover.md` (the whole thing) · `docs/Fitted_Spec_v2.md` §12/§15/§15.1/§15.2/§16 · the real
source: `ml-system/fitted_core/{rescue,snapshot,ranker,response,generation,config}.py`,
`fitted/models/{GenerationSnapshot,OutfitInteraction}.ts`,
`fitted/app/api/{recommend/route,interactions/route}.ts`.

---

## The probes

### P1 — D2: does "regenerate = re-rank the parent" actually give the user different outfits? [HIGHEST]
**Decision under test:** D2 kills fresh generation on re-roll; a regenerate re-ranks the parent snapshot's
already-validated candidates with a new `generation_index` tie-break and writes a child snapshot.
**Failure hypothesis:** the ranker orders by score first and `tiebreak_seed` only breaks *ties*, so a re-roll
with no intervening feedback returns the **same top outfits, merely reordered** — a degraded experience vs
the legacy fresh-GPT re-roll. **Trace precisely:** How many validated candidates does a parent snapshot hold
(read `build_candidate_pool` scaling + validator)? How many are shown per render (`n_surfaced`, `k`)? On a
re-roll, does `rank()` + the shown-selection logic surface **previously-unshown** candidates from the
validated pool (a rotation through 4,5,6…), or re-surface the same top-`n_surfaced`? Read `rank()`,
`_order_final_candidates`, the tie-break path, and wherever `shownCandidateIds`/`n_surfaced` selection
happens. **The crux:** if re-roll rotates through unshown validated candidates until the pool exhausts, D2 is
clever and correct; if it re-shows the same set, D2 needs an explicit exclude-already-shown / rotation-cursor
rule (and the spec doesn't have one). **Verdict + if NEEDS-CHANGE, the exact rule to add.**

### P2 — H50: is "first-write-wins, not a unique index" a real idempotency guarantee or a no-op? [HIGHEST]
**Decision under test:** §C.6 — a double-clicked Generate is deduped by "first-write-wins on
`{user, requestId}`," explicitly **not** a write-path unique index (to preserve the §16 append-only posture).
**Failure hypothesis:** with no unique constraint, two concurrent requests with the same `requestId` both
read "no existing render" and both insert → two immutable snapshots, i.e. the guard does nothing under the
exact concurrency it targets. **Trace:** what is the actual write sequence (read-check-then-`.create()`?) and
where is the TOCTOU window? Then resolve the real question: **can you have first-write-wins AND append-only
feedback simultaneously?** (Likely yes — a *partial* unique index scoped to render snapshots keyed on
`{user, requestId}`, entirely separate from the append-only `OutfitInteraction` rows the §16 posture is
about. Check whether the spec conflated the render-idempotency index with the feedback-row append-only rule
and wrongly rejected the index for both.) **Verdict:** is H50 as specced actually idempotent? If not, the
exact mechanism (index scope + write path) that makes it so without breaking append-only feedback.

### P3 — D5/H58: is a static shared-secret header the right auth for an OpenAI-spending public service?
**Decision under test:** the Fly.io service holds `OPENAI_API_KEY` and gates on an `X-Fitted-Service-Key`
shared secret (Fly secret + Next env), no rotation specced. **Trace the threat model:** if the secret leaks
(Next bundle, log, git), the endpoint is an open LLM-spend proxy until manual rotation. **Ask the senior
questions:** Does the **service itself** have an independent spend/rate ceiling, or does it trust Next's H60
body-clamp entirely (so a leaked secret = unbounded spend)? Is a static secret the right primitive vs. Fly
private networking / no public route / an allowlist? Is "not publicly discoverable" doing load-bearing work
it shouldn't? **Verdict:** SOUND for a portfolio service, or NEEDS-CHANGE with the specific hardening
(service-side spend cap? private networking?) — and is that hardening M5 or a named deferral.

### P4 — D3: is the degenerate payload actually constructable at every internal failure point? [HIGH]
**Decision under test:** on any engine-*internal* failure the **service** returns a schema-valid degenerate
`GenerationSnapshotPayload` ("provenance is known because generation ran"). **Failure hypothesis:** some
failures happen *before* generation runs (sampler raises on a degenerate wardrobe; `_check_sufficiency`
short-circuits pre-GPT; a config/version read throws) — at those points there is no `generationAttempts[]`
entry and possibly no `generator` block, so the required-provenance schema (`fittedCoreVersion`, all four
`generator` subfields, `scorer.kind` enum, empty-but-present arrays) may be **unsatisfiable**, forcing the
no-snapshot arm the spec reserved only for transport loss. **Trace:** enumerate the internal failure points
in the `render`/`rescue` pipeline (sampler → §12 generation → validator → rank → response) and at each ask
"can the service assemble a schema-valid payload here?" **Verdict:** is D3's "generation ran ⇒ provenance
satisfiable" true everywhere, or are there pre-generation failure points that must route to the no-snapshot
degraded arm — and does the spec distinguish them? If not, the exact boundary to write into §D.

### P5 — C8: is deleting the legacy vertical in the same commit as the flag flip the right rollback story? [HIGH]
**Decision under test:** C8 flips `USE_ML_SHORTLISTER=true` **and** deletes the legacy recommend/regenerate
arm wholesale. **Consequence to trace:** after C8, `flag=false` no longer means "fall back to legacy" — it
means "degraded response, no recommendations." So the flag is **not a rollback**: if the Fly service ships a
prod bug, flipping off leaves the app with no recommendation feature at all. **Weigh honestly:** against the
open deletion license + zero users (which argues delete-now), versus keeping the legacy arm one milestone as
a true fallback (which argues the cutover isn't reversible without it). **Verdict:** SOUND (the demo can
tolerate a dead feature during a hotfix, delete is fine) or NEEDS-CHANGE (retain legacy as a real fallback
through one post-cutover milestone) — pick one and defend it as the engineer who gets paged.

### P6 — D5/§H: does shipping all raw behavioral rows per request have an unbounded-growth path?
**Decision under test:** Next fetches **raw** `behavioralRows` (recent snapshots + interaction rows) and
ships them over the wire every request; the service reduces them. **Trace:** read the §H reducer inputs and
the Mongo queries they imply. For a heavy user (many interactions, many snapshots), what bounds the fetch and
the wire payload? Is the repetition-window read bounded (`REPETITION_WINDOW_SNAPSHOTS`) but the
affinity/cooldown interaction read **unbounded**? **Verdict:** is there a bounded-scan spec on every
behavioral read, or a latent multi-MB-request path? If unbounded, the exact `last-K` / time-window bound to
add (and confirm it doesn't corrupt the affinity projection).

### P7 — D1/H40: is the new daily-intent prompt's believability validated, or assumed?
**Decision under test:** §B adds a **new** daily prompt ("mirror the rescue structure, drop the forced-item
framing"). **Gap:** H40 measured generation believability only for the **rescue** prompt (gpt-4o, Spearhead
C6). The daily prompt is new *and* targets `gpt-5.4-mini`, unmeasured. **Trace the hidden assumption:** is
daily (full-pool, no forced item) genuinely *easier* than rescue (so believability transfers a fortiori), or
does dropping the forced-item anchor make believable full-outfit assembly *harder*? **Verdict:** is "mirror
the rescue structure" sufficient assurance to cut over, or should M5 gate on a daily-prompt believability
read (the §E/C6 rubric, descriptive) before C8? Recommend the specific pre-cutover check or explicitly clear
it.

### P8 — H48 (prior-review decision): preserve the breakdown, or is recoverability strictly cleaner?
**Decision under test:** the prior review set M5's default to option (a) — preserve variant-cap losers'
Step-5 `ScoreBreakdown` as a pre-diversity scored collection in the `rank_with_audit` trace. **Challenge it:**
the breakdown is a *deterministic* function of preserved candidate content + context (H29 recoverability), so
storing it may be redundant bytes that (i) perturb the dormant M4b audit trace + its tests, (ii) push against
the H29 raw-size caps, for a signal that's reconstructable offline. **Trace:** how large is the pre-diversity
set vs the shown set, and does storing it risk the caps? Is the M4b audit-test perturbation real? **Verdict:**
uphold option (a), or overturn to option (b) (a recorded recoverability rationale, no inline storage) — decide
as the engineer who owns both the corpus completeness *and* the snapshot-size budget.

---

## Output format

For each probe: **P# — VERDICT (SOUND / NEEDS-CHANGE / WRONG)** · the mechanism you traced with the
file:line evidence · if not SOUND, the exact spec edit or corrected decision. Then a closing **senior
sign-off**: *would you start implementing from this spec as-is, or is there a probe whose outcome must be
resolved first?* Name any probe that is a true go/no-go before C1. Do not fix the spec in this pass — report;
Brian decides what to apply.
