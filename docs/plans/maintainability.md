# Maintainability campaign — make the repo hold its own shape

> **STATUS: adversarial re-read complete, 2026-07-27. Nothing has been built yet.** §6's six decisions
> stand, with **two amendments** (D3: the `UserPromptSubmit` hook is **cut**, §4; D5: one of its three
> legs was false, §6). §1.3's derived-state centerpiece stands, with its **boundary redrawn** — the
> disease is not confined to `CLAUDE.md` (§1.2). §4 was rebuilt on proven receipts and shrank from
> 3 agents / 4 commands / 3 hooks to **2 / 3 / 2**. **The ladder is resequenced (§7): S1a → S4a → S0,
> then stop.** The next-session prompt is §9 and it is **S1a**, not S0.
>
> **This doc dies at S6**, and after D4 that is enforced by check 12(b) rather than by remembering:
> the check requires this file to exist while any target is unmet and to be **gone** once all are met.
> It is the first customer of the deletion procedure it specifies (§8).
>
> **Verification standard for this file.** Three consecutive sessions each found multiple false claims
> here, including in text the previous session had just written and marked "verified." Every number and
> every cite below carries the method that produced it. Re-run the method before relying on it; a claim
> whose method is not stated is not yet evidence.

## 1. Why

The repo states rules about itself — single-home, past-goes-to-commits, close-the-decision-loop, and
literally *"enforce process rules with CI-shaped artifacts, not discipline"* (`CLAUDE.md`) — and every
one of them has drifted. Not because anyone disagreed with them, but because the only thing enforcing
them is Brian noticing. A prose rule about prose rules is still a prose rule.

Whether maintainability work is worth doing is **settled**. Do not re-open it.

**The constraint that shapes the whole design:** AI's create-create-create tendency is part of the
disease. Deletion procedures are part of the system, and they apply to this document.

### 1.1 Requirements (Brian's words, 2026-07-26 + 2026-07-27)

1. **Navigable by AI agents and Claude Code.** The reader is a zero-context agent, every session.
2. **Defined roles to replace a team in spirit.** A team's advantage isn't five brains — it's that four
   of them weren't in the room when the decision was made.
3. **Self-sufficient**, so it does not depend on him "being vigilant all the time with prompting
   properly." Materially less vigilance is acceptable; it has to be **a lot** less.
4. **Enough docs that nothing important is lost, not so many that it bloats.** A *middle*, not
   minimisation — this is a direct constraint on the checks, which all measure "too much."
5. **Orderly speccing, bug-hunting and plan execution — with room for the real loop.** Work is not a
   line. Build part C → C surfaces something → bug hunt → doc re-audit → the spec itself changes → back
   to building. A design that only supports the straight path is wrong.
6. **The goal is the development process being easier**, not the repo scoring well on its own metrics.

### 1.2 Diagnosis (probed 2026-07-27, evidence not assertion)

Requirement 3 demanded finding out where the repo actually stands before designing for it. Three
probes, and the result **relocated the disease**:

- **The §23 register tells the truth.** Three `RESOLVED`/`IMPLEMENTED` rows read-verified against
  code — H14 (`store → repoint → delete` in `wardrobe/[id]/image/route.ts`), H7
  (`generationIndex = (parent.generationIndex ?? 0) + 1`, `mlRecommend.ts:322`), H19 (repetition window
  in `RankerContext`). All three hold, and H14's trap-guard is a comment **at the symbol** — §8's ideal
  destination, already working. **The register is the healthiest process in the repo; distrust of it is
  not evidence-based.**
- **Single-home is violated mostly by already-dead docs.** "Regenerate = fresh generation, no cache"
  is stated in four files — two of which (`m5-cutover.md`, `regen-controls.md`) are already slated for
  deletion. D1 cures most of this as a side effect. Not the disease either.
- **The disease is hand-maintained status prose.** `CLAUDE.md`'s Current-focus block (lines 80–124,
  **45 lines**, 38 non-blank) is stale on every axis checked: it still lists the 07-26 deploy and
  staggered onboarding as *remaining* (`CLAUDE.md:99`; commits `4936c8e9`/`b8c3dfb9` say
  otherwise), and it has **zero** mentions of the clothingType rollout (07-24) or of the two bug-hunt
  rounds and their 13 defects. (Its three `clothingType` hits — `:117`, `:136`, `:204` — are all the
  M4 five-value migration, a different event. Do not "correct" this line by grepping the word.)

**The 2026-07-27 boundary error, corrected here.** The draft located the disease *in that block*. It is
not in that block; it is in the **artifact class**. Two more instances, both verified 2026-07-27, both
outside the block and both invisible to every proposed check:

- **A plan's status banner. `docs/plans/clothingtype-slot-correctness.md:3-4` says the deploys, the
  live-DB migration run and the re-invite "remain Brian's." `docs/plans/m5-c8-half2-runbook.md:495`
  says "Rollout status (2026-07-24): steps 1–3 DONE."** Two active docs, opposite claims, three days
  stale. This is a single-home conflict — a bug by `CLAUDE.md`'s own rule — and D1 does not touch it:
  the plan carries no `COMPLETED` banner, so it is not one of the 14 slated for deletion.
- **A test floor inside the durable arc. `CLAUDE.md:117` states `≥922 (+10 skip) jest`; the suite is
  `967 (+10 skip)`** (measured, `npm test`). That line sits in the numbered milestone arc — the part of
  the section a reader actually needs — not in the volatile paragraph §1.3 proposes to delete.

**None of the twelve size checks would catch any of the three.** Every one measures *size*; none measures
*currency*. A completely wrong `CLAUDE.md` passes all twelve. That is requirement 4's asymmetry in
concrete form: **the campaign was all ceilings and no floors.** And a floor aimed only at
`## Current focus` would have caught **one of three**.

### 1.3 The centerpiece — derived state (ruled 2026-07-27)

`CLAUDE.md` goes stale because it **stores volatile state in a format only a human can update**. No
check on doc *size* can help, and no better rule about updating it will hold — that rule already exists
and already failed. So the design changes at the root: **stop storing volatile state in prose at all.**

Every fact in the repo is routed by two questions — *does it change often?* and *can it be computed?*

| | Derivable | Must be authored |
|---|---|---|
| **Stable** | — | **Docs.** Contracts, decisions, conventions, ambition. Single-homed. Naturally small *because state isn't in them*. |
| **Volatile** | **Derived state.** Computed at read time from git, the register, the suites, the deploy. **Never written to a file.** | **A register row** with `BLOCKED:<condition>` (D6b's third field). "Waiting on 3 friend closets" lives here. |

**You cannot have a stale artifact if the artifact is computed at read time.** That is strictly better
than any currency check, which by construction only tells you something is stale *after* it is stale.

Shape of the derived state. **The first draft is kept below because §1.3.1 convicts one of its lines
and the failure is instructive; the buildable version follows it.**

```
# DRAFT — one line here is not derivable. See §1.3.1.
FITTED · main · 4 unpushed · web 30b03cc9 = HEAD ✓ · fly v6
plan   docs/plans/maintainability.md — §6 ruled, S1a next     <-- NOT DERIVABLE
open   39 register rows · 13 defects unfixed (H87–H99)        <-- needs D6c (S4a)
tests  jest 967 ✓ · pytest 1098 ✓ · hygiene 12 ✓              <-- 9.6 s; /state only
last   f9565559 docs(maintainability): rule §6…
```

The buildable version — `SessionStart` prints only the top two lines and only when something is off;
`/state` prints all of it on demand:

```
FITTED · main · 5 unpushed · 0 uncommitted
plan   docs/plans/maintainability.md · S1a red, S4a red, S0 red  → next: S1a
open   99 register rows · 37 status ^OPEN
tests  jest 967 ✓ · pytest 1098 ✓ · hygiene 14 ✓                 (/state only)
deploy web 30b03cc9 = HEAD ✓ · fly 1 machine v6                  (/state only, network)
last   8039906a docs(maintainability): re-centre the campaign…
```

Every line is computed: unpushed from `git rev-list`, rung position from **which hygiene checks are
red**, register counts from the closed vocabulary, deploy from the network on demand.

**Why this is what serves requirement 5.** When C3 surfaces something and the session detours into a
bug hunt, then a re-audit, then a spec change, **nobody has to remember to update a paragraph** — the
state block just reflects where things are. The loop stops being a thing the docs must be talked into
tolerating. And it dissolves requirement 4's tension: docs bloat *because* state gets written into
them; take state out and "enough but not too many" stops being a balancing act, because what remains
is durable and therefore small.

### 1.3.1 The model tested against a real loop (2026-07-27) — it holds, with one hole at its centre

Asserted is not tested, so the model was walked through the **clothingType slot fix**, a completed real
instance of requirement 5's loop: *Track 2 collects → friend Zhiyun's session surfaces something (a
dress-heavy 6-item closet, 13 renders, 0 ratings, mined from live Atlas 2026-07-22) → bug hunt finds a
mis-slot → plan + Fable review + three audit lanes → **the audit changes the plan** (D1 is a wire change
not a copy edit; the weather dimension is dead → new row H71) → build C1–C4 → roll out 07-24 → back to
Track 2.* Every stage of the detour the requirement describes, in one real episode.

Four of the five lines in the block above survive that walk. One does not, and it is the one that
matters most:

```
plan   docs/plans/maintainability.md — §6 ruled, S1a next
```

**`§6 ruled, S1a next` is not derivable.** There is nowhere to compute it from except a hand-maintained
status banner — the exact artifact class §1.2 just convicted, and the exact thing
`docs/plans/clothingtype-slot-correctness.md:3` got wrong. S0's own DONE condition ("nothing in it is
read from a file a human maintains") is **unsatisfiable for this line as designed.** The centerpiece
had authored state at its centre.

**The fix, and it is why the ladder is resequenced.** Derive rung position from **the checks**, not from
a banner: a rung's position is *the first rung whose DONE check is still red*. That is the same trick
check 12(b) already uses to make this file's own death terminal, applied one level down. It is fully
computed, it cannot go stale, and it makes the line honest.

It also has a hard consequence: **S0 cannot be first.** The checks it reads must exist, so **S1a
precedes S0** (§7). Three further facts from the same walk:

- **`13 defects unfixed (H87–H99)` needs D6c's closed status vocabulary to compute.** Today the
  register carries **86 distinct free-text status strings**; no reliable parse exists. Until S4a, S0
  prints the honest weaker thing: total rows, and rows whose status *begins* `OPEN`.
- **Deploy SHA and Fly machine count are network reads.** §9 says prefer dropping slow facts; dropped,
  the example block above is wrong as printed. Keep them in `/state` (explicit, on demand); keep them
  out of `SessionStart`.
- **Cost is not the constraint.** Measured 2026-07-27: pytest **1098 in 0.73 s**; jest **967 in 9.6 s**.
  jest is the only real tax, and it is the reason suites belong in `/state`, not in `SessionStart`.

**Consequence for `CLAUDE.md`:** the 45-line Current-focus block is **deleted, not maintained** (S3) —
but per §1.2 that fixes one instance of three, so the enforcer (check 14) is aimed at **volatile
markers wherever they appear**, not at that heading.

## 2. Measured state (re-measured 2026-07-27, third pass)

**These numbers drift within days. Re-measure before acting on any of them; the method is given so you
can.** The third pass corrected four more figures that the second pass had marked verified.

| | Method |
|---|---|
| tracked `*.md` (excl. `team/`, `meetings/`) | **90 files, 1,854,675 bytes** — `git ls-files '*.md' \| grep -v '^team/\|^meetings/'`. Unfiltered returns **145**, which is why check 1 must state the exclusion |
| `docs/` | **74 files, 20,042 lines** |
| `docs/plans/` | 21 files; **14 carry a `> COMPLETED` banner** and are still in the active tree — `grep -l '^> COMPLETED\|^> \*\*COMPLETED' docs/plans/*.md`, **8,321 lines** |
| `docs/sessions/` | 48 files, 5,657 lines, self-described "write-mostly"; **13 dated notes cited from outside the directory** ✓ (re-verified per-basename) |
| docs created : deleted, all time | **110 : 20** ✓ |
| §23 register | **99 rows** — `grep -cE '^\| H[0-9]+ \|'` over spec lines 1253–1360; IDs are exactly H1–H99, **no gaps, no duplicates**. (The 07-27 second pass said 100. It was one over.) |
| §23 status vocabulary | **86 distinct strings across 99 rows** (07-27 second pass said 87) |
| §23 populations | **Classifier-dependent — do not quote as fact.** A keyword classifier (`RESOLV\|IMPLEMENT\|LANDED\|CLOSED\|DONE\|FIXED` vs `OPEN\|PARTIAL\|BLOCKED\|DEFER`) gives RESOLVED 47 / OPEN 37 / HYBRID 9 / DEFERRED 6. The second pass's 51/40/8/1 used a different, unstated classifier. **This is itself the argument for D6c**: a population you cannot count twice the same way is not a work queue |
| §23 bytes | **119,238 of the spec's 241,993 — 49.3%** ✓ (`sed -n '1253,1360p' \| wc -c`) |
| largest docs | spec **241,993 B** · `m5-cutover.md` 219,293 B · `h26-spike-v2.md` 104,686 B · `recovered_appendix.md` 102,294 B ✓ |
| spec size | **1,472 lines** against CLAUDE.md's own 1,500-line compaction trigger ✓ |
| default reading list | CLAUDE.md + spec + runbook = **322,496 bytes** ✓ |
| `CLAUDE.md` Current-focus block | **lines 80–124 = 45 lines** (38 non-blank). The second pass said 32; §1.3 and check 14 inherited the wrong number |
| process infrastructure | **1 agent** (`.claude/agents/planner.md`), **2 commands** (`spec`, `sync-upstream`), **0 hooks** ✓ |
| source→doc coupling | **77 citations across 69 `.ts`/`.py` files** to `docs/plans/*.md` ✓ exact; **exactly 1 names a nonexistent path** ✓ (`fitted/lib/outfitLint.ts:15` → `docs/plans/track2-friend-ready-2026-07-18.md`; the real file is `track2-friend-ready-prompt.md`) |
| suites | jest **967 green / 10 skipped / 977 total in 9.6 s** ✓ · pytest **1098 in 0.73 s**. The 10 skips are env-gated integration suites, not backlog skips |

**The dead-doc target is 13,978 lines**, verified: 8,321 (the 14 banner-ed plans) + 5,657
(`docs/sessions/`). It excludes the recovered appendix (2,282 → D5) and `regen-controls.md` (134).

**Two claims the third pass found false and killed:**

- **`docs/plans/full-audit-2026-07-25.md` exists** — tracked, 16,579 B, 243 lines. It was reported
  missing. §4 cites it **once** (not twice) and the cite is good.
- **`docs/sessions/README.md` has 1 real inbound citation, not 23.** By path:
  `grep -rn 'docs/sessions/README\.md'` returns 3 hits — two are this file's own claim, one is
  `docs/sessions/2026-06-16.md` (inside the directory, dies with it). The 23 appears to have counted
  the wrong direction. **D2 is cheaper than stated, not more expensive.**

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

**Rewritten 2026-07-27 (third pass).** The 07-26 draft marked 8 of 9 rows "eliminated"; the D3 ruling cut
that to 4 and told S1b to fix the table. Deferring a correction to a rung that has not started is how
a stale claim survives, so it is fixed here. An elimination requires a **deterministic trigger** and a
**deterministic check** — no classifier, no human choice, anywhere in the loop. Everything else is a
reduction, and calling a reduction an elimination is how a campaign declares victory without winning.

| Today he must remember… | Mechanism | Kind |
|---|---|---|
| To push; that prod matches git | `Stop` hook: `git rev-list --count @{u}..HEAD` | **eliminated** — trigger and check are both mechanical |
| Whether doc claims are true | Checks 9 + 10 — continuous, not a scheduled audit | **eliminated** |
| Not to edit a frozen pre-registration | Check 11 — sha256 pin (+ the D5 appendix) | **eliminated** |
| Whether the campaign ended net-negative | The baseline file *is* the measurement; check 12's liveness coupling makes it terminal | **eliminated** |
| That a bug hunt not also fix (the 07-25 defect) | `/find` **dispatches to the `finder` subagent**, which has no write tool (§4) | **partial** — see the split below |
| Which red is "expected backlog" | Ratchet: `current <= baseline` blocks, `current <= target` reports (D4) | reduced — the two signals are separated, but reading the status is still a choice |
| Where the repo stands right now | `SessionStart` prints derived state, silent when clean (§1.3) | reduced — recall → recognition; acting on it is still his |
| Whether prose is migrating out of `docs/` | Whole-tree byte cap, not a `docs/`-only file count | reduced — the cap catches migration, not the decision to migrate |
| To deploy from `fitted/`, not the repo root | `/ship` command | reduced — he must choose to type it |

**Four eliminations out of nine rows — three mechanisms** (`Stop`; checks 9–11 as continuous
assertions; the baseline file as its own measurement). That is the honest score and it is the number
the campaign is accountable to.

**The 07-25 row splits, and the split is the point.** "Audit without also fixing" is two obligations
wearing one sentence:

- **"Don't let the finder's own reasoning also be the fixer's."** *Eliminated.* The `finder` subagent
  has `tools: Read, Glob, Grep` and no write tool. Not a rule it follows — a capability it lacks.
- **"Don't act on the report in the same session."** *Not eliminated, and no mechanism proposed here
  reaches it.* The main loop receives the report and can fix immediately. §4 specs a `PreToolUse` latch
  that would close it and deliberately does not build it yet.

**The residual, stated once and not softened.** Everything in the "reduced" rows can be ignored by a
session that decides to. A printed line is present-at-the-moment-of-decision, which is a large delta
over recall — but it is **not a capability boundary**, and claiming otherwise would be the false
guarantee this repo already punishes (*"a false guarantee in source is worse than the original bug"*).
The only true boundaries in this design are a missing tool and a hook that exits 2.

## 4. Roles — 2 agents, 3 commands, 2 hooks

**Rebuilt 2026-07-27 (third pass).** The prior draft proposed 3 agents / 4 commands / 3 hooks. Applying
its own rule — *no receipt, no role* — to itself removed one agent and one hook, and revealed that the
fourth command was never named anywhere in this file. What survives is smaller and each piece is
carrying proof.

**Correction that stands from the second pass:** read-only agents do **not** fix the 2026-07-25 defect
class. `docs/plans/full-audit-2026-07-25.md:26-27` already required read-only subagents that day;
session 1 obeyed and still shipped six self-inflicted defects, because they came from the **main loop**
finding, deciding and fixing in one motion. See §3's split for what the agents do and do not buy.

### The two agents

| Agent | Tools | Receipt — a failure that actually happened, verifiable today |
|---|---|---|
| `finder` | `Read, Glob, Grep` | **The read-only rule written after the incident does not deliver read-only.** `full-audit-2026-07-25.md:26-27` (commit `5cbf5973`) reads: *"Every review/search subagent MUST be read-only (`subagent_type: "Explore"`). A writable agent deleted a user file in an earlier session."* But `Explore`'s tool set is *all tools except Agent, Artifact, ExitPlanMode, Edit, Write, NotebookEdit* — **it keeps `Bash`, and `Bash` deletes files.** |
| `reviewer` | `Read, Glob, Grep` | `CLAUDE.md:236` mandates *"spawn **one** fresh-context review agent"* every checkpoint and names no agent, so it resolves to a writable default. Same boundary as `finder`, different stance. |

**On the `finder` receipt.** The originally-cited artifact — a review subagent deleting
`scripts/track2-users-peek.mjs` — is **unverifiable**: `git log --all -- '*track2-users-peek*'` is empty,
consistent with "never committed" and therefore consistent with anything. By this section's own rule
that is not a receipt. The receipt above replaces it and is strictly better: it is a **committed, dated
contemporaneous record** of the incident *plus* a demonstrable hole in the fix that was written for it.

**Why "it would only prompt" is not a defence.** A `Bash rm` outside `settings.json`'s allowlist raises
a permission prompt. That is a human-in-the-loop check — and this repo runs **long autonomous
sessions**, where prompts get approved by reflex. A prompt is declined by attention; a missing tool
cannot be approved at all. That difference is the entire reason these two agents exist.

**Honest note:** `finder` and `reviewer` have identical tool sets. This is **one boundary wearing two
system prompts**, and the second agent's value is its stance (hunt vs. review), not extra safety. That
is a legitimate reason to have both and not a reason to claim two boundaries.

**`librarian` is CUT.** Its stated receipt was *"nobody owns deletion → 110:20"* — a repo statistic, not
an incident, so it fails the no-receipt-no-role rule. Its job (does a deletion leave information
without a destination?) is **check 13's** job, and a test beats an agent for a recurring mechanical
question. The one-time deletion sweep is S2, not a standing role.

### The two traps, both now proven rather than asserted

- **`tools: Bash(git log)` silently resolves to full unrestricted `Bash`. VERIFIED at the source**
  (`@anthropic-ai/claude-code@2.1.220`, bundle strings, 2026-07-27). The parser `fg(entry)` splits a
  trailing `(...)` into `{toolName, ruleContent}` — `Bash(git log)` → `{toolName:"Bash",
  ruleContent:"git log"}`. The resolver `hte()` then reads `ruleContent` **only** when
  `toolName === "Agent"`; for every other tool it does `y.get(toolName)` and pushes the **whole tool
  object** into `resolvedTools`. The scope is parsed and dropped. Corroborated by the public docs: the
  `tools` field accepts pattern syntax only for MCP servers (`mcp__<server>__*`), and the documented
  way to constrain `Bash` is a **`PreToolUse` hook, "when you need finer control than the `tools` field
  provides."** A role built to be safe would ship with `rm`.
  - **Therefore:** grant no scoped `Bash`. If an agent genuinely needs constrained `Bash`, the *only*
    working mechanism is a `PreToolUse` matcher in that agent's own `hooks:` frontmatter, exiting 2 to
    block. Neither agent above needs `Bash`, so neither gets it.
  - **Verify by attempting the forbidden action, never by reading the frontmatter.** A frontmatter line
    that looks like a boundary is exactly the failure this trap describes.
- **`planner` is not the good example to copy. VERIFIED.** `.claude/agents/planner.md:4` grants
  unrestricted `Write`; the "only file you may write is `docs/plans/<slug>.md`" limit exists only in
  body prose at `:8` and `:27`. It is the promise-not-a-boundary failure, in the one instance of the
  pattern that already exists in this repo.

### Commands: 3, not 4

The prior draft's ladder promised "4 commands." Only **three are named anywhere in this file** —
`/find`, `/ship`, `/state`. The fourth does not exist; the count was the aspiration, not the content.

| Command | What it is |
|---|---|
| `/state` | Prints the §1.3 derived block on demand, including the slow/network facts `SessionStart` drops |
| `/find` | **Dispatches to the `finder` subagent.** This is the one command that is not just ergonomics |
| `/ship` | Deploy from `fitted/`, not the repo root. Pure ergonomics — he must choose to type it |

**Commands are ergonomics, not enforcement, and the spec says so.** A slash command's
`disallowed-tools` clears on the next user message, so an in-command "don't fix anything" is prose
enforced by attention — the exact mechanism that failed on 07-25. `/find` earns its place only because
it **dispatches**: the boundary comes from the subagent's missing tools, not from the command.

### The hooks: 2, not 3 — `UserPromptSubmit` is cut (amends D3)

D3 ruled all three hooks and simultaneously described `UserPromptSubmit` as *"a heuristic classifier
standing where a guarantee is claimed… the weakest link in this design."* Both cannot hold. It is cut.

Its trigger is a **regex over prompt text**: it fails to fire on unusual phrasing (leaving full
vigilance *plus* false confidence, which is worse than no hook) and fires wrongly into sessions that
want fixes. It was the flagship mechanism for the flagship defect class and it was never more than
decoration over a phrasing convention.

**What replaces it:** `/find` → `finder`, per §3's split. That is a real boundary for the half of the
defect it can reach, and honest silence about the other half.

**Specced, deliberately not built — the `PreToolUse` latch.** The remaining half ("don't act on the
report in the same session") *is* mechanically closable: `/find` writes a marker keyed by the hook
input's `session_id`; a `PreToolUse` matcher on `Edit|Write` exits 2 while that marker exists. Keying by
session id means a stale marker cannot block a later session — the failure mode that would otherwise
make this worse than nothing. It is a real mechanism, not a regex.

**It is not built until a receipt demands it** — a real find-session that leaks a fix. That is this
section's own rule applied to a mechanism instead of a role, and it is the difference between a system
and a bureaucracy.

## 5. The 14 checks

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
| 8 | §23 + `DEFECTS.md` status **vocabulary membership** | 86 distinct strings | D6c: was a hybrid *detector*; a closed set makes hybrids unconstructible, so this becomes a membership assertion |
| 9 | doc cites naming a nonexistent path | measure at S1a | catches the D2 session-note re-homing and the D5 appendix deletion |
| 10 | **source files citing a nonexistent doc** | **1** — `docs/plans/track2-friend-ready-2026-07-18.md` | D4: lands at its **target (0)**, not ratcheted — one-line fix |
| 11 | sha256 pins: `ml-system/experiments/*/preregistration.*` **+ `Fitted_Spec_v2_recovered_appendix.md`** | — | D5 |
| 12 | (a) no `current` exceeds its `landing`; (b) **liveness**: `maintainability.md` exists iff any `current > target` | — | D4: converts §7's S6 DONE condition from prose into a test |
| **13** | **FLOOR — every commit that `git rm`s a `*.md` carries an `EXTRACTED <path>` block whose named destinations RESOLVE** (each `code:` path exists, each `spec:` § exists, each `test:` name is collected by a suite) **and whose `DROPPED:` field is an integer** | — | §1.2: the counterweight to twelve ceilings. Strengthened 07-27 — see below |
| **14** | **FLOOR — no volatile markers in `CLAUDE.md` or in any `docs/plans/*.md` status banner**: no commit SHAs, no `✅`, no `Remaining:`/`Now:`/`next:` status lines, no bare suite counts, no ISO date used as a status stamp | CLAUDE.md: 2 SHAs, 6 `✅`, 14 ISO dates, 1 stale suite floor (`:117`) | §1.3, rewritten 07-27 — see below |

**Checks 13 and 14 are the requirement-4 floors.** Checks 1–12 all assert *less*; without these the
campaign optimises "fewer docs" while Brian asked for "enough docs." Both were thin and both were
rewritten on 2026-07-27.

**Check 13 — what changed, and the honest limit.** As drafted it verified that an `EXTRACTED` block
*exists*. That is defeated by the cheapest possible commit message:
`EXTRACTED foo.md / DROPPED: everything`. Two changes make it bite:

1. **Destinations must resolve.** A `code:` path that does not exist, a `spec:` section that does not
   exist, a `test:` name no suite collects — each fails the check. This is checks 9/10 applied to the
   extraction record itself, and it defeats the confident-sounding fabricated destination, which is the
   realistic failure mode when an agent writes the block.
2. **`DROPPED:` must be an integer, and the running total is printed by `npm run hygiene`.** Not a
   gate — a **cost meter**. The campaign's failure mode is silent lossiness; a standing line reading
   *"this campaign has dropped 412 paragraphs"* makes the cost impossible not to see, and makes a
   session that drops 300 in one commit visible to the next session without anyone auditing.

**Stated plainly, because inventing a floor here would be worse than admitting there isn't one: no
check can verify that a dropped paragraph was worth dropping.** That judgment requires reading the
paragraph and knowing the future. Check 13 makes *"was this extracted, and to somewhere real?"*
answerable by `git log`, and makes the volume of loss continuously visible. It does not and cannot
grade the loss. Anything claiming to would be a false guarantee, which §3 already rules out.

**Check 14 — the draft was aimed at a heading; the disease is a marker.** The drafted version banned
`## Current focus` in `CLAUDE.md`. §1.2 measured three live instances of the disease and that version
catches **one**:

| Instance | Heading ban | Marker ban |
|---|---|---|
| `CLAUDE.md` Current-focus block, stale by three events | caught | caught |
| `clothingtype-slot-correctness.md:3-4` vs `runbook:495` — opposite rollout claims | missed | caught (ISO date used as status + `Remaining`-shaped banner) |
| `CLAUDE.md:117` — jest floor `≥922`, actual `967` | **missed** (it is in the durable arc, not the block) | caught (bare suite count) |

The heading ban is also **evadable by renaming the heading** and **over-broad**: `## Current focus`
contains the durable milestone arc a zero-context agent needs (requirement 1), so deleting the whole
section to satisfy the check would destroy orientation to satisfy a metric — precisely requirement 6's
failure. The marker ban targets the disease instead of the container, cannot be renamed around, and
extends to `docs/plans/*.md` banners where two of the three instances actually live.

**Why these and not the obvious versions** — each of these replaced a worse check that an adversarial
review defeated:

- **Bytes, not lines.** `CLAUDE.md` averages ~123 chars/line and its longest line is 1,538 chars. The
  §23 register is **7% of the spec's lines (108 of 1,472) and 49% of its bytes (119,238 of 241,993)** —
  re-measured 07-27; the second pass said 6%/45%. A line cap is satisfied by reflowing prose to long
  lines — a 40% "improvement" worth exactly nothing — while the single highest-value deletion in the
  repo barely moves it.
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

*Note against this doc's own standard:* 307 → 545 lines at the §6 ruling, **→ 934 at the 07-27
adversarial re-read**. Three sessions have tripled a document whose thesis is that documents accrete.
That is partly earned — it now carries the decision record and, more importantly, the *method* behind
every number, which is the only thing that stopped the fourth session repeating the third's errors —
and partly the disease. It is why check 12(b) exists. **Hard limit: if this file crosses 1,100 lines
before S1a lands, the next session compacts it instead of building.** This doc does not get to be the
exception.

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
- **13 of the 48 notes are cited from outside `docs/sessions/`** ✓ re-verified 2026-07-27, and need
  re-homing or citation repair, not bulk `git rm`. Counts and the full list are in §8; the largest are
  `2026-07-18-track2-friend-ready.md` (4 inbound), then `2026-07-25-audit-session1.md`,
  `2026-07-08-m5-c5-seam6-route.md`, `2026-06-26-m4a-post-audit.md` and `2026-06-20-m3-ledger.md` at 3
  each. **`docs/sessions/README.md` has 1 real inbound, not 23** — D2 is cheaper than the second pass
  claimed. Check 9 is the backstop for a missed repair.

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

> **AMENDED 2026-07-27 — `UserPromptSubmit` is CUT, taking D3 from three hooks to two.** This ruling
> named it the weakest link and kept it anyway; those cannot both stand. Nothing replaced it for a full
> session, which is how a known-decorative mechanism stays flagship. `/find` → the read-only `finder`
> subagent replaces the half of the defect a boundary can reach; a `PreToolUse` latch is specced and
> deliberately unbuilt for the other half. **See §4.** The rest of D3 — all hooks silent-when-clean,
> `SessionStart` printing only on a problem, `Stop` exiting 0 silently, jest cold start ~0.8 s — stands
> unchanged and applies to the remaining two.

**§3 was inflated and is the campaign's stated acceptance criterion.** It has been rewritten in place
(2026-07-27) rather than deferred to S1b: **4 of 9 rows, 3 mechanisms**. Deferring a known-false claim
to a rung that has not started is how the claim survives — the disease, not the cure.

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
  a recurring trigger. ✓ verified 07-27.
- **The surviving spec cites into it:** `Fitted_Spec_v2.md:1303` (§23-H45) → "the someday-launch
  growth-loop artifact (recovered appendix C.4)", and `C.4` exists at `recovered_appendix.md:1457`.
  ✓ verified 07-27 — **but the conclusion drawn from it was false.** The second pass wrote *"Deleting it
  reddens check 9."* It would not: the cite is the **prose phrase** "recovered appendix C.4", not a
  path, and check 9 tests paths. Deleting the appendix would break this cite **silently**, which makes
  the argument for keeping it stronger, not weaker — but the mechanism named was wrong and would have
  had S2 relying on a backstop that does not cover this case.
- **Its content is not anecdotes.** `C.0` (`recovered_appendix.md:13`) is the definitional source for
  `Board`/`StyleProfile`/`Routine`/`Lens`/`StyleMove`/`StyleEdge` and the core purpose statement — the
  vocabulary the entire spec is written in. ✓ verified 07-27.

**D5's verdict stands on two legs of three.** Kept, sha256-pinned.

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
`DEFECTS.md`: `OPEN` | `FIXED:<sha>`. All **86 distinct strings across 99 rows** (re-measured 07-27)
collapse into these. **Hybrid rows become unconstructible** — one row, one status from a fixed set, so
a half-done row must split into two. **Check 8 downgrades from a hybrid *detector* to a vocabulary
*membership* assertion**, which is mechanical and cannot drift. The hybrids (8 or 9 depending on the
classifier — §2, and that ambiguity is itself the argument) are still
**split, never deleted** — H78's open half is an unclosed cross-user data-scoping defect and belongs in
`DEFECTS.md`.

## 7. Ladder and sequencing

**Recommendation, 2026-07-27: do a three-session slice now — S1a → S4a → S0 — then stop and go back to
Track 2 and M6.** Not the whole campaign now; not S0 alone; not after Track 2. The rest resumes when a
receipt demands it.

### 7.1 Why this and not the alternatives

**"The campaign blocks Track 2" is false, and that reframes the question.** Recruiting is Brian's,
out-of-session. The pre-recruit checklist is push/redeploy → staggered onboarding → cron monitor
(`CLAUDE.md:99`). The campaign does not sit on Track 2's critical path; it **competes for Brian's
sessions**. So the question is not "product or hygiene," it is "which spend makes the next thirty
sessions cheaper, and how little of it can we buy."

**Against "after Track 2":** the payoff scales with the number of sessions that come *after* it, and
Track 2 + M6 is the session-dense phase. Deferring means paying the **322 KB reading list** on every
session of the densest stretch. This is the one argument that decides the timing, and it points early.

**Against "all nine rungs now":** ~9 sessions of doc surgery for zero product value is not defensible
when three of the rungs (S3, S5, S6) are polish with no receipt, S1b's agents take minutes to write
whenever one is needed, and S2's win is second-order (grep noise, not per-session context).

**Against "S0 only":** S0 as specced cannot be built honestly — its plan line is not derivable and its
defect count needs the closed vocabulary (§1.3.1). Building it first means building it wrong.

**Why these three, in this order.** Ranked by what a Track-2/M6 session actually pays today:

| Rung | What it buys | Cost |
|---|---|---|
| **S1a** | The enforcement spine. Makes every later rung's DONE condition *provable*, and — per §1.3.1 — makes rung position **derivable**, which is what unblocks S0. Fixes the `npm test` trap and lands check 10 at 0. | 1 session |
| **S4a** | **The single biggest per-session win in the campaign:** move the defect rows out of the spec. Reading list **322 KB → ~203 KB, −37%**. Half the canonical spec is a bug tracker a design session does not need. | ~1 session |
| **S0** | Derived state, now honestly derivable. Serves requirement 5 directly. | 1 session |

**S4a is deliberately not S4.** Split the register and close the status vocabulary — a mechanical cut
and re-point. **Do not** do D6's compression, trap-guard extraction or 51 resolved-body deletions yet:
those are the one-way doors, and they are far safer once friend data has generated its next wave of
rows. The −119 KB comes from the move, not the compression.

**Before session A, and not as part of the campaign: push the 5 commits and redeploy.** It is one
minute of work, it has been "remaining" on the checklist since 07-20, and it is the highest-value
action available in the repo today. That the campaign keeps not-noticing it is the entire argument for
S0 — and also the reason S0 is not worth waiting for before pushing.

### 7.2 The rungs

One rung per fresh session; each ends with its DONE condition **proven**, not asserted. `npm test` must
be green at every session boundary (D4) — unfinished work hands off as a `DEFECTS.md`/§23 row or a plan
checkpoint, never as a failing test.

**Slice to build now:**

- **S1a** — the 14 checks + baseline, green on arrival, with `current`/`target`/`landing` per check.
  **First: fix `"test"` to `jest --selectProjects node jsdom`** and prove hygiene is outside `npm test`
  (§5 trap). Repair the check-10 citation so it lands at target 0. **DONE when** lowering each baseline
  by one reddens exactly that check, proven one at a time (mutation, not reading), *and* a deliberately
  reddened hygiene check leaves `npm test` green.
- **S4a** — split `docs/DEFECTS.md` out of §23 (D6a) and close the status vocabulary (D6c); split the
  hybrid rows; repair every inbound citation in the same commit. **No compression, no body deletion.**
  **DONE when** the reading list is measured under 210 KB, every §23/`DEFECTS.md` status is a member of
  the closed set, and check 9 is green.
- **S0** — the derived-state script (§1.3): `/state` + `SessionStart`, silent when clean. Rung position
  comes from **the checks**, register counts from **the closed vocabulary**. Suites and network facts
  go in `/state`, not `SessionStart`. **DONE when** Brian has started three real sessions with it and
  it told him something he would otherwise have gone looking for — and when **nothing in it is read
  from a file a human maintains** (the condition §1.3.1 showed the original ordering could not meet).

**Then stop. Push, recruit, build the M6 embedding pipeline.** The rungs below resume when a receipt
demands them, not on a schedule.

- **S1b** — 2 agents, 3 commands, 2 hooks (§4, silent-when-clean). **DONE when** each agent has been
  *refused* its forbidden action and the refusal is pasted into the commit. Not "the frontmatter says
  so." *Receipt to wait for: the next session that needs a genuinely read-only hunt.*
- **S1c** — fold `TOMORROW.md`'s two keepers into `CLAUDE.md`, `git rm docs/TOMORROW.md`.
- **S2** — the deletion pass: 14 completed plans, `docs/sessions/` **as a directory** (D2), the two
  retired ledgers, `regen-controls.md`. Also in S2: move `RECOVERY.md` → `docs/RECOVERY.md` **and edit
  CLAUDE.md's critical-usage backstop (`CLAUDE.md:191`) in the same commit**; re-home the 13 cited
  session notes; append the D1 retrieval index to `CLAUDE.md`. **Check 10 green in the same commit as
  every `git rm`.**
- **S3** — `CLAUDE.md` + spec rewritten as a map for a zero-context reader; line cites → symbol cites.
  **Delete the 45-line Current-focus block** (`CLAUDE.md:80-124`) — it is derived state now (§1.3) —
  **but keep the durable milestone arc**, moving its stale suite floor (`:117`) out to derived state.
  **Resolve two standing CLAUDE.md conflicts:** the recovered appendix is a *frozen ambition baseline*,
  not "historical context only" (`:139` vs `:238`, D5); and the "externalize state into
  `docs/sessions/`" convention is dead (D2).
- **S4b** — the rest of D6: extract trap-guards to their symbols; delete the resolved bodies; convert
  open design holes to `symptom | where | unblock`.
- **S5** — a `/find` doc-claim verification pass. Output: *X checked, Y wrong.*
- **S6 (terminal)** — `git rm docs/plans/maintainability.md`. **Campaign DONE when** every check's
  `current <= target` — at which point check 12(b) *requires* this file to be gone, so S6 is enforced
  by the suite rather than by remembering to do it.

**The number that must go down** is tracked markdown files and bytes. `.claude/` and `fitted/tests/`
are enforcement infrastructure, counted separately — S1a+S1b are expected to be **+6 there and
net-zero in `docs/`**. A campaign that ends with more docs than it started has failed regardless of the
checks.

## 8. Deletion procedure — six destinations

A doc, a plan, a session note and a register row all die the same way. Content goes to exactly one of:

| What it is | Where it survives |
|---|---|
| **Trap-guard** — a mistake that actually bit | A comment at the symbol where it would be remade. **If it needs more than 3 lines it is a contract** — mechanism to the spec, one-line pointer in code. |
| **Contract / decision** | The spec, single-homed |
| **Guarantee** | A test |
| **An unclosed obligation** | **A §23 row.** H61's "M6 obligation", H77's three open residuals and H54's unbuilt test all live inside rows whose status says RESOLVED. |
| **Evidence** — an observation or measurement that justifies an open question | **The register row it justifies.** Added 07-27, see below. |
| History, rationale, review narrative | The commit message. Then delete the file. |

**The unit is a claim, not a paragraph** — split first, then route.

**The sixth destination, and why its absence was dangerous (tested 2026-07-27).** The five were never
checked against the workflow that produces the content. Walking the clothingType episode through them,
its most reusable artifact routes to **none of the five**: the Zhiyun case study — *a dress-heavy
6-item closet, 13 renders, 0 ratings, one ~46-minute session, mined from the live Atlas DB 2026-07-22*.
It is not a trap-guard, not a contract, not a guarantee, not an obligation, and not rationale. It is
**evidence**: the observation that motivated the work and the baseline any re-measure must compare
against. A data-collection project produces more of this than of any other category.

Its correct home already exists and is already in use: `Fitted_Spec_v2.md:1328` (**§23-H70**) carries
that case study inline as the justification for an open representation gap. Evidence lives in the row
whose question it answers, and dies when that row closes. §8 simply never named it.

**Rewrite of the closing rule.** The draft said: *"If a claim maps to none of the five, it was never
load-bearing."* That is a false dichotomy, and with evidence missing from the list it would have
licensed dropping the Zhiyun study as "not load-bearing." It now reads:

> If a claim maps to none of the destinations, **either the taxonomy is short one or the claim was not
> load-bearing.** Decide which, and record which in the `EXTRACTED` block. A taxonomy that has never
> gained a destination has not been tested against real content.

**A second gap, same shape, same home.** A decision whose reason is a *measurement that can change* —
*"gate B passed at N=1000, hw 0.0363"* — is also evidence, not contract. It belongs with the row or the
pre-registration it supports, never restated in prose that will silently disagree with the next run.

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
- **The other 12 cited session notes** (re-measured 2026-07-27, per-basename across `*.md`/`*.ts`/
  `*.py`/`*.mjs`, excluding hits inside `docs/sessions/`): `2026-07-18-track2-friend-ready.md` (4
  inbound), `2026-07-25-audit-session1.md` (3), `2026-07-08-m5-c5-seam6-route.md` (3),
  `2026-06-20-m3-ledger.md` (3), and 8 with one each. **`docs/sessions/README.md` has 1 real inbound,
  not 23** (§2) — it dies with the directory at negligible cost.
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

## 9. Next session — S1a, the checks and the baseline

**First, outside the campaign: `git push` and redeploy the web half.** §7.1.

Then paste this into a fresh session. Build **only** S1a.

```
Read docs/plans/maintainability.md §5 and §7 in full, then build S1a and nothing else — the 14 hygiene
checks plus fitted/tests/repoHygiene.baseline.json.

Re-measure every number in §2 before you seed the baseline. They are days old and they drift; §2 gives
the method for each one. Three consecutive sessions have found false claims in that file, so treat it
as a lead, not a source.

Do these two first, before writing any check:
1. Change fitted/package.json "test" to `jest --selectProjects node jsdom`, add a `hygiene` jest
   project, and PROVE the hygiene project is outside `npm test` — deliberately redden a hygiene check
   and show `npm test` still green. .github/workflows/conformance.yml runs `npm test` on every push to
   main; a doc file-count must never be confusable with a broken Python<->TS wire contract.
2. Repair fitted/lib/outfitLint.ts:15, which cites docs/plans/track2-friend-ready-2026-07-18.md — that
   file does not exist; the real one is docs/plans/track2-friend-ready-prompt.md. Check 10 then lands
   at its target of 0 rather than being ratcheted.

Every check asserts `current <= baseline`, seeded to today's real measurements, so the suite is green
on arrival. Print `current -> target (N to go)` per check plus a REGRESSIONS: line.

Checks 13 and 14 are the floors and they are the ones worth getting right — read their rationale in §5
before implementing. 13 must verify that EXTRACTED destinations RESOLVE, not merely that a block
exists. 14 is a volatile-MARKER ban across CLAUDE.md and docs/plans/*.md banners, not a ban on the
`## Current focus` heading — the heading version catches one of the three live instances in §1.2.

DONE when: lowering each baseline by one reddens exactly that check, proven ONE AT A TIME by mutation
rather than by reading; and a deliberately reddened hygiene check leaves `npm test` green. Paste the
red output into the commit.

Do not build the agents, the hooks, /state, or start any deletion.
```

**Sessions after that:** **S4a** (split `DEFECTS.md` out of the spec, close the status vocabulary) →
**S0** (derived state, now buildable honestly). **Then stop** and go back to Track 2 and M6; S1b, S1c,
S2, S3, S4b, S5, S6 resume on a receipt, not on a schedule (§7.1).
