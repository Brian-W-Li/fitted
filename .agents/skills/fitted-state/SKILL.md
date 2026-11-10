---
name: fitted-state
description: Read computed Fitted checkout state and report the command output accurately.
---

For routine status, run `scripts/workflow/state.sh --fast` and report its output
verbatim. This mode is local and skips suites and deployment probes. Do not reconcile
computed state against a remembered or prose status.

Run `scripts/workflow/state.sh` only when the user requests or needs full state. It
runs the local Jest and Python suites and probes configured Vercel/Fly CLIs. Python
selection uses `FITTED_PYTHON`, then this checkout's `ml-system/.venv/bin/python`,
then `python3` on `PATH`. Nonzero suite exits are reported as failures. Deployment
freshness is inferred from timestamps and does not prove which Git SHA was deployed.
