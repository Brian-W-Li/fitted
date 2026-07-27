# Maintainability campaign — make the repo hold its own shape

> **THE MAIN IDEA, in three sentences.** **Facts that change should never be written down** — compute
> them at read time, or put them in exactly one register row with a falsifiable condition for closing.
> Documents then hold only what is *durable* (contracts, decisions, conventions, ambition), so they
> cannot disagree with reality and stop needing maintenance; they get smaller as a **side effect, never
> as a goal.** The standing rules that keep this true must survive as **artifacts — tests and hooks —
> not as prose anyone has to remember**, because a prose rule about prose rules already existed here and
> already failed.
>
> **The goal it serves:** sessions go back to being about code, instead of reconstructing where the
> repo stands from four documents that disagree. **The measured burden it targets is in §3.1.**
>
> Everything below should trace to one of those lines. If a passage does not, it is freight.

> **STATUS: adversarial re-read + re-cut, 2026-07-27. Nothing has been built yet.**
>
> **The load-bearing change: the suite now enforces truth and location, and only *prints* size (§5).**
> Every instance of the disease anyone has verified is a currency failure; none is a size failure. The
> felt cost is **ripple — one fact stored in N places**, so landing one test edits four documents. A
> suite that capped size would have enforced a proxy and punished the register for growing.
>
> §6's six decisions stand, with two amendments (D3: `UserPromptSubmit` **cut**, §4; D5: one leg was
> false, §6). §1.3's derived-state centerpiece stands with its **boundary redrawn** — the disease is not
> confined to `CLAUDE.md` (§1.2). §4 rebuilt on proven receipts: 3 agents / 4 commands / 3 hooks →
> **2 / 3 / 2**. New **check 15** (suite counts never decrease) turns *"floors grow, never pins"* from
> a convention into an artifact and is the guard against standing rules fading.
>
> **Ladder: S0 → S1a-lite → S4a, then stop** (§7 — this reversed once; the reasoning is recorded there).
> The next-session prompt is §9 and it is **S0**.
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
FITTED · main · 6 unpushed · 0 uncommitted
plan   docs/plans/maintainability.md · last touched 2h ago · 4ac8d523
open   99 register rows · 37 status ^OPEN
tests  jest 967 ✓ · pytest 1098 ✓ · hygiene 7 ✓                  (/state only)
deploy web 30b03cc9 = HEAD ✓ · fly 1 machine v6                  (/state only, network)
last   4ac8d523 docs(maintainability): survive an adversarial read…
```

Every line is computed: unpushed from `git rev-list`, **plan position from
`git log -1 -- docs/plans/`** (not from a status banner), register counts from a `^OPEN` scan, deploy
from the network on demand. Once S1a-lite lands, the plan line can upgrade to *which rung's check is
still red* — strictly better, and not a prerequisite.

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

**The fix — two forms, and the cheap one is enough.** The pure form derives rung position from **the
checks**: a rung's position is *the first rung whose DONE check is still red*, the same trick check
12(b) uses on this file's own death. That requires the checks to exist.

The cheap form needs nothing: **`git log -1 -- docs/plans/` gives which plan was last touched, when,
and by which commit.** 100% computed, cannot go stale, and it answers "where are we" well enough to
start a session. **So S0 does not have to wait** (§7 records where the opposite conclusion was drawn
and why it was wrong). Adopt the git form now; upgrade to the check form once S1a-lite lands.

Three further facts from the same walk:

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

## 2. How to measure the state — not the values

> **This section deliberately holds no numbers.** A table of volatile figures inside the document that
> diagnoses volatile figures is the disease, and it behaved exactly like the disease: three sessions ran
> against it and each found the previous session's "verified" values wrong. **The values are derived at
> read time (§1.3) and printed by `npm run hygiene` (§5). This section holds only the commands.**
> Once S1a-lite lands, even these move into the check definitions and §2 disappears.

| What | Command |
|---|---|
| tracked `*.md`, files + bytes | `git ls-files '*.md' \| grep -v '^team/\|^meetings/' \| xargs wc -c` — **the exclusion is load-bearing**: unfiltered is ~60% higher, so a "whole tree" wording makes any baseline unfalsifiable |
| completed-but-undeleted plans | `grep -l '^> COMPLETED\|^> \*\*COMPLETED' docs/plans/*.md \| xargs wc -l` |
| register rows | `grep -cE '^\| H[0-9]+ \|'` over the §23 line range |
| register status vocabulary | same range, field 4, `sort -u \| wc -l` |
| register bytes / share of spec | `sed -n '<§23 range>p' docs/Fitted_Spec_v2.md \| wc -c` against `wc -c` on the whole spec |
| default reading list | `wc -c CLAUDE.md docs/Fitted_Spec_v2.md docs/plans/m5-c8-half2-runbook.md` |
| source→doc coupling, and broken cites | `grep -rnoE 'docs/[A-Za-z0-9_./-]+\.md' --include='*.ts' --include='*.py'` then test each path with `[ -f ]` |
| suites | `npm test` in `fitted/`; `.venv/bin/python -m pytest tests service/tests -q` in `ml-system/` |
| the §3 burden baseline | the three commands in §3.1 |

**Two measurement traps, which are durable knowledge and stay:**

- **Register populations are classifier-dependent.** Two reasonable keyword classifiers give
  RESOLVED/OPEN/HYBRID splits that differ by 4–5 rows each. **Never quote a population as fact without
  stating the classifier.** This is itself the argument for D6c: a population you cannot count twice the
  same way is not a work queue.
- **Count inbound citations by path, not by basename.** The second pass reported
  `docs/sessions/README.md` at **23 inbound**; by path it has **1**. A bare `README.md` grep matches
  every README reference in the repo, and the direction of the count inverted. **D2 is cheaper than
  the campaign has been assuming, not more expensive.**

**One correction worth keeping because it was acted on:** `docs/plans/full-audit-2026-07-25.md` was
reported missing and **exists** — tracked, 243 lines. §4 cites it once, and the cite is good.

**The diagnosis is not "too much gets written."** It is that **completion produces a banner instead of
a deletion**. ~14,000 of those 19,388 lines are already dead by the repo's own rules and were simply
never removed.

**Proof that declarations don't work:** `docs/TOMORROW.md` opens with *"DISPOSABLE. Delete this file
once you've picked."* It was picked up on 2026-07-26 and is still here. A death condition with no
enforcer never fires. Everything below assumes that.

## 3. The burden, measured — and what actually gets eliminated

### 3.1 The baseline (measured 2026-07-27; the campaign had none until now)

The campaign existed to reduce a burden it had never measured, which meant "did it work?" could only
ever be argued. Measured over the **last 120 commits (2026-07-17 → 2026-07-27)**:

| | | |
|---|---|---|
| **Commits that touch no code** | **83 of 120 — 69%** | `git show --name-only` per commit; doc-only if no non-`.md`/`.txt` path |
| **Markdown share of all line churn** | **34%** (8,484 md vs 16,604 code) | `git log --numstat` |
| **Doc-only commits that are *corrections*** | **48 of 83 — 58%** | message matches `correct\|stale\|reconcile\|repair\|current.truth\|re-verif\|false claim\|fix.*(cite\|claim\|doc)` |

**Read these honestly, because two of them flatter the campaign:**

- **69% overstates the felt cost.** A one-line doc fix is as much a commit as a 400-line feature.
  **34% of line churn is the defensible figure** and it is the one to track.
- **58% is a heuristic over commit messages**, taken once by hand — the same regex-classifier weakness
  §4 rejects for a *mechanism*. It is a directional read, not a check, and must never become one.
- **The window is contaminated.** 07-17 → 07-27 contains two audit campaigns and three maintainability
  sessions, all correction-heavy by nature. Treat 58% as an **upper bound**.

Even discounted, the direction is unambiguous and it is worse than the working estimate of "~20% of a
session." **Roughly five correction-shaped doc commits per working day** — each one a fact that changed
in reality while N documents went on asserting the old value. That is the burden. It is ripple, not
volume, and §5's enforced channel is aimed at exactly it.

**The success test, stated now so it cannot be argued later.** Re-run the same three commands over 120
commits in a window that **excludes the campaign's own sessions**. Success is md-churn-share and the
correction share both moving down; failure is either holding flat. No target number — a number invented
before the intervention is a number the intervention will be tuned to hit.

### 3.2 What vigilance actually gets eliminated

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

> **This section serves the *guardrail*, not the main idea** (§1) — it is about audit discipline, not
> about ripple. Its rung (S1b) is deferred past the stopping point, so it is kept short: the roster, the
> two traps, and the one rule. The traps are the durable part; they stop a future session shipping a
> boundary that isn't one.

**The rule: no receipt, no role.** A receipt is a failure that actually happened and can be verified
today. Applying it to the draft removed one agent and one hook, and exposed a fourth command that was
never named anywhere.

**Read-only agents do not fix the 2026-07-25 defect class.**
`docs/plans/full-audit-2026-07-25.md:26-27` already required read-only subagents that day; session 1
obeyed and still shipped six self-inflicted defects, because they came from the **main loop** finding,
deciding and fixing in one motion. §3.2 splits what the agents do and do not buy.

### The roster

| Piece | Tools | Receipt |
|---|---|---|
| `finder` | `Read, Glob, Grep` | **The read-only rule written after the incident does not deliver read-only.** `full-audit-2026-07-25.md:26-27` (commit `5cbf5973`) says *"Every review/search subagent MUST be read-only (`subagent_type: "Explore"`)"* — but `Explore` keeps `Bash`, and `Bash` deletes files. |
| `reviewer` | `Read, Glob, Grep` | `CLAUDE.md:236` mandates *"spawn **one** fresh-context review agent"* every checkpoint and names none, so it resolves to a writable default. |
| `/state` | — | Prints the §1.3 block on demand, including the network facts `SessionStart` drops |
| `/find` | — | **Dispatches to `finder`.** The only command that is not pure ergonomics |
| `/ship` | — | Deploy from `fitted/`, not the repo root. Ergonomics |
| `SessionStart` · `Stop` | — | §1.3 derived state; push guard. Silent when clean |

**Three judgments recorded so they are not re-argued:**

- **Why not just use `Explore`.** A `Bash rm` outside the allowlist raises a permission prompt — a
  human-in-the-loop check, in a repo that runs **long autonomous sessions** where prompts get approved
  by reflex. A prompt is declined by attention; a missing tool cannot be approved at all.
- **`finder` and `reviewer` are one boundary wearing two system prompts.** Identical tools; the second's
  value is its stance, not extra safety. Legitimate — but not two boundaries.
- **`librarian` is CUT** and **`UserPromptSubmit` is CUT** (amends D3). The librarian's receipt was a
  repo statistic, not an incident, and its job is check 13's. The hook's trigger was a **regex over
  prompt text** — it fails silently on unusual phrasing, leaving full vigilance *plus* false
  confidence, and fires wrongly into sessions that want fixes. D3 called it "the weakest link" and kept
  it anyway; both could not stand. `/find` → `finder` replaces the half a boundary can reach.
- **Commands are ergonomics, not enforcement.** A slash command's `disallowed-tools` clears on the next
  user message, so an in-command "don't fix anything" is prose enforced by attention — the mechanism
  that failed on 07-25.

**Specced, deliberately unbuilt — the `PreToolUse` latch.** The other half ("don't act on the report in
the same session") *is* closable: `/find` writes a marker keyed by the hook input's `session_id`; a
`PreToolUse` matcher on `Edit|Write` exits 2 while it exists. Keying by session id means a stale marker
cannot block a later session. **Not built until a receipt demands it** — a real find-session that leaks
a fix. That is this section's rule applied to a mechanism, and it is the difference between a system and
a bureaucracy.

### The two traps — proven, and the durable part of this section

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

## 5. The checks — 7 enforced, 7 printed, 1 that moves

> **RE-CUT 2026-07-27, and this is the most important correction in the file.** The draft was 12 size
> ceilings + 2 floors. But **every instance of the disease anyone has actually verified is a *currency*
> failure, and not one is a *size* failure** — the stale `≥922` jest floor at `CLAUDE.md:117`, the plan
> banner contradicting `runbook:495`, the Current-focus block stale by three events, six unpushed
> commits nobody surfaced. §1.2 already said so (*"every check measures size; none measures
> currency"*) and §5 then spent 12 of 14 checks on size anyway.
>
> **The felt cost is ripple, not bloat: one fact stored in N places, so landing one test edits four
> documents.** Size merely co-varies with it. A suite that enforces the proxy instead of the disease is
> a process to fight, and the first thing it would do is punish the register — the healthiest artifact
> in the repo — for growing when a bug hunt succeeds.
>
> So the suite splits. **Truth and location are enforced. Size is printed.** Every legitimate action in
> this campaign turns out to be about truth (is this claim still true?) or location (is this fact in
> exactly one place?) — deleting dead plans is not a diet, it is removing things that stopped being
> true; moving §23 out is not a diet, it is putting a work queue where a work queue goes.

**Two channels, and only one of them can block:**

| | Checks | Behaviour |
|---|---|---|
| **ENFORCED** | 9, 10, 11, 13, 14, 15, 12(b) — **and 8 from S4a** | Assert a fact about truth or location. Red = something is wrong *now*. Blocks session end. |
| **PRINTED** | 1–7, 12(a) — **and 8 until S4a** | Size and shape. `npm run hygiene` prints them with direction of travel. **Never blocks.** A growing number is information, not a violation. |

**Check 8 is the one that moves channels.** It asserts that every register status is a member of a
closed set — a location fact, so it belongs in the enforced channel. But the closed set does not exist
until D6c lands at S4a; before that it would assert against ~86 free-text strings and be permanently
red. **It ships printed at S1a-lite and is promoted to enforced in the S4a commit** — and that
promotion is itself S4a's DONE condition, so nobody has to remember to do it.

**Why printed rather than deleted.** Reading-list bytes are a real per-session cost and worth watching.
But a *cap* forces the wrong reflex — compact something because a number went up — and specs on a big
change grow for good reasons. Printing gives the signal without the reflex. If a printed number ever
drives a real decision, that is the moment to consider promoting it, and not before.

**Ratchet form (enforced channel):** each asserts `actual <= baseline`, seeded to today's measured
values in `fitted/tests/repoHygiene.baseline.json`, so the suite is **green on arrival**. A session that
improves a number lowers its baseline in the same commit.

*Why not land them RED (the obvious version):* they would be red for the entire campaign — weeks — and
a permanently-red suite trains every session to write off RED. This repo's own rules forbid that:
*"A RED run is evidence. Never write one off as 'transient.'"* `test.skip` was also rejected: nothing
bounds how long a skip lives, which is the COMPLETED-banner failure wearing a different hat.

*Why the ratchet isn't just an evasion:* raising a baseline is legal but it is a one-line diff in a
single JSON file — the one artifact a reviewer, or check 12, can watch.

**No `Today` column — deliberately.** Seeding values here would recreate §2's failure. The baseline
JSON holds the numbers; this table holds the definitions.

| # | Check | Channel | Definition notes |
|---|---|---|---|
| 1 | tracked `*.md` file count, **excluding `team/` + `meetings/`** | printed | the exclusion must be **stated in the check** — unfiltered is ~60% higher, so a "whole tree" wording makes any figure unfalsifiable |
| 2 | total markdown bytes, minus `DEFECTS.md` and the D5-pinned appendix | printed | |
| 3 | largest single doc, bytes | printed | |
| 4 | default reading list bytes (hardcoded list) | printed | the number that most directly tracks per-session cost |
| 5 | `docs/plans/` file count | printed | |
| 6 | `docs/sessions/` file count | printed | D2 targets 0 — the directory is deleted, not capped |
| 7 | §23 **resolved-row bytes** (archaeology), not row count | printed | D4/D6: never count open rows as bloat — that is the live queue |
| 8 | §23 + `DEFECTS.md` status **vocabulary membership** | printed → **enforced at S4a** | D6c: a closed set makes hybrid rows unconstructible, so this is a membership assertion, not a detector |
| 9 | doc cites naming a nonexistent path | **enforced** | catches the D2 session-note re-homing. **Paths only — it does not catch prose-form cross-references** (D5) |
| 10 | source files citing a nonexistent doc | **enforced** | lands at its **target (0)** at S1a-lite, not ratcheted — one-line fix |
| 11 | sha256 pins: `ml-system/experiments/*/preregistration.*` **+ `Fitted_Spec_v2_recovered_appendix.md`** | **enforced** | D5 |
| 12 | (a) no printed figure exceeds its landing value; (b) **liveness**: `maintainability.md` exists iff any enforced `current > target` | (a) printed · (b) **enforced** | D4: converts §7's S6 DONE condition from prose into a test |
| **13** | **FLOOR — every commit that `git rm`s a `*.md` carries an `EXTRACTED <path>` block whose named destinations RESOLVE** (each `code:` path exists, each `spec:` § exists, each `test:` name is collected by a suite) **and whose `DROPPED:` field is an integer** | **enforced** | The counterweight to the printed channel — see below |
| **14** | **FLOOR — no volatile markers in `CLAUDE.md` or in any `docs/plans/*.md` status banner**: no commit SHAs, no `✅`, no `Remaining:`/`Now:`/`next:` status lines, no bare suite counts, no ISO date used as a status stamp | **enforced** | §1.3 — keeps changing facts out of prose. See below |
| **15** | **FLOOR — suite counts never decrease** (jest, pytest, experiments pytest), recorded in the baseline **and nowhere else** | **enforced** | Encodes *"floors grow, never pins"* as an artifact instead of a convention |

**Check 15 does three jobs with one artifact, and it is the direct answer to "don't let the standing
rules fade."**

1. **It kills the ripple you actually feel.** Today the jest floor is written in prose in `CLAUDE.md`,
   so landing one test makes a document wrong — and `CLAUDE.md:117` is wrong *right now* (`≥922` vs an
   actual 967). Once the number lives in the baseline and nowhere else, adding a test edits **one JSON
   line**, and check 14 forbids re-writing it into prose. One fact, one home.
2. **It enforces a standing rule that was previously only a convention.** *"Green test counts are
   floors that grow, never pins"* has been discipline. It becomes a test.
3. **It catches the code smell you named.** Deleting a test, or `.skip`-ing one to make a suite pass,
   drops the count and reddens the check. It cannot catch a test *weakened* in place — nothing
   mechanical can — but the cheapest and most common version of "modify the test until it passes" is
   removal, and removal is now visible.

**Checks 13, 14 and 15 are the requirement-4 floors.** Everything in the printed channel reports *less*; without these the
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
  §23 register was 7% of the spec's lines and 49% of its bytes when measured 2026-07-27 —
  a ratio worth re-checking, not quoting. A line cap is satisfied by reflowing prose to long
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
> then any future project is opt-in, not opt-out) or a separate config file. **Fix at S1a-lite; prove it by
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

The rulings below are the contract S0–S6 build against. **Each entry is the decision plus the reasons
that stop it being re-litigated — the arguing that produced it lives in the commits.** A rejected
alternative stays only when its rejection is a trap-guard: something a future session would otherwise
re-propose.

*Note on this doc's own size:* 307 → 545 → ~980 lines across three sessions. **A line limit was
imposed here on 07-27 and removed the same day — it was the campaign's own disease.** A spec covering a
large change grows as implementation uncovers detail; that is the spec working, not failing. What
earned the growth is that the file now carries the *method* behind every number, which is the only
thing that stopped the fourth session repeating the third's errors.

The right death condition is **check 12(b)** — this file exists while any enforced target is unmet and
is gone once they are all met — plus one judgment call, stated as a question rather than a threshold:
**when a rung lands and its decision record stops being read, that record belongs in the commit that
implemented it (§8), not here.** Compact when a section stops being consulted, never because a number
grew.

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

*Rejected, and it stays rejected:* "keep notes, cap the count." A bare count cap names no victim, so
nothing dies — the `COMPLETED`-banner failure again. The only workable version would be rolling-N with
a forced victim (a 4th note reddens the suite until the same commit deletes the oldest).

**D3 — Hooks vs. commands. → RULED: `SessionStart` + `Stop`, both silent-when-clean.
`UserPromptSubmit` is NOT built (§4).**

Intrusiveness is the whole cost, and it is a calibration problem, not a philosophical one: a hook that
prints nothing when everything passes is invisible until it matters. **`SessionStart` prints only on a
problem** — its stdout enters *every* session's context forever, so verbosity is a permanent tax.
**`Stop` exits 0 silently** and blocks only on unpushed commits.

The two are not equivalent: **`Stop` is a genuine elimination** (deterministic trigger, deterministic
check, no interpretation in the loop); **`SessionStart` is a reminder** — it converts recall into
recognition, which is real, but you still act on it. §3.2 scores them accordingly.

*Verified:* jest cold start here is **~0.8 s** for a single small suite, so running the hygiene project
from the `Stop` hook carries no meaningful latency tax. No separate non-jest runner is needed.

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

- **`npm test` green at every session boundary, no exceptions.** Unfinished work hands off as a §23 row
  or a plan checkpoint — **never as a failing test**. (The count itself lives in the baseline under
  check 15, not in prose here.)
- **`npm run hygiene` prints `current → target` per check** and blocks (via the `Stop` hook) **only on
  a regression against baseline**. A session may end with the campaign unfinished; it may not end
  having made something worse. The status print is the handoff artifact: measured, not asserted —
  better than a red suite (poisons the regression signal) and better than a plan doc (drifts).

The justification is *not* alarm fatigue: `current <= baseline` and `current <= target` are two
different assertions with two different meanings, and the ratchet lets one suite carry both.

**Two consequences that survive, and one that dissolved:**

- **Check 10 lands at its target (0), not ratcheted** — a single one-line citation repair.
- **Check 12 gains a liveness coupling:** while any enforced `current > target`,
  `docs/plans/maintainability.md` must exist; once all are met it must be gone. That converts §7's S6
  DONE condition from prose-in-a-doc-that-dies into a test — "CI-shaped artifacts, not discipline",
  applied to itself.
- **DISSOLVED by §5's two-channel re-cut:** this ruling forced an elaborate carve-out to stop the §23
  register from tripping the byte caps when a bug hunt added rows. **Size no longer enforces anything,
  so there is nothing to carve out of.** A register that grows now simply prints as having grown. The
  carve-out was three amendments of complexity paid to protect the repo from a check that should not
  have blocked in the first place — worth remembering the next time a check needs an exception to
  avoid punishing good work.

*(The `jest --selectProjects` trap this ruling also surfaced is single-homed in §5's TRAP box.)*

**D5 — Does `Fitted_Spec_v2_recovered_appendix.md` (102 KB) survive? → RULED: SURVIVES, sha256-pinned.**

It joins check 11's pin set and is excluded from checks 2/3 **by explicit path**. Frozen: it may never
grow, so it cannot become the dumping ground an open exemption would invite. Same byte relief as
exemption, opposite incentive.

**Three verified facts — it is not "history":**

- **`CLAUDE.md:238` makes it required grounding** for the ambition-merit lane (*"grounded in
  `Fitted_Spec_v2.md` + the recovered appendix + the real committed state"*) — a guaranteed reader with
  a recurring trigger.
- **The spec cites into it:** `Fitted_Spec_v2.md:1303` (§23-H45) → "recovered appendix C.4", which
  exists at `recovered_appendix.md:1457`. **Trap: that cite is a prose phrase, not a path, so check 9
  would NOT catch its breakage.** Deleting the appendix breaks it silently. Do not rely on check 9 as
  the backstop for prose-form cross-references — it tests paths only.
- **Its content is not anecdotes.** `C.0` (`recovered_appendix.md:13`) is the definitional source for
  `Board`/`StyleProfile`/`Routine`/`Lens`/`StyleMove`/`StyleEdge` and the core purpose statement — the
  vocabulary the entire spec is written in.

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

**The insight: §23 is two registers wearing one row format.** Roughly half its bytes are RESOLVED rows
(archaeology, whose only residual value is trap-guards) and roughly half are the live work queue. They
have opposite lifecycles and belong in different files.

**D6a — defects physically leave the spec** → `docs/DEFECTS.md`, counted separately as work-queue
infrastructure (same class as `.claude/` and `fitted/tests/` in §7), capped on **CLOSED rows only**.
§23 keeps design holes. Roughly halves both the spec and the default reading list.

**Why moving, not exempting.** An exemption fixes the *measurement* and does nothing about the *context
cost* — a session reading `Fitted_Spec_v2.md` loads every byte regardless of what any check counts.
Requirement 1 is navigability; ~half the canonical spec being a bug tracker is a navigability defect
that a cap exclusion is theater against. It also matches the session split: a bug-hunt session and a
design session want different reading lists.

**Compression is per-population.** The obvious "make every row two lines" target aims at the wrong half:

- **RESOLVED** → one line each after trap-guard extraction to the symbol. ~90% off, essentially free.
  This is where the bytes are.
- **OPEN design hole** → three-field row (D6b), analysis in the spec body.
- **OPEN defect → full body preserved. Do not compress these.** H87 carries mechanism
  (`lib/mongodb.ts:31-44` caches a rejected promise), reachability (an Atlas M0 SRV blip inside the
  30 s server-selection window), blast radius (`connectMongo` sits under `apiAuth`/`session`, so auth
  dies too) and the one-line fix. That *is* the deliverable, and there is no spec section to move a
  missing owner check into. **Compressing a defect row deletes the finding.**

**D6b — three fields: `symptom | where | unblock condition`.** The third is what must be true before the
row can close. Its value is that it is **falsifiable** — "BLOCKED: 3 friend closets land" is checkable
against reality, "OPEN" is not. Its absence is what produced the H7/H8/H61 staleness.

**D6c — closed status vocabulary, check-enforced.** §23: `OPEN` | `BLOCKED:<condition>` | `RESOLVED`.
`DEFECTS.md`: `OPEN` | `FIXED:<sha>`. Today's ~86 distinct free-text strings collapse into these.
**Hybrid rows become unconstructible** — one row, one status from a fixed set, so a half-done row must
split into two. Check 8 becomes a vocabulary *membership* assertion, which is mechanical and cannot
drift. **Existing hybrids are split, never deleted** — H78's open half is an unclosed cross-user
data-scoping defect and belongs in `DEFECTS.md`.

**A note that shaped D6c:** the hybrid count depends on the classifier (§2). Two reasonable ones
disagree by several rows. That a population cannot be counted twice the same way is not a measurement
nuisance — it is the proof that the register is not yet a machine-readable work queue.

## 7. Ladder and sequencing

**Recommendation, 2026-07-27 (revised the same day): do a three-session slice now — S0 → S1a-lite →
S4a — then stop and go back to Track 2 and M6.** The rest resumes when a receipt demands it.

> **Why this reversed.** The first ordering was S1a → S4a → S0, derived from what is *technically
> prerequisite*. Re-derived from what actually costs a session, it inverts. The two concrete pains are
> *"a doc said we hadn't pushed, we had, now I must grep"* and *"one extra test and I edit four
> documents"* — **both are ripple, and S0 is the direct hit on both.** S1a's ratchet mostly prevents
> size regrowth, which is not a pain anyone has felt.
>
> **The prerequisite argument was wrong.** S0 was blocked because *"§6 ruled, S1a next"* is not
> derivable. But it does not have to come from check status: `git log -1 -- docs/plans/` gives *which
> plan was last touched, when, and by what commit* — **100% computed, and about 80% as useful.**
> "Where we are" is answerable without the checks existing. That removes the block.

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

**Against "S0 only":** it is the closest of the alternatives and worth naming as the fallback. S0 alone
kills both named pains. It leaves the counts living in prose with nothing stopping them being rewritten
there, which is what S1a-lite's checks 14 and 15 pin.

**Why these three, in this order.** Ranked by *what a session actually costs Brian today*, not by
dependency order:

| Rung | The pain it removes | Cost |
|---|---|---|
| **S0** | *"A doc said we hadn't pushed; we had; now I must grep."* Direct hit. Also the only rung that makes "where are we" cost zero at session start. | 1 session |
| **S1a-lite** | *"One extra test and I edit four documents."* Check 15 moves the counts into the baseline; check 14 forbids writing them back into prose. **One fact, one home.** | 1 session |
| **S4a** | The per-session context bill: reading list **322 KB → ~203 KB, −37%**. A cost, not a pain — which is exactly why it is third. | ~1 session |

**S1a-lite is deliberately not S1a.** Build the **enforced** channel only — checks 9, 10, 11, 13, 14,
15 and 12(b) — plus the printed readout for the size numbers. The size caps are not enforced (§5), so
there is no ceiling baseline to seed or defend. Smaller rung, and it stops the suite from ever
punishing the register for growing.

**S4a is deliberately not S4.** Split the register and close the status vocabulary — a mechanical cut
and re-point. **Do not** do D6's compression, trap-guard extraction or 51 resolved-body deletions yet:
those are the one-way doors, and they are far safer once friend data has generated its next wave of
rows. The −119 KB comes from the move, not the compression.

**Before session A, and not as part of the campaign: push the unpushed commits and redeploy the web
half.** It is one minute of work, it has been "remaining" on the checklist since 07-20, and it is the
highest-value action available in the repo today. That the campaign keeps not-noticing it is the entire
argument for S0 — and also the reason S0 is not worth waiting for before pushing.

**Standing rules must survive the deletion rungs — this is a real risk and nothing guarded it.** S2 and
S3 rewrite `CLAUDE.md` and delete ~14,000 lines, and the build-and-audit rules live in exactly those
places: mutate-don't-read, tests-are-floors, verify-before-answering, no-inline-test-mirrors,
convergence-before-closure, heavy-loop-at-boundaries. **The rule is: any standing rule that can become
a check must become one before the rung that could drop it.** Check 15 does this for
tests-are-floors — it was a convention, it is now an artifact. Whatever is left prose after that gets
enumerated at the top of S3's commit and re-read after, one at a time. A rule that survives only
because someone remembered to keep the paragraph is the same failure this whole campaign is about.

### 7.2 The rungs

One rung per fresh session; each ends with its DONE condition **proven**, not asserted. `npm test` must
be green at every session boundary (D4) — unfinished work hands off as a `DEFECTS.md`/§23 row or a plan
checkpoint, never as a failing test.

**Slice to build now:**

- **S0** — the derived-state script (§1.3): `/state` + `SessionStart`, silent when clean. Plan position
  from `git log -1 -- docs/plans/`; register counts from a `^OPEN` prefix scan (honest and weaker until
  S4a closes the vocabulary); suites and network facts in `/state` only, never `SessionStart`. Ship the
  `Stop` push guard in the same rung — it is five lines and it is half the reason this rung is first.
  **DONE when** Brian has started three real sessions with it and it told him something he would
  otherwise have gone looking for, and **nothing in it is read from a file a human maintains.**
- **S1a-lite** — the **enforced** checks only (9, 10, 11, 13, 14, 15, 12(b)) + the printed size readout.
  **First: fix `"test"` to `jest --selectProjects node jsdom`** and prove hygiene is outside `npm test`
  (§5 trap). Repair the check-10 citation so it lands at target 0. Move the suite floors out of
  `CLAUDE.md:117` into the baseline in the same commit. **DONE when** each enforced check has been
  reddened one at a time by mutation (not by reading), *and* a deliberately reddened hygiene check
  leaves `npm test` green.
- **S4a** — split `docs/DEFECTS.md` out of §23 (D6a) and close the status vocabulary (D6c); split the
  hybrid rows; repair every inbound citation in the same commit. **No compression, no body deletion.**
  **DONE when** the reading list is measured under 210 KB, check 9 is green, and **check 8 has been
  promoted from printed to enforced in this commit and is green** — that promotion is the DONE
  condition, so it cannot be forgotten.

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

## 9. Next session — S0, derived state

**First, outside the campaign: `git push` and redeploy the web half.** §7.1.

Then paste this into a fresh session. Build **only** S0.

```
Read docs/plans/maintainability.md §1 in full — the diagnosis, the state model, and §1.3.1 where the
model was walked through a real episode and one line of it failed. Then build S0 and nothing else:
the derived-state script behind /state, a SessionStart hook, and the Stop push guard.

The design constraint is the whole point. Every line printed must be COMPUTED at read time. If a fact
has to be read from a file a human maintains, it does not belong in the output — that is the exact
failure this replaces. Three live examples, all verified 2026-07-27: CLAUDE.md:117 says the jest floor
is >=922 and the suite is 967; docs/plans/clothingtype-slot-correctness.md:3-4 says the deploys
"remain Brian's" while m5-c8-half2-runbook.md:495 says they were done on 07-24; the Current-focus
block is stale by three events.

Target shape is the second block in §1.3 (the "buildable version", not the DRAFT above it). Get the
facts right before the formatting:
  - unpushed count and dirty-tree state      -> git
  - which plan was last worked and when      -> git log -1 -- docs/plans/   (NOT a status banner)
  - register rows, and rows whose status starts OPEN -> scan spec 23; the vocabulary is not closed
    yet, so print the honest weaker number and say so
  - suites, and deploy/Fly facts             -> /state ONLY, never SessionStart

SessionStart must print NOTHING when everything is clean. Its stdout enters every session's context
forever, so verbosity is a permanent tax. jest is 9.6s and pytest is 0.73s, so suites are affordable
on demand but not on every session start. Anything needing the network is /state-only. Say which facts
you dropped and why.

Ship the Stop hook in the same rung: block session end on unpushed commits. It must exit 2 (jest and
a Stop hook exiting 1 print but do not block) and honor stop_hook_active, or a genuinely-red state
makes the session loop against a wall it cannot fix.

DONE when I can run /state in a fresh session and every line is correct — verify each one against the
real repo before claiming it works — and when nothing in the output is read from a human-maintained
file.

Do not build the checks, the agents, /find, or start any deletion.
```

**Sessions after that:** **S1a-lite** (the enforced checks; moves the suite floors out of prose) →
**S4a** (split `DEFECTS.md` out of the spec, close the status vocabulary). **Then stop** and go back to
Track 2 and M6; S1b, S1c, S2, S3, S4b, S5, S6 resume on a receipt, not on a schedule (§7.1).
