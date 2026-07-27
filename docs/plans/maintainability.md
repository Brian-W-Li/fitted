# Maintainability campaign — make the repo hold its own shape

> **STATUS: §6 RULED 2026-07-27. Nothing has been built yet.** All six decisions (plus D6a/b/c) are
> settled; §2/§3/§5/§7/§8 were corrected against the repo in the same session. The ladder (§7) is
> unblocked — next session is **S1a**, the prompt is §9.
>
> **This doc dies at S6**, and after D4 that is enforced by check 12(b) rather than by remembering:
> the check requires this file to exist while any target is unmet and to be **gone** once all are met.
> It is the first customer of the deletion procedure it specifies (§8).

## 1. Why

The repo states rules about itself — single-home, past-goes-to-commits, close-the-decision-loop, and
literally *"enforce process rules with CI-shaped artifacts, not discipline"* (`CLAUDE.md`) — and every
one of them has drifted. Not because anyone disagreed with them, but because the only thing enforcing
them is Brian noticing. A prose rule about prose rules is still a prose rule.

Three requirements, in his words (2026-07-26):

1. **Navigable by AI agents and Claude Code.** The reader is a zero-context agent, every session.
2. **Defined roles to replace a team in spirit.** A team's advantage isn't five brains — it's that four
   of them weren't in the room when the decision was made.
3. **Self-sufficient**, so it does not depend on him "being vigilant all the time with prompting
   properly." Materially less vigilance is acceptable; it has to be **a lot** less.

Whether maintainability work is worth doing is **settled**. Do not re-open it.

**The constraint that shapes the whole design:** AI's create-create-create tendency is part of the
disease. Deletion procedures are part of the system, and they apply to this document.

## 2. Measured state (re-measured 2026-07-27)

Every number re-verified against the repo at the decision walkthrough. **Four of the 2026-07-26 figures
were wrong or stale; they are corrected here and the originals are in the commit history.**

| | |
|---|---|
| tracked `*.md` (excl. `team/`, `meetings/`) | **90 files, 1,828,711 bytes** (`git ls-files '*.md'` unfiltered returns **145**) |
| `docs/` | 74 files, 19,713 lines |
| `docs/plans/` | 21 files, **14 banner-ed `COMPLETED`** and still in the active tree (8,321 lines) |
| `docs/sessions/` | 48 files, 5,657 lines, self-described "write-mostly"; **13 cited from outside the directory** |
| docs created : deleted, all time | **110 : 20** (the 07-26 "89 : 17" did not exclude a historically-committed `node_modules`) |
| §23 register | **100 rows** (was 86); **87 distinct status strings** (was "~70"); **8 rows resolved AND open** ✓ |
| §23 populations | RESOLVED 51 / 52,632 B · OPEN 40 / 57,801 B · HYBRID 8 / 7,651 B · DEFERRED 1 / 888 B |
| largest docs | spec **241,993 B** (was 223,709; +18,284 = the H87–H99 defect rows) · `m5-cutover.md` 219,293 B · `h26-spike-v2.md` 104,686 B · `recovered_appendix.md` 102,294 B |
| spec composition | §23 is **119,238 of 241,993 bytes — 49%**; the spec is **1,472 lines** against CLAUDE.md's own 1,500-line compaction trigger |
| default reading list | CLAUDE.md + spec + runbook = **322,496 bytes** |
| process infrastructure | **1 agent** (`planner`), 2 commands, **0 hooks** ✓ |
| source→doc coupling | **69 `.ts`/`.py` files, 77 citations** at `docs/plans/*.md` (+8 more in `.mjs`/`.js`); exactly **1 names a nonexistent path** |
| jest | 967 green / 10 skipped ✓ (the 10 are env-gated integration suites, not backlog skips) |

**The dead-doc target is 13,978 lines**, verified: 8,321 (the 14 banner-ed plans) + 5,657
(`docs/sessions/`). It excludes the recovered appendix (2,282 → D5) and `regen-controls.md` (134).

**The diagnosis is not "too much gets written."** It is that **completion produces a banner instead of
a deletion**. ~14,000 of those 19,388 lines are already dead by the repo's own rules and were simply
never removed.

**Proof that declarations don't work:** `docs/TOMORROW.md` opens with *"DISPOSABLE. Delete this file
once you've picked."* It was picked up on 2026-07-26 and is still here. A death condition with no
enforcer never fires. Everything below assumes that.

## 3. What vigilance actually gets eliminated

This is the acceptance criterion for the whole campaign. An adversarial review scored an earlier draft
*2 reduced, 4 renamed, 6 untouched, 4 net-new — **zero eliminated***. Anything Brian must *choose to
invoke* is a rename, not an elimination.

**Corrected at the D3 ruling (2026-07-27).** The 07-26 draft marked 8 of 9 rows "eliminated"; only 4
survive that word. An elimination requires a **deterministic trigger** and a **deterministic check** —
no classifier, no human choice, anywhere in the loop. Everything else is a reduction, and calling a
reduction an elimination is how a campaign declares victory without winning.

| Today he must remember… | Mechanism | Kind |
|---|---|---|
| To push; that prod matches git | `Stop` hook: `git rev-list --count @{u}..HEAD` | **eliminated** |
| Whether doc claims are true | Checks 9 + 10 — continuous, not a scheduled audit | **eliminated** |
| Not to edit a frozen pre-registration | Check 11 — sha256 pin (+ the D5 appendix) | **eliminated** |
| Whether the campaign ended net-negative | The baseline file *is* the measurement; check 12's liveness coupling makes it terminal | **eliminated** |
| Which red is "expected backlog" | Ratchet: `current <= baseline` blocks, `current <= target` reports (D4) | reduced — the two signals are separated, but reading the status is still a choice |
| To audit without also fixing (the 07-25 defect) | `UserPromptSubmit` hook injects the FIND contract | **reduced** — the trigger is a **regex over prompt text**, exactly as reliable as the phrasing discipline it replaces |
| Which role this session is | `SessionStart` hook prints the menu | **reduced** — recall → recognition; the choice and the compliance are still his |
| Whether prose is migrating out of `docs/` | Whole-tree byte cap, not a `docs/`-only file count | reduced — the cap catches migration, not the decision to migrate |
| To deploy from `fitted/`, not the repo root | `/ship` command | reduced — he must choose to type it |

**Two honest residuals — do not let either get lost.**

1. A session can still **ignore** an injected contract. The hook makes the rule *present at the moment
   of decision* instead of requiring recall. That is a large delta but it is **not a capability
   boundary**, and claiming otherwise would be the kind of false guarantee this repo already punishes
   (*"a false guarantee in source is worse than the original bug"*).
2. `UserPromptSubmit` can also **fail to fire** (unusual phrasing → no injection → full vigilance plus
   false confidence) or **fire wrongly** (injects "find, don't fix" into a session that wants fixes).
   A heuristic classifier standing where a guarantee is claimed is the weakest link in this design, and
   §4 assigns it the flagship defect class.

## 4. Roles

**Correction, load-bearing:** an earlier draft justified read-only agents as fixing the 2026-07-25
defect class. That is false. `full-audit-2026-07-25.md`'s standing rules *already* required read-only
subagents that day; session 1 obeyed them and still shipped six self-inflicted defects, because the
defects came from the **main loop** finding, deciding and fixing in one motion. Subagent tool
restrictions are orthogonal. The `UserPromptSubmit` hook in §3 is what addresses it.

The agents are still worth building — for their own receipts, not that one.

| Agent | Tools | Receipt (a failure that actually happened) |
|---|---|---|
| `finder` | `Read, Glob, Grep` | A **writable** review subagent deleted `scripts/track2-users-peek.mjs` — unrecoverable, never committed |
| `librarian` | `Read, Glob, Grep` | Nobody owns deletion → 89:17. **Proposes a manifest; never executes it** |
| `reviewer` | `Read, Glob, Grep` | Fresh, un-anchored context; must not be the author |

**A role must come with a receipt.** No receipt, no role — that is what stops this layer becoming its
own bureaucracy.

**Two traps, both verified:**

- **`tools: Bash(git log/show)` is not valid agent frontmatter.** The rule content is parsed and then
  discarded, so it resolves to **full unrestricted Bash**, silently. It conflates
  `.claude/settings.json`'s `permissions.allow` syntax with a frontmatter tool-*name* list. The role
  built to be safe would ship with `rm`. **Grant no scoped Bash; verify by attempting the forbidden
  action, never by reading the frontmatter.**
- **`planner` is not the good example to copy.** Its `tools:` grants unrestricted `Write`; the
  single-file limit exists only in body prose. It is the promise-not-a-boundary failure, in the one
  instance of the pattern that already exists.

**Session commands are ergonomics, not enforcement — and the spec must say so.** A slash command's
`disallowed-tools` clears on the next user message, so `/find`'s discipline is prose enforced by
attention: the exact mechanism that failed on 07-25. Either `/find` immediately dispatches to the
`finder` subagent (one line, buys the real boundary), or it is a typing convenience. Do not count it as
enforcement.

## 5. The 12 checks

**Ratchet form:** every check asserts `actual <= baseline`, seeded to today's measured values in
`fitted/tests/repoHygiene.baseline.json`, so the suite is **green on arrival**. A session that improves
a number lowers its baseline in the same commit.

*Why not land them RED (the obvious version):* they would be red for the entire campaign — weeks — and
a permanently-red suite trains every session to write off RED. This repo's own rules forbid that:
*"A RED run is evidence. Never write one off as 'transient.'"* `test.skip` was also rejected: nothing
bounds how long a skip lives, which is the COMPLETED-banner failure wearing a different hat.

*Why the ratchet isn't just an evasion:* raising a baseline is legal but it is a one-line diff in a
single JSON file — the one artifact a reviewer, or check 12, can watch.

| # | Check | Today | Notes from the §6 rulings |
|---|---|---|---|
| 1 | tracked `*.md` file count, **excluding `team/` + `meetings/`** | 90 | the exclusion must be **stated in the check** — unfiltered `git ls-files '*.md'` is **145**, so a "whole tree" wording makes the baseline unfalsifiable |
| 2 | total markdown bytes, **minus §23 and the D5-pinned appendix** | 1,828,711 raw | D6a: the register moves to `DEFECTS.md` and is counted separately |
| 3 | largest single doc, bytes | 241,993 → ~123,000 post-D6a | |
| 4 | default reading list bytes (hardcoded list) | 322,496 → ~203,000 post-D6a | |
| 5 | `docs/plans/` file count | 21 | |
| 6 | ~~`docs/sessions/` file count~~ → **`docs/sessions/` does not exist** | 48 → 0 | D2: directory deleted; `RECOVERY.md` moves to `docs/RECOVERY.md` |
| 7 | §23 **resolved-row bytes** (archaeology), not row count | 52,632 | D4/D6: never cap open rows — that is the live queue |
| 8 | §23 + `DEFECTS.md` status **vocabulary membership** | 87 distinct strings | D6c: was a hybrid *detector*; a closed set makes hybrids unconstructible, so this becomes a membership assertion |
| 9 | doc cites naming a nonexistent path | measure at S1a | catches the D2 session-note re-homing and the D5 appendix deletion |
| 10 | **source files citing a nonexistent doc** | **1** — `docs/plans/track2-friend-ready-2026-07-18.md` | D4: lands at its **target (0)**, not ratcheted — one-line fix |
| 11 | sha256 pins: `ml-system/experiments/*/preregistration.*` **+ `Fitted_Spec_v2_recovered_appendix.md`** | — | D5 |
| 12 | (a) no `current` exceeds its `landing`; (b) **liveness**: `maintainability.md` exists iff any `current > target` | — | D4: converts §7's S6 DONE condition from prose into a test |

**Why these and not the obvious versions** — each of these replaced a worse check that an adversarial
review defeated:

- **Bytes, not lines.** `CLAUDE.md` averages ~123 chars/line and its longest line is 1,538 chars. The
  §23 register is **6% of the spec's lines and 45% of its bytes**. A line cap is satisfied by
  reflowing prose to long lines — a 40% "improvement" worth exactly nothing — while the single
  highest-value deletion in the repo barely moves it.
- **Positive assertions, not bans.** A ban on `file.ts:123` is cheapest satisfied by *deleting the
  cite*, which leaves the next agent with strictly less than a stale line number gave it. "The path
  must exist" fails both the rotted cite and the bare-filename dodge.
- **Counts, not banners.** Forbidding the string `COMPLETED` in `docs/plans/` punishes honesty about
  deadness: two genuinely dead plans (`regen-controls.md` "SUPERSEDED", `spec-resolutions.md`
  "Retired") pass it today *because they don't use the word*, while 14 honest ones fail.
- **Check 8 replaces an undecidable one.** "No stale forward-pointers" needs an oracle for which
  checkpoints landed; nothing records that, and its cited drift (H7/H8/H61) is already repaired.
  "No row says done and not-done at once" is the same defect, mechanical, and genuinely red at 8.
- **Check 10 is the campaign's safety gate.** Deleting docs without repairing their inbound source
  citations manufactures the exact drift this campaign exists to kill. The repo already learned this:
  *"a stale claim about H14 sat in `models/User.ts`, which a `docs/`-only sweep missed."*
- **Check 11 guards the only irreversible thing here.** Git restores a deleted file; it cannot un-look
  at data. The re-measure rule was frozen before any friend label was seen, and that freeze is the only
  reason the M6 result will be credible.

**Where they run:** their own jest project, `npm run hygiene`, **excluded from `npm test`** — because
`.github/workflows/conformance.yml` runs `npm test` on every push to `main` (and on every PR) as the M5
cross-runtime pre-flip gate, and a doc file-count must never be confusable with a broken Python↔TS wire
contract.

> **TRAP, verified 2026-07-27 — the specced exclusion does not happen by itself.**
> `fitted/jest.config.js` already uses a `projects` array (`node`, `jsdom`) and `fitted/package.json`
> defines `"test": "jest"` — bare `jest` runs **every** project in that array. Adding a `hygiene`
> project therefore lands it **inside `npm test`, and inside the conformance gate**, which is exactly
> what this paragraph forbids. Exclusion requires `"test": "jest --selectProjects node jsdom"` (and
> then any future project is opt-in, not opt-out) or a separate config file. **Fix at S1a; prove it by
> reddening a hygiene check and watching `npm test` stay green.**

**Output contract (D4).** `npm run hygiene` prints `current → target (N to go)` per check and a
`REGRESSIONS:` line. That print is the cross-session handoff artifact — measured, not asserted. The
`Stop` hook blocks **only** on `current > baseline`; a session may end with the campaign unfinished,
but not having made something worse.

**Hook command**, with the three things a naive version gets wrong:

```
cd "$CLAUDE_PROJECT_DIR/fitted" && npx --no-install jest --selectProjects hygiene || exit 2
```

`cd` because there is no jest at the repo root (root `package.json` only delegates). `--no-install`
because a bare `npx jest` hits the network. `|| exit 2` because **jest exits 1, and a `Stop` hook
exiting 1 prints to the user and stops anyway** — exit 2 is the only blocking code, so the naive
version is a log line, not enforcement. Honor `stop_hook_active` in the hook input, or a genuinely-red
check makes the session loop against a wall it cannot fix.

## 6. Decisions — RULED 2026-07-27

All six settled in the walkthrough session, each taught from first principles and argued before the
verdict. The rulings below are the contract S1a–S6 build against; where a ruling contradicts §2–§5 or
§7–§8, those sections were corrected in the same session and the ruling still wins.

*Note against this doc's own standard:* §6 grew this file from 307 to 545 lines. That is deliberate —
it now carries the decision record, which is the one thing that must survive until S6 — but it is also
why check 12(b) exists. This doc does not get to be the exception.

**D1 — Delete ~14,000 lines of docs, or archive them? → RULED: DELETE, plus a retrieval index in `CLAUDE.md`.**

Target verified 2026-07-27: **13,978 lines** = 8,321 (the 14 banner-ed plans) + 5,657 (`docs/sessions/`).
Excludes the recovered appendix (2,282, → D5) and `regen-controls.md` (134).

`git rm` after §8 extraction. S2 additionally appends a **~20-line retrieval index to `CLAUDE.md`** —
one line per deleted doc, `path · deletion-sha · one-line what it was` — so recovery is
`git show <sha>^:<path>`, a command a zero-context agent will actually run. Pointers only; a body in
that index is a single-home violation.

*Why not `docs/archive/`:* it is the `COMPLETED` banner with a directory name — same declaration, same
absent enforcer, same outcome. `Grep` does not honor a reading list, so an archived body is read as
current truth by accident, silently, forever. And an archive exempt from checks 1–4 makes every byte
cap satisfiable by `git mv`, which is the same worthless "improvement" the spec already rejects for
line-counting.

*The real cost, accepted:* extraction is lossy by design (§8's own example drops 61 paragraphs).
Delete is only safe if §8 runs as real work. `m5-cutover.md` §E's M6 order-influence recipe is **not
in the spec** — losing it is a live risk, not a hypothetical one.

**D2 — Session notes stop being created. → RULED: STOP, and `docs/sessions/` is deleted as a directory.**

The real defect is not note-writing, it is that **`docs/sessions/` is the junk drawer** — the place
things go when nobody decides where they belong. Killing the directory removes the "I don't know where
this goes" destination; durable output must name a real home: a commit body, the spec, a §23 row,
memory, or a test.

This overrides `CLAUDE.md`'s "externalize state into `docs/sessions/`" convention — **S3 must rewrite
that clause, not leave it standing.** A session note has no guaranteed reader (CLAUDE.md itself calls
the directory "write-mostly… never required context"); a commit body is delivered by `git log -p`/
`git blame` exactly when someone edits the code it describes.

**Two load-bearing consequences, both S2 work:**

- **`RECOVERY.md` moves to `docs/RECOVERY.md`.** It stays exempt from every cap, but CLAUDE.md's
  critical-usage backstop names `docs/sessions/RECOVERY.md` verbatim — **that path must be edited in
  the same commit as the move**, or the backstop points at nothing at the one moment a session cannot
  recover.
- **13 of the 48 notes are cited from outside `docs/sessions/`** (measured 2026-07-27) and need
  re-homing or citation repair, not bulk `git rm`: `2026-06-26-m4a-post-audit.md` (3 inbound, incl.
  spec §23-H26 by path), `2026-07-18-track2-friend-ready.md` (3), `2026-06-20-m3-ledger.md` (2),
  `2026-07-08-m5-c5-seam6-route.md` (2), `2026-07-25-audit-session1.md` (2), and 8 with one inbound
  each. `docs/sessions/README.md` has 23 inbound and dies with the directory. Check 9 is the backstop
  for a missed repair.

*Rejected middle:* "keep notes, cap the count." A bare count cap names no victim, so nothing dies —
the `COMPLETED`-banner failure again. The only workable version would be rolling-N with a forced
victim (check 6 at `<= 3`, so a 4th note reddens the suite until the same commit deletes the oldest).

**D3 — Hooks vs. commands. → RULED: all three hooks, built silent-when-clean.**

Intrusiveness is the whole cost, and it is a calibration problem, not a philosophical one: a hook that
prints nothing when everything passes is invisible until it matters. **`SessionStart` prints ~5 lines
only on a problem** (unpushed commits / live-SHA drift / a red check) and nothing otherwise — its
stdout is injected into *every* session's context forever, so verbosity is a permanent tax.
**`Stop` exits 0 silently.**

**The three are not equivalent, and §3's table must be corrected in the S1b commit:**

- **`Stop` — a genuine elimination.** Deterministic trigger (session end), deterministic check
  (`git rev-list --count @{u}..HEAD`), no interpretation in the loop.
- **`SessionStart` — a reminder, not an elimination.** You still choose the role and still comply. It
  converts recall into recognition, which is real, but §3 marks it "eliminated" and it is not.
- **`UserPromptSubmit` — REDUCED, not eliminated.** Mechanically a **regex over prompt text** — a
  heuristic classifier standing where §3 claims a guarantee. False negative: unusual phrasing → no
  injection → full vigilance plus false confidence. False positive: injects "find, don't fix" into a
  session that wants fixes. The trigger is exactly as reliable as the phrasing discipline it replaces.

**§3 is inflated and is the campaign's stated acceptance criterion — fix it before S1b runs.** By the
above, ~3 of the 9 rows are genuine eliminations (`Stop`/push, checks 9–11 as continuous assertions,
the baseline file as its own measurement); the rest are reductions. An inflated acceptance criterion is
how a campaign declares victory without winning — the disease, not the cure.

*Verified 2026-07-27:* jest cold start here is **0.8 s** for a single small suite, so running the
hygiene project from the `Stop` hook carries no meaningful latency tax. No separate non-jest runner is
needed.

**D4 — Checks land green or red? → RULED by the multi-session workflow: `npm test` green at every
handoff; hygiene is a separate channel that blocks on regression and *reports* progress.**

The governing requirement is that work spans sessions — one hunts bugs, one specs, one implements part,
one finishes — because a fresh session is better at context engineering. That makes the question
"what must be true at a handoff," and it separates **two kinds of red the spec conflated**:

| | Meaning | Tolerable across sessions |
|---|---|---|
| **Broken** | was green, now red — a regression | **never** |
| **Unfinished** | asserts a target not yet reached | yes, normal |

Share one suite and a fresh session cannot tell them apart, which destroys detection of the first.
`CLAUDE.md` records why that matters: *"fixes regress, proven repeatedly (a fix landed a new bug caught
only by the next round, three times in the M4 session)."*

- **`npm test` (967) green at every session boundary, no exceptions.** Unfinished work hands off as a
  §23 row or a plan checkpoint — **never as a failing test**.
- **`npm run hygiene` prints `current → target (N to go)` per check** and blocks (via the `Stop` hook)
  **only on `current > baseline`**. A session may end with the campaign unfinished; it may not end
  having made something worse. The status print is the handoff artifact: measured, not asserted —
  better than a red suite (poisons the regression signal) and better than a plan doc (drifts).

This is the ratchet, but the justification is *not* alarm fatigue: `current <= baseline` and
`current <= target` are two different assertions with two different meanings, and the ratchet is what
lets one suite carry both.

**Amendments this forces (all load-bearing, all verified 2026-07-27):**

- **§23 MUST be excluded from checks 2/3/4, and check 7 must not cap open rows.** The register is a
  live work queue, not prose bloat. The 2026-07-26 hunts added 13 rows / **18,284 bytes** — under the
  specced checks that is a *regression* that would block session end via the `Stop` hook, penalising
  the most valuable work in the repo. §23 is **119,238 of the spec's 241,993 bytes (49%)**; excluding
  it puts the spec at 122,755 B and the reading list at 203,258 B with nothing deleted. Any §23 cap
  must target **resolved-row bodies** (archaeology), never open rows (the queue).
- **§5's "their own jest project… excluded from `npm test`" is FALSE as written.**
  `fitted/jest.config.js` already uses a `projects` array (`node`, `jsdom`) and `test` is bare `jest`,
  which runs **every** project — so a third project lands inside `npm test` and therefore inside
  `.github/workflows/conformance.yml`, the M5 cross-runtime gate. Exclusion requires
  `"test": "jest --selectProjects node jsdom"` or a separate config file. Fix at S1a.
- **Check 1 is worded "whole tree" but its 89 baseline silently excludes `team/` and `meetings/`;**
  `git ls-files '*.md'` returns **145**. State the exclusion in the check or the baseline is
  unfalsifiable.
- **Check 10 lands at its target (0), not ratcheted** — the single failure is the missing
  `docs/plans/track2-friend-ready-2026-07-18.md` citation, a one-line fix.
- **Check 12 gains a liveness coupling:** while any `current > target`, `docs/plans/maintainability.md`
  must exist; once all targets are met it must be gone. That converts §7's S6 DONE condition from
  prose-in-a-doc-that-dies into a test — the campaign's own "CI-shaped artifacts, not discipline",
  applied to itself.

**D5 — Does `Fitted_Spec_v2_recovered_appendix.md` (102 KB) survive? → RULED: SURVIVES, sha256-pinned.**

It joins check 11's pin set and is excluded from checks 2/3 **by explicit path**. Frozen: it may never
grow, so it cannot become the dumping ground an open exemption would invite. Same byte relief as
exemption, opposite incentive.

**Three verified facts the earlier draft missed — it is not "history":**

- **`CLAUDE.md:238` makes it required grounding** for the ambition-merit lane (*"grounded in
  `Fitted_Spec_v2.md` + the recovered appendix + the real committed state"*) — a guaranteed reader with
  a recurring trigger.
- **The surviving spec cites into it:** `Fitted_Spec_v2.md:1303` (§23-H45) → "recovered appendix C.4".
  Deleting it reddens check 9.
- **Its content is not anecdotes.** C.0 is the definitional source for `Board`/`StyleProfile`/
  `Routine`/`Lens`/`StyleMove`/`StyleEdge` and the core purpose statement — the vocabulary the entire
  spec is written in.

**The structural argument.** The spec is a lossy compression of the ambition
([[feedback_spec_is_lossy]]). The appendix is the only artifact in the repo that is **not a compression
of itself**. Delete it and the merit lane audits the spec against the spec, which structurally cannot
detect the one failure it exists to detect — a sound-but-misaimed project. You cannot check a
compression for fidelity using only the compression.

**Conflict to fix at S3 (a bug by the repo's own rule):** `CLAUDE.md:139` files the appendix under
*"Historical context only — do not mine for architectural truth"* while `:238` makes it mandatory audit
grounding. Same file, opposite instructions. Resolve by giving it a third category the reading-list
rules do not currently have: **frozen ambition baseline — outside the default reading list, loaded by
the merit lane only.**

*Rejected:* folding it into the spec. That merges ambition with implementation, destroying the
independence the merit lane needs, and grows a spec already at CLAUDE.md's 1,500-line compaction
trigger (1,472 today).

**D6 — How aggressive is the §23 rewrite? → RULED: split the register in two; compress per-population;
three-field open rows; closed status vocabulary.**

**Measured 2026-07-27** — the register is two registers wearing one row format:

| Population | Rows | Bytes | Lifecycle |
|---|---|---|---|
| RESOLVED | 51 | 52,632 (44%) | archaeology; residual value is trap-guards only |
| OPEN | 40 | 57,801 (49%) | **live work queue** |
| HYBRID | 8 | 7,651 | both at once (the check-8 defect) |
| DEFERRED | 1 | 888 | |

**D6a — defects physically leave the spec** → `docs/DEFECTS.md`, counted separately as work-queue
infrastructure (same class as `.claude/` and `fitted/tests/` in §7), capped on **CLOSED rows only**.
§23 keeps design holes. Spec 241,993 → ~123,000 B; reading list 322,496 → ~203,000 B.

*This corrects the D4 amendment.* Excluding §23 from checks 2/3/4 fixes the **measurement** and does
nothing about the **context cost** — a session reading `Fitted_Spec_v2.md` loads all 241,993 bytes
regardless of what the checks count. Requirement 1 is *navigability*; 49% of the canonical spec being a
bug tracker is a navigability defect that a cap exclusion is theater against. The register must
physically move, not merely stop being counted. It also matches the session split: a bug-hunt session
and a design session want different reading lists.

**Compression is per-population — the original "two-line open row" target aimed at the wrong 57,801 bytes:**

- **RESOLVED (51 rows / 52,632 B)** → one line each after trap-guard extraction to the symbol. ~90%
  off, essentially free. This is where the bytes are.
- **OPEN design hole** → three-field row (below), analysis in the spec body.
- **OPEN defect** → **full body preserved.** H87 carries mechanism (`lib/mongodb.ts:31-44` caches a
  rejected promise), reachability (Atlas M0 SRV blip inside the 30 s server-selection window), blast
  radius (`connectMongo` sits under `apiAuth`/`session`, so auth dies too) and the one-line fix. That
  *is* the deliverable; there is no spec section to move a missing owner check into. Compressing a
  defect row deletes the finding.

**D6b — three fields: `symptom | where | unblock condition`.** The third is what must be true before the
row can close. Its value is that it is **falsifiable** — "BLOCKED: 3 friend closets land" is checkable
against reality, "OPEN" is not. Its absence is what produced the H7/H8/H61 staleness.

**D6c — closed status vocabulary, check-enforced.** §23: `OPEN` | `BLOCKED:<condition>` | `RESOLVED`.
`DEFECTS.md`: `OPEN` | `FIXED:<sha>`. All **87 distinct strings across 100 rows** (measured) collapse
into these. **Hybrid rows become unconstructible** — one row, one status from a fixed set, so a
half-done row must split into two. **Check 8 downgrades from a hybrid *detector* to a vocabulary
*membership* assertion**, which is mechanical and cannot drift. The 8 existing hybrids are still
**split, never deleted** — H78's open half is an unclosed cross-user data-scoping defect and belongs in
`DEFECTS.md`.

## 7. Ladder

**§6 is ruled (2026-07-27). The ladder is unblocked.** One rung per fresh session; each ends with its
DONE condition **proven**, not asserted. `npm test` must be green at every session boundary (D4) —
unfinished work hands off as a `DEFECTS.md`/§23 row or a plan checkpoint, never as a failing test.

- **S1a** — the 12 checks + baseline, green on arrival, with `current`/`target`/`landing` per check.
  **First: fix `"test"` to `jest --selectProjects node jsdom`** and prove hygiene is outside `npm test`
  (§5 trap). Repair the check-10 citation so it lands at target 0. **DONE when** lowering each baseline
  by one reddens exactly that check, proven one at a time (mutation, not reading), *and* a deliberately
  reddened hygiene check leaves `npm test` green.
- **S1b** — 3 agents, 4 commands, 3 hooks (silent-when-clean, D3). Correct §3's eliminated/reduced
  table in this commit. **DONE when** each agent has been *refused* its forbidden action and the
  refusal is pasted into the commit. Not "the frontmatter says so."
- **S1c** — fold `TOMORROW.md`'s two keepers into `CLAUDE.md`, `git rm docs/TOMORROW.md`.
- **S2** — the deletion pass: 14 completed plans, `docs/sessions/` **as a directory** (D2), the two
  retired ledgers, `regen-controls.md`. Also in S2: move `RECOVERY.md` → `docs/RECOVERY.md` **and edit
  CLAUDE.md's critical-usage backstop in the same commit**; re-home the 13 cited session notes; append
  the D1 retrieval index to `CLAUDE.md`. **Check 10 green in the same commit as every `git rm`.**
- **S3** — `CLAUDE.md` + spec rewritten as a map for a zero-context reader; line cites → symbol cites.
  **Resolve two standing CLAUDE.md conflicts:** the recovered appendix is a *frozen ambition baseline*,
  not "historical context only" (`:139` vs `:238`, D5); and the "externalize state into
  `docs/sessions/`" convention is dead (D2).
- **S4** — register conversion (D6): split `docs/DEFECTS.md` out of §23; close the status vocabulary;
  split the 8 hybrid rows; extract trap-guards to their symbols; delete the 51 resolved bodies
  (52,632 B); convert open design holes to `symptom | where | unblock`.
- **S5** — a `/find` doc-claim verification pass. Output: *X checked, Y wrong.*
- **S6 (terminal)** — `git rm docs/plans/maintainability.md`. **Campaign DONE when** every check's
  `current <= target` — at which point check 12(b) *requires* this file to be gone, so S6 is enforced
  by the suite rather than by remembering to do it.

**The number that must go down** is tracked markdown files and bytes. `.claude/` and `fitted/tests/`
are enforcement infrastructure, counted separately — S1 is expected to be **+8 there and net-zero in
`docs/`**. A campaign that ends with more docs than it started has failed regardless of the checks.

## 8. Deletion procedure — five destinations

A doc, a plan, a session note and a register row all die the same way. Content goes to exactly one of:

| What it is | Where it survives |
|---|---|
| **Trap-guard** — a mistake that actually bit | A comment at the symbol where it would be remade. **If it needs more than 3 lines it is a contract** — mechanism to the spec, one-line pointer in code. |
| **Contract / decision** | The spec, single-homed |
| **Guarantee** | A test |
| **An unclosed obligation** | **A §23 row.** H61's "M6 obligation", H77's three open residuals and H54's unbuilt test all live inside rows whose status says RESOLVED. |
| History, rationale, review narrative | The commit message. Then delete the file. |

If a claim maps to none of the five, it was never load-bearing. **The unit is a claim, not a
paragraph** — split first, then route.

**Extraction is an artifact, not a judgment.** Every deletion commit carries a grep-able block per
deleted file, so "was this extracted?" is answerable by `git log` instead of trust:

```
EXTRACTED docs/plans/m5-cutover.md
  code:   ml-system/fitted_core/response.py::select_spread   (D2 re-rank trap-guard)
  spec:   §15.1 (snapshot contract) · §23-H28 (M6 rank hook + item-blindness)
  test:   tests/mlSnapshotWrite.test.ts::child lineage
  DROPPED: 61 paragraphs
```

**Do not delete these before extracting — each was found by adversarial review, each fits none of the
obvious destinations:**

- `docs/sessions/2026-06-26-m4a-post-audit.md` — the ambition-merit verdict and H26's research recipe.
  **The surviving spec §23-H26 cites it by path**, and it has **3 inbound citations** total. It is why
  the ML dive is framed as content compatibility on public corpora. Re-home it; do not bulk-delete it.
- **The other 12 cited session notes** (measured 2026-07-27): `2026-07-18-track2-friend-ready.md` (3
  inbound), `2026-06-20-m3-ledger.md` (2), `2026-07-08-m5-c5-seam6-route.md` (2),
  `2026-07-25-audit-session1.md` (2), and 8 with one each. `docs/sessions/README.md` has 23 inbound and
  dies with the directory.
- `docs/plans/m5-cutover.md` §E — the M6 order-influence hook recipe and the item-blindness constraint.
  Not in the spec.
- The 8 hybrid §23 rows, and the 7 resolved rows containing the literal words "trap-guard".

> **CORRECTION (2026-07-27) — the 07-26 draft was wrong about the closet-photo capture protocol.** It
> claimed the protocol *"exists in three files, all slated for deletion, and in neither
> `preregistration.md`."* It is in fact already **single-homed in a surviving, tracked, non-markdown
> file** — `ml-system/experiments/h26/closet_manifest.template.json:8`, verbatim: *"Keep each garment in
> its REAL as-photographed context… Do NOT crop to a clean garment cutout, re-shoot, or clean into
> flat-lays."* That is the file someone opens when assembling a closet, i.e. the correct home. **It is
> not at risk and needs no extraction.** Left standing, this entry would have sent S2 hunting for a
> non-problem — which is why every claim in this doc is re-verified before it is acted on.

**Exempt from all caps, by path:** `docs/RECOVERY.md` (moved from `docs/sessions/` at D2);
`ml-system/experiments/*/preregistration.*` and `docs/Fitted_Spec_v2_recovered_appendix.md` (both
sha-pinned under check 11 — editing a prereg invalidates the ML result; editing the appendix destroys
the merit lane's independent baseline). **Counted separately, not exempt:** `.claude/`,
`fitted/tests/`, and `docs/DEFECTS.md` — enforcement and work-queue infrastructure, not prose.

## 9. Next session — S1a

Paste this into a fresh session.

```
Read docs/plans/maintainability.md in full, then build S1a only — the 12 checks plus their baseline
file. Do not run S1b or later.

Two things come first, before any check is written:

1. fitted/package.json defines "test": "jest" and fitted/jest.config.js uses a projects array, so a
   new hygiene project would land inside npm test and inside .github/workflows/conformance.yml.
   Change "test" to `jest --selectProjects node jsdom` and prove the exclusion holds.
2. Check 10 is at 1: a source file cites docs/plans/track2-friend-ready-2026-07-18.md, which does not
   exist. Repair the citation so check 10 lands at its target of 0, not at a ratcheted 1.

The baseline file carries current, target and landing per check. Check 12 asserts (a) no current
exceeds its landing, and (b) the liveness coupling — this doc must exist while any current > target
and must be gone once all targets are met.

Verify every number in §2 against the repo before you seed a baseline from it. The 2026-07-26 draft
had four wrong figures; the 07-27 walkthrough corrected them; assume more have drifted.

DONE when lowering each baseline by one reddens exactly that check, proven one at a time by mutation
rather than by reading, AND a deliberately reddened hygiene check leaves npm test green. Paste the
mutation output into the commit.
```

**Sessions after that:** S1b → S1c → S2 → S3 → S4 → S5 → S6, one per fresh session, each ending with
its DONE condition proven rather than asserted.
