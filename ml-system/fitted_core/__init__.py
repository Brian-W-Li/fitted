"""Fitted v2 recommendation substrate (M0–M3 + the Spearhead orphan-rescue vertical).

Pure functions and contracts for the sampler/shortlister pipeline (the Spearhead
generation boundary in ``generation.py`` is the lone lazy-``openai`` IO seam). No Mongo,
no API keys in the core — everything here unit-tests cleanly. See docs/plans/m0-m1-substrate.md,
docs/plans/m2-validator.md, docs/plans/m3-ranker.md, and docs/plans/spearhead.md.

Error-model convention (applies across the package):
  - **Expected, data-driven failures return an error channel** — a
    ``(value | None, IssueCode | None)`` or ``(bool, IssueCode | None)`` tuple — never
    raise. These are routine control flow: invalid GPT output, a SlotMap that fails the
    v2 §8 rules. ``normalize_to_slotmap`` / ``is_valid_slotmap`` use this form (D7).
  - **Precondition / caller-contract violations raise ``ValueError``.** These mean
    "you called this wrong" — a key function handed an unvalidated SlotMap
    (``keys``, ``template_of``), a wardrobe with duplicate logical item-ids
    (``build_candidate_pool``, R12), a wire value the internal dataclass guards reject
    (``WardrobeItem`` / ``RenderRequest``). They should be unreachable if upstream validation ran.
  The dividing line: can a well-behaved pipeline produce this state at runtime
  (→ error channel), or only a programming error (→ raise)?
"""

from fitted_core.config import PROMPT_VERSION, RANKER_CONFIG_VERSION

# --- Substrate version (M6 training-provenance, spec §15.1 group C / plan §14 C4) ---
# A GenerationSnapshot is immutable training truth; M6 must be able to separate two
# behaviorally-different corpora, so every render stamps a three-part provenance key.
# The three axes are deliberately split because each has a different bump trigger and a
# different failure mode if NOT bumped:
#
#   __version__          semver, HAND-bumped on any behavioral substrate change
#                        (sampler / validator / ranker / prompt *logic*). Coarse,
#                        release-grained — it intentionally does not move for a single
#                        constant tweak; RANKER_CONFIG_VERSION is the fine-grained backstop.
#   PROMPT_VERSION       its own string (config.py), bumped on ANY prompt-text edit — a
#                        reword changes generations even with zero code change, so neither
#                        of the other two would catch it.
#   RANKER_CONFIG_VERSION  auto sha256 over the Appendix B constants (config.py), so a
#                        one-constant tuning change __version__ would miss still moves it.
#
# The failure mode is SILENT (forget to bump → two distinct corpora share a version →
# M6 can't separate them), so these comments are the guardrail. On any change to the
# behavioral logic above, bump __version__ here; on any §D prompt-text edit, bump
# PROMPT_VERSION in config.py. RANKER_CONFIG_VERSION needs no manual action.
__version__ = "0.5.0"

__all__ = ["__version__", "PROMPT_VERSION", "RANKER_CONFIG_VERSION"]
