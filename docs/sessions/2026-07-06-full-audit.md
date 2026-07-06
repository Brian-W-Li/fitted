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
