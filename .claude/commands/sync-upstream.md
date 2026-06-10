---
description: Pull the latest from the team upstream (ucsb-cs148-w26/pj12-outfit-recommender) into main, fast-forwarding when safe
---

Sync this fork with the team upstream remote.

Procedure:

1. Run `git fetch upstream` to pull the latest team commits.
2. Compare `upstream/main` against `origin/main`:
   - `git log --oneline origin/main..upstream/main` — what's new
   - `git diff --stat origin/main..upstream/main` — file scope of those commits
   Summarize the changes in 2–3 sentences before continuing.
3. Identify my current branch with `git branch --show-current`.
4. **If on `main`:**
   - Check for local divergence: `git log --oneline upstream/main..origin/main` (any output = divergence).
   - **No divergence:** fast-forward `main` to `upstream/main` (`git merge --ff-only upstream/main`), then `git push origin main`.
   - **Divergence:** STOP. Show me the diverging commits and ask whether to rebase, merge, or leave it. Don't act unilaterally.
5. **If on a feature branch:** don't touch `main`. Show me the upstream changes and ask whether I want to rebase the current branch onto `upstream/main`. If yes, run `git rebase upstream/main` and report conflicts if any.
6. **Never** force-push. **Never** modify already-pushed history without explicit confirmation from me. If a rebase would require either, stop and explain.

Report the final state with `git log --oneline -5` and `git status`.
