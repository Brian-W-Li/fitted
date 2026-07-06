# Full-project audit — post-H26, pre-M5 (2026-07-06)

Checkpointed heavy-loop audit. Find-and-fix, autonomous, loop-within-checkpoint,
stop cleanly at boundaries. Append per checkpoint — never rewrite.

## Baseline (Checkpoint 0)

- **git HEAD:** `4271dee9` — "docs(h26): reconcile canon to H26 COMPLETE — verdict recorded, plan retired, M5 next"
- **Branch:** main. Working tree: CLEAN.
- **Unpushed commits:** 84 (this session's push-safety review, CP1b, must certify).
- **Suite counts vs floors (all MET):**
  | Suite | Count | Floor | Status |
  |---|---|---|---|
  | ml-system core pytest | 752 passed | ≥751 | ✅ |
  | h26 pytest | 302 passed, 1 skipped | ≥302 (+1 skip) | ✅ |
  | fitted/ jest | 375 passed (20 suites) | ≥366 | ✅ |
  - h26 run time ~28s (real work in fixtures); core 0.38s; jest 0.93s.

### Skim notes (things already visibly worth a look)
- `docs/sessions/RECOVERY.md` is a **stale unfilled template** — doc-lifecycle says a
  healthy session clears/replaces it. It currently reads "Unfilled" throughout. → CP2c.
- `.DS_Store` present on disk in repo root, `ml-system/`, `experiments/h26/` but **not tracked**
  (good). Not in any `.gitignore` though — a future `git add -A` could catch them. → CP7c.
- All sealed H26 artifacts confirmed tracked; tree clean.
- h26 `.gitignore` is thorough (photo formats, payloads, closet/, panel_answers/, viewer blob,
  calibration_questions/pilot, closet_input). Cross-check vs docs' CLAIMS in CP1b/2b.

### Checkpoint plan (per the audit brief)
- CP1 safety-critical: 1a spend/side-effect, 1b privacy/push-safety, 1c hash-binds, 1d backups.
- CP2 written-word truth: 2a executable, 2b docs-canon, 2c memory/session hygiene, 2d §23 holes.
- CP3 tests: 3a mutation, 3b (RUN-trap two-state class), 3c coverage gaps, 3d independence/fixtures.
- CP4 python core adversarial: 4a fitted_core re-check, 4b determinism/numerical, 4c numerical spot, 4d data eyeball.
- CP5 app-side: (auth) 5b injection/upload, 5c error-path/concurrency, 5d type-contract/perf.
- CP6 merit/product/portfolio: 6a post-verdict merit delta, 6b promise fidelity, 6c portfolio, 6d bus-factor.
- CP7 ops: 7a deploy gaps, 7b CI absence, 7c git hygiene, 7d live-data (if MONGODB_URI).
- CP8 convergence: regression-of-fixes, loop to zero load-bearing.

---

## CHECKPOINT 1 — safety-critical (2026-07-06)

Outcome: **CLEAN — no BLOCKER/IMPORTANT code fixes needed.** All four lanes verified against
source. One backup gap (actionable by Brian) + two CP7c chips recorded. No code changed →
this checkpoint's artifact is this report section.

### 1a — Spend / side-effect safety: CLEAN
Enumerated every path from tests/tools to network or committed/live-data mutation:
- **h26 OpenAI construction** (`gpt_judge.py:722` `OpenAIJudgeClient.__init__`) is lazy (`from openai import OpenAI`
  inside `__init__`), reached **only** by CLI `cmd_pilot`/`cmd_gate_b` and the skip-guarded live smoke. The unit
  suite injects a fake `openai` module into `sys.modules` (`test_gpt_judge.py:284 _FakeOpenAISDK`, installed
  via `monkeypatch.setitem` before construction) → hermetic, no key, no network. Verified.
- **Live smoke** (`test_gpt_judge.py:471`) `@pytest.mark.skipif` on `H26_LIVE_JUDGE != "1" or not OPENAI_API_KEY`
  — the only token-spending path, opt-in only. Verified.
- **Committed-ledger deletion** (`run_judge.py:184 _guard_gate_b_ledger`): guard is **not inverted** — returns
  early if absent; raises `SystemExit` if `git.identity(ledger).committed` is False; `os.remove` only on the
  committed-clean branch (git preserves the prior paid run). `cmd_pilot`'s bare `os.remove(PILOT_LEDGER)` (line 73)
  targets the **gitignored** throwaway pilot ledger only. Verified.
- **HF model download** (`embed.py` `create_model_from_pretrained`): tests monkeypatch `embed.load_backbone`
  (`test_embed.py:235`) → no download. Suite runs hermetically in ~28s (a real CLIP pull would blow that).
- **fitted_core**: the single `openai` seam is `generation.py:88` (lazy, inside `generate()`); tests inject fake
  `Generator`s; suite runs with `openai` absent by design.
- **App (jest)**: `regenerateExclusion` / `recommendationStability` mock `openai`, `@/lib/db`, `@/lib/firebaseAdmin`
  (`jest.mock(...)`). No live network/Mongo/OpenAI from jest.

### 1b — Privacy / secrets / push-safety: CLEAN — 84 unpushed commits CERTIFIED SAFE TO PUSH
- **No secrets** in tracked tree (`git grep` for sk-/AKIA/PEM/ghp_/AIza/xox → none) nor in full history
  except one **public Chromium CrUX key** (`AIzaSy...Uwgw`) inside a minified `CrUXManager.ts` that lived only in
  the team-era `matthew-hello-world/node_modules/` (a teammate committed a `node_modules` tree). That path is
  **not currently tracked** (0 files) and is already in shared/team history — not a new leak. → **CP7c chip: history bloat.**
- **Emails** in tracked tree are all placeholders (`.env.sample`, `wipeGuard.test.ts` fixtures) or a **PII-rejection
  guard test** (`test_run_tooling.py:257` iterates `"Brian Li"`/`"brian.li@gmail.com"` as inputs it asserts are rejected).
- **Committed H26 artifacts carry no PII/bytes**: `judge_runs.ndjson` rows are `{arm, choice, dropped, model_snapshot,
  order, payload_log_sha256, question_id, retried, sample_index, system_fingerprint}` — hashes only, no image bytes/free-text.
  `closet_manifest.json` = de-identified (`owner_01`, `third_party_api_processing:False`), items hold clothing
  descriptions + `photo_path` (string ref to gitignored `closet/`) + `photo_sha256` — no bytes, no names.
- **Sensitive dirs 0-tracked**: `raw_payloads/`, `panel_answers/`, `closet/`, `embeddings/`, `checkpoints/` all
  untracked + `git check-ignore` YES. The historically-leaked-once files (`closet_input.json`, `calibration_viewer.html`)
  confirmed untracked + ignored.
- **84 unpushed commits**: 172 files / +39250 / −1784, **no binary blobs added**, only closet path added is
  `closet_input.template.json` (a template). → **Certified: the 84 commits are safe to push publicly.**

### 1c — Hash-bind integrity: CLEAN — every committed-byte bind recomputed OK
Recomputed sha256 + git-blob-sha of every frozen file and compared to the recorded binds:
- `metrics._meta.unlock_files` (preregistration.md/.json, judge_addendum.md, closet_manifest.json): all sha256 **and**
  blob OK. `metrics._meta.selection` (selection.json): sha256 + blob OK. `judge_ledger_sha256` (judge_runs.ndjson) OK.
  `closet_metrics_sha256` (closet_metrics.json) OK.
- `selection.json.manifest_hashes` (preregistration.json, fitb_manifest.json, embedding_manifest_fashionsiglip.json,
  type_map.json): all OK. `judge_addendum.md` `calibration_set.manifest_sha256` vs `calibration_set.json`: OK.
- Local-only-verifiable (not committed-byte binds, test-enforced): `selection.checkpoint_sha256` (gitignored `.pt`),
  `judge_addendum.prompt_sha256` (of `gpt_judge.SYSTEM_PROMPT`). No mismatch anywhere → **no BLOCKER**.

### 1d — Backup of irreplaceables: GAP (actionable by Brian, not a code fix)
Laptop-loss today destroys ~70 MB of **non-regenerable** data (gitignored, laptop-only):
| Dir | Files | Size | Why irreplaceable |
|---|---|---|---|
| `raw_payloads/` | 4647 | 18 M | Paid API request/response payloads — the evidentiary provenance behind the committed judge ledger |
| `closet/` | 13 | 52 M | Brian's consented closet photos — the M6 closet-transfer re-measure source; regenerable only by re-photographing |
| `panel_answers/` | 4 | 16 K | Raw per-person panel labels — the calibration_set.json provenance/audit trail |

The **derived** verdict artifacts (judge_runs.ndjson, calibration_set.json, closet_manifest.json, metrics.json,
results.md) survive in git — **but the 84 commits are unpushed**, so today even those live only on this laptop.

**Recommendations (Brian to run):**
1. **Push the 84 commits** — protects all committed/derived artifacts immediately (already certified safe in 1b).
2. **Archive the irreplaceables off-laptop.** A 53 MB tarball was prepared at
   `…/scratchpad/h26-irreplaceable-backup.tar.gz` (4664 files) — but scratchpad is ephemeral. One-command reproducible
   archive to copy to private storage (external drive / private cloud — **never a public remote**; closet photos are
   consent-bound local-only):
   ```sh
   cd ml-system/experiments/h26 && tar -czf ~/h26-irreplaceable-$(date +%Y%m%d).tar.gz raw_payloads closet panel_answers
   ```
   Then move that tarball to private backup manually. (I did not egress it — consent is `third_party_api_processing:False`.)

---

## CHECKPOINT 2 — is the written word true? (2026-07-06)

Outcome: **6 fixes landed (2 IMPORTANT code/doc, 4 doc-truth), 4 report-only NITs, 2 CP7c chips.**
Cheap mechanical checks run inline; the three reading-heavy lanes (2b/2c/2d) ran as parallel
read-only agents, every finding re-verified against source before fixing.

### 2a — Executable truth
- **tsc `--noEmit` was RED (exit 1, 24 errors) — FIXED → now green (exit 0).** All 24 were in `tests/`
  (product code app/lib/models = **0 errors**): 3 test files (`interactionPersistence`, `recommendationStability`,
  `regenerateExclusion`) had no top-level `import`/`export` so TS treated them as global scripts → cross-file
  helper-name collisions (`WARDROBE`, `OPENAI_EMPTY_RESPONSE`, `makeRequest`, …). Fix: appended `export {};`
  module markers. The remaining 8 (all in `addItemUploadStepActions.test.ts`) were React-19 `props: unknown`
  on a DOM-walker — fixed by narrowing to `type El = ReactElement<Record<string, unknown>>` + an `asEl` helper.
  IMPORTANT because CLAUDE.md's build-audit loop prescribes `tsc --noEmit` as a verification signal; it was
  unusable project-wide. All 4 touched tests pass; full jest 375 green; introduced **zero** new lint errors.
- **`npm run lint` is RED pre-existing (48 issues: 28 `no-explicit-any`, 9 `next/no-img-element`, 6 unused-vars,
  2 exhaustive-deps) across product + test code.** Known legacy debt that M5 rewrites (CLAUDE.md "match team style,
  don't refactor for taste" + deletion license). **Report-only / out-of-scope** — scoped-to-touched-file lint (what
  the loop actually requires) is achievable. One artifact leak: `coverage/lcov-report/*.js` is being linted (no
  eslintignore for `coverage/`) → **CP7c chip.**
- **`.env.sample` missing `GEMINI_MODEL` — FIXED** (added, marked optional w/ default). Env-var diff otherwise clean:
  code reads exactly {FIREBASE×5, MONGODB_URI, OPENAI_API_KEY, GEMINI_API_KEY, GEMINI_MODEL, CV_SERVICE_URL}.
- **Requirements coverage OK** (no fresh `pip install` — no-network rule): `fitted_core` has no third-party runtime
  dep beyond the lazy `openai` (declared); h26 `requirements.txt` is fully pinned. pytest core+h26 + jest all green.
- **`npm run build` not run** — requires gitignored `.env.local` (documented). tsc+jest+lint cover the TS surface.

### 2b — Docs-canon truth
- **IMPORTANT — undocumented live Gemini integration — FIXED.** `fitted/lib/gemini.ts` `inferWhyForInteraction`
  (model `gemini-2.5-flash-lite`, `@google/generative-ai`) is fired best-effort from `app/api/interactions/route.ts`
  when `GEMINI_API_KEY` is set, writing `OutfitInteraction.inferredWhy` (`models/OutfitInteraction.ts:46`). CLAUDE.md's
  env table + flow omitted it entirely (a cost-incurring key claimed absent from the "env inventory"). A 2026-06-17
  locked v2 decision said this path was "completely excised" but it survives (m4a-close note confirms only
  PreferenceSummary's use was ripped). Fix: added `GEMINI_API_KEY`/`GEMINI_MODEL` row to CLAUDE.md env table with the
  best-effort/optional/no-op semantics; softened the "all required" line.
- **NIT — CLAUDE.md floors stale-low (≥715/≥366) — FIXED** → `≥751 pytest / ≥302 (+1 skip) h26 / ≥366 jest`.
- **NIT (report-only)** — spec §16/§1079 only mentions gemini.ts in the PreferenceSummary-rip line (accurate but
  implies removal); the surviving `inferredWhy` path is now documented in CLAUDE.md's env table (its correct home).
- **NIT (report-only)** — CLAUDE.md:7 pairs `OutfitInteraction + FeedbackReason` as the current feedback shape, but
  there is **no `FeedbackReason` model** in `fitted/` (it's a spec §16 design concept); current reality is `inferredWhy`.
  Left as future-target framing (touching the top-line summary risks scope creep); env table now carries the truth.

### 2c — Memory / session hygiene
- **IMPORTANT — `MEMORY.md` index line for `project_h26_c4_build` still read "H26 blocked on ≥3 panel labels" — FIXED.**
  The memory *file* was current but its index one-liner wasn't re-synced when H26 closed. Rewrote to "SUPERSEDED: H26
  COMPLETE" pointing at `project_full_audit_2026_07_06`.
- **NIT — `project_h26_c4_audit` index line said "uncommitted / Brian to commit" — FIXED** (marked historical snapshot).
- **CORRECTION to my own CP0 skim:** `docs/sessions/RECOVERY.md` is **NOT stale** — a reset "Unfilled" template is
  exactly the healthy resting state doc-lifecycle wants. Not a finding; my CP0 note mischaracterized it. Withdrawn.
- Retirement banners: **all present** (h26-spike, m4, m3, m2, m0-m1, spearhead all `> COMPLETED`; spec-resolutions +
  scope-decisions carry RETIRED banners). No session note contradicts canon (the one "GO" is the 2026-07-05 Fable
  *ambition-merit* GO, distinct from the H26 spike NO-GO). Clean.

### 2d — §23 holes register health
- **IMPORTANT — MISSING HOLE (EXIF orientation) — FIXED → registered as H53.** results.md §6/§10: all 13 closet phone
  photos carried EXIF orientation 6, PIL ignores EXIF on open, the first probe embedded sideways garments (closet
  AUC 0.4375 → 0.5625 after `exif_transpose`). "M4/W-track ingestion must normalize EXIF before embedding" — a bug
  that already halved a real measurement, feeding the pre-registered M6 re-measure. Was in results.md but unregistered.
- **IMPORTANT — MISSING HOLE (snapshot delete-guard) — FIXED → registered as H54.** `GenerationSnapshot.ts:481-483`
  guards update/replace/save but has **no `pre(["deleteOne","deleteMany"])`** — a raw delete can hard-remove an
  immutable training snapshot outside the redaction seam. Nominated in the 2026-07-02 handoff, never promoted; M5
  closes it with the live writer (redaction is the only sanctioned removal).
- **NIT — §20 "Scorer-seam shape" row hard-coded `(post-H26, pre-M5)`** while §20 prose + §23-H28 make timing an
  M5-`/spec` call post-NO-GO — **FIXED** (row status reconciled to the flexible timing). Conflicts are bugs.
- **NIT (report-only)** — results.md §9.5 "dated-2017-taste" M6 risk not in §23. Register at M6 entry (M6 not greenlit;
  the escape rides the already-registered `SignalScorer` behavioral slot). → soft chip.
- Verified clean: no OPEN hole is silently resolved-but-still-marked-open (H13/H28/H48–H51 re-checked vs source);
  H26/H28 correctly reflect NO-GO + item-level-shape-falsified.

### CP2 task chips (out-of-scope, for CP7c / M5)
- `coverage/` is not eslint-ignored (lint touches generated `lcov-report/*.js`).
- `matthew-hello-world/node_modules/` bloat in git history (from CP1b) — old team era, not tracked now.
- Legacy `npm run lint` debt (48 issues) — folds into the M5 app-side rewrite, not a standalone task.

---

## CHECKPOINT 3 — the tests themselves (2026-07-06)

Outcome: **3 mutation survivors found (all test-gaps, code correct) → 4 hardening tests added
+ re-verified to catch their mutations.** 3b/3d clean; 3c gaps are legacy/infra → chips.
Floors grew: h26 302→304, jest 375→377, core 752.

### 3a — Mutation sweep (12 load-bearing rules across both stacks)
Method: mutate source line → run covering test → confirm red/green → `git checkout` revert.
| # | Rule mutated | File | Result |
|---|---|---|---|
| M2 | gate-B power `hw <= delta` → `hw <= delta*2` | evaluate.py | ✅ caught (3 fail) |
| M6 | verdict `a and b and d` → `or` | evaluate.py | ✅ caught (6 fail) |
| M1 | gate-A `low > thr` → `>=` | evaluate.py | ❌ **SURVIVED** |
| M5 | gate-D `low >= floor` → `>` | evaluate.py | ❌ **SURVIVED** |
| R1 | ranker score sort `reverse=True` → `False` | ranker.py | ✅ caught |
| R2 | ranker tie-break `full_signature` → reversed | ranker.py | ✅ caught |
| R3 | overuse group.sort `-score` → `+score` | ranker.py | ✅ caught |
| V1 | validator `item_id == ""` → `!= ""` | validator.py | ✅ caught (123 fail) |
| S1 | serde `not isfinite` → `isfinite` (NaN/Inf leak) | snapshot_serde.py | ✅ caught (21 fail) |
| W1 | wipeGuard exact-host right `[:/]` → `[.:/]` | wipeGuard.ts | ✅ caught |
| W2 | wipeGuard left-anchor `(^\|[.@/:])` → `(.*)` | wipeGuard.ts | ❌ **SURVIVED** |

**3 survivors — all TEST GAPS (the code is correct; the guarding test was missing). FIXED:**
- **Gate A strict-`>` boundary** — no test pinned "CI_low exactly at the 0.0 threshold must FAIL"
  (metrics.py §12 documents the strict-`>` as deliberate: a head *not decisively above* its zero-shot
  floor must fail). Added `test_gate_a_boundary_ci_low_exactly_at_threshold_fails`.
- **Gate D inclusive-`>=` boundary** — no test pinned "CI_low exactly on a floor still PASSES."
  Added `test_gate_d_floor_inclusive_at_exact_floor_passes` (both floors, 0.81 + 0.50).
- **wipeGuard `(^|[.@/:])` left-anchor** — the existing "contains-label" tests only covered invalid
  *right* boundaries (`fitted-dev-shadow`, `myfitted-development`); a label with a **valid right but no
  left** boundary (`xlocalhost:27017`, `notfitted-dev.abc.mongodb.net`, `evil127.0.0.1`) would authorize
  an irreversible wipe. Safety-critical. Added the covering test + an unparseable-URI case (also closes
  the wipeGuard line-18 coverage gap). Each new test re-verified to catch its mutation (M1/M5/W2 now red).

### 3b — RUN-trap two-state class: CLEAN
The 2026-07-02 RUN-traps (pytest deletes live ledger / tests go red on RUN success / spend) are fixed and
robust: `test_freeze.py:244` asserts the FROZEN branch is schema-valid (not vacuous post-RUN);
`test_evaluate.py:177 test_compute_metric_suite_writes_nothing_to_metrics_json` uses mtime-before/after
(so it stays valid after a real emit committed metrics.json — the old "does not exist" would go red);
`_guard_gate_b_ledger` tests use tmp scaffolds, never the live ledger. No test silently goes vacuous now
that `frozen:true` / artifacts-present.

### 3c — Coverage-guided gaps (jest-native; no pytest-cov under the no-network rule)
Logic files 100% branch (clearWardrobe, clothingType, deriveWarmth, keywordMatch, wardrobeValidation,
cvToWardrobeForm 98%). Load-bearing gaps: **weather.ts 0% (228 lines)** — legacy that M5 re-derives as the
Lens field → **chip** (don't test code slated for deletion); **gemini.ts 0%** — the newly-surfaced
best-effort path (returns null on any error) → **chip**. Infra files (db/firebaseAdmin/mongodb/imageStorage)
low unit coverage is expected — exercised via mocked route tests. Python decision-point gaps were surfaced
directly by the mutation sweep (higher signal than a line %) and closed above.

### 3d — Independence + fixture realism: CLEAN
Stateful h26 files (test_gates/freeze/evaluate/run_tooling/evaluate_emission) each pass **standalone** as
well as in-suite — no cross-file coupling; monkeypatch-based isolation (auto-undone) holds. Fixture realism:
`test_gates` runs `apply_gates` on the **real committed metrics.json** (not only the synthetic `_metrics()`),
so the fixture shape is validated against reality. Deep three-way-contract realism → CP4a.

### CP3 task chips
- `weather.ts` (228 lines) untested — legacy, M5 deletes; no test investment.
- `gemini.ts` untested — best-effort optional path; add a null-on-no-key + timeout test if it survives M5.

---
