"use client";

import { auth } from "@/lib/firebaseClient";
import { signOut, onAuthStateChanged, type User as FirebaseUser } from "firebase/auth";
import { useRouter } from "next/navigation";
import { useState, useEffect, useCallback } from "react";

// ============================================================================
// Types
// ============================================================================

interface OutfitItem {
  id: string;
  name: string;
  category: string;
  subCategory?: string;
  layerRole?: string;
  colors: string[];
  imagePath?: string;
  isLocked?: boolean;
}

interface Outfit {
  itemIds: string[];
  items: OutfitItem[];
  confidence: number;
  reason: string;
  feedback?: "liked" | "disliked";
}

interface EnvironmentContext {
  temperatureHint: "hot" | "mild" | "cold" | "indoor" | "outdoor";
  weatherSummary?: string;
}

interface PerItemFeedback {
  itemId: string;
  disliked: boolean;
  notes?: string;
}

/** Persisted dashboard state so recommendations + likes/dislikes survive navigation. */
interface DashboardPersistedState {
  eventDescription: string;
  eventTimeBucket: EventTimeBucket;
  customEventDateTime: string;
  outfits: Outfit[];
  environment?: EnvironmentContext;
  recMessage: string;
}

const DASHBOARD_STORAGE_KEY = "fitted_dashboard_state";

function loadDashboardState(): DashboardPersistedState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(DASHBOARD_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DashboardPersistedState;
    if (!parsed || !Array.isArray(parsed.outfits)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveDashboardState(state: DashboardPersistedState): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(DASHBOARD_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore quota or serialization errors
  }
}

// ============================================================================
// Helpers
// ============================================================================

type EventTimeBucket = "now" | "later_today" | "tomorrow" | "custom";

/**
 * Converts the user's "When?" selection to a UTC ISO string for the backend.
 * Returns undefined for "now" (backend uses current conditions).
 */
/**
 * Returns the target event hour as a UTC ISO string.
 * - "later_today" → 18:00 in user's local timezone (rolls to tomorrow 18:00 if already past 18:00)
 * - "tomorrow"    → 12:00 local (noon)
 * - "custom"      → whatever the datetime-local picker holds
 * - "now"         → undefined (backend uses live current conditions)
 */
function getEventTimeISO(bucket: EventTimeBucket, customVal: string): string | undefined {
  if (bucket === "now") return undefined;
  if (bucket === "later_today") {
    const d = new Date();
    // Roll to tomorrow if it's already 18:00 or later
    if (d.getHours() >= 18) d.setDate(d.getDate() + 1);
    d.setHours(18, 0, 0, 0); // 6 PM in user's local timezone
    return d.toISOString();  // toISOString() converts local → UTC
  }
  if (bucket === "tomorrow") {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(12, 0, 0, 0); // noon in user's local timezone
    return d.toISOString();
  }
  // custom: datetime-local input → UTC ISO
  if (customVal) {
    const parsed = new Date(customVal);
    return isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
  }
  return undefined;
}

/** Human-readable label sent to the backend for inclusion in the LLM prompt. */
function getEventTimeLabel(bucket: EventTimeBucket, customVal: string): string | undefined {
  if (bucket === "now") return undefined;
  if (bucket === "later_today") {
    const isPast6PM = new Date().getHours() >= 18;
    return isPast6PM ? "Tomorrow at 6 PM" : "Today at 6 PM";
  }
  if (bucket === "tomorrow") return "Tomorrow at noon";
  if (bucket === "custom" && customVal) {
    const parsed = new Date(customVal);
    if (isNaN(parsed.getTime())) return undefined;
    return parsed.toLocaleString([], {
      weekday: "short", month: "short", day: "numeric",
      hour: "numeric", minute: "2-digit",
    });
  }
  return undefined;
}

function imageUrlFromPath(imagePath?: string) {
  if (!imagePath) return null;
  if (imagePath.startsWith("mongo:")) {
    return `/api/images/${imagePath.slice("mongo:".length)}`;
  }
  return null;
}

function getScoreColor(score: number) {
  if (score >= 80) return "text-green-600 bg-green-100";
  if (score >= 60) return "text-yellow-600 bg-yellow-100";
  return "text-orange-600 bg-orange-100";
}


function sortOutfitItems(items: OutfitItem[]): OutfitItem[] {
  const getItemTypeOrder = (item: OutfitItem): number => {
    const cat = item.category?.toLowerCase() || "";
    const subCat = item.subCategory?.toLowerCase() || "";
    const name = item.name?.toLowerCase() || "";
    const layerRole = item.layerRole?.toLowerCase() || "";
    
    // One piece (dresses, jumpsuits) - should be first if present
    if (cat === "one piece" || ["dress", "jumpsuit", "romper"].some(w => cat.includes(w) || name.includes(w) || subCat.includes(w))) {
      return 0;
    }
    
    // Base top (t-shirts, shirts, blouses)
    if (cat === "top" || cat === "tops" || layerRole === "base" || 
        ["shirt", "tee", "t-shirt", "blouse", "polo", "tank", "henley", "button-down", "oxford", "camisole"].some(w => name.includes(w) || subCat.includes(w))) {
      return 1;
    }
    
    // Bottom (pants, jeans, skirts)
    if (cat === "bottom" || cat === "bottoms" || 
        ["pants", "jeans", "shorts", "skirt", "trousers", "chinos", "leggings"].some(w => cat.includes(w) || name.includes(w) || subCat.includes(w))) {
      return 2;
    }
    
    // Mid layer (sweaters, cardigans, hoodies)
    if (layerRole === "mid" || 
        ["cardigan", "sweater", "hoodie", "fleece", "vest", "pullover"].some(w => name.includes(w) || subCat.includes(w))) {
      return 3;
    }
    
    // Outer layer (jackets, coats)
    if (layerRole === "outer" || 
        ["jacket", "coat", "blazer", "parka", "puffer", "windbreaker", "trench", "overcoat", "denim jacket"].some(w => name.includes(w) || subCat.includes(w))) {
      return 4;
    }
    
    // Footwear last
    if (cat === "footwear" || 
        ["shoes", "sneakers", "boots", "sandals", "loafers", "heels", "flats"].some(w => cat.includes(w) || name.includes(w) || subCat.includes(w))) {
      return 5;
    }
    
    // Unknown items at the end
    return 6;
  };
  
  return [...items].sort((a, b) => getItemTypeOrder(a) - getItemTypeOrder(b));
}

// ============================================================================
// Feedback Modal Component
// ============================================================================

interface FeedbackModalProps {
  outfit: Outfit;
  eventDescription: string;
  environment?: EnvironmentContext;
  onClose: () => void;
  onSaveFeedback: (data: {
    perItemFeedback: PerItemFeedback[];
    overallNotes: string;
  }) => void;
}

function FeedbackModal({
  outfit,
  onClose,
  onSaveFeedback,
}: FeedbackModalProps) {
  const [perItemFeedback, setPerItemFeedback] = useState<Record<string, PerItemFeedback>>({});
  const [overallNotes, setOverallNotes] = useState("");
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set());

  const toggleDisliked = (itemId: string) => {
    setPerItemFeedback(prev => ({
      ...prev,
      [itemId]: {
        itemId,
        disliked: !prev[itemId]?.disliked,
        notes: prev[itemId]?.notes,
      }
    }));
  };

  const setItemNotes = (itemId: string, notes: string) => {
    setPerItemFeedback(prev => ({
      ...prev,
      [itemId]: {
        itemId,
        disliked: prev[itemId]?.disliked || false,
        notes,
      }
    }));
  };

  const toggleNotesExpanded = (itemId: string) => {
    setExpandedNotes(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  };

  const handleSaveFeedback = () => {
    const feedbackList = Object.values(perItemFeedback).filter(f => f.disliked || f.notes);
    onSaveFeedback({ perItemFeedback: feedbackList, overallNotes });
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-slate-200">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Feedback on Outfit</h2>
            <button
              onClick={onClose}
              className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <p className="text-sm text-slate-600 mt-1">
            Tell us what you didn&apos;t like. You can mark individual pieces or add notes.
          </p>
        </div>

        <div className="p-6 space-y-4">
          {sortOutfitItems(outfit.items).map((item) => {
            const imgSrc = imageUrlFromPath(item.imagePath);
            const isDisliked = perItemFeedback[item.id]?.disliked;
            const notesExpanded = expandedNotes.has(item.id);

            return (
              <div
                key={item.id}
                className={`p-4 rounded-lg border transition-colors ${
                  isDisliked ? "border-red-200 bg-red-50" : "border-slate-200 bg-slate-50"
                }`}
              >
                <div className="flex gap-4">
                  {imgSrc ? (
                    <img
                      src={imgSrc}
                      alt={item.name}
                      className="w-20 h-20 object-cover rounded-lg"
                    />
                  ) : (
                    <div className="w-20 h-20 bg-slate-200 rounded-lg flex items-center justify-center text-xs text-slate-500">
                      No photo
                    </div>
                  )}
                  <div className="flex-1">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-medium text-slate-900">{item.name}</p>
                        <p className="text-sm text-slate-500">
                          {item.category}
                          {item.layerRole && ` • ${item.layerRole}`}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => toggleDisliked(item.id)}
                          className={`px-3 py-1 text-sm font-medium rounded-lg transition-colors ${
                            isDisliked
                              ? "bg-red-200 text-red-800"
                              : "bg-slate-200 text-slate-700 hover:bg-red-100"
                          }`}
                        >
                          {isDisliked ? "Disliked" : "Dislike"}
                        </button>
                        {false && (
                          <button
                            onClick={() => toggleNotesExpanded(item.id)}
                            className="px-2 py-1 text-sm bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 transition-colors"
                            title="Add notes for this item"
                          >
                            📝
                          </button>
                        )}
                      </div>
                    </div>
                    {false && notesExpanded && (
                      <input
                        type="text"
                        placeholder="e.g. Color too bright, doesn't fit well..."
                        value={perItemFeedback[item.id]?.notes || ""}
                        onChange={(e) => setItemNotes(item.id, e.target.value)}
                        className="mt-2 w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500"
                      />
                    )}
                  </div>
                </div>
              </div>
            );
          })}

	          {false && (
	            <div className="pt-4 border-t border-slate-200">
	              <label className="block text-sm font-medium text-slate-700 mb-2">
	                Overall feedback (optional)
	              </label>
	              <textarea
	                value={overallNotes}
	                onChange={(e) => setOverallNotes(e.target.value)}
	                placeholder="e.g. Too dressy for this occasion, colors don't match..."
	                rows={2}
	                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500"
	              />
	            </div>
	          )}

        </div>

        <div className="p-6 border-t border-slate-200 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSaveFeedback}
            className="px-4 py-2 text-sm font-medium text-white bg-slate-700 rounded-lg hover:bg-slate-800 transition-colors"
          >
            Save Feedback
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Regenerate Modal (lock pieces, get new outfits)
// ============================================================================

type ChangeTarget = "outer" | "top" | "bottom" | "footwear" | "any";

interface RegenerateModalProps {
  outfit: Outfit;
  eventDescription: string;
  environment?: EnvironmentContext;
  regeneratedOutfits: Outfit[] | null;
  onClose: () => void;
  onRegenerate: (lockedItemIds: string[], changeTarget: ChangeTarget) => Promise<void>;
  onDone: () => void;
  isRegenerating: boolean;
}

function RegenerateModal({
  outfit,
  onClose,
  onRegenerate,
  onDone,
  regeneratedOutfits,
  isRegenerating,
}: RegenerateModalProps) {
  const [lockedItemIds, setLockedItemIds] = useState<Set<string>>(new Set());
  const [changeTarget, setChangeTarget] = useState<ChangeTarget>("any");

  const toggleLocked = (itemId: string) => {
    setLockedItemIds(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const handleRegenerate = () => {
    onRegenerate(Array.from(lockedItemIds), changeTarget);
  };

  const showResult = regeneratedOutfits && regeneratedOutfits.length > 0;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-slate-200">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">
              {showResult ? "Regenerated outfit" : "Regenerate from this outfit"}
            </h2>
            <button
              onClick={onClose}
              disabled={isRegenerating}
              className="p-2 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <p className="text-sm text-slate-600 mt-1">
            {showResult
              ? "Here’s your new outfit. Click Done to use it on the main list, or close to keep the previous recommendations."
              : "Lock the pieces you want to keep. We'll suggest new outfits that use them."}
          </p>
        </div>

        {showResult ? (
          <div className="p-6 space-y-4">
            {regeneratedOutfits.map((regOutfit, idx) => (
              <div key={idx} className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800">
                    {regeneratedOutfits.length > 1 ? `Outfit ${idx + 1}` : "New outfit"}
                  </span>
                  <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getScoreColor(regOutfit.confidence)}`}>
                    {regOutfit.confidence}% confident
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {sortOutfitItems(regOutfit.items).map((item) => {
                    const imgSrc = imageUrlFromPath(item.imagePath);
                    return (
                      <div key={item.id} className="bg-white rounded-lg border border-slate-100 overflow-hidden">
                        {imgSrc ? (
                          <div className="h-28 bg-slate-50 flex items-center justify-center p-2">
                            <img src={imgSrc} alt={item.name} className="max-h-full max-w-full object-contain" />
                          </div>
                        ) : (
                          <div className="h-28 flex items-center justify-center bg-slate-50 text-xs text-slate-400">No photo</div>
                        )}
                        <div className="p-2">
                          <p className="font-medium text-slate-900 text-sm truncate">{item.name}</p>
                          <p className="text-xs text-slate-500">{item.category}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className="text-sm text-slate-600 italic">{regOutfit.reason}</p>
              </div>
            ))}
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200"
              >
                Close
              </button>
              <button
                onClick={onDone}
                className="px-4 py-2 text-sm font-medium text-white bg-slate-800 rounded-lg hover:bg-slate-700"
              >
                Done — use on main list
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="p-6 space-y-4">
              {sortOutfitItems(outfit.items).map((item) => {
                const imgSrc = imageUrlFromPath(item.imagePath);
                const isLocked = lockedItemIds.has(item.id);
                return (
                  <div
                    key={item.id}
                    className={`p-4 rounded-lg border transition-colors flex items-center gap-4 ${
                      isLocked ? "border-green-200 bg-green-50" : "border-slate-200 bg-slate-50"
                    }`}
                  >
                    {imgSrc ? (
                      <img src={imgSrc} alt={item.name} className="w-16 h-16 object-cover rounded-lg" />
                    ) : (
                      <div className="w-16 h-16 bg-slate-200 rounded-lg flex items-center justify-center text-xs text-slate-500">No photo</div>
                    )}
                    <div className="flex-1">
                      <p className="font-medium text-slate-900">{item.name}</p>
                      <p className="text-sm text-slate-500">{item.category}{item.layerRole ? ` • ${item.layerRole}` : ""}</p>
                    </div>
                    <button
                      onClick={() => toggleLocked(item.id)}
                      className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                        isLocked ? "bg-green-200 text-green-800" : "bg-slate-200 text-slate-700 hover:bg-slate-300"
                      }`}
                    >
                      {isLocked ? "🔒 Locked" : "🔓 Lock"}
                    </button>
                  </div>
                );
              })}

              <div className="pt-4 border-t border-slate-200">
                <label className="block text-sm font-medium text-slate-700 mb-2">What should change?</label>
                <select
                  value={changeTarget}
                  onChange={(e) => setChangeTarget(e.target.value as ChangeTarget)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500"
                >
                  <option value="any">Change anything not locked</option>
                  <option value="top">Primarily change the top</option>
                  <option value="bottom">Primarily change the bottom</option>
                  <option value="outer">Primarily change the outer layer</option>
                  <option value="footwear">Primarily change the footwear</option>
                </select>
              </div>
            </div>

            <div className="p-6 border-t border-slate-200 flex justify-end gap-3">
              <button
                onClick={onClose}
                disabled={isRegenerating}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleRegenerate}
                disabled={isRegenerating}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
              >
                {isRegenerating ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Regenerating...
                  </>
                ) : (
                  "Regenerate"
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function Home() {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  
  // Recommendation state
  const [eventDescription, setEventDescription] = useState("");
  const [eventTimeBucket, setEventTimeBucket] = useState<EventTimeBucket>("now");
  const [customEventDateTime, setCustomEventDateTime] = useState("");
  const [outfits, setOutfits] = useState<Outfit[]>([]);
  const [environment, setEnvironment] = useState<EnvironmentContext | undefined>();
  const [recLoading, setRecLoading] = useState(false);
  const [recError, setRecError] = useState("");
  const [recMessage, setRecMessage] = useState("");
  
  // Per-outfit disliked item IDs — contextual, not persisted, cleared on new recommendations.
  // Maps outfit index → item IDs the user explicitly flagged in the dislike modal.
  // Used only for the single regenerate call on that specific outfit.
  const [outfitDislikedItems, setOutfitDislikedItems] = useState<Record<number, string[]>>({});

  // Feedback modal state (dislike)
  const [feedbackModalOutfit, setFeedbackModalOutfit] = useState<{ outfit: Outfit; index: number } | null>(null);
  // Regenerate modal state
  const [regenerateModalOutfit, setRegenerateModalOutfit] = useState<{ outfit: Outfit; index: number } | null>(null);
  const [regeneratedOutfitsInModal, setRegeneratedOutfitsInModal] = useState<Outfit[] | null>(null);
  const [isRegenerating, setIsRegenerating] = useState(false);

  // Geolocation (best-effort — used for weather in prompt when allowed; if denied, recommendations still work without weather)
  const [geoCoords, setGeoCoords] = useState<{ lat: number; lon: number } | null>(null);

  useEffect(() => {
    if (!navigator?.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setGeoCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => {}, // denied or unavailable — send prompt without weather
    );
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
    });
    return () => unsub();
  }, []);

  // Restore last recommendations + form when returning to dashboard
  useEffect(() => {
    if (!firebaseUser) return;
    const saved = loadDashboardState();
    if (!saved) return;
    setEventDescription(saved.eventDescription);
    setEventTimeBucket(saved.eventTimeBucket);
    setCustomEventDateTime(saved.customEventDateTime);
    setOutfits(saved.outfits);
    setEnvironment(saved.environment);
    setRecMessage(saved.recMessage);
  }, [firebaseUser]);

  // Persist recommendations + form whenever we have outfits (so like/dislike and navigation preserve state)
  useEffect(() => {
    if (!firebaseUser || outfits.length === 0) return;
    saveDashboardState({
      eventDescription,
      eventTimeBucket,
      customEventDateTime,
      outfits,
      environment,
      recMessage,
    });
  }, [firebaseUser, eventDescription, eventTimeBucket, customEventDateTime, outfits, environment, recMessage]);

  // Check and update preference summary in background
  useEffect(() => {
    if (!firebaseUser) return;

    const checkAndUpdatePreferences = async () => {
      try {
        const token = await firebaseUser.getIdToken();
        
        // Check if summary needs update
        const checkRes = await fetch("/api/preferences/summarize", {
          headers: { Authorization: `Bearer ${token}` },
        });
        
        if (!checkRes.ok) return;
        
        const { needsUpdate, newFeedbackCount } = await checkRes.json();
        
        // If 5+ new interactions since last summary, update in background
        if (needsUpdate && newFeedbackCount >= 5) {
          fetch("/api/preferences/summarize", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
          }).catch(err => console.error("Background preference update failed:", err));
        }
      } catch (error) {
        console.error("Error checking preferences:", error);
      }
    };

    checkAndUpdatePreferences();
  }, [firebaseUser]);

  async function handleLogout() {
    try {
      setSigningOut(true);
      await signOut(auth);
      localStorage.removeItem("userId");
      router.push("/");
    } catch (error) {
      console.error("Error signing out:", error);
      setSigningOut(false);
    }
  }

  const getRecommendations = useCallback(async () => {
    if (!firebaseUser) {
      setRecError("Please sign in to get recommendations");
      return;
    }

    if (!eventDescription.trim()) {
      setRecError("Describe the event or context to get recommendations.");
      return;
    }
    
    setRecLoading(true);
    setRecError("");
    setRecMessage("");
    setOutfits([]);
    setOutfitDislikedItems({});

    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch("/api/recommend", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          eventDescription,
          eventTimeISO: getEventTimeISO(eventTimeBucket, customEventDateTime),
          eventTimeLabel: getEventTimeLabel(eventTimeBucket, customEventDateTime),
          ...(geoCoords ? { lat: geoCoords.lat, lon: geoCoords.lon } : {}),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setRecError(data.error || "Failed to get recommendations");
        return;
      }

      setOutfits(data.outfits || []);
      setEnvironment(data.environment);
      if (!data.outfits?.length && data.message) {
        setRecMessage(data.message);
      } else if (data.message) {
        setRecMessage(data.message);
      }
    } catch {
      setRecError("Something went wrong. Please try again.");
    } finally {
      setRecLoading(false);
    }
  }, [firebaseUser, eventDescription, eventTimeBucket, customEventDateTime]);

  const handleLike = async (outfitIndex: number) => {
    if (!firebaseUser) return;

    const outfit = outfits[outfitIndex];
    const prevFeedback = outfit.feedback;

    // Optimistic update
    setOutfits(prev => prev.map((o, i) =>
      i === outfitIndex ? { ...o, feedback: "liked" as const } : o
    ));

    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch("/api/interactions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          itemIds: outfit.itemIds,
          action: "accepted",
          occasion: eventDescription || "casual",
        }),
      });

      if (!res.ok) {
        // Revert optimistic update
        setOutfits(prev => prev.map((o, i) =>
          i === outfitIndex ? { ...o, feedback: prevFeedback } : o
        ));
        const data = await res.json().catch(() => ({}));
        setRecError((data as { error?: string }).error || "Failed to save like. Please try again.");
      }
    } catch (error) {
      console.error("Error saving feedback:", error);
      // Revert optimistic update
      setOutfits(prev => prev.map((o, i) =>
        i === outfitIndex ? { ...o, feedback: prevFeedback } : o
      ));
      setRecError("Failed to save like. Please try again.");
    }
  };

  const handleDislikeClick = (outfitIndex: number) => {
    setFeedbackModalOutfit({ outfit: outfits[outfitIndex], index: outfitIndex });
  };

  const handleSaveFeedback = async (data: {
    perItemFeedback: PerItemFeedback[];
    overallNotes: string;
  }) => {
    if (!firebaseUser || !feedbackModalOutfit) return;

    const outfit = feedbackModalOutfit.outfit;
    const outfitIndex = feedbackModalOutfit.index;
    const prevFeedback = outfit.feedback;
    const dislikedItemIds = data.perItemFeedback.filter(f => f.disliked).map(f => f.itemId);

    // Optimistic update
    setOutfits(prev => prev.map((o, i) =>
      i === outfitIndex ? { ...o, feedback: "disliked" as const } : o
    ));
    setFeedbackModalOutfit(null);

    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch("/api/interactions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          itemIds: outfit.itemIds,
          action: "rejected",
          occasion: eventDescription || "casual",
          perItemFeedback: data.perItemFeedback,
          dislikedItemIds: dislikedItemIds.length > 0 ? dislikedItemIds : undefined,
        }),
      });

      if (!res.ok) {
        // Revert optimistic update
        setOutfits(prev => prev.map((o, i) =>
          i === outfitIndex ? { ...o, feedback: prevFeedback } : o
        ));
        const resData = await res.json().catch(() => ({}));
        setRecError((resData as { error?: string }).error || "Failed to save feedback. Please try again.");
        return;
      }

      // Store disliked item IDs for this specific outfit — used only if the user
      // immediately regenerates this same outfit. Not persisted or shared globally.
      if (dislikedItemIds.length > 0) {
        setOutfitDislikedItems(prev => ({ ...prev, [outfitIndex]: dislikedItemIds }));
      }
    } catch (error) {
      console.error("Error saving feedback:", error);
      // Revert optimistic update
      setOutfits(prev => prev.map((o, i) =>
        i === outfitIndex ? { ...o, feedback: prevFeedback } : o
      ));
      setRecError("Failed to save feedback. Please try again.");
    }
  };

  const handleRegenerateClick = (outfitIndex: number) => {
    setRegeneratedOutfitsInModal(null);
    setRegenerateModalOutfit({ outfit: outfits[outfitIndex], index: outfitIndex });
  };

  const handleRegenerateSubmit = async (lockedItemIds: string[], changeTarget: "outer" | "top" | "bottom" | "footwear" | "any") => {
    if (!firebaseUser || !regenerateModalOutfit) return;
    setIsRegenerating(true);
    setRecError("");
    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch("/api/recommend/regenerate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          eventDescription,
          temperatureHint: environment?.temperatureHint,
          weatherSummary: environment?.weatherSummary,
          lockedItemIds,
          dislikedItemIds: outfitDislikedItems[regenerateModalOutfit.index] ?? [],
          changeTarget,
          maxOutfits: 5,
        }),
      });
      const newData = await res.json();
      if (!res.ok) {
        setRecError(newData.error || "Failed to regenerate recommendations");
        return;
      }
      setRegeneratedOutfitsInModal(newData.outfits || []);
      if (newData.message) setRecMessage(newData.message);
    } catch (error) {
      console.error("Error regenerating:", error);
      setRecError("Failed to regenerate. Please try again.");
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleRegenerateDone = () => {
    if (regeneratedOutfitsInModal?.length) {
      setOutfits(regeneratedOutfitsInModal);
    }
    setRegeneratedOutfitsInModal(null);
    setRegenerateModalOutfit(null);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Home</h1>
        </div>
        <button
          onClick={handleLogout}
          disabled={signingOut}
          className="rounded-lg bg-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {signingOut ? "Signing out..." : "Log Out"}
        </button>
      </div>

      {/* Recommendations Section */}
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Get Outfit Recommendations</h2>
            <p className="mt-1 text-sm text-slate-600">
              Our AI stylist uses your wardrobe, event description, and style preferences to suggest outfits.
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-4">
          <div className="w-full">
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600 mb-1">
              Event description
            </label>
            <textarea
              value={eventDescription}
              onChange={(e) => setEventDescription(e.target.value)}
              rows={3}
              maxLength={280}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 placeholder:text-slate-400"
              placeholder="e.g. Outdoor brunch with friends in early spring, want something smart casual but comfortable. Might get windy."
            />
            <div className="mt-1 flex justify-between text-[11px] text-slate-500">
              <span>Tell the AI what the event is, vibe, and any constraints.</span>
              <span>{eventDescription.length}/280</span>
            </div>
          </div>

          <div className="w-full">
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600 mb-1">
              When is the event?
            </label>
            <div className="flex gap-2 flex-wrap">
              {([
                { value: "now",        label: "Now" },
                { value: "later_today", label: "Later today" },
                { value: "tomorrow",   label: "Tomorrow" },
                { value: "custom",     label: "Pick date/time" },
              ] as { value: EventTimeBucket; label: string }[]).map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => setEventTimeBucket(value)}
                  className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                    eventTimeBucket === value
                      ? "bg-slate-900 text-white"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                  }`}
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
                className="mt-2 px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white"
              />
            )}
            <p className="mt-1 text-[11px] text-slate-500">
              Optional. If you allow location, we use it for weather; otherwise we recommend without weather.
            </p>
          </div>

          <button
            onClick={getRecommendations}
            disabled={recLoading}
            className="self-start px-6 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 disabled:bg-slate-400 disabled:cursor-not-allowed transition-colors"
          >
            {recLoading ? "Generating..." : "Get Recommendations"}
          </button>
        </div>

        {recError && (
          <div className="mt-4 p-4 bg-red-50 text-red-700 rounded-lg text-sm">
            {recError}
          </div>
        )}

        {!recError && recMessage && (
          <div className="mt-4 p-4 bg-slate-50 text-slate-700 rounded-lg text-sm border border-slate-200">
            {recMessage}
          </div>
        )}

        {environment && (
          <div className="mt-4 p-3 bg-blue-50 rounded-lg text-sm text-blue-700 flex items-center gap-2">
            <span>
              {environment.temperatureHint === "hot" && "🌡️"}
              {environment.temperatureHint === "mild" && "🌤️"}
              {environment.temperatureHint === "cold" && "❄️"}
              {environment.temperatureHint === "indoor" && "🏠"}
              {environment.temperatureHint === "outdoor" && "🌿"}
            </span>
            <span>
              Detected context: <strong>{environment.temperatureHint}</strong>
              {environment.weatherSummary && ` — ${environment.weatherSummary}`}
            </span>
          </div>
        )}

        {outfits.length > 0 && (
          <div className="mt-6 space-y-4">
            {outfits.map((outfit, index) => (
              <div
                key={index}
                className={`p-5 border rounded-xl shadow-sm transition-colors ${
                  outfit.feedback === "liked" 
                    ? "bg-green-50 border-green-200" 
                    : outfit.feedback === "disliked"
                    ? "bg-red-50 border-red-200 opacity-60"
                    : "bg-slate-50 border-slate-200"
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="px-3 py-1 bg-slate-900 text-white text-sm font-medium rounded-full">
                      Outfit {index + 1}
                    </span>
                    <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getScoreColor(outfit.confidence)}`}>
                      {outfit.confidence}% confident
                    </span>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleRegenerateClick(index)}
                      className="px-3 py-1 bg-blue-100 text-blue-700 text-sm font-medium rounded-lg hover:bg-blue-200 transition-colors flex items-center gap-1"
                    >
                      <span>🔄</span> Regenerate
                    </button>
                    {!outfit.feedback && (
                      <>
                        <button
                          onClick={() => handleLike(index)}
                          className="px-3 py-1 bg-green-100 text-green-700 text-sm font-medium rounded-lg hover:bg-green-200 transition-colors flex items-center gap-1"
                        >
                          <span>👍</span> Like
                        </button>
                        <button
                          onClick={() => handleDislikeClick(index)}
                          className="px-3 py-1 bg-red-100 text-red-700 text-sm font-medium rounded-lg hover:bg-red-200 transition-colors flex items-center gap-1"
                        >
                          <span>👎</span> Dislike
                        </button>
                      </>
                    )}
                    {outfit.feedback && (
                      <span className={`px-3 py-1 text-sm font-medium rounded-lg ${
                        outfit.feedback === "liked" 
                          ? "bg-green-200 text-green-800" 
                          : "bg-red-200 text-red-800"
                      }`}>
                        {outfit.feedback === "liked" ? "👍 Liked" : "👎 Disliked"}
                      </span>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                  {sortOutfitItems(outfit.items).map((item) => {
                    const imgSrc = imageUrlFromPath(item.imagePath);
                    return (
                      <div
                        key={item.id}
                        className="bg-white rounded-lg border border-slate-100 overflow-hidden"
                      >
                        {imgSrc ? (
                          <div className="h-40 w-full bg-slate-50 flex items-center justify-center p-2">
                            <img
                              src={imgSrc}
                              alt={item.name}
                              className="max-h-full max-w-full object-contain"
                              loading="lazy"
                            />
                          </div>
                        ) : (
                          <div className="flex h-40 w-full items-center justify-center bg-slate-50 text-xs text-slate-400">
                            No photo
                          </div>
                        )}
                        <div className="p-3">
                          <p className="font-medium text-slate-900 text-sm truncate">{item.name}</p>
                          <p className="text-xs text-slate-500">
                            {item.category}
                            {item.layerRole && (
                              <span className="ml-1 px-1.5 py-0.5 bg-slate-100 rounded text-[10px]">
                                {item.layerRole}
                              </span>
                            )}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <p className="text-sm text-slate-600 italic">
                  {outfit.reason}
                </p>
              </div>
            ))}
          </div>
        )}

        {!recLoading && outfits.length === 0 && !recError && (
          <div className="mt-6 mx-auto w-full max-w-3xl p-6 bg-slate-50 rounded-lg text-center">
            <p className="text-slate-600">
              Click &quot;Get Recommendations&quot; to see outfit suggestions.
            </p>
            <p className="mt-2 text-sm text-slate-500">
              The more you like/dislike, the smarter the recommendations become!
            </p>
          </div>
        )}
      </div>

      {/* How it works */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h3 className="font-semibold text-slate-900">How the AI Stylist Works</h3>
        <div className="mt-3 grid md:grid-cols-4 gap-3">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="text-[11px] font-semibold tracking-wider text-slate-400">01</p>
            <p className="mt-2 font-semibold text-slate-900">Smart Shortlisting</p>
            <p className="mt-1 text-sm text-slate-600 leading-relaxed">
              Filters your wardrobe by season, availability, and occasion relevance.
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="text-[11px] font-semibold tracking-wider text-slate-400">02</p>
            <p className="mt-2 font-semibold text-slate-900">Intelligent Layering</p>
            <p className="mt-1 text-sm text-slate-600 leading-relaxed">
              Adds outer and mid layers when the temperature calls for it.
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="text-[11px] font-semibold tracking-wider text-slate-400">03</p>
            <p className="mt-2 font-semibold text-slate-900">Learns from You</p>
            <p className="mt-1 text-sm text-slate-600 leading-relaxed">
              Your detailed feedback builds a preference profile over time.
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="text-[11px] font-semibold tracking-wider text-slate-400">04</p>
            <p className="mt-2 font-semibold text-slate-900">Lock & Regenerate</p>
            <p className="mt-1 text-sm text-slate-600 leading-relaxed">
              Keep items you like and regenerate the rest with targeted changes.
            </p>
          </div>
        </div>
      </div>

      {/* Dislike feedback modal */}
      {feedbackModalOutfit && (
        <FeedbackModal
          outfit={feedbackModalOutfit.outfit}
          eventDescription={eventDescription}
          environment={environment}
          onClose={() => setFeedbackModalOutfit(null)}
          onSaveFeedback={handleSaveFeedback}
        />
      )}

      {/* Regenerate modal (lock pieces, get new outfits; result shown in same modal) */}
      {regenerateModalOutfit && (
        <RegenerateModal
          outfit={regenerateModalOutfit.outfit}
          eventDescription={eventDescription}
          environment={environment}
          regeneratedOutfits={regeneratedOutfitsInModal}
          onClose={() => {
            if (!isRegenerating) {
              setRegeneratedOutfitsInModal(null);
              setRegenerateModalOutfit(null);
            }
          }}
          onRegenerate={handleRegenerateSubmit}
          onDone={handleRegenerateDone}
          isRegenerating={isRegenerating}
        />
      )}
    </div>
  );
}
