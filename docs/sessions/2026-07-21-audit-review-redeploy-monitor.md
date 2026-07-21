# 2026-07-21 — Audit-review → redeploy both halves → monitor (coordinator session)

Executed the 3-stage continuation-coordinator charter (now deleted; it ran). Standing constraint held
all session: `ml-system/experiments/h26/gate_b_extension.py` (a parallel gate-B session's in-flight
work) was never touched, staged, or committed — verified untracked at close.

## Stage 1 — audit-review of the 2026-07-20 merit+live+dynamics audit (`fd5b1448`) + prereg fold-in (`7ae9ebb5`)

Orchestration: 6 read-only verify lanes (workflow) + coordinator-run mutation testing + full suite run.
The audit **stands**; findings folded into their single homes + appended to
`docs/sessions/2026-07-20-merit-live-dynamics-audit.md`. Commit `734ea85e`.

- **CONFIRMED:** power-math undecidability re-derived from scratch (Hanley-McNeil, catalog AUC 0.7315 —
  every `preregistration.md` §9 constant reproduced); the 3 dynamics tests load-bearing by mutation
  (serialization pin, composed erasure race, different-identity 409 — each went red under its mutation,
  sources restored via `git checkout`); H68/H69 accurate; prereg homes mutually consistent; git clean.
- **LOAD-BEARING (Lane 3):** the TOKCAP-1 discharge was **daily-only** but records claimed the whole
  "capped worst case." The pre-C5 gate named TWO asks (daily *and* rescue); only daily-12 ran. Rescue is
  unbounded by the daily-12 cap (`_rescue_candidate_requested` → [6, 40], up to ~6,800 tok >> 2,200).
  Fixed: scoped the discharge to DAILY across all 4 homes (config.py / Spec §16 / runbook §8 / m5-cutover)
  and registered the un-revalidated rescue ask as graded residual **TOKCAP-2** (runbook §8). Not a blocker
  — the ask is an upper-bound hint; a large rescue yield degrades gracefully (truncation → repair →
  "couldn't find enough", never a 500), and friend closets are small.
- **Truth refreshes:** H67 render rate 6→12/min sustained (burst 5); suite floors to ground truth across
  README / CLAUDE.md / runbook §8 — **1098 ml-system pytest / 308 (+2 skip) experiments / 793 jest**
  (verified by running all three in `.venv`; base anaconda numpy is broken — use `ml-system/.venv`).

## Stage 2 — push + redeploy BOTH halves (pre-recruit checklist item 2)

- Pushed `fc53b987..734ea85e`.
- **Web** (`npx vercel --prod` from `fitted/`): `dpl_BJiWUrkMvwuWLh2KLHnVWmKaifXP` READY → aliased
  `fitted-three.vercel.app`, 200.
- **Fly** (`fly deploy` from `ml-system/`): image `deployment-01KY3AR1TAZS67900TCCHW20FE`; rolling update
  reused the single machine — **`fly scale show` = exactly 1** (no HA machine spawned; G1 held); `/readyz`
  green (fittedCore 0.5.0, prompt m5-c1.v1).
- **Sanctioned gate (once, ~1¢, erased):** `track2-gauntlet.mjs run college-male-minimal` → daily renders
  200/3-candidates + reroll + feedback accepted/rejected (real `snapshotId` + populated `shown` +
  bound feedback = `bindable:true`) → `erase-all` (200) → `corpusReadback` **0 orphans** (all 8 integrity
  checks green). This was the first live exercise of `217a6ee3`'s newly-deployed code on both sides.

## `217a6ee3` focused audit (added this session — it was outside the Stage-1 charter but went live today)

`217a6ee3` (2026-07-20) was the one substantive *runtime* change since the last stable build (`30b03cc9`,
07-19) and shipped live for the first time today. Verdict: **sound, behavior-preserving, no load-bearing
findings.** It single-homes the warmth band (0..10) + token default (2200) that were hand-copied at ~8
TS↔Python sites, and pins them equal. Values unchanged; predicates logically identical. The one behavioral
tightening (Python now rejects `warmth < 0`) is safe — the adapter has always dropped negatives, so it is
unreachable via the real Next→service path. The cross-runtime pin is **real, not a mirror**:
`crossRuntimeContract.test.ts` imports the actual constants + reads `contract_fields.json` and asserts
key-set + value equality; `test_render_contract.py` asserts `CROSS_RUNTIME_CLAMPS == live cfg` and the JSON
mirrors the module. TS == JSON == Python transitively; either side drifting reddens a suite. Both pin tests
are green in the suites, and the live gate proved the path end-to-end.

## Stage 3 — the monitor (checklist item 4) + close-out

- **Built `fitted/scripts/track2-monitor.mjs`** (`npm run track2:monitor`) — the CI-shaped ops artifact.
  Two HARD read-only checks (`/readyz`==200+ready ∧ Fly machine-count==1) + an informational yield readout;
  a hard FAIL fires a macOS notification + appends `track2-monitor.log` + exits non-zero. Both PASS and FAIL
  paths verified live. **Script-only per Brian's call** — not scheduled; the launchd daily plist is
  documented in runbook §8 for when he wants it running unattended. `track2-monitor.log` gitignored.
- Checklist items 2 + 4 checked off in runbook §8; deploy-state ops line refreshed to current truth.

## Explicitly NOT this session (remaining, per charter)

- Brian's H26 **gate-B power extension** (his parallel session — `gate_b_extension.py`; reconcile §23-H56
  only when it lands).
- **Staggered friend onboarding** (checklist item 3 — a rule, not a build task) and **recruiting** 3–5
  closets (Brian, out-of-session) toward the M6/H26 re-measure entry conditions.
