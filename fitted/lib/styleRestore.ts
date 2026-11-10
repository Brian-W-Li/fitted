import { sameCapturedStyleContext, type CapturedStyleContext } from "@/lib/styleContext";

interface StyledCache { styleContext: CapturedStyleContext; shown: { snapshotId: string; candidateId: string }[] }
/** Session cache is a convenience, never authority to show an erased styling source. */
export async function validateStyledRestore(cache: StyledCache, token: string, signal: AbortSignal): Promise<"visible" | "unavailable" | "unverified"> {
  if (!cache.shown.length || cache.shown.length > 3) return "unavailable";
  try {
    const states = await Promise.all(cache.shown.map(async shown => {
      if (!/^[a-f0-9]{24}$/.test(shown.snapshotId) || typeof shown.candidateId !== "string" || !shown.candidateId || shown.candidateId.length > 128) return "unavailable";
      const query = new URLSearchParams({ snapshotId: shown.snapshotId, candidateId: shown.candidateId });
      const response = await fetch(`/api/experiences/suggestion?${query}`, { headers: { Authorization: `Bearer ${token}` }, signal, cache: "no-store" });
      if ([404, 410].includes(response.status)) return "unavailable";
      if (!response.ok) return "unverified";
      const { suggestion } = await response.json();
      return suggestion?.snapshotId === shown.snapshotId && suggestion?.candidateId === shown.candidateId &&
        sameCapturedStyleContext(suggestion.styleContext, cache.styleContext) ? "visible" : "unverified";
    }));
    return states.includes("unavailable") ? "unavailable" : states.every(state => state === "visible") ? "visible" : "unverified";
  } catch { return "unverified"; }
}
