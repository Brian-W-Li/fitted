# Documentation map

Use this map to find the owner of a fact or decision. The app overview and setup
are in [README.md](../README.md); agent execution rules are in
[AGENTS.md](../AGENTS.md). Read by task, not by document age or apparent size.

| Owner | Document | Authority |
|---|---|---|
| Product ambition and durable design | [Fitted specification](Fitted_Spec_v2.md) | Defines the intended service, vocabulary and technical contracts. Future designs are not shipped claims. |
| Full user stories and ambition detail | [Recovered appendix](Fitted_Spec_v2_recovered_appendix.md) | Preserve the comprehensive scenarios; use them when deciding what to build. Historical candidate rulings yield to resolved design in the spec. |
| Selected loop implementation contract and code index | [Personal styling loop](plans/personal-styling-loop.md) | Owns this bounded design, evidence semantics and observable acceptance. |
| Current scope, decisions and handoff | [Roadmap](ROADMAP.md) | One current work record, release boundary and next actions. |
| Implemented behavior | `../fitted/`, `../ml-system/fitted_core/` and tests | Source and executable contracts establish what runs. |
| Design holes | [Spec §23](Fitted_Spec_v2.md#23-open-holes-register) | Registered design questions and capability gaps. |
| Recorded behavior defects | [DEFECTS.md](DEFECTS.md) | Unresolved and historical findings; triage current relevance in the roadmap. |
| Experiment evidence | [H26 results](../ml-system/experiments/h26/results.md) and retained private Track-2 evidence | Frozen results govern those experiments, not the product's entire ambition. Private participant evidence stays outside public source. |

## Product reading path

Before changing direction, read spec §§1–3 and the relevant user stories. Important
appendix entry points are [C.0 ambition](Fitted_Spec_v2_recovered_appendix.md#c0-ambition-candidate-weapons-and-why-the-product-should-not-shrink),
[C.1 full stories](Fitted_Spec_v2_recovered_appendix.md#c1-detailed-user-stories-decisions-and-spec-implications),
[C.3 interaction principles](Fitted_Spec_v2_recovered_appendix.md#c3-ux-speed-principles-and-emotional-neglect-modes),
[C.7 closet fluency](Fitted_Spec_v2_recovered_appendix.md#c7-closet-fluency-feature-family),
and [C.8 executable style memory](Fitted_Spec_v2_recovered_appendix.md#c8-executable-style-memory-north-star).
For a focused bug, read its source/tests, relevant spec contract and register entry.

## History and retirement

`plans/` contains engineering/research designs retained for specific provenance or
source citations. A filename or old `[NOW]`/`[NEXT]` label does not make a plan active;
the roadmap selects work. [Session records](sessions/README.md), `team/` and
`meetings/` are historical references. Do not resume friend collection or a model
rollout from an old prompt. Track 2's terminal outcome governs its frozen head.

One home per decision: design in the spec, execution in the roadmap, current behavior
in source/tests, research conclusions in frozen evidence. Update the owner in place.
At a milestone replace the current handoff and retire completed execution prose;
Git and PRs retain the detailed history. Preserve necessary trap-guards and repair
inbound references before deletion. Never replace a deleted doc with another archive
copy merely to retain everything. Keep new material issues short and explicitly scoped.

## Component entry points

[Web app](../fitted/README.md), [Python engine/service](../ml-system/README.md) and [database source map](../fitted/docs/database.md) route implementation work to source owners. They do not duplicate product direction or release status. [The retained hygiene reference](plans/maintainability.md) explains executable guards; it is not a default reading queue.

## Retirement and preservation

Split a retired document into claims before removing it: durable design goes to the spec, mechanisms/rationale to the responsible source, guarantees to meaningful tests, material unresolved work to the roadmap or owning register, and frozen research to its unchanged evidence owner. Completed execution and review history stays in Git. Preserve privacy when routing evidence; do not export private cases into public documentation.

Repair inbound references, then use the existing guard's `EXTRACTED <path>` commit receipt with existing `code:` paths, literal `spec:` text and/or literal `test:` names, plus an integer `DROPPED:` paragraph count. Validate destinations at the commit; do not invent symbol syntax the parser does not accept. Record what was deliberately discarded. A retrieval pointer may help, but a replacement archive body recreates the duplication.
