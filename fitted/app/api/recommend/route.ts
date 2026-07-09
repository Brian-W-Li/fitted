/**
 * POST /api/recommend — the single recommendation endpoint (M5).
 *
 * Behind `USE_ML_SHORTLISTER`: flag-ON dispatches the M5 vertical (`mlRecommend` — the stateless
 * render service + live GenerationSnapshot write). The pre-M5 legacy recommender is RETIRED (C8);
 * with the flag off/unset the ML vertical is disabled, so the route returns the §A degraded empty
 * browser state (`renderDegraded`) — empty candidates, no {snapshotId,candidateId} binding token, no
 * snapshot, HTTP 200 — never legacy, never a 5xx. That degraded state is the rollback story.
 *
 * The M5 vertical folds regenerate into this one route (a `/render` call with a `parentSnapshotId`);
 * there is no `/rerank` endpoint (the legacy `regenerate/route.ts` sibling was deleted at C8).
 *
 * Reference: docs/plans/m5-cutover.md §A / §19 (legacy retirement).
 */
import { type NextRequest } from "next/server";
import { mlRecommend, prodDeps, renderDegraded } from "@/lib/mlRecommend";

// G6 host-timeout dominance (§D): the serverless platform must not abort the function BEFORE Next's
// own fetch timeout fires, or the degrade logic never runs. maxDuration=60 (Vercel Hobby's ceiling)
// with the ordering invariant PRE_SERVICE_BUDGET_MS + SERVICE_TIMEOUT_MS + MONGO_WRITE_REREAD_MARGIN_MS
// < 60_000 (SERVICE_TIMEOUT_MS defaults to 45_000 in lib/mlServiceClient.ts, leaving ~15s for the
// pre-service Mongo reads + the post-service write). C8 pre-flip re-asserts the deployed maxDuration.
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  if (process.env.USE_ML_SHORTLISTER === "true") {
    return mlRecommend(request, prodDeps());
  }
  // Flag off/unset: the ML vertical is disabled and legacy is retired — return the §A degraded
  // empty state (200, no snapshot, no binding token), never legacy, never a 5xx.
  return renderDegraded();
}
