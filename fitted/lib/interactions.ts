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
 * The GET is the read side (the History curation view): user-scoped, collapsed to per-candidate
 * latest-STATE (§23-H61) so one card shows per `{snapshotId, candidateId}` (a dislike + its later
 * "why" enrich, or a like later flipped to dislike, read as ONE card in its winning tab, never two).
 * It server-JOINS each surviving row's bound candidate content (styleMove/optionPath/risk/items) +
 * `itemSnapshots` display fields via `{snapshotId, candidateId}` at read time — never denormalized
 * interaction-row content, never the legacy unscoped populate.
 *
 * DELETE is the curation door (the "little bro tapped 5 reactions" case, D-1): a HARD-delete of every
 * row for one `{snapshotId, candidateId}` binding, scoped to the caller's user, via the same sanctioned
 * native-driver door the account-erasure cascade uses (below the co-presence `pre('validate')` guard,
 * which is document-only and never fired on deletes anyway). This is NOT a break of the append-only
 * posture: a *correction* is still a new event (a flip = an appended opposite action via POST); DELETE
 * is deliberate *curation/erasure* of a retracted-or-junk label, and with no derived affinity anywhere
 * (affinity recomputes from the log every request) a delete is consistent by construction — the reducer
 * + export simply stop seeing the rows, reverting that candidate to shown-but-unrated (`label=null`).
 * Snapshots are NEVER touched (immutable training truth, H10/H29); deleting a `rejected` correctly
 * un-blocks that candidate's signature AND drops its baseKey from the disliked-cooldown buffer (both
 * interaction-derived — recomputed from the log — so the aversion is forgotten, as intended) but does
 * NOT un-surface a repeated outfit: the repetition window (recently-shown fullSignatures) is the
 * snapshot-driven suppression, and it is untouched by a feedback delete (Fable-confirmed, D-1.2).
 *
 * INJECTABLE (`InteractionDeps`) so a jest test drives it over a REAL in-memory Mongo with a fixed
 * user — the behavior-first cure. `prodInteractionDeps()` binds the real auth + models.
 *
 * Reference: docs/plans/friend-facing-fixes.md PHASE 1; docs/plans/m5-cutover.md §I / §H / §A (G15);
 * docs/Fitted_Spec_v2.md §16 / §23-H61.
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
import { OBJECT_ID_RE } from "@/lib/formats";
import { pickLatestPerCandidate } from "@/lib/latestFeedbackState";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

// The live feedback vocabulary — pinned to contract_fields.json crossRuntime.enums.interactionAction
// (derived from the Python reducers' COUNTED_ACTIONS ∪ REJECTED_ACTION) by crossRuntimeContract.test.ts.
export const ALLOWED_ACTIONS = new Set(["accepted", "rejected"]);
export const MAX_PER_ITEM_FEEDBACK = 20; // §A clamp table (mirror of config.MAX_PER_ITEM_FEEDBACK)
export const MAX_INTERACTIONS_PER_USER = 2000; // per-user storage ceiling (append-only rows only grow)
const NOTES_MAX_CHARS = FEEDBACK_REASON_RAW_TEXT_MAX_CHARS; // 500 — same route cap
// History reachability (#4): scan the FULL per-user corpus (the storage cap), not the old
// `createdAt >= 1 month` + 50-cap that made older feedback un-curatable over a weeks-long collection.
// Deliberately the whole corpus and NOT the reducer's 500-row serving window: the M6 export dedups
// over EVERY row, so a label past row 500 is still trainable — and anything trainable must be
// curatable (flip/remove), or the "little bro" cleanup can't reach it. Bounded by the 2000-row
// per-user ceiling; deduped to latest-state the card count is far smaller in practice.
const HISTORY_SCAN_LIMIT = MAX_INTERACTIONS_PER_USER;

const REASON_CODE_SET = new Set<string>(FEEDBACK_REASON_CODES);

// --- Per-user rate limit (§A) — a token bucket bounding the append-only write path so one account
// cannot flood its OWN feedback corpus (this route is own-account-only; not a cross-user threat).
// Serverless ⇒ per-instance, exactly like the Python service's RATE_LIMIT_* bound; the intent is a
// sane ceiling, not a global quota. ~60 writes/minute sustained, full 60-token burst.
export const INTERACTION_RATE_LIMIT_CAPACITY = 60;
const RATE_LIMIT_REFILL_PER_MS = INTERACTION_RATE_LIMIT_CAPACITY / 60_000; // full refill in 60s
const rateBuckets = new Map<string, { tokens: number; last: number }>();
function allowInteraction(userId: string, now: number): boolean {
  const b = rateBuckets.get(userId) ?? { tokens: INTERACTION_RATE_LIMIT_CAPACITY, last: now };
  b.tokens = Math.min(INTERACTION_RATE_LIMIT_CAPACITY, b.tokens + (now - b.last) * RATE_LIMIT_REFILL_PER_MS);
  b.last = now;
  rateBuckets.set(userId, b);
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}
/** Test seam: clear all buckets so the module-level limit never bleeds across cases. */
export function __resetInteractionRateLimit(): void {
  rateBuckets.clear();
}

// ---------------------------------------------------------------------------
// Injectable dependencies.
// ---------------------------------------------------------------------------
export interface InteractionModels {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  OutfitInteraction: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  GenerationSnapshot: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  User: any;
}
export interface InteractionDeps {
  verifyUser(request: NextRequest): Promise<AuthResult>;
  models: InteractionModels;
  /** Injectable clock (ms) for the rate limiter — defaults to Date.now; tests freeze it. */
  now?: () => number;
}

export async function prodInteractionDeps(): Promise<InteractionDeps> {
  const { OutfitInteraction, GenerationSnapshot, User } = await initDatabase();
  return { verifyUser: verifyFirebaseUser, models: { OutfitInteraction, GenerationSnapshot, User } };
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
    // Rate-limit BEFORE any body parse or DB work — a flooded caller is rejected cheaply, no write.
    if (!allowInteraction(auth.userId, (deps.now ?? Date.now)())) {
      return respondError(429, "rate_limited", "too many interactions — please slow down");
    }
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
      const seenItemIds = new Set<string>();
      for (const f of body.perItemFeedback as Any[]) {
        if (!f || typeof f !== "object") return respondError(400, "contract_invalid", "malformed perItemFeedback entry");
        const itemId = typeof f.itemId === "string" ? f.itemId : "";
        if (!OBJECT_ID_RE.test(itemId)) return respondError(400, "invalid_binding", "perItemFeedback.itemId is not a 24-hex ObjectId");
        if (!candidateItemSet.has(itemId)) return respondError(400, "invalid_binding", "perItemFeedback.itemId is not in the outfit");
        // Reject-not-coerce (§F doctrine): a duplicated itemId is a malformed request, and it
        // would let one request carry MAX entries of repeated payload for a two-item outfit.
        if (seenItemIds.has(itemId)) return respondError(400, "contract_invalid", "perItemFeedback has a duplicate itemId");
        seenItemIds.add(itemId);
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

    // Per-user row ceiling (§I — the storage-bounds symmetry with wardrobe's 300-item cap and the
    // image byte budget): the append-only design means rows only grow, and the in-process rate
    // limiter above is per-instance, not a storage bound. 2000 rows is years of real feedback for
    // one friend and bounds a scripted loop at ~20MB worst-case against the shared M0.
    const interactionCount = await OutfitInteraction.countDocuments({ user: userObjectId });
    if (interactionCount >= MAX_INTERACTIONS_PER_USER) {
      return respondError(400, "storage_limit", "feedback storage limit reached");
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

    // Erasure race (§23-H43 — the mirror of mlRecommend step 11.5): auth re-reads the User row,
    // so only an ALREADY-authed request can interleave with DELETE /api/account. If the account
    // died while this request was in flight, the row just written is an orphan that would survive
    // the phase-3 sweep — "delete means delete", so self-erase via the native driver (the same
    // sanctioned erasure door the User cascade uses; the append-only guard stays intact for every
    // other path) and reject non-committally.
    const userStillExists = await deps.models.User.exists({ _id: userObjectId });
    if (!userStillExists) {
      await OutfitInteraction.db
        .collection("outfitinteractions")
        .deleteMany({ user: userObjectId });
      return respondError(401, "auth", "User not found");
    }

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

    // Fetch BOTH actions across the training-active window (no per-action query filter): the latest
    // state of a candidate can be either sign (a like flipped to dislike), so the dedup MUST see both
    // signs before deciding the winning tab — filtering by action in the query would strand a flipped
    // candidate under its stale sign. Same deterministic sort as the reducer's projection.
    const { OutfitInteraction, GenerationSnapshot } = deps.models;
    // Project ONLY what pickLatestPerCandidate + projectHistoryCard read: the binding/order fields +
    // action + occasion. The card CONTENT is server-joined from the snapshot (below), never the row —
    // so an unprojected find would pull heavy per-row fields (perItemFeedback notes, feedbackReason
    // rawText, items) for up to HISTORY_SCAN_LIMIT (2000) rows and discard them. On the free-tier M0
    // wire that read cost is real (and it fires again on every dashboard restore-reconcile).
    const rawRows = (await OutfitInteraction.find({ user: userObjectId })
      .select("action context.occasion createdAt snapshotId candidateId")
      .sort({ createdAt: -1, _id: -1 })
      .limit(HISTORY_SCAN_LIMIT)
      .lean()
      .exec()) as Any[];

    // §23-H61 latest-state collapse (D-2): one row per {snapshotId, candidateId}, newest wins — so a
    // one-tap dislike + its later "why" enrich, or a like since flipped, render as ONE card, never two.
    // The optional `?action=` filter is applied AFTER the collapse (on the WINNING action) so a caller
    // asking for one tab still gets correct latest-state; History fetches all and splits client-side.
    const wanted = action && ALLOWED_ACTIONS.has(action) ? action : null;
    const interactions = pickLatestPerCandidate(rawRows).filter(
      (i) => wanted == null || i.action === wanted,
    );

    // User-scoped snapshot join (the cross-user read guard: only THIS user's snapshots resolve).
    const snapshotIds = [
      ...new Set(interactions.filter((i) => i.snapshotId).map((i) => i.snapshotId.toString())),
    ];
    const snapshotById = new Map<string, Any>();
    if (snapshotIds.length > 0) {
      // Project ONLY what projectHistoryCard reads — a full snapshot carries generationAttempts
      // rawText (up to 120KB each) + rawEmitted blobs, and the history page fires this join over the
      // deduped candidate set per view; unprojected, that's multi-MB reads growing with every week
      // of real use.
      const snapshots = (await GenerationSnapshot.find({ _id: { $in: snapshotIds }, user: userObjectId })
        .select(
          "candidates.candidateId candidates.items candidates.styleMove candidates.optionPath " +
            "candidates.risk candidates.template itemSnapshots.itemId itemSnapshots.engineVisible",
        )
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

// ---------------------------------------------------------------------------
// DELETE — curation door (D-1): hard-delete every row for one {snapshotId, candidateId} binding,
// scoped to the caller's user. Flip is NOT here — a flip is an appended opposite action (POST). This
// is the deliberate erasure of a retracted/junk label. Binding ids come from the query string
// (?snapshotId=&candidateId=) so the DELETE carries no body (proxies strip DELETE bodies).
// ---------------------------------------------------------------------------
export async function deleteInteraction(request: NextRequest, deps: InteractionDeps): Promise<NextResponse> {
  try {
    const auth = await deps.verifyUser(request);
    if ("error" in auth) return respondError(auth.status, "auth", auth.error);
    // Rate-limit curation on the same per-user bucket as writes — a friend removing a handful of
    // reactions is nowhere near 60/min; the bound stops a scripted delete loop.
    if (!allowInteraction(auth.userId, (deps.now ?? Date.now)())) {
      return respondError(429, "rate_limited", "too many requests — please slow down");
    }
    const userObjectId = new mongoose.Types.ObjectId(auth.userId);

    const { searchParams } = new URL(request.url);
    const snapshotId = searchParams.get("snapshotId");
    const candidateId = searchParams.get("candidateId");
    if (typeof snapshotId !== "string" || !mongoose.isValidObjectId(snapshotId)) {
      return respondError(400, "invalid_binding", "snapshotId is required and must be a valid id");
    }
    if (typeof candidateId !== "string" || candidateId.length === 0) {
      return respondError(400, "invalid_binding", "candidateId is required");
    }

    // Native-driver hard-delete of ALL rows for the binding (a like-then-dislike leaves two rows; a
    // latest-only delete would resurrect the superseded action as the new latest-state, Fable D-1.1).
    // The filter is user-scoped, so a cross-user binding matches nothing → deletedCount 0 → 404. The
    // ObjectId casts matter: the native driver does no Mongoose casting (mirror of interactions.ts
    // erasure-race + User.ts cascade), so a hex-string user/snapshot would match zero ObjectId fields.
    const { OutfitInteraction } = deps.models;
    const result = await OutfitInteraction.db
      .collection("outfitinteractions")
      .deleteMany({
        user: userObjectId,
        snapshotId: new mongoose.Types.ObjectId(snapshotId),
        candidateId,
      });
    const deleted = typeof result?.deletedCount === "number" ? result.deletedCount : 0;
    if (deleted === 0) {
      // Cross-user (nothing owned matched) OR already-removed. The client treats its own 404 as
      // success-equivalent (idempotent remove); a genuine cross-user probe learns nothing (404 same
      // as a stale self-delete). Never 200-with-0, which would let an attacker distinguish the two.
      return respondError(404, "not_found", "no feedback found for that outfit");
    }
    return NextResponse.json({ success: true, deleted });
  } catch (error) {
    console.error("Error deleting interaction:", error);
    return respondError(500, "internal", "Failed to delete interaction");
  }
}
