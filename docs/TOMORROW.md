# TOMORROW — scratch (2026-07-26)

> **DISPOSABLE. Delete this file once you've picked what to do.** It is a conversation dump, not a
> plan doc, and it deliberately does not go in `docs/plans/`. If something here survives, it should
> survive as a spec or a test — not as this file.

---

## The one-line diagnosis from 2026-07-25

Auditing and fixing ran as one motion. Finding a bug, deciding it was worth fixing, and fixing it all
happened in the same breath, with no gap and no second opinion. Every self-inflicted defect that day
came from a fix that added **new state or new control flow**; zero came from deletions, string
changes, or tests.

**The rule that falls out:**

> During an audit you may DELETE something, change a STRING, or add a TEST. Anything that needs new
> state or new branching is a **feature** — register it and spec it. It is not a fix, no matter how
> small the bug that motivated it.

Where it went wrong is also *where*: every defect and every round of churn happened in
`wardrobe/page.tsx` and `dashboard/page.tsx`. Nothing went wrong in `fitted_core`, the service
boundary, or the Python side. That is not luck — it's the difference between code with seams and
code without.

---

## Numbers, so you don't have to re-derive them

```
§23 register        86 rows — 56 already resolved, 30 open
                    median row 970 chars, longest 5,053
docs/               72 files, 19,279 lines   (CLAUDE.md's own budget: ~2,500)
  docs/sessions/    48 files,  5,657 lines   ("write-mostly", i.e. archive in the active tree)
docs created:doc deleted, all time            89 : 17
wardrobe/page.tsx   2,208 lines   (2,047 at the start of 07-25)
dashboard/page.tsx  1,407 lines   (1,364 at the start of 07-25)
Fitted_Spec_v2.md   1,459 lines   (your compaction trigger: 1,500)
jest                967 green
```

---

## Candidate jobs — pick, don't do all of them

### 1. Two tests that make the doc rules self-enforcing  ·  small  ·  highest leverage
`CLAUDE.md` already says single-home, past-goes-to-commits, and *"enforce process rules with
CI-shaped artifacts, not discipline."* All three drifted anyway — because a prose rule about prose
rules is still a prose rule.

- **Doc budget test.** Active set (`CLAUDE.md` + spec + plans not marked `COMPLETED`) must be under N
  lines. Flips the incentive: creating a doc currently costs nothing, which is why it's 89:17.
- **Zero resolved rows in §23.** Grep for `RESOLVED`/`IMPLEMENTED`/`LANDED`, fail. Forces
  delete-on-resolve. It fails at 56 immediately — that's correct, that's the backlog.

Build this **before** the register cleanup, or the cleanup re-accumulates in a month.

### 2. Register cleanup  ·  two phases, deliberately separated
- **Phase A (find-only, completely safe, and it ENDS):** read all 56 resolved rows, extract every
  genuine trap-guard, output a list of "this trap should live at this symbol." No edits.
- **Phase B (specced, from that list):** move traps into the code where the mistake would be made,
  delete the 56 rows. History is already in git — a better archive than a table.

Target: an open row is **two lines**. Symptom + where. Analysis goes in the spec for the fix.

### 3. Audits — reframed to end in a measurement, not a finding stream
A "find bugs" audit is structurally anti-confidence: every finding is also evidence there's more, and
there's no denominator, so thoroughness makes you feel worse. These have denominators and finish:

- **B. Doc-claim verification** — every code reference in `CLAUDE.md` / spec / runbook: does the
  symbol exist, is the claim true? Output: *X checked, Y wrong.* **Do this first** — cheapest, worst
  expected numbers, and untrue docs make every later session unreliable. Fixes are string edits.
- **A. Drift census** — every fact that must agree across Python/TS/Mongoose/docs. For each: single
  source, cross-runtime test, or nothing. Output: *N surfaces, M unguarded.* Never been counted.
- **E. Race enumeration** — every place two async things can interleave, every check-then-act pair.
  This is where "small bugs that are hard to reproduce" actually live. Enumeration, not hunting.
- **C. Convention conformance** — all ~15 API routes × {auth, error surfacing, destructive-op
  confirm, input validation}. Output: a matrix. Gaps are bugs or deliberate exceptions; label both.
- **D. Complexity map** — outlier files/functions, dead code, duplication.

All find-and-register. None of them fix anything.

### 4. The structural job — give the client the seams the server already has
Not "clean up the codebase." One specific thing: the render lifecycle (envelope, persistence, failure
handling) is a **unit** and currently lives inside a page component that also renders outfit cards.
Same for wardrobe ingestion. Mechanical extraction, not redesign.

**Do not start this before the audits.** Extraction based on someone's judgment of what belongs
together is how you get another 07-25. The drift census and race enumeration produce the map; then
the extraction is evidence-driven and reviewable.

---

## Two things worth keeping from the conversation

**Gaps are the unit you can't compress.** A team's real advantage isn't five brains, it's that four
of them weren't in the room when the decision was made. Four "convergence rounds" in one hour is the
same mind reviewing its own work — an echo, not a second opinion. Find today, decide tomorrow, build
the day after, with the finding written down in between.

**Docs for an AI reader are a different document.** A team doc is read by people who already have
context and need a reminder. Mine is read by something with zero context, every session. What worked
on 07-25 were the short trap-guards ("don't move this back, here's what broke"). What failed were the
narrative ones. Only three kinds earn the reading budget: **orientation** (where things live),
**trap-guards** (1–3 lines, in the code, only for traps that actually bit), and **current-state facts
with values** (tables, not prose). Everything else is archive.
