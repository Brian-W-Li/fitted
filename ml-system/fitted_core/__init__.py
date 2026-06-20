"""Fitted v2 recommendation substrate (M0–M2).

Pure functions and contracts for the sampler/shortlister pipeline. No Mongo, no
API keys — everything here unit-tests cleanly. See docs/plans/m0-m1-substrate.md
and docs/plans/m2-validator.md.

Error-model convention (applies across the package):
  - **Expected, data-driven failures return an error channel** — a
    ``(value | None, IssueCode | None)`` or ``(bool, IssueCode | None)`` tuple — never
    raise. These are routine control flow: invalid GPT output, a SlotMap that fails the
    v2 §8 rules. ``normalize_to_slotmap`` / ``is_valid_slotmap`` use this form (D7).
  - **Precondition / caller-contract violations raise ``ValueError``.** These mean
    "you called this wrong" — a key function handed an unvalidated SlotMap
    (``keys``, ``template_of``), a wardrobe with duplicate logical item-ids
    (``build_candidate_pool``, R12), a wire value the internal dataclass guards reject
    (``WardrobeItem``). They should be unreachable if upstream validation ran.
  The dividing line: can a well-behaved pipeline produce this state at runtime
  (→ error channel), or only a programming error (→ raise)?
"""
