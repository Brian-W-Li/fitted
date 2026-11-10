import { readStyleMemoryOwner, contextIsVisible } from "@/lib/styleMemory/store";
import { StyleMemoryError } from "@/lib/styleMemory/validation";
import { StyleMemoryRevisionChanged } from "@/lib/ownerWriteFence";
import { writeSnapshotWithIdempotency } from "@/lib/mlSnapshotWrite";
import type { CapturedStyleContext } from "@/lib/styleContext";

/** This receipt is terminal under its original request ID. It never invents another dispatch. */
export async function writeSupersededStyleRender(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  models: { User: any; GenerationSnapshot: any },
  doc: Record<string, unknown>, owner: { toString(): string }, requestId: string,
) {
  const context = doc.styleContext as CapturedStyleContext;
  const receipt = { ...doc, commandStatus: "superseded", nSurfaced: 0,
    supersededSelection: doc.shownCandidateIds,
    shownCandidateIds: [], shownFullSignatures: [],
    ...(doc.preference ? { preference: { ...(doc.preference as Record<string, unknown>),
      status: "superseded", reason: "memory_changed", shownFullSignatures: [] } } : {}),
    // Preserve candidate/attempt evidence while recording that nothing was surfaced.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    candidates: ((doc.candidates ?? []) as any[]).map(candidate => {
      const captured = { ...candidate, shown: false };
      delete captured.shownPosition;
      if (captured.stageReached === "shown") captured.stageReached = "ranked";
      return captured;
    }),
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    const current = await readStyleMemoryOwner(String(owner));
    if (!contextIsVisible(current.data, context)) throw new StyleMemoryError(404, "context_unavailable", "That styling context was erased.");
    try {
      return await writeSnapshotWithIdempotency<Record<string, unknown>>(models.GenerationSnapshot, receipt, owner, requestId, models.User, current.revision);
    } catch (error) {
      if (!(error instanceof StyleMemoryRevisionChanged)) throw error;
    }
  }
  throw new StyleMemoryError(409, "memory_changed", "Styling memory changed again. Start a new request when ready.");
}
