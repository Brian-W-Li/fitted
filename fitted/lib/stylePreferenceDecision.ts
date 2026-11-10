/** User-facing summary of an experimental decision, never model confidence or satisfaction. */
export interface PreferenceDecision {
  status: string;
  selectionChanged?: boolean;
  reason: string | null;
  support: number;
  likes: number;
  dislikes: number;
  featureVersion?: string;
  modelVersion?: string;
  policyVersion?: string;
  evidenceDigest?: string;
  baselineShownFullSignatures?: string[];
  shownFullSignatures?: string[];
}
export function preferenceDecisionMessage(decision: PreferenceDecision | undefined, enabled: boolean): string {
  if (!enabled) return "Learning is off for this saved situation.";
  if (!decision) return "Your saved direction guided these outfits. Preference learning was unavailable for this request.";
  if (["active", "fitted_experimental"].includes(decision.status)) {
    const same = decision.selectionChanged === undefined ? JSON.stringify(decision.baselineShownFullSignatures) === JSON.stringify(decision.shownFullSignatures) : !decision.selectionChanged;
    return same ? "Your feedback was considered; this set stayed the same." : "Your feedback helped choose this set for this direction and situation.";
  }
  const counts = `${decision.likes} likes and ${decision.dislikes} dislikes across ${decision.support} eligible outfits.`;
  if (["insufficient_support", "insufficient_evidence"].includes(decision.reason ?? "")) return `Still getting to know this direction. ${counts}`;
  const reasons: Record<string, string> = {
    unknown_required_features: "Some clothes are missing the details needed to learn from this set.",
    unsupported_candidate_contrast: "This set has no supported alternatives to compare.",
    no_learned_contrast: "Your feedback doesn't distinguish the available alternatives yet.",
    numerical_runtime_missing: "Preference learning is unavailable for this request.",
    evidence_size_limit: "Your saved feedback is too large to use on this request.",
    solver_failure: "Preference learning couldn't complete for this request.",
    non_convergence: "Preference learning couldn't complete for this request.",
    line_search_failed: "Preference learning couldn't complete for this request.",
    learner_timeout: "Preference learning ran out of time for this request.",
  };
  return `${reasons[decision.reason ?? ""] ?? "There wasn't a supported preference pattern to use for this set."} Your saved direction still guided these outfits. ${counts}`;
}

export function projectPreferenceDecision(raw: PreferenceDecision | undefined): PreferenceDecision | undefined {
  if (!raw || typeof raw.status !== "string" || ![raw.support, raw.likes, raw.dislikes].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 200)) return undefined;
  return { status: raw.status, reason: typeof raw.reason === "string" ? raw.reason : null,
    support: raw.support, likes: raw.likes, dislikes: raw.dislikes,
    selectionChanged: JSON.stringify(raw.baselineShownFullSignatures ?? []) !== JSON.stringify(raw.shownFullSignatures ?? []) };
}
