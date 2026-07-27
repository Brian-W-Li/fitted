---
description: Where the repo actually stands right now — every line computed, nothing read from prose
---

Run the derived-state script and show me its output verbatim:

```sh
.claude/scripts/state.sh
```

Pass `--fast` instead if I asked for it to be quick — that skips the test suites (~10s)
and the two network calls (~8s) and prints position and the register only.

Report exactly what it printed. **Do not supplement it with anything you remember, and
do not reconcile it against `CLAUDE.md`, a plan's status banner, or any other prose.**
Every line of that output is computed from git, the register's own table rows, the
suites and the live deployments; prose in this repo is exactly the thing it exists to
replace, so where they disagree the script is right and the prose is a defect worth
reporting.
