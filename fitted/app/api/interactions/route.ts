/**
 * /api/interactions — M5 append-only feedback boundary (C6, §I).
 *
 * POST binds `{snapshotId, candidateId}` and derives every persisted field from the re-read immutable
 * snapshot candidate (never a client echo); GET is user-scoped and joins the bound candidate content.
 * The core is INJECTABLE (`lib/interactions.ts`) so a jest test drives it over a real in-memory Mongo.
 *
 * There is NO DELETE and NO PATCH: feedback is append-only — corrections are new events, not mutations
 * (a DELETE/PATCH request now gets Next's automatic 405). The legacy Gemini `inferredWhy` write-back is
 * gone (the structured `feedbackReason` channel is the "why" home; `lib/gemini.ts` is deleted at C8).
 *
 * Reference: docs/plans/m5-cutover.md §I; docs/Fitted_Spec_v2.md §16.
 */
import { type NextRequest } from "next/server";
import { getInteractions, postInteraction, prodInteractionDeps } from "@/lib/interactions";

export async function GET(request: NextRequest) {
  return getInteractions(request, await prodInteractionDeps());
}

export async function POST(request: NextRequest) {
  return postInteraction(request, await prodInteractionDeps());
}
