# Maintainability campaign — make the repo hold its own shape

> **STATUS: SPEC UNDER REVIEW. Nothing below has been built.** The ladder (§7) does not run until
> Brian has ruled on §6 Decisions. Next session is a **decision walkthrough**, not a build — the
> prompt is §9.
>
> **This doc dies at S6.** It is the first customer of the deletion procedure it specifies (§8).

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

## 2. Measured state (2026-07-26)

Every number verified this session, not quoted from a prior doc.

| | |
|---|---|
| tracked `*.md` (excl. `team/`, `meetings/`) | **89 files, 1,791,327 bytes** |
| `docs/` | 73 files, 19,388 lines |
| `docs/plans/` | 20 files, **14 already banner-ed `COMPLETED`** and still in the active tree |
| `docs/sessions/` | 48 files, 5,657 lines, self-described "write-mostly" |
| docs created : deleted, all time | **89 : 17** |
| §23 register | 86 rows; ~70 distinct status strings; **8 rows are resolved AND open** |
| largest docs | spec 223,709 B · `m5-cutover.md` 219,293 B · `h26-spike-v2.md` 104,686 B · `recovered_appendix.md` 102,294 B |
| default reading list | CLAUDE.md + spec + runbook = **304,212 bytes** |
| process infrastructure | **1 agent** (`planner`), 2 commands, **0 hooks** |
| source→doc coupling | **79 citations across 69 `.ts`/`.py` files** point at `docs/plans/*.md` |
| jest | 967 green / 10 skipped |

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

| Today he must remember… | Mechanism that removes it | Kind |
|---|---|---|
| To audit without also fixing (the 07-25 defect) | `UserPromptSubmit` hook: audit-shaped prompt + no role active → inject the FIND contract. **Fires on the prompt, not on memory.** | eliminated |
| Which role this session is | `SessionStart` hook prints role menu + live-SHA-vs-HEAD + hygiene status | eliminated |
| To push; that prod matches git | `Stop` hook checks `git rev-list --count @{u}..HEAD` | eliminated |
| Whether doc claims are true | Checks 9 + 10 — continuous, not a scheduled audit | eliminated |
| Not to edit a frozen pre-registration | Check 11 — sha256 pin | eliminated |
| Whether prose is migrating out of `docs/` | Whole-tree byte cap, not a `docs/`-only file count | eliminated |
| Which red is "expected backlog" | Ratchet baselines — green on arrival, so any red is new | eliminated |
| Whether the campaign ended net-negative | The baseline file *is* the measurement | eliminated |
| To deploy from `fitted/`, not the repo root | `/ship` command | reduced |

**Honest residual — do not let this get lost.** A session can still ignore an injected contract. The
hook makes the rule *present at the moment of decision* instead of requiring recall. That is a large
delta, but it is **not a capability boundary**, and claiming otherwise would be exactly the kind of
false guarantee this repo already punishes (`full-audit-2026-07-25.md`: *"a false guarantee in source
is worse than the original bug"*).

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

| # | Check | Today |
|---|---|---|
| 1 | tracked `*.md` file count, whole tree | 89 |
| 2 | total markdown **bytes** | 1,791,327 |
| 3 | largest single doc, bytes | 223,709 |
| 4 | default reading list bytes (hardcoded list) | 304,212 |
| 5 | `docs/plans/` file count | 20 |
| 6 | `docs/sessions/` file count (`RECOVERY.md` exempt) | 48 |
| 7 | §23 non-`OPEN` status count | 60 |
| 8 | §23 rows both resolved **and** open | **8** |
| 9 | doc cites naming a nonexistent path | measure at S1a |
| 10 | **source files citing a nonexistent doc** | **1** |
| 11 | frozen pre-registration sha256 pins | — |
| 12 | no baseline exceeds its landing value | — |

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
`.github/workflows/conformance.yml` runs `npm test` on every push to `main` as the M5 cross-runtime
pre-flip gate, and a doc file-count must never be confusable with a broken Python↔TS wire contract.

**Hook command**, with the three things a naive version gets wrong:

```
cd "$CLAUDE_PROJECT_DIR/fitted" && npx --no-install jest --selectProjects hygiene || exit 2
```

`cd` because there is no jest at the repo root (root `package.json` only delegates). `--no-install`
because a bare `npx jest` hits the network. `|| exit 2` because **jest exits 1, and a `Stop` hook
exiting 1 prints to the user and stops anyway** — exit 2 is the only blocking code, so the naive
version is a log line, not enforcement. Honor `stop_hook_active` in the hook input, or a genuinely-red
check makes the session loop against a wall it cannot fix.

## 6. Decisions — Brian rules on these before the ladder runs

Each is a call where a reasonable person could go the other way. Recommendation given, but the point is
that he decides.

**D1 — Delete ~14,000 lines of docs, or archive them?**
Recommend: delete. Git preserves everything and 710 commits have substantive bodies, so retrievability
is real; a directory that exists gets read, which is how 5,657 lines of "archive" ended up inside the
active tree. *Cost if wrong:* finding old rationale requires `git log -S`, which a zero-context agent
will not run. *Reversal:* keep a `docs/archive/` and exclude it from the caps.

**D2 — Session notes stop being created.**
This **contradicts** `CLAUDE.md`'s own convention ("externalize state… sessions are days apart and
context recovery matters"). Recommend: stop anyway — a commit message is the same artifact with a
guaranteed reader — but `docs/sessions/RECOVERY.md` must stay exempt, because CLAUDE.md's
critical-usage backstop names that exact path and a check that reddens when it appears would fire at
the one moment a session cannot act on it. *Reversal:* keep session notes, cap their count.

**D3 — Hooks that fire automatically vs. commands you invoke.**
The automatic version is the only thing that actually cuts vigilance (§3), but it means the harness
injects text into sessions unasked. *Cost if wrong:* it feels intrusive and gets disabled, at which
point the campaign delivers renames only.

**D4 — Checks land green (ratchet) or red (punch list)?**
Recommend green, for the alarm-fatigue reason above. *Cost:* the backlog is invisible unless someone
reads the baseline file. *Reversal:* land red, accept the noise, finish faster.

**D5 — Does `Fitted_Spec_v2_recovered_appendix.md` (102 KB) survive?**
It is the north-star / ambition doc, explicitly separate from the implementation spec, and it is the
second-largest surviving file. No earlier draft mentioned it at all. *Options:* delete, fold the
still-live parts into the spec, or exempt it from the caps as a declared non-narrative artifact.

**D6 — How aggressive is the §23 rewrite?**
Target is a two-line open row (symptom + where) with analysis moved to the spec. The 8 hybrid rows must
be **split**, not deleted — H78's open half is an unclosed cross-user data-scoping defect. *Question:*
is a two-line row enough for a zero-context agent, or does it need three?

## 7. Ladder

Nothing here runs until §6 is ruled on.

- **S1a** — the 12 checks + baseline, green on arrival. **DONE when** lowering each baseline by one
  reddens exactly that check, proven one at a time (mutation, not reading).
- **S1b** — 3 agents, 4 commands, 3 hooks. **DONE when** each agent has been *refused* its forbidden
  action and the refusal is pasted into the commit. Not "the frontmatter says so."
- **S1c** — fold `TOMORROW.md`'s two keepers into `CLAUDE.md`, `git rm docs/TOMORROW.md`.
- **S2** — the deletion pass: 14 completed plans, `docs/sessions/` (minus `RECOVERY.md`), the two
  retired ledgers, `regen-controls.md`, and the recovered appendix per D5. **Check 10 green in the same
  commit as every `git rm`.**
- **S3** — `CLAUDE.md` + spec rewritten as a map for a zero-context reader; line cites → symbol cites.
- **S4** — register conversion: close the status vocabulary, split the 8 hybrid rows, extract
  trap-guards to their symbols, delete resolved bodies.
- **S5** — a `/find` doc-claim verification pass. Output: *X checked, Y wrong.*
- **S6 (terminal)** — `git rm docs/plans/maintainability.md`. **Campaign DONE when** all 12 baselines
  equal target and `git diff --stat <S1a-sha>..HEAD -- docs/` is net-negative in files and bytes.

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
  **The surviving spec §23-H26 cites it by path.** It is why the ML dive is framed as content
  compatibility on public corpora, and that has never been re-derived anywhere else.
- **The closet-photo capture protocol** (*keep the garment in real on-body context — not flat-lays —
  because cleaning them erases the very domain gap the probe measures*). It exists in three files, all
  slated for deletion, and in **neither** `preregistration.md`. M6's headline measurement depends on it.
- `docs/plans/m5-cutover.md` §E — the M6 order-influence hook recipe and the item-blindness constraint.
  Not in the spec.
- The 8 hybrid §23 rows, and the 7 resolved rows containing the literal words "trap-guard".

**Exempt from all caps, by path:** `docs/sessions/RECOVERY.md`;
`ml-system/experiments/*/preregistration.*` (sha-pinned — editing one invalidates the ML result).

## 9. Next session — decision walkthrough

Paste this into a fresh session. It is a **discussion**, not a build.

```
Read docs/plans/maintainability.md in full. This is a campaign spec under review — nothing in it has
been built, and nothing should be built this session.

Your job is to walk me through §6 Decisions so I can rule on each one. For every decision: teach me
the mechanics from first principles before asking for a verdict — what the mechanism actually does,
what it buys, what it costs, and what breaks if I choose the other way. Verify the spec's claims
against the real repo as you go; several of its numbers came from a single session and one earlier
draft of this spec had four factually wrong claims that only an adversarial review caught. Do not
assume it is right because it is written down.

Push back on me. If I pick something you think is wrong, say so and argue it — I want to end this
session understanding the trade-offs well enough to defend them, not just having approved a document.

Record each verdict in §6 as I make it, in the same session. Do not start the ladder in §7.
```

**Sessions after that:** S1a → S1b → S1c → S2 → S3 → S4 → S5 → S6, one per fresh session, each ending
with its DONE condition proven rather than asserted.
