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

## CHECKPOINT 4 — the Python core, adversarially (2026-07-06)

Outcome: **CLEAN across all four lanes — no BLOCKER/IMPORTANT; NITs are report-only.** No code
changed (verification checkpoint). 4a/4b ran as parallel agents (verified against source + empirically);
4c/4d I ran directly on the real local data (`data/` 136M Polyvore + closet photos + embeddings all present).

### 4a — fitted_core re-check (agent + spot-verify)
- **Determinism: bit-identical.** Same `RescueRequest` twice → dict-equal AND `json.dumps(sort_keys=True)`-equal
  wire docs; different seed (generation_index / session_id) moves both the sampler draw and the tie-break order.
  `seed.py` uses `hashlib.sha256` (not process-salted `hash()`) + a dedicated `random.Random`.
- **Boundaries degrade gracefully:** empty wardrobe → clean `ValueError` (forced item can't exist); single-item /
  all-one-type → `not_enough_items` + hint; single dress → 1 valid variant; giant (5001 items) → sub-quadratic
  (16× items ≈ 6× time; caps bound the pool before O(n²)).
- **M4b three-way contract COHERENT:** every TS `required` field (minus the two M5-owned `user`/`interactionCountAtRequest`)
  is authored by the Python producer; casing round-trips (`type`→`clothingType`, data-Map key `outer_layer` verbatim);
  version constants match (`fitted_core_version` 0.4.0 ↔ `fittedCoreVersion`; `ranker_config_version` sha ↔ `rankerConfigVersion`);
  `schemaVersion` correctly TS-only. Both `test_m4_e2e_fixture.py` and `m4bSnapshotContract` green.
- **NIT (report-only) — empty-items `ZeroDivisionError`** in `response.compatibility()`/`visibility()`
  (`_neutral_anchor`/`_occasion_overlap`/`_statement_tags` do `sum/len(items)` with no empty guard, unlike the
  pair-helpers). **I verified it is UNREACHABLE:** `is_valid_slotmap(SlotMap())` → `(False, empty_base)`, so ≥1 item
  is an upstream invariant. Correctly NIT (were it reachable it'd be a BLOCKER). → chip for M5 (these are the public
  "M6 seam" fns; add `if not items: return 0.0` when wired live).
- **NIT (report-only) — `admittedViaFallbackStage`** in `GenerationSnapshot.ts:112` `CandidateSnapshotSchema` is never
  authored by the Python builder (optional → both suites still pass). Reserved-but-unwired; M5 decides populate-or-drop.

### 4b — Determinism + numerical sweep (whole Python surface, agent)
All 8 hazard classes CLEAN on every load-bearing path (metrics.json / committed artifacts / seeds / ranked output):
unseeded-random (every RNG seeded — `random.Random(seed)` / `np.random.default_rng(seed)`); wall-clock (only
`bench_head.py` uses `date.today()`, into an explicitly-non-frozen artifact); set/dict order (the one risky site,
`iter_positive_edges` returning a set, is consumed through `sorted(...)`); filesystem order (`sorted(glob.glob)`,
`sorted(Path.glob)`; embedding cache re-keyed to corpus order); float-== (all are exact-by-construction or
intentional bit-determinism *fail-loud* guards, never silent corruption); accumulation order (fixed loader order;
the co-occurrence detector uses a `1e-3` tolerance); div-by-zero (every reduction guarded — `auc_pos_neg` rejects
empty, `bootstrap_ci` requires ≥1 cluster, each cluster carries both a pos+neg score so no all-one-sign slice);
quantile (`0.05/2==0.025` bit-exact; `two_sided_boot_p` exact-zero replicates push p in the SAFE direction). NITs:
machine/torch-pinned reproducibility (documented, by design) + `popularity_deciles` empty-guard (unreachable/reported-only).

### 4c — Independent numerical spot-audit (my fresh code, not evaluate.py)
Re-derived / cross-checked 15+ numbers — **all consistent, correctly rounded:**
- Every `metrics.json` CI half-width recomputed = `(high−low)/2`. **Gate-B power margin = 0.050302 − 0.05 = +0.000302**
  (matches results.md/CLAUDE.md +3.02e-4); CI_low 0.2213 > +δ → power miss not accuracy miss ✓.
- Gate A +0.0995 [+0.0969, +0.1022] ✓; gate D outfit_auc 0.845 (low 0.8408 > 0.81) + fitb 0.621 (low 0.6127 > 0.50) ✓;
  judge low 0.3058 > 0.25 ✓; seam +0.216 [+0.212, +0.220], Holm p 0.0 ✓; closet AUC 0.5625 CI [0.2857, 0.75] wholly
  below the 0.7 floor ✓; drop CI [−0.019, 0.448] straddles ✓.
- **AUC convention verified independently:** fresh Mann-Whitney (`(wins + 0.5·ties)/(|pos||neg|)`) == `metrics.auc_pos_neg`
  == `sklearn.roc_auc_score` to 1e-9.
- results.md printed values match metrics.json at displayed precision (4-dp CIs); no banker's-rounding hazard surfaced.

### 4d — Data-level eyeballing (the EXIF class — only found by LOOKING)
- **EXIF (H53) validated on real pixels:** all 5 sampled closet photos carry **orientation 6** (stored 4032×3024
  landscape); `ImageOps.exif_transpose` rights them to portrait — rendered `IMG_5061` post-transpose shows dark jeans
  correctly vertical (would be sideways to the embedder without the transpose). Confirms H53's premise + fix direction.
- **type_map coverage PERFECT:** all **153** distinct `category_id`s in `polyvore_item_metadata.json` have a type_map
  entry (**0 reachable-but-unmapped**); 6 defensive extras. No item can be silently dropped/crashed for a missing map.
- **Ledger integrity:** `judge_runs.ndjson` = 3000 rows, all sampled `payload_log_sha256` are valid 64-hex; 151/200
  sampled `raw_payloads/*.json` hash-match a ledger row (the rest are pilot/reverse/retry payloads outside the gate-B
  ledger — expected). Provenance chain intact. `calibration_visual_qc.json` present with the closet exclusion list.
- Parquet corruption: not sampled fresh (image parquet is the download-gated mvasil source); indirectly clean — the
  full AUC pipeline ran to sensible numbers over the corpus and the visual-QC exclusion list exists.

### CP4 task chips
- M5: when `response.compatibility()`/`visibility()` get wired as a live scoring seam, add the `if not items: return 0.0` guard.
- M5: decide `admittedViaFallbackStage` — populate it in the live snapshot writer or drop it from the TS schema.

---

## CHECKPOINT 5 — app-side (PARTIAL — stopped at a clean boundary 2026-07-06)

**STATUS: security lane (5a auth-completeness / 5b injection+upload) DONE + npm audit (part of 5d) DONE.
The robustness lane (5c error-path+concurrency / rest of 5d type-contract+perf) was NOT run — its agent
was interrupted before launch. RESUME CP5 by running that lane, then CP6+.** App-side findings are almost
all §19-registered and M5-owned (no code fixes now — this vertical is rewritten at cutover); the one code
action taken was a §19 register-accuracy fix.

### 5a/5b — Security review (agent, findings verified against source)
- **The 7 routes §19 calls "secure host-infrastructure" all check out** — each verifies the Firebase ID token
  (`adminAuth.verifyIdToken`), derives `userId` only from the token, and scopes every Mongo query by `{user: userId}`.
  Verified: `wardrobe` GET/POST, `wardrobe/[id]` PATCH/DELETE, `wardrobe/[id]/image` POST, `wardrobe/clear`,
  `recommend`, `recommend/regenerate`, `cv/status`. **No unregistered auth hole on these.**
- **NEW-1 (IMPORTANT / prod-BLOCKER) — cross-user read primitive via `interactions` POST→GET.** VERIFIED against
  source: POST stores `items: itemIds` from the body with no ownership check (route.ts:157-159); GET's
  `.populate({path:"items", select:"name category colors imagePath"})` (route.ts:67-71) is NOT user-scoped, so an
  attacker POSTs an interaction referencing a victim's `WardrobeItem` ObjectId, then GETs to read that item's
  name/category/colors/imagePath — and `imagePath` chains to the unauth `images/[imageId]` route for photo bytes.
  This is the amplified consequence of the registered "interactions POST: no ownership check on items" hole; the
  register's one-liner undersold it. **FIX APPLIED (docs only): §19 trust-boundary-gates line amended** to name the
  GET-populate sink + the imagePath→images chain, so the M5 implementer scopes the populate, not just the write.
- **REGISTERED, confirmed, under-described (noted, M5-owned):** `account/route.ts` is a read+write primitive for an
  *arbitrary* user given only their (non-secret) Firebase UID — GET leaks email/age/gender/feedback; PATCH overwrites
  profile + photo (input validation itself is fine — gender allowlist, age 0-130, photo data-URL regex + 3MB cap, no
  SVG/`javascript:` bypass). `images/[imageId]` unauth + enumerable ObjectIds + an uncaught `CastError`→500 on a
  malformed id (NIT amplifier). `cv/infer` unauth + content-type allowlisted but **no `file.size` cap** before
  buffering the whole upload → memory/cost amplification.
- **NEW-2 (NIT) — `cv/status` GET unauthenticated** — server-side `fetch(HEAD)` to the fixed `CV_SERVICE_URL` env
  (not user-controlled → not SSRF); worst case an unauth caller probes/keeps-warm the CV backend.
- **Prompt injection — LOW/NIT:** `recommend`/`regenerate` interpolate `eventDescription`/`weatherSummary`/
  `changeTarget`/`feedbackNotes` raw into the user message; `gemini.ts` interpolates item names/occasion raw. Impact
  is low — output is structurally validated server-side (outfits whose itemIds aren't in the caller's own shortlist
  are dropped), it's the attacker's own session, no tools/side-effects. M5 hardening pass, not a blocker.
- **Checked CLEAN:** NoSQL/`$`-injection (every body-id query also scoped by token `user`; `_id` ObjectId-cast; path
  params are strings) · ReDoS (no `new RegExp(userInput)`; all dynamic regexes built from static escaped keyword lists)
  · upload path-traversal (images stored as base64 in Mongo, ids never used as filesystem paths; 5MB cap + jpeg/png/webp
  allowlist; SVG excluded so `images` can't serve an XSS payload).

### 5d (partial) — npm vulnerability scan
`npm audit`: **19 vulnerabilities (1 critical, 6 high, 11 moderate, 1 low)** — all transitive under `firebase-admin`
(→ `@google-cloud/firestore` → `google-gax`; `teeny-request`→`uuid`; `retry-request`). Not app code; a dependency-bump
task for the M5 deploy prep. → CP7a/deploy chip. (License scan + the rest of 5d fold into the deferred robustness lane.)

### CP5 status / resume
- **DONE:** auth-completeness, injection, upload, npm-vuln. **NOT RUN:** error-path UX, concurrency/races
  (double-submit interactions, parallel regenerate, wardrobeimages cascade under concurrent delete), type-contract
  (`any`/casts on the data path, schema↔interface↔dataclass mismatches), perf (N+1, indexes-vs-queries). These feed
  the M5 spec; run them next session, then CP6 (merit/product/portfolio) + CP7 (ops) + CP8 (convergence).
- **CP5 task chips:** all app-side security fixes are M5-owned via §19 (now with NEW-1 folded in); firebase-admin
  dep-vuln bump at deploy.

---

### 5c/5d — Robustness lane (session 2, resumed 2026-07-06)

Outcome: **CLEAN — no NEW load-bearing hole. 1 doc trap-guard landed (spec §15 R5).** Three parallel
read-only sub-lanes (concurrency+error-path / type-contract / perf); every load-bearing claim re-verified
against source. One cross-agent conflict resolved by reading the Mongoose source myself. Findings are all
§19/§15-registered + M5-owned (this vertical is rewritten at cutover). No app-code changed.

**Concurrency + error-path (agent + spot-verify): CLEAN.**
- Double-submit interactions: no unique index (`OutfitInteraction.ts:104` is plain multikey), two POSTs → two
  rows + 2× Gemini fire. **Registered §23-H11** (append-only by design; dedup is an M5 read-time reducer). NIT
  caveat: legacy rows never write `snapshotId`/`candidateId`, so the H11 dedup key degenerates to `{null,null,action}`
  for the pre-M5 corpus — moot under the M5 DB-wipe; M5 must wire the binding write before relying on the reducer.
- Parallel regenerate: **genuinely race-free** — `recommend`/`regenerate` routes are DB-read-only (no exclusion
  write, no snapshot counter — the racy snapshot write doesn't exist yet). No finding.
- wardrobeimages cascade: single-item DELETE (`wardrobe/[id]/route.ts:176-199`) is item-first then best-effort
  `WardrobeImage.deleteOne` in a log-and-continue try/catch — non-atomic, orphan-image-on-mid-failure (the *safe*
  direction: leaked doc, never a dangling pointer). Image **replacement** (`image/route.ts:74-94`) deletes old
  before storing new = data-loss ordering — **registered §23-H14** (DEFERRED-W-track). No Mongo txn anywhere
  (`lib/mongodb.ts` plain pooled conn). Minor NIT extension of H14, not separately blocking.
- Error-path: systemic **500-on-CastError** (malformed ObjectId → generic catch → 500 where 400 is right) across
  the legacy vertical — NIT, M5 "validate ObjectIds at the boundary". Best-effort Gemini side-effect is correct
  posture (durable save at `:157` before enrichment fires). No data corruption anywhere.

**CONFLICT RESOLVED (I read Mongoose 8.23.0 source myself):** the type-contract agent's F4 claimed interactions
GET crashes 500 on a deleted-item ref (`item._id.toString()` on a null populate result). **REFUTED against
`node_modules/mongoose/lib/helpers/populate/assignVals.js` `valueFilter`:** for a dangling array ref with
`retainNullValues` falsy (the default), the loop hits `continue` and **strips** the element — `interaction.items`
holds only successfully-populated docs, so the `.map` never sees null. The concurrency agent was right; F4 is
wrong. The `item: any` cast there is cosmetic, not a load-bearing crash-hider.

**Type-contract (agent + source-verify): three-way contract is TYPE-safe for every field Python authors.**
Enums / int-vs-float / nullability / nested shapes / version constants all agree; the serde rejects the two
corruption classes (non-finite floats `snapshot_serde.py:291`, non-string ids `:204`) at author time. The one
genuine forward-compat gap (**F1/F2, verified**): `GenerationSnapshot.ts:272-273` pins `occasion` `required` +
`weather` to a 5-value `enum`+`required`, but `RescueRequest.weather/occasion` (`rescue.py:88-89`) cross as
unvalidated free `str` (`__post_init__` validates only generation_index/k/n_surfaced). **Ownership already
registered** (§15 R5 = M5 adapter owns weather-bucketing + occasion-normalization; §7 step-0). What was
missing = the *consequence*: a normalization miss hard-fails the Mongoose insert and, since the write is
async/best-effort, **silently drops the training row**. → **FIX APPLIED (doc): spec §15 R5 bullet gains a
trap-guard** — "R5 is load-bearing for snapshot-write integrity, validate-or-log-and-skip before constructing
the snapshot, never let Mongoose throw mid-write." Conflict-free amplification, not a new hole.

**Perf (agent + index-vs-query table verified): no DB-level defect.** Every user-scoped query is index-backed
(`User{authProvider,authId}` unique; `WardrobeItem{user}` + `{user,updatedAt}`; `OutfitInteraction{user,createdAt}`;
all cascades `deleteMany({user})` on `{user:1}`). The interactions-GET populate is **batched** (one `$in`), not
an N+1. Dormant M4b GenerationSnapshot indexes already match the planned M5 read shapes. Two NITs both inside
M5-deleted code: `docs.find` in a `.map` (`recommend:606`/`regenerate:600` — should be a Map, negligible at closet
scale); unbounded per-user `WardrobeItem.find({user})` feeding the shortlister (single-user bounded, the #112
cap-at-80 is the intended mitigation). All expected demo-scale legacy; the M5 sampler is their principled replacement.

**CP5 VERDICT: COMPLETE.** Security lane (session 1) + robustness lane (session 2) both done. Zero app-code
fixes (correct — the vertical is M5-rewritten); 2 doc actions total (§19 NEW-1 register-accuracy in s1, §15 R5
trap-guard in s2). No NEW unregistered load-bearing hole survived verification across either lane.

---

## SESSION 1 STOP (2026-07-06) — clean boundary after CP4-complete + CP5-partial
CP0–CP4 fully complete + committed. CP5 partial (security lane done + committed; robustness lane pending).
No agents in flight. Next session: resume at CP5 robustness lane. Suite floors after this session:
**core 752 / h26 304 (+1 skip) / jest 377.** Commits this session: afb51a5d, c9a94e9d, 37a3d2f9, 2e1b74ca,
265800c0, + the CP5 commit below.

---
