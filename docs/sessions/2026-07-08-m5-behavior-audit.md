# M5 C1–C4 behavior-ticket audit (2026-07-08)

Method: behavior-driven vertical trace `ambition → plan → code → tests`, suspect-first, adversarial.
Four Claude auditors, one per cluster. **Every finding below re-verified against source by the main
session** (not trusted from the subagent). This is a **same-model (Claude→Claude) audit** — per
[[feedback_cross_model_review]] the `WORKS` verdicts carry a shared-blind-spot risk and are the
targets for the Codex decorrelated pass, NOT settled.

## Verified findings ledger

| ID | Sev | Cluster | Class | Status |
|---|---|---|---|---|
| **F1** | ~~MEDIUM~~ | daily orchestrator | ~~code defect~~ → **OVERTURNED (doc+test only)** | Fable decorrelated read: current code is CORRECT |
| **F2** | MEDIUM | generator/§D | unrealized order (test) | verified test gap |
| **F3** | LOW | service clamps | unrealized order (test) | verified test gap |
| **F4** | LOW | scorer seams | test-quality (vacuous assert) | verified test gap |

### F1 — trace-completed degenerate emits an English `reasonHint` (should be `engine_failure`)
- **Behavior:** a valid daily/rescue request whose GPT output is unparseable-after-repair (or refusal /
  cap-truncation / empty valid set) → HTTP 200 `degenerate:true`. Convention (§A, comment `app.py:84-88`):
  every `degenerate:true` failure carries the **stable machine code** `"engine_failure"`.
- **Defect:** `app.py:870-881` — the two dedicated degenerate arms (`:822`, `:864`) hard-code
  `_ENGINE_FAILURE_HINT`, but the third path (payload assembled, `generation_attempts` non-empty,
  `n_surfaced==0`) returns `reason_hint=result.reason_hint` with no branch on `degenerate`. On parse-fail
  `payload is None` (`rescue.py:1526`) → empty survivors → `insufficient = 0 < 3 = True` →
  `reason_hint=_INSUFFICIENT_AFTER_GENERATION_HINT` (English, `rescue.py:746-748,1555`).
- **Concrete:** parse-fail daily render → `flags.reasonHint="couldn't assemble enough distinct ways to wear
  this item right now — try regenerating"` **and** `insufficientAfterGeneration=true`, instead of
  `reasonHint="engine_failure"`. This is the **most common** degenerate, so the divergence is the default,
  not an edge. C5/C6 client switching over the failure machine-code family falls through to unknown, and a
  total failure is mislabeled as a healthy partial.
- **Unpinned:** no degenerate-arm test asserts `flags.reasonHint` (`test_render_flow.py:315,333,347,562`
  check `degenerate`/`generationAttempts`/`finishStatus` only).
- **Disposition (OVERTURNED 2026-07-08 — the proposed code change was WRONG; current code is correct).**
  The same-model audit read the plan's letter ("degenerate → machine code") as a bug and would have made the
  third path emit `engine_failure` with all healthy flags false. A **Fable decorrelated read** (the pass this
  ledger's header reserved for exactly these WORKS/finding verdicts) rejected it: the zero-survivor third path
  threw **no exception**, `diagnostics.engineFailure` is `None`, and `generationAttempts` ARE recorded — it is
  **model-produced-nothing, not engine-crashed**, and its remedy is the regenerate CTA the milestone just
  built. Flattening it to `engine_failure` would (1) **falsify** `insufficientAfterGeneration` (generation
  genuinely left `< n_surfaced`), (2) break the honest-partial continuity (1-of-3 vs 0-of-3 survivors share
  cause + remedy), (3) misroute the user to a generic error, and (4) buy the corpus nothing — the
  crash-vs-garbage distinction lives in `diagnostics`, never in `flags`. The audit's "client falls through to
  unknown" premise was also factually off: `degenerate`/`engineFailure` are NOT in the G15 browser allowlist,
  and the register is already decidable (any healthy flag true → prose; all false + non-null hint → code).
- **What actually landed (doc + test, no code change):** (1) reconcile plan §A — replace the imprecise "the
  client keys on `degenerate`" sentence with the real register discriminator + an explicit anti-F1 trap-guard;
  (2) reword §J docket (a) to "the engine-failure **arms'** reasonHint" (not "the §D degenerate reasonHint");
  (3) add named guards to `test_empty_valid_set_is_degenerate` + `test_parse_fail_after_repair…` asserting
  `reasonHint != "engine_failure"` (+ `engineFailure is None`) so a future "flatten the degenerate arms"
  regression trips a named test. **Lesson:** a same-model finding that flips a contract + rewrites its guarding
  test is not turnkey — a "Fable read optional" note on a genuine flag-semantics call was the tell.

### F2 — no test pins an *unrecognized* non-stop `finish_reason`
- Code correct: `abnormal_finish_status` (`snapshot.py:613`) is general (`finish_reason not in (None,"stop")`).
  But every pinning test uses only `stop`/`length`/`refusal`. A regression narrowing to a `{length,refusal}`
  allowlist passes the whole suite — the false-"healthy-empty" slip §A.6-6 exists to prevent.
- Fix: add `FinishStatus("content_filter", None)` cases at `test_snapshot.py:433` and a render-flow degenerate.

### F3 — two clamps lack an at-limit-passes test
- `MAX_CONTROL_IDS`(50) `test_render_contract.py:196` and `MAX_ITEM_TAGS`(25) `:431` have only limit+1-rejects.
  A `>`→`>=` regression on those two slips. Every other constant has both halves. Add exactly-at-limit cases.

### F4 — a byte-identity assertion is near-tautological
- `test_c4:262` `assert audit.result == rank(variants, ctx)` where `audit.result` is itself an internal
  `rank()` output → `rank()==rank()`. Reads as a byte-identity proof; isn't. The real guarantee rests on the
  unchanged `rank()` body + the M3 golden suite (both hold). Replace with a frozen expected-order literal.

## Clean (verified WORKS, but same-model — hand to Codex)
Generator API surface (strict schema/cap/reasoning/store/cache/timeout/retry/finish-status routing),
service trust boundary (auth+rotation, all render-side clamps pre-spend, generator 11-field exact-match,
`full_signature` shown-zip, `/readyz` secret-safety, rate bucket vs single-instance `fly.toml`, error
envelope), scorer seams (AffinitySignalScorer opens the slot with a positive-selection proof; H28 seam
doesn't touch rank order; M0–M3 `rank()` byte-identical; regenerated `m4b_e2e_snapshot.json` diff strictly
additive). **These are the rows most worth Codex challenging** — the trust boundary especially.

## C5-blocked (mandate exists, no code to audit yet)
The entire TS side: Next route rewrite, live snapshot write, `requestId` idempotency index + E11000
winner-re-read, feedback binding `{snapshotId,candidateId}`, browser-response allowlist enforcement,
degraded-browser-response arm. Not holes — nothing landed to suspect.
