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
  temperatureHint: "hot" | "mild" | "cold" | "indoor";
  weatherSummary?: string;
}

interface PerItemFeedback {
  itemId: string;
  disliked: boolean;
  notes?: string;
}

// ============================================================================
// Helpers
// ============================================================================

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
  onSaveAndRegenerate: (data: {
    perItemFeedback: PerItemFeedback[];
    overallNotes: string;
    lockedItemIds: string[];
    changeTarget: "outer" | "top" | "bottom" | "any";
  }) => void;
}

function FeedbackModal({
  outfit,
  onClose,
  onSaveFeedback,
  onSaveAndRegenerate,
}: FeedbackModalProps) {
  const [perItemFeedback, setPerItemFeedback] = useState<Record<string, PerItemFeedback>>({});
  const [overallNotes, setOverallNotes] = useState("");
  const [lockedItemIds, setLockedItemIds] = useState<Set<string>>(new Set());
  const [changeTarget, setChangeTarget] = useState<"outer" | "top" | "bottom" | "any">("any");
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

  const toggleLocked = (itemId: string) => {
    setLockedItemIds(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
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

  const handleSaveAndRegenerate = () => {
    const feedbackList = Object.values(perItemFeedback).filter(f => f.disliked || f.notes);
    onSaveAndRegenerate({
      perItemFeedback: feedbackList,
      overallNotes,
      lockedItemIds: Array.from(lockedItemIds),
      changeTarget,
    });
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
            Tell us what you didn&apos;t like. You can also lock items you want to keep.
          </p>
        </div>

        <div className="p-6 space-y-4">
          {outfit.items.map((item) => {
            const imgSrc = imageUrlFromPath(item.imagePath);
            const isDisliked = perItemFeedback[item.id]?.disliked;
            const isLocked = lockedItemIds.has(item.id);
            const notesExpanded = expandedNotes.has(item.id);

            return (
              <div
                key={item.id}
                className={`p-4 rounded-lg border transition-colors ${
                  isDisliked ? "border-red-200 bg-red-50" : 
                  isLocked ? "border-green-200 bg-green-50" : 
                  "border-slate-200 bg-slate-50"
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
                        <button
                          onClick={() => toggleLocked(item.id)}
                          className={`px-3 py-1 text-sm font-medium rounded-lg transition-colors ${
                            isLocked
                              ? "bg-green-200 text-green-800"
                              : "bg-slate-200 text-slate-700 hover:bg-green-100"
                          }`}
                          title="Lock this piece for regeneration"
                        >
                          {isLocked ? "🔒 Locked" : "🔓 Lock"}
                        </button>
                        <button
                          onClick={() => toggleNotesExpanded(item.id)}
                          className="px-2 py-1 text-sm bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 transition-colors"
                          title="Add notes for this item"
                        >
                          📝
                        </button>
                      </div>
                    </div>
                    {notesExpanded && (
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

          {lockedItemIds.size > 0 && (
            <div className="pt-4 border-t border-slate-200">
              <label className="block text-sm font-medium text-slate-700 mb-2">
                What should change? (for regeneration)
              </label>
              <select
                value={changeTarget}
                onChange={(e) => setChangeTarget(e.target.value as typeof changeTarget)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500"
              >
                <option value="any">Change anything not locked</option>
                <option value="top">Primarily change the top</option>
                <option value="bottom">Primarily change the bottom</option>
                <option value="outer">Primarily change the outer layer</option>
              </select>
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
          {lockedItemIds.size > 0 && (
            <button
              onClick={handleSaveAndRegenerate}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
            >
              Save & Regenerate
            </button>
          )}
        </div>
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
  const [temperatureHint, setTemperatureHint] = useState<"hot" | "mild" | "cold" | "indoor" | "">("");
  const [outfits, setOutfits] = useState<Outfit[]>([]);
  const [environment, setEnvironment] = useState<EnvironmentContext | undefined>();
  const [recLoading, setRecLoading] = useState(false);
  const [recError, setRecError] = useState("");
  const [recMessage, setRecMessage] = useState("");
  
  // Feedback modal state
  const [feedbackModalOutfit, setFeedbackModalOutfit] = useState<{ outfit: Outfit; index: number } | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
    });
    return () => unsub();
  }, []);

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
          temperatureHint: temperatureHint || undefined,
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
  }, [firebaseUser, eventDescription, temperatureHint]);

  const handleLike = async (outfitIndex: number) => {
    if (!firebaseUser) return;

    const outfit = outfits[outfitIndex];

    try {
      const token = await firebaseUser.getIdToken();
      await fetch("/api/interactions", {
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

      setOutfits(prev => prev.map((o, i) => 
        i === outfitIndex ? { ...o, feedback: "liked" } : o
      ));
    } catch (error) {
      console.error("Error saving feedback:", error);
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

    try {
      const token = await firebaseUser.getIdToken();
      await fetch("/api/interactions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          itemIds: outfit.itemIds,
          action: "rejected",
          occasion: eventDescription || "casual",
        }),
      });

      setOutfits(prev => prev.map((o, i) => 
        i === feedbackModalOutfit.index ? { ...o, feedback: "disliked" } : o
      ));
      setFeedbackModalOutfit(null);
    } catch (error) {
      console.error("Error saving feedback:", error);
    }
  };

  const handleSaveAndRegenerate = async (data: {
    perItemFeedback: PerItemFeedback[];
    overallNotes: string;
    lockedItemIds: string[];
    changeTarget: "outer" | "top" | "bottom" | "any";
  }) => {
    if (!firebaseUser || !feedbackModalOutfit) return;

    const outfit = feedbackModalOutfit.outfit;

    try {
      const token = await firebaseUser.getIdToken();

      // Save feedback first
      await fetch("/api/interactions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          itemIds: outfit.itemIds,
          action: "rejected",
          occasion: eventDescription || "casual",
        }),
      });

      // Get disliked item IDs
      const dislikedItemIds = data.perItemFeedback
        .filter(f => f.disliked)
        .map(f => f.itemId);

      // Build feedback notes for the regeneration prompt
      const feedbackNotes = [
        data.overallNotes,
        ...data.perItemFeedback
          .filter(f => f.notes)
          .map(f => {
            const item = outfit.items.find(i => i.id === f.itemId);
            return `${item?.name || "Item"}: ${f.notes}`;
          })
      ].filter(Boolean).join("\n");

      // Regenerate outfits
      setRecLoading(true);
      setFeedbackModalOutfit(null);

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
          lockedItemIds: data.lockedItemIds,
          dislikedItemIds,
          changeTarget: data.changeTarget,
          feedbackNotes: feedbackNotes || undefined,
        }),
      });

      const newData = await res.json();

      if (!res.ok) {
        setRecError(newData.error || "Failed to regenerate recommendations");
        return;
      }

      // Replace the disliked outfit with new ones
      setOutfits(prev => {
        const updated = [...prev];
        updated[feedbackModalOutfit.index] = { ...updated[feedbackModalOutfit.index], feedback: "disliked" };
        return [...updated, ...(newData.outfits || [])];
      });

      if (newData.message) {
        setRecMessage(newData.message);
      }
    } catch (error) {
      console.error("Error regenerating:", error);
      setRecError("Failed to regenerate. Please try again.");
    } finally {
      setRecLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Home</h1>
          <p className="mt-2 text-sm text-slate-600">
            Get AI-powered outfit recommendations from your wardrobe.
          </p>
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
              Temperature hint (optional)
            </label>
            <div className="flex gap-2 flex-wrap">
              {(["hot", "mild", "cold", "indoor"] as const).map((hint) => (
                <button
                  key={hint}
                  onClick={() => setTemperatureHint(temperatureHint === hint ? "" : hint)}
                  className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                    temperatureHint === hint
                      ? "bg-slate-900 text-white"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                  }`}
                >
                  {hint === "hot" && "🌡️ Hot"}
                  {hint === "mild" && "🌤️ Mild"}
                  {hint === "cold" && "❄️ Cold"}
                  {hint === "indoor" && "🏠 Indoor"}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              Leave empty to auto-detect from your event description.
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
                  
                  {!outfit.feedback && (
                    <div className="flex gap-2">
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
                    </div>
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

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                  {outfit.items.map((item) => {
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
          <div className="mt-6 p-6 bg-slate-50 rounded-lg text-center">
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
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <h3 className="font-semibold text-slate-900">How the AI Stylist Works</h3>
        <div className="mt-4 grid md:grid-cols-4 gap-4">
          <div className="p-4 bg-blue-50 rounded-lg">
            <div className="text-2xl mb-2">🎯</div>
            <p className="font-medium text-slate-900">Smart Shortlisting</p>
            <p className="text-sm text-slate-600 mt-1">
              Filters your wardrobe by season, availability, and occasion relevance.
            </p>
          </div>
          <div className="p-4 bg-purple-50 rounded-lg">
            <div className="text-2xl mb-2">🧥</div>
            <p className="font-medium text-slate-900">Intelligent Layering</p>
            <p className="text-sm text-slate-600 mt-1">
              Adds outer and mid layers when the temperature calls for it.
            </p>
          </div>
          <div className="p-4 bg-green-50 rounded-lg">
            <div className="text-2xl mb-2">🧠</div>
            <p className="font-medium text-slate-900">Learns from You</p>
            <p className="text-sm text-slate-600 mt-1">
              Your detailed feedback builds a preference profile over time.
            </p>
          </div>
          <div className="p-4 bg-orange-50 rounded-lg">
            <div className="text-2xl mb-2">🔄</div>
            <p className="font-medium text-slate-900">Lock & Regenerate</p>
            <p className="text-sm text-slate-600 mt-1">
              Keep items you like and regenerate the rest with targeted changes.
            </p>
          </div>
        </div>
      </div>

      {/* Feedback Modal */}
      {feedbackModalOutfit && (
        <FeedbackModal
          outfit={feedbackModalOutfit.outfit}
          eventDescription={eventDescription}
          environment={environment}
          onClose={() => setFeedbackModalOutfit(null)}
          onSaveFeedback={handleSaveFeedback}
          onSaveAndRegenerate={handleSaveAndRegenerate}
        />
      )}
    </div>
  );
}
