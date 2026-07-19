/**
 * /api/interactions — M5 append-only feedback boundary (C6, §I).
 *
 * POST binds `{snapshotId, candidateId}` and derives every persisted field from the re-read immutable
 * snapshot candidate (never a client echo); GET is user-scoped and joins the bound candidate content,
 * collapsed to per-candidate latest-state (§23-H61) for the History curation view.
 *
 * Feedback writes stay APPEND-ONLY: a *correction* is a new event (a flip = an appended opposite
 * action via POST, never an in-place edit). There is NO PATCH. DELETE is the deliberate CURATION door
 * (D-1 — the "little bro tapped 5 reactions" case): a user-scoped hard-delete of every row for one
 * `{snapshotId, candidateId}` binding, through the sanctioned native-driver door (below the co-presence
 * guard, exactly like the account-erasure cascade). It reverts that candidate to shown-but-unrated;
 * snapshots (immutable training truth) are never touched. The legacy Gemini `inferredWhy` write-back is
 * gone (the structured `feedbackReason` channel is the "why" home; `lib/gemini.ts` is deleted at C8).
 *
 * Reference: docs/plans/friend-facing-fixes.md PHASE 1; docs/plans/m5-cutover.md §I;
 * docs/Fitted_Spec_v2.md §16 / §23-H61.
 */
import { type NextRequest } from "next/server";
import {
  deleteInteraction,
  getInteractions,
  postInteraction,
  prodInteractionDeps,
} from "@/lib/interactions";

export async function GET(request: NextRequest) {
  return getInteractions(request, await prodInteractionDeps());
}

export async function POST(request: NextRequest) {
  return postInteraction(request, await prodInteractionDeps());
}

export async function DELETE(request: NextRequest) {
  return deleteInteraction(request, await prodInteractionDeps());
}
