# Working in Fitted

Fitted aims to provide personal styling on demand through quick visual wardrobe
interactions and meaningful personal-taste learning. The durable promise and design
live in [the spec](docs/Fitted_Spec_v2.md); the full user stories live in
[the recovered appendix](docs/Fitted_Spec_v2_recovered_appendix.md). Memory and
rules are foundations, not a substitute for that ambition.

## Read by task

- Start with [README.md](README.md) for the app and [docs/README.md](docs/README.md)
  for authority. [The current roadmap](docs/ROADMAP.md) owns scope and handoff.
- Before proposing product direction, read spec §§1–3 and the relevant appendix
  stories, including C.0's excitement correction and C.8's north star. Do not
  derive the product destination from the most recent small feature or failed model.
- For implementation, read the relevant source/tests and governing design sections.
  Historical plans and sessions are references, not a default reading queue.
- For a design gap, consult spec §23; for a recorded behavior defect, consult
  [DEFECTS.md](docs/DEFECTS.md). Triage relevance before choosing a sprint.

## Build and review

- Preserve ambition while completing clear user jobs in bounded sprints. Plan,
  build, independently review when useful, debug, then review the milestone.
  Ask for direction on consequential product choices; use discretion for reversible
  implementation work within the authorized task.
- Personal taste learning is required by the intended product. Track 2 did not
  establish the frozen catalog head's transfer; do not ship that head or infer that
  all learning is abandoned. Future model influence and statistical claims need
  separate, appropriate evidence and an explicit release task.
- Keep ownership, availability, correction, deletion and provenance intact. Separate
  suggestions, reactions, plans, actual wear and satisfaction. Never rewrite frozen
  experiments or manufacture evidence of benefit from passing engineering tests.
- Keep code modular. Repair reproduced dependent failures in the touched journey;
  do not turn a bounded review into an endless audit or unrelated rewrite.

## Check proportionally

Web commands run from `fitted/`: `npm test`, `npx tsc --noEmit`, `npm run lint`,
`npm run build` when web behavior changes. Python changes use relevant
`python -m pytest` tests from `ml-system/`. Use the compiled browser baseline for
end-to-end journeys and focused real-Mongo tests for persistence/deletion changes.
Start focused, then run one relevant integrated regression. Repeat a full suite
only after a meaningful change or failure. Documentation-only work uses focused
link, hierarchy, provenance and documentation-guard checks; do not rerun the app
solely because prose changed. Report local, CI and hosted evidence separately.
Block release on broken core journeys, data integrity, ownership, deletion or
misleading user-facing claims. Triage other findings into a bounded backlog.

## One home and a short current state

Follow [the documentation map](docs/README.md) for ownership. Amend the owning
spec or current roadmap instead of creating a plan/session note per decision.
Retire completed execution plans after retaining useful contracts in source/tests
or the spec, fixing references, and recording extraction/deletion in Git. Keep
frozen evidence byte-identical. Do not create archive copies merely to avoid deletion.
Keep detailed past execution in Git/PRs; retain rationale that prevents a real mistake.
Do not duplicate suite counts, release status or future decisions across guides.

## Coordination and workspace care

Keep one named coordinator per active sprint. Use short subagents for independent
searches/reviews or disjoint file work; supporting chats require clear user scope.
Route routine work to a lighter capable model and escalate specific consequential
uncertainty with exact evidence. Helpers do not become competing coordinators.
Before handoff record baseline, worktree, dirty files, checks, unverified claims,
blockers and next 1–3 actions in the current roadmap. Resume the same work after
interruptions; do not silently rebuild it elsewhere. Preserve unrelated checkout
changes and credentials. Prefer current public main as a code baseline; never
publish private participant/wardrobe records or private branch ancestry.
