"use client";

import { auth } from "@/lib/firebaseClient";
import { signOut, onAuthStateChanged, type User as FirebaseUser } from "firebase/auth";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { resolveImageSrc } from "@/lib/imageUrl";
import { clearSessionCookie } from "@/lib/sessionCookie";
import { MAX_OCCASION_CHARS } from "@/lib/mlRequestAdapter";
import { isEmptyDegradedRender } from "@/lib/renderResultGuards";
import { useDislikeEnrich } from "@/lib/useDislikeEnrich";
import { emptyStateMessage, recommendErrorMessage, partialRenderHint } from "@/lib/recommendCopy";
import type { ClothingType } from "@/lib/clothingType";
import { reconcileShownFeedback, buildActionByKey, type HistoryActionRow } from "@/lib/feedbackReconcile";

// ============================================================================
// M5 §6.5 browser contract (the G15 allowlist the /api/recommend route returns).
// The dashboard renders ONLY this projection — never a legacy `outfits[]` shape, never a
// `shown[].outfit` echo. The StyleMove card body comes from `candidates[candidateId]` (already
// resolved server-side into `styleMove`/`optionPath`/`risk`/`templateType`); item display fields
// come from `itemSnapshots` (hydrated server-side into `displayItems`).
// ============================================================================

interface DisplayItem {
  itemId: string;
  role?: string;
  name?: string;
  clothingType?: string;
  colorTags?: string[];
  imageUrl?: string;
}

interface StyleMove {
  moveType?: string;
  oneSentence?: string;
  changedItemIds?: string[];
}

interface ShownOutfit {
  snapshotId: string;
  candidateId: string;
  displayItems: DisplayItem[];
  styleMove: StyleMove | null;
  optionPath?: string;
  risk?: string;
  templateType?: string;
  /** client-only UI state — which way this variant was rated this session */
  feedback?: "liked" | "disliked";
}

interface RenderFlags {
  notEnoughItems: boolean;
  insufficientAfterGeneration: boolean;
  spreadCollapsed: boolean;
  reasonHint: string | null;
  /** D1 slot census — live renders only (replay/dedup responses omit it); read by
   *  emptyStateMessage's dual-remedy sentence. */
  slotCensus?: Partial<Record<ClothingType, number>>;
}

interface RenderResult {
  shown: ShownOutfit[];
  flags: RenderFlags;
  bindable: boolean;
  generationIndex?: number;
  parentSnapshotId?: string | null;
}

/** The Lens inputs frozen once per Generate action (F10 — the retry re-sends these verbatim). */
interface LensSummary {
  occasion: string;
  forcedItemId?: string | null;
  location?: string | null;
  lat?: number;
  lon?: number;
  eventTimeISO?: string;
  eventTimeLabel?: string;
}

interface NormalizedControls {
  lockedItemIds: string[];
  dislikedItemIds: string[];
}

/** The durable pending-render envelope (§C.4 F10) — persisted BEFORE the fetch so `requestId`
 *  survives a reload/lost response, cleared only on hydrated success or explicit discard. */
interface PendingEnvelope {
  requestId: string;
  intent: "daily" | "rescue_item";
  parentSnapshotId: string | null;
  normalizedControls: NormalizedControls;
  lensSummary: LensSummary;
}

// ============================================================================
// Namespaced client storage (C7 client-state gate — keyed by uid, cleared on logout).
// ============================================================================
const DASHBOARD_KEY = (uid: string) => `fitted_dashboard_v2:${uid}`;
const PENDING_KEY = (uid: string) => `fitted_pending_render:${uid}`;

interface PersistedDashboard {
  occasion: string;
  result: RenderResult;
  /** H100 — locks last submitted on this lineage's re-roll, so a restored render still seeds them. */
  activeLockedItemIds?: string[];
}

function readJSON<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function writeJSON(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota/serialization errors
  }
}
function removeKey(key: string): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
}

// ============================================================================
// Helpers
// ============================================================================

type EventTimeBucket = "now" | "later_today" | "tomorrow" | "custom";

function getEventTimeISO(bucket: EventTimeBucket, customVal: string): string | undefined {
  if (bucket === "now") return undefined;
  if (bucket === "later_today") {
    const d = new Date();
    if (d.getHours() >= 18) d.setDate(d.getDate() + 1);
    d.setHours(18, 0, 0, 0);
    return d.toISOString();
  }
  if (bucket === "tomorrow") {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(12, 0, 0, 0);
    return d.toISOString();
  }
  if (customVal) {
    const parsed = new Date(customVal);
    return isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
  }
  return undefined;
}

// Resolve §6.5 displayItems.imageUrl (already "/api/images/<id>" or an external url) — plus mongo:
// for defensiveness — to a browser <img src>. Shared, unit-tested (lib/imageUrl).
const imageUrlFromPath = resolveImageSrc;

const CLOTHING_TYPE_ORDER: Record<string, number> = {
  dress: 0,
  top: 1,
  bottom: 2,
  outer_layer: 3,
  shoes: 4,
};
function sortDisplayItems(items: DisplayItem[]): DisplayItem[] {
  return [...items].sort(
    (a, b) => (CLOTHING_TYPE_ORDER[a.clothingType ?? ""] ?? 5) - (CLOTHING_TYPE_ORDER[b.clothingType ?? ""] ?? 5),
  );
}

/** UUIDv4 for the idempotency token. `crypto.randomUUID` needs a secure context + a ~2021 browser;
 *  on anything older, fall back to a Math.random v4 (fine here — it's an idempotency key, not a
 *  security token) instead of throwing BEFORE any state change (which made Generate a silent no-op). */
function newRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const RISK_BADGE: Record<string, string> = {
  safe: "bg-green-100 text-green-700",
  noticeable: "bg-yellow-100 text-yellow-700",
  bold: "bg-orange-100 text-orange-700",
};

// ============================================================================
// Dislike feedback modal — per-item dislikes + structured reason codes (§16).
// ============================================================================
interface PerItemFeedback {
  itemId: string;
  disliked: boolean;
  notes?: string;
}


const DISLIKE_REASONS: { code: string; label: string }[] = [
  { code: "too_boring", label: "Too boring" },
  { code: "too_much", label: "Too much" },
  { code: "not_practical", label: "Not practical" },
  { code: "not_me", label: "Not my style" },
  { code: "wrong_context", label: "Wrong for the occasion" },
  { code: "weather_forced", label: "Wrong for the weather" },
  { code: "too_repetitive", label: "Too repetitive" },
];

function FeedbackModal({
  outfit,
  onClose,
  onSave,
}: {
  outfit: ShownOutfit;
  onClose: () => void;
  onSave: (data: { perItemFeedback: PerItemFeedback[]; codes: string[] }) => void;
}) {
  const [disliked, setDisliked] = useState<Set<string>>(new Set());
  const [codes, setCodes] = useState<Set<string>>(new Set());

  const toggle = (set: Set<string>, key: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setter(next);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-xl font-semibold">What didn&apos;t work?</h2>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <p className="text-sm font-medium text-slate-700 mb-2">Mark any pieces that felt off (optional)</p>
            <div className="space-y-2">
              {sortDisplayItems(outfit.displayItems).map((item) => {
                const imgSrc = imageUrlFromPath(item.imageUrl);
                const isDisliked = disliked.has(item.itemId);
                return (
                  <div
                    key={item.itemId}
                    className={`p-3 rounded-lg border flex items-center gap-3 ${
                      isDisliked ? "border-red-200 bg-red-50" : "border-slate-200 bg-slate-50"
                    }`}
                  >
                    {imgSrc ? (
                      <img src={imgSrc} alt={item.name} className="w-14 h-14 object-cover rounded-lg" />
                    ) : (
                      <div className="w-14 h-14 bg-slate-200 rounded-lg flex items-center justify-center text-[10px] text-slate-500">
                        No photo
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-slate-900 text-sm truncate">{item.name ?? "Item"}</p>
                      <p className="text-xs text-slate-500">{item.clothingType}</p>
                    </div>
                    <button
                      onClick={() => toggle(disliked, item.itemId, setDisliked)}
                      className={`px-3 py-1 text-sm font-medium rounded-lg ${
                        isDisliked ? "bg-red-200 text-red-800" : "bg-slate-200 text-slate-700 hover:bg-red-100"
                      }`}
                    >
                      {isDisliked ? "Disliked" : "Dislike"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <p className="text-sm font-medium text-slate-700 mb-2">Why? (optional)</p>
            <div className="flex flex-wrap gap-2">
              {DISLIKE_REASONS.map(({ code, label }) => (
                <button
                  key={code}
                  onClick={() => toggle(codes, code, setCodes)}
                  className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                    codes.has(code)
                      ? "bg-slate-900 text-white border-slate-900"
                      : "bg-white text-slate-700 border-slate-300 hover:bg-slate-100"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="p-6 border-t border-slate-200 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200">
            Cancel
          </button>
          <button
            onClick={() =>
              onSave({
                perItemFeedback: [...disliked].map((itemId) => ({ itemId, disliked: true })),
                codes: [...codes],
              })
            }
            className="px-4 py-2 text-sm font-medium text-white bg-slate-700 rounded-lg hover:bg-slate-800"
          >
            Submit dislike
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Regenerate modal — R9 controls (lock pieces to keep, mark pieces to avoid). Drives one
// server re-roll (POST /api/recommend with parentSnapshotId + controls); the child render replaces
// the list. Works identically for daily and rescue parents (the server derives intent + forcedItemId
// from the parent row, §C.1).
// ============================================================================
function RegenerateModal({
  outfit,
  onClose,
  onRegenerate,
  isRegenerating,
  error,
  initialLockedItemIds,
}: {
  outfit: ShownOutfit;
  onClose: () => void;
  onRegenerate: (controls: NormalizedControls) => void;
  isRegenerating: boolean;
  error?: string;
  /** H100 — locks inherited from this lineage's previous re-roll (already intersected with THIS
   *  outfit's items by the caller): a lock means "keep this piece" until the person unlocks it, so
   *  it must survive re-roll after re-roll instead of silently resetting. Avoids are deliberately
   *  NOT inherited — the engine excludes an avoided item from every child candidate, so an
   *  inherited avoid could never be displayed (or cleared) here, and silently accumulating avoids
   *  starves a small closet into "nothing buildable" with no visible cause. */
  initialLockedItemIds?: string[];
}) {
  const [locked, setLocked] = useState<Set<string>>(() => new Set(initialLockedItemIds ?? []));
  const [disliked, setDisliked] = useState<Set<string>>(new Set());

  // A piece can't be both locked and disliked (the server rejects it, so the UI forbids it too).
  const setLock = (id: string) => {
    setDisliked((d) => {
      const nd = new Set(d);
      nd.delete(id);
      return nd;
    });
    setLocked((l) => {
      const nl = new Set(l);
      if (nl.has(id)) nl.delete(id);
      else nl.add(id);
      return nl;
    });
  };
  const setDislike = (id: string) => {
    setLocked((l) => {
      const nl = new Set(l);
      nl.delete(id);
      return nl;
    });
    setDisliked((d) => {
      const nd = new Set(d);
      if (nd.has(id)) nd.delete(id);
      else nd.add(id);
      return nd;
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-xl font-semibold">Regenerate</h2>
          <button onClick={onClose} disabled={isRegenerating} className="p-2 hover:bg-slate-100 rounded-lg disabled:opacity-50">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-6 space-y-3">
          <p className="text-sm text-slate-600">
            Lock the pieces you want to keep, or mark the ones to avoid. We&apos;ll generate a fresh outfit
            under the same occasion.
          </p>
          {/* F13 — regenerate silently swapped the whole list; say so, and reassure feedback is kept. */}
          <p className="text-xs text-slate-500">
            This replaces the outfits currently on screen. Any likes or dislikes you&apos;ve already given are
            saved and stay in your History.
          </p>
          {sortDisplayItems(outfit.displayItems).map((item) => {
            const imgSrc = imageUrlFromPath(item.imageUrl);
            const isLocked = locked.has(item.itemId);
            const isDisliked = disliked.has(item.itemId);
            return (
              <div
                key={item.itemId}
                className={`p-3 rounded-lg border flex items-center gap-3 ${
                  isLocked ? "border-green-200 bg-green-50" : isDisliked ? "border-red-200 bg-red-50" : "border-slate-200 bg-slate-50"
                }`}
              >
                {imgSrc ? (
                  <img src={imgSrc} alt={item.name} className="w-14 h-14 object-cover rounded-lg" />
                ) : (
                  <div className="w-14 h-14 bg-slate-200 rounded-lg flex items-center justify-center text-[10px] text-slate-500">No photo</div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-slate-900 text-sm truncate">{item.name ?? "Item"}</p>
                  <p className="text-xs text-slate-500">{item.clothingType}</p>
                </div>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => setLock(item.itemId)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-lg ${isLocked ? "bg-green-200 text-green-800" : "bg-slate-200 text-slate-700 hover:bg-slate-300"}`}
                  >
                    {isLocked ? "Keeping" : "Keep"}
                  </button>
                  <button
                    onClick={() => setDislike(item.itemId)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-lg ${isDisliked ? "bg-red-200 text-red-800" : "bg-slate-200 text-slate-700 hover:bg-red-100"}`}
                  >
                    {isDisliked ? "Avoiding" : "Avoid"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        {error && <div className="mx-6 mb-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        <div className="p-6 border-t border-slate-200 flex justify-end gap-3">
          <button onClick={onClose} disabled={isRegenerating} className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 disabled:opacity-50">
            Cancel
          </button>
          <button
            onClick={() => onRegenerate({ lockedItemIds: [...locked], dislikedItemIds: [...disliked] })}
            disabled={isRegenerating}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
          >
            {isRegenerating ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Regenerating…
              </>
            ) : (
              "Regenerate"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// One outfit card — StyleMove body from `candidates[candidateId]`, items from `displayItems`.
// ============================================================================
// §4 trust-lane labels — the felt form of the graph vocabulary (§6.5 optionPath), not "Outfit N".
const OPTION_PATH_LABEL: Record<string, string> = {
  reliable: "Reliable",
  bridge: "Bridge",
  stretch: "Stretch",
};
// Friendly-cased risk labels (the schema value is lowercase — never show the raw enum to a friend).
const RISK_LABEL: Record<string, string> = {
  safe: "Safe",
  noticeable: "Noticeable",
  bold: "Bold",
};
// Hover copy (desktop) — the always-visible legend under the results covers mobile.
const PATH_TOOLTIP = "How adventurous the combo is: Reliable (safe, familiar) → Bridge → Stretch (more experimental).";
const RISK_TOOLTIP = "How much the look stands out: Safe (understated) → Noticeable → Bold (a statement).";

function OutfitCard({
  outfit,
  index,
  bindable,
  forcedItemId,
  onLike,
  onDislike,
  onExplain,
  onRegenerate,
  enrichStatus,
  onRetryEnrich,
}: {
  outfit: ShownOutfit;
  index: number;
  bindable: boolean;
  forcedItemId: string | null;
  onLike: () => void;
  onDislike: () => void;
  onExplain: () => void;
  onRegenerate: () => void;
  enrichStatus?: "saving" | "failed";
  onRetryEnrich: () => void;
}) {
  return (
    <div
      className={`p-5 border rounded-xl shadow-sm transition-colors ${
        outfit.feedback === "liked"
          ? "bg-green-50 border-green-200"
          : outfit.feedback === "disliked"
            ? "bg-red-50 border-red-200 opacity-70"
            : "bg-slate-50 border-slate-200"
      }`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span
            className="px-3 py-1 bg-slate-900 text-white text-sm font-medium rounded-full"
            title={outfit.optionPath ? PATH_TOOLTIP : undefined}
          >
            {(outfit.optionPath && OPTION_PATH_LABEL[outfit.optionPath]) ?? `Outfit ${index + 1}`}
          </span>
          {outfit.risk && (
            <span
              className={`px-2 py-1 text-xs font-semibold rounded-full ${RISK_BADGE[outfit.risk] ?? "bg-slate-100 text-slate-600"}`}
              title={RISK_TOOLTIP}
            >
              {RISK_LABEL[outfit.risk] ?? outfit.risk}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onRegenerate}
            className="px-3 py-1 bg-blue-100 text-blue-700 text-sm font-medium rounded-lg hover:bg-blue-200 flex items-center gap-1"
          >
            Regenerate
          </button>
          {bindable && !outfit.feedback && (
            <>
              <button onClick={onLike} className="px-3 py-1 bg-green-100 text-green-700 text-sm font-medium rounded-lg hover:bg-green-200 flex items-center gap-1">
                Like
              </button>
              <button onClick={onDislike} className="px-3 py-1 bg-red-100 text-red-700 text-sm font-medium rounded-lg hover:bg-red-200 flex items-center gap-1">
                Dislike
              </button>
            </>
          )}
          {outfit.feedback && (
            <span className={`px-3 py-1 text-sm font-medium rounded-lg ${outfit.feedback === "liked" ? "bg-green-200 text-green-800" : "bg-red-200 text-red-800"}`}>
              {outfit.feedback === "liked" ? "Liked" : "Disliked"}
            </span>
          )}
          {outfit.feedback === "disliked" &&
            (enrichStatus === "saving" ? (
              <span className="text-xs text-slate-400">Saving details…</span>
            ) : enrichStatus === "failed" ? (
              <button
                onClick={onRetryEnrich}
                className="text-xs text-amber-600 underline hover:text-amber-700 transition-colors"
              >
                Couldn&apos;t save the details — retry
              </button>
            ) : (
              <button
                onClick={onExplain}
                className="text-xs text-slate-500 underline hover:text-slate-700 transition-colors"
              >
                Tell us why?
              </button>
            ))}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        {sortDisplayItems(outfit.displayItems).map((item) => {
          const imgSrc = imageUrlFromPath(item.imageUrl);
          const isForced = forcedItemId != null && item.itemId === forcedItemId;
          const isChanged = outfit.styleMove?.changedItemIds?.includes(item.itemId);
          return (
            <div
              key={item.itemId}
              title={isForced ? "The piece this outfit is built around" : undefined}
              className={`bg-white rounded-lg border overflow-hidden ${
                isForced
                  ? "border-amber-300 ring-1 ring-amber-200"
                  : isChanged
                    ? "border-blue-300 ring-1 ring-blue-200"
                    : "border-slate-100"
              }`}
            >
              {imgSrc ? (
                <div className="h-40 w-full bg-slate-50 flex items-center justify-center p-2">
                  <img src={imgSrc} alt={item.name} className="max-h-full max-w-full object-contain" loading="lazy" />
                </div>
              ) : (
                <div className="flex h-40 w-full items-center justify-center bg-slate-50 text-xs text-slate-400">No photo</div>
              )}
              <div className="p-3">
                <p className="font-medium text-slate-900 text-sm truncate">{item.name ?? "Item"}</p>
                <p className="text-xs text-slate-500">{item.clothingType}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* StyleMove card body — "the one thing that made it work" (from candidates[candidateId]). */}
      {outfit.styleMove?.oneSentence && (
        <div className="rounded-lg bg-white border border-slate-200 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-500">
            {outfit.styleMove.moveType ? outfit.styleMove.moveType.replace(/_/g, " ") : "Style move"}
          </p>
          <p className="mt-1 text-sm text-slate-700">{outfit.styleMove.oneSentence}</p>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main component
// ============================================================================
function DashboardInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [signingOut, setSigningOut] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const uid = firebaseUser?.uid ?? null;

  const [occasion, setOccasion] = useState("");
  const [eventTimeBucket, setEventTimeBucket] = useState<EventTimeBucket>("now");
  const [customEventDateTime, setCustomEventDateTime] = useState("");
  const [result, setResult] = useState<RenderResult | null>(null);
  const [inFlight, setInFlight] = useState(false);
  const [error, setError] = useState("");

  // Rescue: a forced item launched from the wardrobe (?rescue=<id>&name=<name>).
  const [rescueItemId, setRescueItemId] = useState<string | null>(null);
  const [rescueItemName, setRescueItemName] = useState<string>("");

  const [geoCoords, setGeoCoords] = useState<{ lat: number; lon: number } | null>(null);

  const [feedbackModal, setFeedbackModal] = useState<{ outfit: ShownOutfit; index: number } | null>(null);
  const [regenModal, setRegenModal] = useState<{ outfit: ShownOutfit; index: number } | null>(null);

  // H100 — the locks last submitted on this lineage's re-roll. The server stores controls on the
  // snapshot row but never returns them in the browser projection, so the client (the author of
  // every re-roll's controls) is the one place that can remember them. A ref, not state: it is read
  // only at modal-open and persist time, and a ref can be updated synchronously inside runRender's
  // result callback so the persisted copy is never one re-roll stale.
  const activeLocksRef = useRef<string[]>([]);

  // Location is OPT-IN and primed. Calling getCurrentPosition on mount fired the browser's native
  // permission prompt with no in-app explanation — the first thing a brand-new friend saw was an OS
  // dialog asking for their location from an app they'd just signed into, which reads as a reason to
  // bail. Now we say why first and only ask when they tap. Denial stays graceful: geoCoords is purely
  // additive to the render (startGenerate spreads lat/lon only when present), so declining costs the
  // weather signal and nothing else.
  // "unsupported" is distinct from "denied": a browser with no geolocation API can never succeed, so
  // offering it a "Try again" would be a button that provably cannot work.
  const [geoStatus, setGeoStatus] = useState<
    "idle" | "asking" | "granted" | "denied" | "unsupported"
  >("idle");

  const requestGeo = useCallback(() => {
    if (!navigator?.geolocation) {
      setGeoStatus("unsupported");
      return;
    }
    setGeoStatus("asking");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        setGeoStatus("granted");
      },
      () => setGeoStatus("denied"),
      // Without a timeout, a prompt the friend swipes away (some mobile browsers never invoke either
      // callback) strands the button on "Waiting for permission…" with no way back. The error arm
      // fires on TIMEOUT too, so the UI always lands somewhere retryable.
      { timeout: 15000, maximumAge: 10 * 60 * 1000 },
    );
  }, []);

  // Resume an EXISTING grant. Priming the ask must not cost the weather signal on every later
  // visit: a friend who already granted would otherwise have to re-tap the link each session or
  // silently lose it. Querying the Permissions API first keeps the no-cold-prompt property — we
  // only call getCurrentPosition when the answer is already "granted", which shows no prompt.
  // "prompt"/"denied" fall through to the button, and browsers without the API (older Safari) keep
  // the manual path.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const perms = navigator.permissions;
        if (!perms?.query) return;
        const status = await perms.query({ name: "geolocation" as PermissionName });
        if (!cancelled && status.state === "granted") requestGeo();
      } catch {
        // Unsupported/blocked query — the explicit button remains the path.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [requestGeo]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => setFirebaseUser(user));
    return () => unsub();
  }, []);

  // Closet size, for the empty-closet signpost below. `null` means NOT YET KNOWN (loading, or the
  // fetch failed) and is deliberately distinct from 0 — the CTA renders only on a confirmed 0, so an
  // existing friend never gets a flash of "add your clothes first". Reuses the plain wardrobe GET
  // rather than adding a count endpoint: a friend closet is 15-50 rows of small scalars (no image
  // bytes — items carry an imagePath pointer), so one best-effort request on mount is cheaper than a
  // new API surface to keep honest.
  const [closetCount, setClosetCount] = useState<number | null>(null);
  useEffect(() => {
    if (!firebaseUser) {
      setClosetCount(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const token = await firebaseUser.getIdToken();
        const res = await fetch("/api/wardrobe", { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return;
        const data = (await res.json()) as { items?: unknown[] };
        if (!cancelled && Array.isArray(data.items)) setClosetCount(data.items.length);
      } catch {
        // Best-effort: staying at `null` just means no signpost, never a wrong one.
      }
    };
    void load();
    // Re-check when the page is shown again. The signpost's CTA is a plain <a> to /wardrobe (a full
    // document navigation), so a friend who taps it, adds their clothes, and hits Back gets the page
    // restored from the bfcache with React state intact and no effect re-run — leaving "First: add a
    // few clothes" on screen for a closet that is no longer empty. `pageshow` fires on bfcache
    // restore (where `visibilitychange` does not), so both are needed.
    const recheck = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener("pageshow", recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      cancelled = true;
      window.removeEventListener("pageshow", recheck);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, [firebaseUser]);

  // Read a rescue launch from the wardrobe (?rescue=<id>).
  useEffect(() => {
    const r = searchParams.get("rescue");
    if (r) {
      setRescueItemId(r);
      setRescueItemName(searchParams.get("name") ?? "");
    }
  }, [searchParams]);

  // Restore persisted render on return + resume any un-cleared pending envelope (F10).
  useEffect(() => {
    if (!uid) return;
    const saved = readJSON<PersistedDashboard>(DASHBOARD_KEY(uid));
    if (saved?.result) {
      setResult(saved.result);
      setOccasion(saved.occasion ?? "");
      activeLocksRef.current = saved.activeLockedItemIds ?? [];
    }
    const pending = readJSON<PendingEnvelope>(PENDING_KEY(uid));
    if (pending) {
      resumePending(uid, pending);
    } else if (saved?.result && firebaseUser) {
      // No render is resuming (which would replace the result), so reconcile the restored chips.
      // Pass the SAVED occasion so a re-persist round-trips it exactly (the callback's closure
      // `occasion` is still "" here — setOccasion above hasn't flushed for this async continuation).
      void reconcileFeedbackFromServer(firebaseUser, saved.result, saved.occasion ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  async function handleLogout() {
    try {
      setSigningOut(true);
      if (uid) {
        removeKey(DASHBOARD_KEY(uid));
        removeKey(PENDING_KEY(uid));
      }
      await clearSessionCookie(); // revoke the image-serving session cookie on logout (§I)
      await signOut(auth);
      localStorage.removeItem("userId"); // legacy key — no longer written; clear leftovers
      router.push("/");
    } catch (err) {
      console.error("Error signing out:", err);
      setSigningOut(false);
    }
  }

  const persistResult = useCallback(
    // `occasionForResult` lets runRender persist the ENVELOPE's frozen occasion. The state fallback
    // (feedback marks) is fine there, but on a resumed render the closure predates the sessionStorage
    // restore — persisting state `occasion` would overwrite the saved occasion with "".
    (r: RenderResult, occasionForResult?: string) => {
      if (!uid) return;
      writeJSON(DASHBOARD_KEY(uid), {
        occasion: occasionForResult ?? occasion,
        result: r,
        activeLockedItemIds: activeLocksRef.current,
      } satisfies PersistedDashboard);
    },
    [uid, occasion],
  );

  // Reconcile a restored render's feedback chips against server latest-state (audit #2/#4): History
  // curation (flip/remove) done elsewhere would otherwise leave a STALE "disliked" chip whose lingering
  // "Tell us why?" posts a fresh rejected that supersedes the flip (corpus corruption), or hide the
  // re-rate buttons on a removed card. Best-effort + mount-only, and it applies ONLY if the user hasn't
  // touched the restored result yet (identity guard) so it can never clobber a fresh in-session mark.
  const reconcileFeedbackFromServer = useCallback(
    async (user: FirebaseUser, baseResult: RenderResult, savedOccasion: string) => {
      try {
        const token = await user.getIdToken();
        const res = await fetch("/api/interactions", { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return;
        const data = (await res.json()) as { interactions?: HistoryActionRow[] };
        const actionByKey = buildActionByKey(data.interactions);
        const { shown, changed } = reconcileShownFeedback(baseResult.shown, actionByKey);
        if (!changed) return;
        const next = { ...baseResult, shown };
        setResult((prev) => {
          if (prev !== baseResult) return prev; // user already interacted — never clobber a live mark
          // Re-persist the reconciled chips, round-tripping the SAVED occasion verbatim (never the
          // closure's stale "" — that would blank the echoed occasion on the next restore).
          persistResult(next, savedOccasion);
          return next;
        });
      } catch {
        // best-effort — a failed reconcile leaves the restored marks, no worse than before the fix
      }
    },
    [persistResult],
  );

  /** Issue a render (daily/rescue root OR a re-roll) under an already-persisted envelope. */
  const runRender = useCallback(
    async (
      user: FirebaseUser,
      envelope: PendingEnvelope,
      body: Record<string, unknown>,
      // Return `false` to REJECT the result: it is neither set as state nor persisted (the
      // re-roll path uses this to keep the outfits on screen when a re-roll degrades).
      onResult: (r: RenderResult) => void | boolean,
    ) => {
      const userUid = user.uid;
      try {
        const token = await user.getIdToken();
        const res = await fetch("/api/recommend", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => null);

        if (!res.ok) {
          // A stable 4xx/409 (conflict, forced-item-unavailable, malformed) — terminal for this action.
          removeKey(PENDING_KEY(userUid));
          // The recommend route's error envelope is { error: { code, message } } — read the nested
          // fields, NEVER the whole `error` OBJECT (setting it as `error` state would render an object
          // as a React child and crash the page).
          const env = (data as { error?: { code?: string; message?: string } } | null) ?? {};
          const codeStr = env.error?.code ?? "";
          if (codeStr === "forced_item_unavailable") {
            setError("That item is no longer in your closet — pick another to rescue.");
            setRescueItemId(null);
          } else if (codeStr === "request_id_conflict") {
            setError("That request was already used for a different outfit. Please generate again.");
          } else {
            // F14 — map to friendly copy by CODE; never echo the raw server message (the structural-lock
            // rejects like "more than one lock occupies the top slot" are engineer-toned by design).
            setError(recommendErrorMessage(codeStr));
          }
          return;
        }

        // A 200 whose body did not parse arrives here as `data === null`, and falling through set
        // `setResult(null)` AND `persistResult(null, …)` — so the dashboard dropped back to its
        // blank "Click Get Recommendations" screen with no message, and the last good saved render
        // was overwritten with nothing. A completed, paid request read as "nothing happened".
        // Say so instead. The envelope cleanup below still runs, unchanged — this deliberately does
        // NOT try to make the render recoverable, which would need retry state this file should not
        // grow. Recovering it is written up as a hole instead.
        if (data === null || typeof data !== "object") {
          removeKey(PENDING_KEY(userUid));
          setError("We couldn't read the reply. Please generate again.");
          return;
        }

        const rendered = data as RenderResult;
        const accepted = onResult(rendered);
        if (accepted !== false) persistResult(rendered, envelope.lensSummary.occasion);
        // Hydrated success (bindable render) or a completed degraded render — either way the render
        // is done, so the envelope is cleared (a degraded render wrote no snapshot to replay).
        removeKey(PENDING_KEY(userUid));
      } catch {
        // A dropped response — KEEP the envelope so a reload resumes with the SAME requestId.
        // Says "if", not "you won't lose your place". The old wording was an unconditional promise
        // this code cannot keep: the resume depends on the F10 envelope having reached
        // sessionStorage, and `writeJSON` swallows a refusal (private mode, blocked storage), so a
        // friend could reload on the strength of that sentence and lose a render you paid for.
        // Phrased so it is true in BOTH worlds, which needs no new state to decide between them.
        setError("The connection dropped. Try reloading — if that outfit finished, it'll come back.");
      } finally {
        setInFlight(false);
      }
    },
    [persistResult],
  );

  /** Resume an un-cleared pending envelope after a reload/lost response (§C.4 F10). Re-sends the
   *  SAME requestId + frozen Lens: a completed render replays the winner (no second spend); an
   *  in-flight one re-calls (at most one extra generation, dropped by the index). */
  const resumePending = useCallback(
    (userUid: string, envelope: PendingEnvelope) => {
      const user = auth.currentUser;
      if (!user || user.uid !== userUid) return;
      setInFlight(true);
      setError("");
      const body =
        envelope.intent === "rescue_item" && envelope.parentSnapshotId == null
          ? buildRootBody(envelope)
          : envelope.parentSnapshotId != null
            ? {
                requestId: envelope.requestId,
                parentSnapshotId: envelope.parentSnapshotId,
                controls: envelope.normalizedControls,
              }
            : buildRootBody(envelope);
      void runRender(user, envelope, body, (r) => {
        // Same no-wipe rule as submitRegenerate: a resumed RE-ROLL that comes back degraded/empty
        // must not replace (or overwrite the persisted copy of) the outfits restored on reload.
        if (envelope.parentSnapshotId != null && isEmptyDegradedRender(r)) {
          setError(emptyStateMessage(r.flags));
          return false;
        }
        // The arriving render is FOR the envelope's frozen occasion — fill the input when it's
        // empty (a root resume has no saved dashboard to restore it from, and later feedback marks
        // persist the state occasion). Never clobber text the user typed during the resume window.
        setOccasion((prev) => prev || envelope.lensSummary.occasion);
        // H100 — a resumed re-roll carries the lineage's locks in its envelope; a root resume
        // starts a fresh lineage. Before setResult, so runRender's persist sees the fresh value.
        activeLocksRef.current =
          envelope.parentSnapshotId != null ? envelope.normalizedControls.lockedItemIds : [];
        setResult(r);
      });
    },
    [runRender],
  );

  const startGenerate = useCallback(async () => {
    if (!firebaseUser || !uid) {
      setError("Please sign in to get recommendations.");
      return;
    }
    if (!occasion.trim()) {
      setError("Describe the event or context to get recommendations.");
      return;
    }
    if (inFlight) return; // Generate is disabled while a render is in flight

    const requestId = newRequestId();
    const lensSummary: LensSummary = {
      occasion,
      forcedItemId: rescueItemId ?? null,
      ...(geoCoords ? { lat: geoCoords.lat, lon: geoCoords.lon } : {}),
      ...(eventTimeBucket !== "now" ? { eventTimeISO: getEventTimeISO(eventTimeBucket, customEventDateTime) } : {}),
    };
    const envelope: PendingEnvelope = {
      requestId,
      intent: rescueItemId ? "rescue_item" : "daily",
      parentSnapshotId: null,
      normalizedControls: { lockedItemIds: [], dislikedItemIds: [] },
      lensSummary,
    };

    setInFlight(true);
    setError("");
    setResult(null);
    setFeedbackModal(null);
    setRegenModal(null);
    // H100 — a root render starts a fresh lineage (the §C.3 invariant: a root carries no controls),
    // so any locks from the previous lineage end here.
    activeLocksRef.current = [];
    // Persist the envelope BEFORE the fetch (survives a reload/lost response).
    writeJSON(PENDING_KEY(uid), envelope);
    await runRender(firebaseUser, envelope, buildRootBody(envelope), (r) => setResult(r));
  }, [firebaseUser, uid, occasion, inFlight, rescueItemId, geoCoords, eventTimeBucket, customEventDateTime, runRender]);

  const submitRegenerate = useCallback(
    async (controls: NormalizedControls) => {
      if (!firebaseUser || !uid || !regenModal || inFlight) return;
      const parentSnapshotId = regenModal.outfit.snapshotId;
      const requestId = newRequestId(); // a re-roll is a new Generate action → new requestId
      const envelope: PendingEnvelope = {
        requestId,
        intent: "daily", // real intent is derived server-side from the parent; unused on a re-roll
        parentSnapshotId,
        normalizedControls: controls,
        lensSummary: { occasion },
      };
      setInFlight(true);
      setError("");
      writeJSON(PENDING_KEY(uid), envelope);
      await runRender(
        firebaseUser,
        envelope,
        { requestId, parentSnapshotId, controls },
        (r) => {
          // A degraded/empty re-roll (rate-limited, outage, nothing buildable under the locks)
          // must NOT wipe the outfits the user is looking at — keep the current result and show
          // the reason in the modal instead. The modal stays open so they can adjust and retry.
          if (isEmptyDegradedRender(r)) {
            setError(emptyStateMessage(r.flags));
            return false; // reject: state + persisted copy keep the previous render
          }
          // H100 — remember the accepted re-roll's locks so the NEXT regenerate opens with them
          // still held. Set before setResult so runRender's persist writes the fresh value; a
          // rejected (degraded) re-roll above keeps the previous locks, matching the kept render.
          activeLocksRef.current = controls.lockedItemIds;
          setResult(r);
          setRegenModal(null);
        },
      );
    },
    [firebaseUser, uid, regenModal, inFlight, occasion, runRender],
  );

  // --- Feedback binds {snapshotId, candidateId} (never itemIds). ---
  const postFeedback = useCallback(
    async (
      outfit: Pick<ShownOutfit, "snapshotId" | "candidateId">,
      action: "accepted" | "rejected",
      extra?: { perItemFeedback?: PerItemFeedback[]; codes?: string[] },
    ): Promise<boolean> => {
      if (!firebaseUser) return false;
      try {
        const token = await firebaseUser.getIdToken();
        const res = await fetch("/api/interactions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            snapshotId: outfit.snapshotId,
            candidateId: outfit.candidateId,
            action,
            ...(extra?.perItemFeedback?.length ? { perItemFeedback: extra.perItemFeedback } : {}),
            ...(extra?.codes?.length ? { feedbackReason: { codes: extra.codes } } : {}),
          }),
        });
        return res.ok;
      } catch {
        return false;
      }
    },
    [firebaseUser],
  );

  const markFeedback = useCallback(
    (index: number, feedback: "liked" | "disliked") => {
      setResult((prev) => {
        if (!prev) return prev;
        const shown = prev.shown.map((o, i) => (i === index ? { ...o, feedback } : o));
        const next = { ...prev, shown };
        persistResult(next);
        return next;
      });
    },
    [persistResult],
  );

  const handleLike = async (index: number) => {
    const outfit = result?.shown[index];
    if (!outfit) return;
    markFeedback(index, "liked");
    const ok = await postFeedback(outfit, "accepted");
    if (!ok) {
      markFeedbackClear(index);
      setError("Couldn't save your like. Please try again.");
    }
  };

  const markFeedbackClear = (index: number) =>
    setResult((prev) => {
      if (!prev) return prev;
      const shown = prev.shown.map((o, i) => (i === index ? { ...o, feedback: undefined } : o));
      const next = { ...prev, shown };
      persistResult(next);
      return next;
    });

  // One-tap dislike — symmetric with Like (§Q4c): posts 'rejected' immediately so a dislike costs the
  // same as a like. The old flow forced the "what didn't work?" modal before any dislike registered,
  // making dislikes more expensive than likes and skewing the accept/reject balance the M6 re-measure
  // trains on toward the positive. Now the reasons are an optional follow-up (below), not a toll.
  const handleDislike = async (index: number) => {
    const outfit = result?.shown[index];
    if (!outfit) return;
    markFeedback(index, "disliked");
    const ok = await postFeedback(outfit, "rejected");
    if (!ok) {
      markFeedbackClear(index);
      setError("Couldn't save your feedback. Please try again.");
    }
  };

  // D-3 — durable dislike-reason enrich: the reasons are HELD and retried on failure (per-card
  // affordance) instead of silently lost. Attaching them as a second same-action row is safe —
  // per-candidate latest-state (§23-H61) collapses it onto the one-tap, so it is never double-counted,
  // and a retried duplicate is harmless. See lib/useDislikeEnrich for the in-session-only rationale.
  const { saveDislikeReasons, retryEnrich, statusFor } = useDislikeEnrich(
    useCallback(
      (binding, data) => postFeedback(binding, "rejected", data),
      [postFeedback],
    ),
  );

  // Optional "tell us why?" follow-up to a dislike. The one-tap already recorded a reasonless
  // 'rejected', so closing the modal here loses nothing — the reasons are held by the enrich hook.
  const handleSaveDislike = async (data: { perItemFeedback: PerItemFeedback[]; codes: string[] }) => {
    if (!feedbackModal) return;
    const { outfit, index } = feedbackModal;
    setFeedbackModal(null);
    markFeedback(index, "disliked");
    await saveDislikeReasons({ snapshotId: outfit.snapshotId, candidateId: outfit.candidateId }, data);
  };

  const bindable = Boolean(result?.bindable);
  const shown = result?.shown ?? [];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold tracking-tight">Home</h1>
        <button
          onClick={handleLogout}
          disabled={signingOut}
          className="rounded-lg bg-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-300 disabled:opacity-50"
        >
          {signingOut ? "Signing out..." : "Log Out"}
        </button>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="text-xl font-semibold tracking-tight">Get Outfit Recommendations</h2>
        <p className="mt-1 text-sm text-slate-600">
          The stylist uses your wardrobe, the occasion, and the weather to suggest outfits.
        </p>

        {/* Empty-closet signpost. A brand-new friend lands here first and there is nothing yet to
            build from, so point at the wardrobe BEFORE they spend a Generate on an empty closet.
            This is the PROACTIVE half; the reactive empty-state (below, on a returned render) stays
            as the catch-net for closets that are non-empty but unbuildable. */}
        {closetCount === 0 && (
          <div className="mt-4 rounded-lg border border-slate-300 bg-slate-50 p-4 text-sm">
            <p className="font-medium text-slate-900">First: add a few clothes.</p>
            <p className="mt-1 text-slate-600">
              The stylist builds outfits out of pieces you own, so it needs your closet before it can
              suggest anything. A top and a bottom — or a dress — is enough to build something; a
              handful of each plus shoes gives you real options.
            </p>
            <a
              href="/wardrobe"
              className="mt-3 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              Add your clothes
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </a>
          </div>
        )}

        {/* The rescue teaser presupposes they HAVE a piece they can't style — false premise at 0
            items, and it would compete with the signpost above. */}
        {!rescueItemId && closetCount !== 0 && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            Got a piece you never quite know how to wear?{" "}
            <a href="/wardrobe" className="font-medium underline hover:text-amber-900">
              Pick it from your wardrobe
            </a>{" "}
            and the stylist will build every outfit around it.
          </div>
        )}

        {rescueItemId && (
          <div className="mt-4 flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
            <span>
              Building an outfit around <strong>{rescueItemName || "your item"}</strong>. Every suggestion will include it.
            </span>
            <button
              onClick={() => {
                setRescueItemId(null);
                setRescueItemName("");
              }}
              className="ml-3 rounded-md px-2 py-1 text-blue-700 hover:bg-blue-100"
            >
              Clear
            </button>
          </div>
        )}

        <div className="mt-4 flex flex-col gap-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600 mb-1">Event description</label>
            <textarea
              value={occasion}
              onChange={(e) => setOccasion(e.target.value)}
              rows={3}
              maxLength={MAX_OCCASION_CHARS}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 placeholder:text-slate-400"
              placeholder="e.g. Outdoor brunch with friends in early spring, smart casual but comfortable. Might get windy."
            />
            <div className="mt-1 flex justify-between text-[11px] text-slate-500">
              <span>Tell the stylist the event, the vibe, and any constraints (e.g. it might rain, no heels, keep it warm).</span>
              <span>{occasion.length}/{MAX_OCCASION_CHARS}</span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600 mb-1">When is the event?</label>
            <div className="flex gap-2 flex-wrap">
              {([
                { value: "now", label: "Now" },
                { value: "later_today", label: "Later today" },
                { value: "tomorrow", label: "Tomorrow" },
                { value: "custom", label: "Pick date/time" },
              ] as { value: EventTimeBucket; label: string }[]).map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => setEventTimeBucket(value)}
                  className={`px-4 py-2 text-sm font-medium rounded-lg ${eventTimeBucket === value ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {eventTimeBucket === "custom" && (
              <input
                type="datetime-local"
                value={customEventDateTime}
                onChange={(e) => setCustomEventDateTime(e.target.value)}
                min={new Date().toISOString().slice(0, 16)}
                max={new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16)}
                className="mt-2 px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500"
              />
            )}
          </div>

          {/* Primed location ask — the in-app "why" that the native prompt can't give. */}
          <div className="text-xs text-slate-500">
            {geoStatus === "granted" ? (
              <span>Using your location for local weather.</span>
            ) : geoStatus === "unsupported" ? (
              // No retry offered — this browser has no geolocation API, so a "Try again" would be a
              // button that can never succeed. Give the same compensating advice as the denial.
              <span>
                This browser can&apos;t share a location, so outfits are picked without today&apos;s
                weather. Mention it in the event description (e.g. &quot;it&apos;s cold out&quot;) and
                the stylist will factor it in.
              </span>
            ) : geoStatus === "denied" ? (
              <span>
                No location — outfits are picked without today&apos;s weather. Mention it in the event
                description (e.g. &quot;it&apos;s cold out&quot;) and the stylist will factor it in.{" "}
                <button
                  type="button"
                  onClick={requestGeo}
                  className="font-medium text-slate-700 underline hover:text-slate-900"
                >
                  Try again
                </button>
              </span>
            ) : (
              <span>
                Outfits get better with the weather where you are.{" "}
                <button
                  type="button"
                  onClick={requestGeo}
                  disabled={geoStatus === "asking"}
                  className="font-medium text-slate-700 underline hover:text-slate-900 disabled:opacity-50"
                >
                  {geoStatus === "asking" ? "Waiting for permission…" : "Use my location"}
                </button>{" "}
                — your browser will ask first, and it&apos;s only used to look up local weather.
              </span>
            )}
          </div>

          <button
            onClick={startGenerate}
            disabled={inFlight}
            className="self-start px-6 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 disabled:bg-slate-400 disabled:cursor-not-allowed"
          >
            {inFlight ? "Generating…" : "Get Recommendations"}
          </button>
        </div>

        {error && <div className="mt-4 p-4 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}

        {/* In-flight feedback — a warm generate measures ~3s (the gpt-5.4-mini call); only the rare
            cold-deploy first hit is slow. No specific-duration copy (it was wrong twice) — the spinner
            conveys "working" for however long it takes, so a friend never sees a frozen button (F4). */}
        {inFlight && shown.length === 0 && (
          <div className="mt-6 mx-auto w-full max-w-3xl p-6 bg-slate-50 rounded-lg text-center border border-slate-200">
            <div className="inline-flex items-center gap-3 text-slate-600">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" aria-hidden="true" />
              <span>Putting looks together…</span>
            </div>
            <p className="mt-2 text-sm text-slate-500">The stylist is picking outfits from your closet — usually just a few seconds.</p>
          </div>
        )}

        {/* Results — §6.5 cards, or the degraded/empty state (no feedback controls when !bindable). */}
        {result && shown.length > 0 && (
          <div className="mt-6 space-y-4">
            {result.generationIndex != null && result.generationIndex > 0 && (
              <p className="text-xs text-slate-500">Regenerated outfit (variation {result.generationIndex})</p>
            )}
            {/* F16 — a partial render (fewer looks than usual) must still say WHY, not silently show 1–2. */}
            {partialRenderHint(result.flags, shown.length) && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                {partialRenderHint(result.flags, shown.length)}
              </div>
            )}
            {/* Legend — the badges are opaque without it on mobile (no hover for the tooltips). */}
            <p className="text-xs text-slate-500 leading-5">
              Each outfit is tagged two ways: <span className="font-medium text-slate-700">Reliable → Bridge → Stretch</span> (how
              safe vs. adventurous the combo is) and <span className="font-medium text-slate-700">Safe / Noticeable / Bold</span> (how
              much the look stands out).
            </p>
            {shown.map((outfit, index) => (
              <OutfitCard
                key={`${outfit.snapshotId}:${outfit.candidateId}`}
                outfit={outfit}
                index={index}
                bindable={bindable}
                forcedItemId={rescueItemId}
                onLike={() => handleLike(index)}
                onDislike={() => handleDislike(index)}
                onExplain={() => setFeedbackModal({ outfit, index })}
                enrichStatus={statusFor(outfit)}
                onRetryEnrich={() => retryEnrich({ snapshotId: outfit.snapshotId, candidateId: outfit.candidateId })}
                onRegenerate={() => {
                  setError("");
                  setRegenModal({ outfit, index });
                }}
              />
            ))}
          </div>
        )}

        {result && shown.length === 0 && !inFlight && (
          <div className="mt-6 mx-auto w-full max-w-3xl p-6 bg-slate-50 rounded-lg text-center border border-slate-200">
            <p className="text-slate-600">{emptyStateMessage(result.flags)}</p>
            {/* F10 — a healthy-empty dead-end must offer the way out (the wardrobe), not just
                describe it. Both empty shapes qualify: notEnoughItems AND the post-GPT
                zero-survivor insufficient state (its hint also says "add more pieces"). */}
            {(result.flags?.notEnoughItems || result.flags?.insufficientAfterGeneration) && (
              <a
                href="/wardrobe"
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
              >
                Go to your wardrobe
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </a>
            )}
          </div>
        )}

        {!result && !inFlight && !error && (
          <div className="mt-6 mx-auto w-full max-w-3xl p-6 bg-slate-50 rounded-lg text-center">
            <p className="text-slate-600">Click &quot;Get Recommendations&quot; to see outfit suggestions.</p>
            <p className="mt-2 text-sm text-slate-500">The more you like/dislike, the more the recommendations adjust to you.</p>
          </div>
        )}
      </div>

      {feedbackModal && (
        <FeedbackModal outfit={feedbackModal.outfit} onClose={() => setFeedbackModal(null)} onSave={handleSaveDislike} />
      )}
      {regenModal && (
        <RegenerateModal
          outfit={regenModal.outfit}
          onClose={() => !inFlight && setRegenModal(null)}
          onRegenerate={submitRegenerate}
          isRegenerating={inFlight}
          error={error || undefined}
          // H100 — intersect with THIS outfit's items: the modal only renders toggles for what is
          // on screen, so a lock for an absent item would be invisible, un-clearable state. (Locks
          // are a hard constraint — every child candidate contains them — so this normally drops
          // nothing.)
          initialLockedItemIds={activeLocksRef.current.filter((id) =>
            regenModal.outfit.displayItems.some((it) => it.itemId === id),
          )}
        />
      )}
    </div>
  );
}

/** The root (first-render) request body from a pending envelope's frozen Lens (§C.4 F10). The frozen
 *  INPUTS (occasion + geo + time) are re-sent verbatim on a resume, so a same-second reload replays
 *  deterministically. Residual: when geo is present the route re-resolves weather live, so a reload
 *  that straddles a weather-bucket boundary could false-409 the replay — it degrades to a graceful
 *  "generate again", not a lost render (a fully-frozen resolved bucket is a post-M5 nicety). */
function buildRootBody(envelope: PendingEnvelope): Record<string, unknown> {
  const l = envelope.lensSummary;
  return {
    requestId: envelope.requestId,
    occasion: l.occasion,
    ...(l.forcedItemId ? { forcedItemId: l.forcedItemId } : {}),
    ...(l.location ? { location: l.location } : {}),
    ...(l.lat != null && l.lon != null ? { lat: l.lat, lon: l.lon } : {}),
    ...(l.eventTimeISO ? { eventTimeISO: l.eventTimeISO } : {}),
  };
}

export default function Home() {
  return (
    <Suspense fallback={<div className="p-8 text-slate-500">Loading…</div>}>
      <DashboardInner />
    </Suspense>
  );
}
