# Doc-consistency + doc↔code fidelity audit — 2026-07-18

Report-only. No source/doc/test edited. Auditor read the authoritative docs
(`CLAUDE.md`, `docs/Fitted_Spec_v2.md` §23 + Appendix, `docs/plans/m5-c8-half2-runbook.md`,
`docs/plans/track2-audit-campaign.md`, `docs/plans/post-m5-reset.md`,
`docs/plans/track2-stable-audit-2026-07-17.md`, `docs/plans/wardrobe-ingestion-honesty-pass.md`)
against the live code (`recommend/route.ts`, `lib/mlRecommend.ts`, `lib/mlServiceClient.ts`,
`lib/interactions.ts`, `service/config.py`, `fitted_core/config.py` + `__init__.py`,
`models/*.ts`) and verified every cite by reading the source.

## Summary

The doc set is in good shape — the §23 Open Holes Register is internally consistent and the
runbook §8 deployed-state table is accurate against source almost everywhere (fitted_core
`0.5.0`, prompt `m5-c1.v1`, generator provenance block, the 60/min interaction limiter,
`MAX_PER_ITEM_FEEDBACK=20`, the 2000-row storage ceiling, `max_completion_tokens=2200`, the
env-var footgun `FITTED_SERVICE_KEY`↔`SERVICE_KEY_CURRENT`, and all six referenced Track-2
scripts all check out). Only **two** load-bearing findings, both stale-doc (not stale-code):
a badly-understated jest floor in the runbook's pre-flip gate, and two §23 holes still carrying
a "gated on the C8 flag-flip" forward-pointer for a flip that shipped + went live 2026-07-16.

**Headline count:** 0 blocker · 1 important · 1 minor.

---

## Findings (most severe first)

### [IMPORTANT] F1 — Runbook §4 jest floor "516" is stale by 174 tests (real = 690)

- **Doc:** `docs/plans/m5-c8-half2-runbook.md:83` — the H13 pre-flip gate reads
  `cd fitted && npm test   # 516 (incl. generationSnapshotRoundTrip + serde mirror)`.
- **Reality / other doc:** `CLAUDE.md:103` states `≥690 jest`. Running the suite now yields
  **690 passed / 700 total (10 skipped)**. The intermediate (now-COMPLETED) campaign docs
  record the growth trail: `post-m5-reset.md` (516→522→577→604), `track2-audit-campaign.md:133`
  (≥675), `track2-stable-audit-2026-07-17.md:16` (675), and the 2026-07-18 friend-ready session
  grew it to 690.
- **Which side to change + why:** the **DOC** is the defect. Floors grow, never shrink
  (CLAUDE.md convention); the runbook is *the living Track-2 doc* (its own §8 header + CLAUDE.md
  both name it so), and its executable pre-flip gate citing 516 would let a future operator think
  the suite is ~25% smaller than it is. Update `:83` to `690` (line 82's `≥1091` pytest is
  already correct). CLAUDE.md `≥690` is the correct current value — leave it.
- **Verified:** ran `npx jest` in `fitted/` → `Tests: 10 skipped, 690 passed, 700 total`; read
  runbook `:82–83`, CLAUDE.md `:103`, `track2-stable-audit-2026-07-17.md:16`,
  `track2-audit-campaign.md:133` (which carries a `> COMPLETED 2026-07-17 … History only` banner,
  so its ≥675 is an exempt historical snapshot, not a live conflict — but the runbook's is live).

### [MINOR] F2 — Spec §23 H10 & H29 still say "gated on the C8 flag-flip" (that flip is done + live)

- **Doc:** `docs/Fitted_Spec_v2.md:1239` (H10) and `:1258` (H29) — status column reads
  `**IMPLEMENTED (C5–C7)** → live production write gated on the C8 flag-flip`.
- **Reality / same-register neighbours:** the C8 `USE_ML_SHORTLISTER` flip shipped and went live
  **2026-07-16** — `route.ts:26` dispatches `mlRecommend` on the flag, the live snapshot write is
  in `mlRecommend.ts` step 11, the runbook §8 STATUS banner (`:12`) says
  `DEPLOYED + LIVE-VERIFIED`, and the SAME register already reflects the flip elsewhere: H13
  (`:1242`) `live flip 2026-07-16` and H43 (`:1272`) `RESOLVED (Track 2, 2026-07-16)`. So the
  register is internally inconsistent — two holes carry a forward-pointer the rest retired.
- **Which side to change + why:** the **DOC** is stale. This is the exact "→ forward-pointer that
  outlived its checkpoint" pattern CLAUDE.md:228 names as the recurring register-trust erosion
  (it cites the R0 sweep finding H7/H8/H61 stale the same way). Flip both to
  `LANDED / live since 2026-07-16` with the code cite (`mlRecommend.ts` live write). No code
  change — the write is genuinely live.
- **Verified:** read §23 `:1239` (H10), `:1258` (H29), `:1242` (H13), `:1272` (H43); runbook §8
  `:12` STATUS banner and `:167–192` deployed-state table + E2E-verification note; `route.ts:26`;
  `mlRecommend.ts:544–567` (the live idempotent write + erasure close).

---

## Checked and consistent (no finding)

- **Env-var contract** (CLAUDE.md env table ↔ runbook §1–5 ↔ code): `FITTED_SERVICE_KEY` (Next,
  `mlServiceClient.ts:126`) must byte-equal `SERVICE_KEY_CURRENT` (service, `config.py:112`);
  `USE_ML_SHORTLISTER` gate (`route.ts:26`); `ML_SERVICE_URL` (`mlServiceClient.ts:125`);
  `ML_SERVICE_TIMEOUT_MS` default 45000 < `maxDuration=60` (`mlServiceClient.ts:23–29`,
  `route.ts:23`); `M5_MAX_COMPLETION_TOKENS` override (`config.py:114`). All match.
- **Generator provenance** (runbook §8 `gpt-5.4-mini`/0.5/2200/`chat_completions`/
  `json_schema_strict`/`none`/`none`) ↔ `service/config.py:37–44,64`. Exact match.
- **Rate/spend envelope** (runbook §8): service bucket 12/min (`config.py:103–104`
  `BURST=5`, refill `0.2/s`); per-request cap 2200 (`DEFAULT_MAX_COMPLETION_TOKENS`);
  interactions 60/min/user (`lib/interactions.ts:56`); `MAX_PER_ITEM_FEEDBACK=20` (`:45`);
  2000-row per-user ceiling (`:243–247`). All match.
- **Deployed-state versions** (runbook §8 table `:172`): fitted_core `0.5.0`
  (`fitted_core/__init__.py:44`), prompt `m5-c1.v1` (`fitted_core/config.py:166`). Match.
- **Referenced Track-2 scripts** (runbook §8): `export_track2.mjs`, `track2-erasure-check.mjs`,
  `track2-live.mjs`, `track2-gauntlet.mjs`, `track2-export-roundtrip.mjs`, `track2-lint.mjs` all
  present in `fitted/scripts/`; gated jest files `localServiceSmoke`, `corpusReadback`,
  `outfitLint` all present in `fitted/tests/`.
- **Recommend/regenerate flow** (CLAUDE.md "Where the recommendation flow lives"): route is the
  M5 dispatcher, flag-OFF → §A `renderDegraded`, regenerate folded in as a `/render` with
  `parentSnapshotId`, no `/rerank` endpoint — all faithful to `route.ts` + `mlRecommend.ts:296–320`.
- **Model schemas** (`GenerationSnapshot.ts`, `OutfitInteraction.ts`, `WardrobeItem.ts`) vs their
  doc descriptions in CLAUDE.md + §15.1: partial-unique `{user,requestId}` index, immutability +
  delete guards (H43/H54), append-only feedback with the 4-field binding co-presence guard, 5-value
  `clothingType` + `warmth`, controls default `{lockedItemIds:[],dislikedItemIds:[]}` — consistent.
  (Non-finding: `GenerationSnapshot` intent enum lists 4 values `rescue_item/outfit_upgrade/daily/
  translate` while `service/config.py` `SUPPORTED_INTENTS={daily,rescue_item}` — the extra two are
  `[STAGED]` forward intents, no doc claims the enum is 2-valued, so this is forward-compat, not drift.)
- **§23 register generally:** H7/H8/H11/H12/H19/H43/H48/H50/H54/H55/H57/H58/H59/H60/H61 all carry
  IMPLEMENTED/RESOLVED status with code cites that match the live files; no other surviving
  "→ implement at Cn" forward-pointer found in the active docs (the only `→ implement` string in
  CLAUDE.md:228 is the *rule text* describing the anti-pattern, not an instance of it).

---

## Scope NOT covered (honest)

- **Did not run pytest** (`ml-system` ≥1091, h26 ≥305). The `≥1091` claim agrees across CLAUDE.md,
  runbook §4, and track2-stable-audit; a `grep def test_` lower-bound (776 core + 279 h26) is
  consistent with the parametrized-inflated floors but does not *prove* them. h26 `≥305` unverified.
- **Did not deep-read** the full 1399-line spec body (§1–§22) — only §23 + Appendices A/B and the
  sections the two findings touch. A spec-wide §-by-§ fidelity pass against `fitted_core/` was out
  of budget; I trusted the §23 register + CLAUDE.md as the decision index.
- **Did not audit** `dashboard/page.tsx` / `wardrobe/page.tsx` UI copy against the H45/onboarding
  claims beyond what the runbook records; the ingestion-honesty-pass and friend-ready sessions
  already converged those.
- **Did not re-verify** the completed/retired plan docs (`m0–m3`, `spearhead`, `m4`, `h26`,
  `m5-cutover`, `post-m5-reset`, campaign docs) for internal staleness — they carry COMPLETED
  banners and are off the default reading list; only cross-checked them where a live doc pointed in.
- **Did not check git/deploy reality** (whether `origin/main` is actually at `78e5556a`, whether Fly
  is actually 1 machine, whether Vercel serves the claimed build) — those are runtime facts a
  read-only doc audit can't confirm; taken at the runbook's word.
