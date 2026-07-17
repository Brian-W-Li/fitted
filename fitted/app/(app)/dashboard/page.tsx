"use client";

import { auth } from "@/lib/firebaseClient";
import { signOut, onAuthStateChanged, type User as FirebaseUser } from "firebase/auth";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect, useCallback, Suspense } from "react";
import { resolveImageSrc } from "@/lib/imageUrl";
import { clearSessionCookie } from "@/lib/sessionCookie";
import { MAX_OCCASION_CHARS } from "@/lib/mlRequestAdapter";

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

/** Machine-code reason hints (all three healthy flags false) → friendly copy. An unrecognized code
 *  falls to generic error copy — the client-side default the plan requires (G4/§A reasonHint). */
const MACHINE_REASON_COPY: Record<string, string> = {
  service_unavailable: "The stylist is temporarily unavailable. Please try again in a moment.",
  contract_invalid: "We couldn't build a request from that input. Try rephrasing the occasion.",
  // The ceiling is GLOBAL across users (12 renders/min at one service machine) — often someone
  // else's traffic, so never blame the user's pace.
  rate_limited: "The stylist is busy right now — try again in a few seconds.",
  // auth_failed here is the SERVICE key handshake failing (an ops misconfig), not the user's
  // session — "sign in again" would send users on a futile loop.
  auth_failed: "The stylist is temporarily unavailable. Please try again later.",
  engine_failure: "Something went wrong generating outfits. Please try again.",
};

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

/** Turn a render result into the user-facing empty-state message (prose hint or mapped code). */
function emptyStateMessage(result: RenderResult): string {
  // Defensive: a result restored from sessionStorage may predate a shape change — never crash.
  const flags = result.flags ?? ({} as RenderResult["flags"]);
  const healthy = flags.notEnoughItems || flags.insufficientAfterGeneration;
  if (healthy && flags.reasonHint) return flags.reasonHint; // prose register — genuine advice
  if (flags.reasonHint && MACHINE_REASON_COPY[flags.reasonHint]) return MACHINE_REASON_COPY[flags.reasonHint];
  if (flags.notEnoughItems) return "Add a few more items to your closet so we can build an outfit.";
  return "No outfits this time. Try adjusting the occasion, or add more to your closet.";
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
}: {
  outfit: ShownOutfit;
  onClose: () => void;
  onRegenerate: (controls: NormalizedControls) => void;
  isRegenerating: boolean;
  error?: string;
}) {
  const [locked, setLocked] = useState<Set<string>>(new Set());
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
function OutfitCard({
  outfit,
  index,
  bindable,
  onLike,
  onDislike,
  onRegenerate,
}: {
  outfit: ShownOutfit;
  index: number;
  bindable: boolean;
  onLike: () => void;
  onDislike: () => void;
  onRegenerate: () => void;
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
          <span className="px-3 py-1 bg-slate-900 text-white text-sm font-medium rounded-full">Outfit {index + 1}</span>
          {outfit.risk && (
            <span className={`px-2 py-1 text-xs font-semibold rounded-full ${RISK_BADGE[outfit.risk] ?? "bg-slate-100 text-slate-600"}`}>
              {outfit.risk}
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
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        {sortDisplayItems(outfit.displayItems).map((item) => {
          const imgSrc = imageUrlFromPath(item.imageUrl);
          const isChanged = outfit.styleMove?.changedItemIds?.includes(item.itemId);
          return (
            <div key={item.itemId} className={`bg-white rounded-lg border overflow-hidden ${isChanged ? "border-blue-300 ring-1 ring-blue-200" : "border-slate-100"}`}>
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

  useEffect(() => {
    if (!navigator?.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setGeoCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => {},
    );
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => setFirebaseUser(user));
    return () => unsub();
  }, []);

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
    }
    const pending = readJSON<PendingEnvelope>(PENDING_KEY(uid));
    if (pending) resumePending(uid, pending);
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
    (r: RenderResult) => {
      if (!uid) return;
      writeJSON(DASHBOARD_KEY(uid), { occasion, result: r } satisfies PersistedDashboard);
    },
    [uid, occasion],
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
            setError(env.error?.message ?? "Couldn't generate outfits. Please try again.");
          }
          return;
        }

        const rendered = data as RenderResult;
        const accepted = onResult(rendered);
        if (accepted !== false) persistResult(rendered);
        // Hydrated success (bindable render) or a completed degraded render — either way the render
        // is done, so the envelope is cleared (a degraded render wrote no snapshot to replay).
        removeKey(PENDING_KEY(userUid));
        void envelope;
      } catch {
        // A dropped response — KEEP the envelope so a reload resumes with the SAME requestId.
        setError("The connection dropped. Reload to resume — you won't lose your place.");
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
        if (envelope.parentSnapshotId != null && !r.bindable && (r.shown?.length ?? 0) === 0) {
          setError(emptyStateMessage(r));
          return false;
        }
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
          if (!r.bindable && (r.shown?.length ?? 0) === 0) {
            setError(emptyStateMessage(r));
            return false; // reject: state + persisted copy keep the previous render
          }
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
      outfit: ShownOutfit,
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

  const handleSaveDislike = async (data: { perItemFeedback: PerItemFeedback[]; codes: string[] }) => {
    if (!feedbackModal) return;
    const { outfit, index } = feedbackModal;
    setFeedbackModal(null);
    markFeedback(index, "disliked");
    const ok = await postFeedback(outfit, "rejected", data);
    if (!ok) {
      markFeedbackClear(index);
      setError("Couldn't save your feedback. Please try again.");
    }
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
          Our AI stylist uses your wardrobe, the occasion, and the weather to suggest outfits.
        </p>

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
              <span>Tell the AI what the event is, the vibe, and any constraints.</span>
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

          <button
            onClick={startGenerate}
            disabled={inFlight}
            className="self-start px-6 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 disabled:bg-slate-400 disabled:cursor-not-allowed"
          >
            {inFlight ? "Generating…" : "Get Recommendations"}
          </button>
        </div>

        {error && <div className="mt-4 p-4 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}

        {/* Results — §6.5 cards, or the degraded/empty state (no feedback controls when !bindable). */}
        {result && shown.length > 0 && (
          <div className="mt-6 space-y-4">
            {result.generationIndex != null && result.generationIndex > 0 && (
              <p className="text-xs text-slate-500">Regenerated outfit (variation {result.generationIndex})</p>
            )}
            {shown.map((outfit, index) => (
              <OutfitCard
                key={`${outfit.snapshotId}:${outfit.candidateId}`}
                outfit={outfit}
                index={index}
                bindable={bindable}
                onLike={() => handleLike(index)}
                onDislike={() => setFeedbackModal({ outfit, index })}
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
            <p className="text-slate-600">{emptyStateMessage(result)}</p>
          </div>
        )}

        {!result && !inFlight && !error && (
          <div className="mt-6 mx-auto w-full max-w-3xl p-6 bg-slate-50 rounded-lg text-center">
            <p className="text-slate-600">Click &quot;Get Recommendations&quot; to see outfit suggestions.</p>
            <p className="mt-2 text-sm text-slate-500">The more you like/dislike, the smarter the recommendations become.</p>
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
