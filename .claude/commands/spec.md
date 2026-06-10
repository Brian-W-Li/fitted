---
description: Interview me to fully scope a feature, then write a spec doc before any code
---

I want to scope: $ARGUMENTS

**Do not write any code yet.** Interview me using the AskUserQuestion tool until you understand:

- **Goal and success criteria** — what "done" looks like, concretely and verifiably. Push back on vague answers.
- **Files / modules involved** — which paths will change, which stay frozen. Reference real files in this repo, don't hand-wave.
- **Edge cases and failure modes** — what breaks, what's the recovery, what's acceptable to leave unhandled.
- **Constraints** — performance, cost, deploy targets, team conventions, dependencies.
- **Out-of-scope** — what we are explicitly NOT doing. As important as what we are.
- **Open questions** — things you can't answer from the codebase alone that I need to resolve.

Don't ask obvious questions or things you can find by reading the code yourself. Dig into the hard parts I might not have considered. Keep going until you'd genuinely struggle to find another gap.

Before the final question, do one pass over the codebase to verify your assumptions match the actual code — call out any mismatch as another question.

Then write the spec to `docs/plans/$ARGUMENTS.md` (use my argument as the slug; if it's not slug-shaped, ask me what to name it). Structure:

```
# <Feature name>

## Goal
1-2 sentences.

## Success criteria
Verifiable bullets — tests that pass, metrics that hit a threshold, behaviors that can be observed.

## Files touched
Explicit list with one-line purpose each. Files NOT touched also worth noting if there's ambiguity.

## Approach
The chosen design, and 1-2 alternatives considered and rejected (with reasons).

## Edge cases
Each one with: trigger, behavior, why this is the right behavior.

## Out of scope
Explicit. Don't be vague.

## Verification plan
What test, script, or check confirms this is done. Specific commands or fixtures.

## Open questions
Things still unresolved. Ideally none by the time the spec is written.
```

End by telling me: *"Spec written to docs/plans/<slug>.md. Start a fresh session and reference it to implement."*
