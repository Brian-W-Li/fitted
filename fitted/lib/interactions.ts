/**
 * M5 feedback boundary (C6, §I) — append-only interactions bound to `{snapshotId, candidateId}`.
 *
 * The trust-boundary cure over the legacy route (which persisted client `itemIds` verbatim with no
 * ownership check and mutated rows post-insert). The client sends ONLY
 * `{snapshotId, candidateId, action, perItemFeedback?, feedbackReason?}`; every persisted field the
 * §H reducers consume — `items`, `baseKey`, `fullSignature`, occasion — is **derived server-side**
 * from the re-read immutable snapshot candidate, never a client echo. A forged POST cannot poison the
 * behavioral layer even if the binding ids happen to be valid.
 *
 * Gates (§I):
 *   - G8  action allowlist: only `accepted|rejected`; any other value → 400, no row.
 *   - G10 ObjectId-hex + candidate-membership on `items` and `perItemFeedback.itemId`.
 *   - candidate MUST be in `shownCandidateIds` (bind to what the user actually saw).
 *   - ownership: the snapshot is re-read by `{_id, user}`; a cross-user / missing snapshot → 404.
 *   - append-only: `.create()` only (fires the co-presence guard); no update/delete path.
 *   - structured `feedbackReason` validated against the closed §16 code set.
 *
 * The GET is the read side: user-scoped, and it server-JOINS each row's bound candidate content
 * (styleMove/optionPath/risk/items) + `itemSnapshots` display fields via `{snapshotId, candidateId}`
 * at read time — never denormalized interaction-row content, never the legacy unscoped populate.
 *
 * INJECTABLE (`InteractionDeps`) so a jest test drives it over a REAL in-memory Mongo with a fixed
 * user — the behavior-first cure. `prodInteractionDeps()` binds the real auth + models.
 *
 * Reference: docs/plans/m5-cutover.md §I / §H / §A (G15); docs/Fitted_Spec_v2.md §16.
 */
import { NextResponse, type NextRequest } from "next/server";
import mongoose from "mongoose";
import { initDatabase } from "@/lib/db";
import { verifyFirebaseUser, type AuthResult } from "@/lib/apiAuth";
import {
  FEEDBACK_REASON_CODES,
  FEEDBACK_REASON_RAW_TEXT_MAX_CHARS,
  type FeedbackReasonCode,
} from "@/models/OutfitInteraction";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/;
const ALLOWED_ACTIONS = new Set(["accepted", "rejected"]);
const MAX_PER_ITEM_FEEDBACK = 20; // §A clamp table
const NOTES_MAX_CHARS = FEEDBACK_REASON_RAW_TEXT_MAX_CHARS; // 500 — same route cap
const HISTORY_LIMIT = 50;

const REASON_CODE_SET = new Set<string>(FEEDBACK_REASON_CODES);

// ---------------------------------------------------------------------------
// Injectable dependencies.
// ---------------------------------------------------------------------------
export interface InteractionModels {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  OutfitInteraction: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  GenerationSnapshot: any;
}
export interface InteractionDeps {
  verifyUser(request: NextRequest): Promise<AuthResult>;
  models: InteractionModels;
}

export async function prodInteractionDeps(): Promise<InteractionDeps> {
  const { OutfitInteraction, GenerationSnapshot } = await initDatabase();
  return { verifyUser: verifyFirebaseUser, models: { OutfitInteraction, GenerationSnapshot } };
}

function respondError(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: message, code }, { status });
}

// ---------------------------------------------------------------------------
// feedbackReason normalization — closed §16 code set + bounded rawText. Returns the subdoc only when
// at least one code or non-empty rawText exists; throws a code on a bad code (→ 400, never silent).
// ---------------------------------------------------------------------------
class FeedbackReasonError extends Error {}

function normalizeFeedbackReason(
  raw: unknown,
): { codes?: FeedbackReasonCode[]; rawText?: string } | undefined {
  if (raw == null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) throw new FeedbackReasonError("feedbackReason must be an object");
  const r = raw as Record<string, unknown>;

  let codes: FeedbackReasonCode[] | undefined;
  if (r.codes != null) {
    if (!Array.isArray(r.codes)) throw new FeedbackReasonError("feedbackReason.codes must be an array");
    const seen = new Set<string>();
    for (const c of r.codes) {
      if (typeof c !== "string" || !REASON_CODE_SET.has(c)) {
        throw new FeedbackReasonError(`invalid feedbackReason code: ${JSON.stringify(c)}`);
      }
      seen.add(c);
    }
    if (seen.size > 0) codes = [...seen] as FeedbackReasonCode[];
  }

  let rawText: string | undefined;
  if (r.rawText != null) {
    if (typeof r.rawText !== "string") throw new FeedbackReasonError("feedbackReason.rawText must be a string");
    const trimmed = r.rawText.slice(0, NOTES_MAX_CHARS);
    if (trimmed.trim().length > 0) rawText = trimmed;
  }

  if (!codes && !rawText) return undefined; // nothing worth persisting
  return { ...(codes ? { codes } : {}), ...(rawText ? { rawText } : {}) };
}

// ---------------------------------------------------------------------------
// POST — bind + append. Every reducer-consumed field is derived from the re-read candidate.
// ---------------------------------------------------------------------------
export async function postInteraction(request: NextRequest, deps: InteractionDeps): Promise<NextResponse> {
  try {
    const auth = await deps.verifyUser(request);
    if ("error" in auth) return respondError(auth.status, "auth", auth.error);
    const userObjectId = new mongoose.Types.ObjectId(auth.userId);

    const body = (await request.json().catch(() => null)) as Any;
    if (!body || typeof body !== "object") return respondError(400, "contract_invalid", "malformed body");

    const { action, snapshotId, candidateId } = body;

    // G8 — action allowlist; a disallowed value writes NO row.
    if (typeof action !== "string" || !ALLOWED_ACTIONS.has(action)) {
      return respondError(400, "invalid_action", "action must be 'accepted' or 'rejected'");
    }
    if (typeof snapshotId !== "string" || !mongoose.isValidObjectId(snapshotId)) {
      return respondError(400, "invalid_binding", "snapshotId is required and must be a valid id");
    }
    if (typeof candidateId !== "string" || candidateId.length === 0) {
      return respondError(400, "invalid_binding", "candidateId is required");
    }

    // Ownership + immutable re-read: never trust echoed content.
    const { OutfitInteraction, GenerationSnapshot } = deps.models;
    const snapshot = await GenerationSnapshot.findOne({ _id: snapshotId, user: userObjectId }).lean();
    if (!snapshot) return respondError(404, "snapshot_not_found", "snapshot not found");

    // Bind only to what the user actually SAW (a candidate not in shownCandidateIds — incl. every
    // candidate of a degenerate/unbindable render — is unbindable).
    const shownIds: string[] = Array.isArray(snapshot.shownCandidateIds) ? snapshot.shownCandidateIds : [];
    if (!shownIds.includes(candidateId)) {
      return respondError(400, "candidate_not_shown", "candidateId is not in this snapshot's shown set");
    }
    const candidate = (Array.isArray(snapshot.candidates) ? snapshot.candidates : []).find(
      (c: Any) => c.candidateId === candidateId,
    );
    if (!candidate) return respondError(400, "candidate_not_found", "candidateId not found in snapshot");

    // Derive the reducer-consumed fields from the candidate — G10: every item id is 24-hex ObjectId.
    const candidateItemIds: string[] = (Array.isArray(candidate.items) ? candidate.items : []).map(
      (it: Any) => String(it.itemId),
    );
    for (const id of candidateItemIds) {
      if (!OBJECT_ID_RE.test(id)) return respondError(400, "invalid_binding", "candidate item id is not a 24-hex ObjectId");
    }
    const candidateItemSet = new Set(candidateItemIds);
    const baseKey = candidate.baseKey;
    const fullSignature = candidate.fullSignature;
    if (typeof baseKey !== "string" || !baseKey || typeof fullSignature !== "string" || !fullSignature) {
      // A shown candidate always carries both; an incomplete binding must not persist a partial row.
      return respondError(400, "unbindable_candidate", "candidate is missing baseKey/fullSignature");
    }

    // perItemFeedback — each itemId 24-hex ObjectId AND ∈ candidate items (⊄ rejects, G10); notes capped.
    let perItemFeedback: Array<{ itemId: string; disliked: boolean; notes?: string }> | undefined;
    if (body.perItemFeedback != null) {
      // perItemFeedback is a REJECT-time channel: the affinity reducer reads it only on the
      // rejected branch (a dislike window). On an `accepted` action the reducer grants every
      // outfit item +1 and never consults perItemFeedback — so a `{disliked:true}` entry there
      // would silently give the disliked item positive affinity. Reject it at the boundary rather
      // than persist a row whose per-item signal is dropped.
      if (action !== "rejected") {
        return respondError(400, "contract_invalid", "perItemFeedback is only accepted on a 'rejected' action");
      }
      if (!Array.isArray(body.perItemFeedback)) return respondError(400, "contract_invalid", "perItemFeedback must be an array");
      if (body.perItemFeedback.length > MAX_PER_ITEM_FEEDBACK) {
        return respondError(400, "contract_invalid", `perItemFeedback exceeds ${MAX_PER_ITEM_FEEDBACK} entries`);
      }
      const out: Array<{ itemId: string; disliked: boolean; notes?: string }> = [];
      for (const f of body.perItemFeedback as Any[]) {
        if (!f || typeof f !== "object") return respondError(400, "contract_invalid", "malformed perItemFeedback entry");
        const itemId = typeof f.itemId === "string" ? f.itemId : "";
        if (!OBJECT_ID_RE.test(itemId)) return respondError(400, "invalid_binding", "perItemFeedback.itemId is not a 24-hex ObjectId");
        if (!candidateItemSet.has(itemId)) return respondError(400, "invalid_binding", "perItemFeedback.itemId is not in the outfit");
        out.push({
          itemId,
          disliked: Boolean(f.disliked),
          ...(typeof f.notes === "string" ? { notes: f.notes.slice(0, NOTES_MAX_CHARS) } : {}),
        });
      }
      if (out.length > 0) perItemFeedback = out;
    }

    // Structured feedbackReason (closed §16 codes + bounded rawText).
    let feedbackReason;
    try {
      feedbackReason = normalizeFeedbackReason(body.feedbackReason);
    } catch (err) {
      if (err instanceof FeedbackReasonError) return respondError(400, "invalid_feedback_reason", err.message);
      throw err;
    }

    // Append-only write via .create() so the co-presence pre('validate') guard fires. Everything the
    // reducers read is SERVER-DERIVED. `items` are hex strings — mongoose casts to the ObjectId refs.
    const interaction = await OutfitInteraction.create({
      user: userObjectId,
      items: candidateItemIds,
      action,
      context: { occasion: snapshot.occasion ?? "casual" },
      snapshotId,
      candidateId,
      baseKey,
      fullSignature,
      ...(perItemFeedback ? { perItemFeedback } : {}),
      ...(feedbackReason ? { feedbackReason } : {}),
    });

    return NextResponse.json({
      success: true,
      interaction: { id: interaction._id.toString(), action: interaction.action },
    });
  } catch (error) {
    console.error("Error saving interaction:", error);
    return respondError(500, "internal", "Failed to save interaction");
  }
}

// ---------------------------------------------------------------------------
// GET — user-scoped read + server join of the bound candidate content (never denormalized rows).
// ---------------------------------------------------------------------------
export interface HistoryDisplayItem {
  itemId: string;
  role?: string;
  name?: string;
  clothingType?: string;
  colorTags?: string[];
  imageUrl?: string;
}
export interface HistoryCard {
  id: string;
  action: string;
  occasion: string;
  createdAt: unknown;
  snapshotId: string | null;
  candidateId: string | null;
  displayItems: HistoryDisplayItem[];
  styleMove: unknown;
  optionPath?: string;
  risk?: string;
  templateType?: string;
}

/** Join one interaction row to its bound snapshot candidate → the card content the history renders. */
function projectHistoryCard(interaction: Any, snapshot: Any | undefined): HistoryCard {
  const base: HistoryCard = {
    id: interaction._id.toString(),
    action: interaction.action,
    occasion: interaction.context?.occasion ?? "casual",
    createdAt: interaction.createdAt,
    snapshotId: interaction.snapshotId ? interaction.snapshotId.toString() : null,
    candidateId: interaction.candidateId ?? null,
    displayItems: [],
    styleMove: null,
  };
  if (!snapshot || !interaction.candidateId) return base;
  const candidate = (Array.isArray(snapshot.candidates) ? snapshot.candidates : []).find(
    (c: Any) => c.candidateId === interaction.candidateId,
  );
  if (!candidate) return base;
  const engineVisibleById = new Map<string, Any>(
    (Array.isArray(snapshot.itemSnapshots) ? snapshot.itemSnapshots : []).map((it: Any) => [
      it.itemId,
      it.engineVisible ?? {},
    ]),
  );
  base.displayItems = (Array.isArray(candidate.items) ? candidate.items : []).map((it: Any) => {
    const ev = engineVisibleById.get(it.itemId) ?? {};
    return {
      itemId: it.itemId,
      role: it.role,
      name: ev.name,
      clothingType: ev.clothingType,
      colorTags: ev.colorTags,
      imageUrl: ev.imageUrl,
    };
  });
  base.styleMove = candidate.styleMove ?? null;
  base.optionPath = candidate.optionPath;
  base.risk = candidate.risk;
  base.templateType = candidate.template;
  return base;
}

export async function getInteractions(request: NextRequest, deps: InteractionDeps): Promise<NextResponse> {
  try {
    const auth = await deps.verifyUser(request);
    if ("error" in auth) return respondError(auth.status, "auth", auth.error);
    const userObjectId = new mongoose.Types.ObjectId(auth.userId);

    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action");

    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

    const query: Record<string, unknown> = { user: userObjectId, createdAt: { $gte: oneMonthAgo } };
    query.action = action && ALLOWED_ACTIONS.has(action) ? action : { $in: ["accepted", "rejected"] };

    const { OutfitInteraction, GenerationSnapshot } = deps.models;
    const interactions = (await OutfitInteraction.find(query)
      .sort({ createdAt: -1 })
      .limit(HISTORY_LIMIT)
      .lean()
      .exec()) as Any[];

    // User-scoped snapshot join (the cross-user read guard: only THIS user's snapshots resolve).
    const snapshotIds = [
      ...new Set(interactions.filter((i) => i.snapshotId).map((i) => i.snapshotId.toString())),
    ];
    const snapshotById = new Map<string, Any>();
    if (snapshotIds.length > 0) {
      const snapshots = (await GenerationSnapshot.find({ _id: { $in: snapshotIds }, user: userObjectId })
        .lean()
        .exec()) as Any[];
      for (const s of snapshots) snapshotById.set(s._id.toString(), s);
    }

    const formatted = interactions.map((i) =>
      projectHistoryCard(i, i.snapshotId ? snapshotById.get(i.snapshotId.toString()) : undefined),
    );

    return NextResponse.json({ interactions: formatted });
  } catch (error) {
    console.error("Error fetching interactions:", error);
    return respondError(500, "internal", "Failed to fetch interactions");
  }
}
