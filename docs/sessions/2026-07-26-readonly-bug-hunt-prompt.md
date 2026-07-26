# Next session prompt — read-only latent-bug hunt (round 2)

> **Death condition:** delete this file once the session it describes has run and its findings are
> registered in `Fitted_Spec_v2.md` §23. It is a disposable handoff, not a standing doc.

Authored 2026-07-26, at the close of the deployed-app audit that registered **H87–H94**.

---

## The paste-ready prompt

> Continue the read-only latent-bug hunt on Fitted. **The rule is absolute: no fixes this session.**
> Code reading, live observation, and bug registration only — no matter the severity, no matter how
> one-line the fix looks. A defect you find gets a §23 register row, never an edit. Do not "fix while
> you're in there," do not repair a stale comment, do not add a test.
>
> Read `docs/sessions/2026-07-26-readonly-bug-hunt-prompt.md` for what round 1 already covered (don't
> redo it), the three surfaces it left unexamined, and the 15 carried-forward leads. Work those in the
> order given, as a detective: form a hypothesis about what this codebase characteristically gets
> wrong, test it against source, and kill your own theory when the evidence says so — round 1's
> headline theory died that way and the session was better for it.
>
> You have standing authorization to spend OpenAI money on live renders. Use it: round 1 could only
> read the pipeline, never watch it run.
>
> Register findings in `Fitted_Spec_v2.md` §23 starting at H95. Verify every finding against the real
> source yourself before it lands — a subagent's claim is a lead, not evidence. Commit the register on
> `main` as the closing act. Report what you did NOT cover and why.

---

## Standing authorization (new this round)

**OpenAI spend on the live service is approved** ("it never is much"). This unlocks behavioral
observation, which round 1 lacked entirely.

Be aware of the side effect and treat it as accepted: a real render **writes a GenerationSnapshot row
to production Mongo** and may write interaction rows. That is inherent to exercising the pipeline and
is the same thing `scripts/track2-gauntlet.mjs` has done in prior sessions. Still forbidden without a
fresh ask: deleting production data, account erasure runs, `fly` restart/scale/deploy, `vercel`
deploy/rollback/env mutation.

Use the existing admin-mint driver rather than inventing one — `fitted/scripts/track2-gauntlet.mjs`
(no browser needed). Prefer a small number of deliberate renders over a loop.

## Ground truth — re-verify before trusting it

Deployed state drifts. Three commands re-establish it (round 1's method):

```sh
git diff --name-only <live-web-sha>..HEAD -- fitted/ ml-system/   # empty => local IS deployed code
curl -s https://fitted-render-service.fly.dev/readyz               # hashes must match local
fly status -a fitted-render-service                                # MUST stay exactly 1 machine
```

As of 2026-07-26: web `b8c3dfb9`, Fly v6, both halves at parity with local HEAD. The Vercel project
has **no git integration** — pushing `main` does not redeploy. Production env has 9 vars;
`ML_SERVICE_TIMEOUT_MS` and `CV_SERVICE_URL` are unset by design. Production Mongo indexes **are**
built (pre-2026-07-18 the prod connection ran `autoIndex: true`; all declarations predate it).
Telemetry is worthless as evidence: ~4 requests/week, zero errors — absence of signal, not health.

## Already covered — do not redo

Round 1 read and adversarially verified: `mongodb.ts`, `db.ts`, `apiAuth.ts`, `session.ts`,
`sessionCookie.ts`, `images/[imageId]`, `imageStorage.ts`, `rateLimit.ts`, the wardrobe image route,
`recommend/route.ts`, `mlServiceClient.ts`, `fly.toml`, model index declarations, `clearWardrobe.ts`,
and spot-checks of `account/page.tsx` + `dashboard/page.tsx:855`.

Registered: **H87** (poisoned Mongo connect cache — highest severity), **H88** (DB failure reported as
expired login), **H89** (account page catch-less fetches), **H90** (5xx drops the paid-render
envelope), **H91** (non-atomic wardrobe clear), **H92** (base64 quota unit), **H93** (false autoIndex
comment), **H94** (weather re-resolve 409s a resume). **H68** and **H76** were re-confirmed live.

Killed by evidence, do not re-report: the production-indexes-missing theory, the photo-upload path
(genuinely hardened), and the per-instance rate limiter (documented, deliberate).

## Priority 1 — `fitted/scripts/*.mjs` (~1,048 lines), wholly unexamined

Round 1 defined its target as code that *runs in* production; these run *against* production from your
laptop with admin credentials, so no lane owned them. That was a scoping error, and it left the
highest-consequence surface unread.

`export_track2.mjs` / `exportTrack2Core.cjs` **is the deliverable Track 2 exists to produce**. A silent
under-join, a redaction miss, or a latest-feedback-state bug there quietly wastes every friend closet
and would not surface until M6 training. Also `track2-erasure-check.mjs`, `track2-monitor.mjs`,
`track2-live.mjs`, `track2-gauntlet.mjs`.

Hunt: wrong/missing joins, silent truncation, `--apply`-style flags with weak dry-run guards, anything
that writes or deletes, credential handling, and whether the export's own verdict certificate can pass
while the data underneath is wrong. Note §23-H86(b) already registers the exporter's missing
image-ownership check — extend it, don't duplicate it.

## Priority 2 — `fitted/app/(app)/history/page.tsx` (376 lines), zero eyes

Round 1's client lane was scoped by naming files and this one wasn't named. It is the **only UI with a
destructive control**: the D-1 curation `DELETE /api/interactions` hard-deletes *every* row for a
`{snapshotId, candidateId}` binding. Its `fetchHistory`/curation handlers use the same `try/finally`
family that produced H89. Check the delete's confirmation, its failure reporting, and whether it can
destroy more than the user believes.

## Priority 3 — `ml-system/fitted_core/` ranker/response/validator (~4,000 lines)

The render-service lane triaged to the seams and disclaimed `ranker.py` (1,027), `response.py` (637),
`validator.py` (740) end-to-end; `rescue.py` (1,631) was read only at the parse seam. This is the code
that decides **what outfit a friend actually sees**. With live-render authorization you can now pair
reading with observation: run a render and check the returned outfit against what the ranker claims to
guarantee.

## Carried-forward leads (round 1 found these; verification was capped at 18 by severity)

Each has a real file:line but was NOT adversarially verified — treat as leads, confirm before
registering, and expect some to die:

| Sev | Location | Lead |
|---|---|---|
| med | `lib/interactions.ts:193` | Every like/dislike re-reads the whole snapshot unprojected, including capped raw generation text |
| med | `lib/mlRecommend.ts:569` | GenerationSnapshot — largest doc type — has no per-user storage ceiling, unlike every other user-owned collection |
| med | `dashboard/page.tsx:814` | Mount downloads entire feedback history + joins every referenced snapshot to build a small action map |
| med | `dashboard/page.tsx:1230` | "Pick date/time" min/max computed in UTC → next N hours unselectable west of Greenwich |
| med | `account/page.tsx:226` | Photo picker has no size/format guard; a failed photo wedges every later profile save |
| med | `wardrobe/[id]/image/route.ts:18` | Quota check rescans every one of the user's image docs on each upload (perf half of H92) |
| med | `fitted_core/rescue.py:472` | Rescue asks up to 40 outfits against a token cap validated only for 12; repair retry re-sends the identical ask |
| med | `service/app.py:842` | An internal engine failure is invisible everywhere — no log line, no exception type, `/readyz` stays green |
| med | `service/config.py:118` | Spend ceiling is one global 12/min bucket shared by all users; the per-user Next-side guard does not survive serverless |
| low | `lib/session.ts:31` | `checkRevoked=false` + cookie not cleared on sign-out → a revoked account's photos stay fetchable up to 5 days |
| low | `wardrobe/[id]/image/route.ts:180` | A failed repoint after a successful store orphans a full-size photo row the user cannot reclaim |
| low | `wardrobe/page.tsx:800` | Add-item step never resets the file input, so re-picking a rejected photo does nothing |
| — | `wardrobe/[id]/image/route.ts:158` | Snapshot-referenced photos are kept by both reclaim paths but still counted by the budget aggregate, so the storage-limit error tells the user to do something impossible. Judged unreachable at current scale — re-grade if quota pressure becomes real |

`mlServiceClient.ts:39` and `apiAuth.ts:37` also appeared here; both are already registered (H76, H88).

## Method notes that earned their keep

- **Be a detective, not a haystack sweeper.** Form a hypothesis from what this codebase
  characteristically gets wrong, then test it decisively. The highest-yield pattern found so far: **a
  comment asserting an invariant the code does not enforce** (H90 and H93 are both exactly this).
- **Kill your own leads.** Round 1's scariest theory (missing production indexes) died to
  `git show 414dca7b^`. Reporting it unverified would have wasted a session.
- **Verify before registering.** Every subagent finding was re-read against source; several had
  correct mechanisms with wrong repros or severities.
- **Name what you didn't cover.** Convergence claims without a residual list are not trustworthy.
