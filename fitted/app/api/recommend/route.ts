/**
 * POST /api/recommend — the single recommendation endpoint (M5 C5, seam #6).
 *
 * Behind `USE_ML_SHORTLISTER`: flag-ON dispatches the M5 vertical (`mlRecommend` — the stateless
 * render service + live GenerationSnapshot write); flag-OFF runs the pre-M5 legacy recommender
 * (`legacy.ts`), unchanged, as rollback/reference scaffolding. C8 deletes `legacy.ts` + the one-line
 * flag-off arm; the M5 route file itself is never deleted (post-deletion flag-off = degraded empty
 * state, the rollback story).
 *
 * The M5 vertical folds regenerate into this one route (a `/render` call with a `parentSnapshotId`);
 * there is no `/rerank` endpoint. The legacy `regenerate/route.ts` sibling stays until C8.
 *
 * Reference: docs/plans/m5-cutover.md §A / C5 checkpoint.
 */
import { type NextRequest } from "next/server";
import { legacyRecommend } from "./legacy";
import { mlRecommend, prodDeps } from "@/lib/mlRecommend";

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
  return legacyRecommend(request);
}
