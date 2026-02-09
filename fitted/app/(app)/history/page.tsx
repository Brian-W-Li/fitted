"use client";

import { auth } from "@/lib/firebaseClient";
import { onAuthStateChanged, type User as FirebaseUser } from "firebase/auth";
import { useState, useEffect, useRef } from "react";

interface OutfitItem {
  id: string;
  name: string;
  category: string;
  colors: string[];
  imagePath?: string;
}

// Helper to convert imagePath to actual image URL
function imageUrlFromPath(imagePath?: string) {
  if (!imagePath) return null;
  // Backend stores images as "mongo:<imageId>"
  if (imagePath.startsWith("mongo:")) {
    const imageId = imagePath.slice("mongo:".length);
    return `/api/images/${imageId}`;
  }
  return null;
}

interface Interaction {
  id: string;
  items: OutfitItem[];
  action: "accepted" | "rejected";
  occasion: string;
  createdAt: string;
}

type TabType = "liked" | "disliked";

const OCCASIONS = [
  { value: "all", label: "All Occasions" },
  { value: "casual", label: "Casual" },
  { value: "business", label: "Business" },
  { value: "formal", label: "Formal" },
  { value: "date night", label: "Date Night" },
];

export default function HistoryPage() {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>("liked");
  const [likedOutfits, setLikedOutfits] = useState<Interaction[]>([]);
  const [dislikedOutfits, setDislikedOutfits] = useState<Interaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [occasionFilter, setOccasionFilter] = useState("all");
  const menuRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpenMenuId(null);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (firebaseUser) {
      fetchHistory();
    }
  }, [firebaseUser]);

  const fetchHistory = async () => {
    if (!firebaseUser) return;

    setLoading(true);
    setError("");

    try {
      const token = await firebaseUser.getIdToken();

      // Fetch both liked and disliked in parallel
      const [likedRes, dislikedRes] = await Promise.all([
        fetch("/api/interactions?action=accepted", {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch("/api/interactions?action=rejected", {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      if (!likedRes.ok || !dislikedRes.ok) {
        throw new Error("Failed to fetch history");
      }

      const [likedData, dislikedData] = await Promise.all([
        likedRes.json(),
        dislikedRes.json(),
      ]);

      setLikedOutfits(likedData.interactions || []);
      setDislikedOutfits(dislikedData.interactions || []);
    } catch (err) {
      console.error("Error fetching history:", err);
      setError("Failed to load your outfit history. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const handleRemove = async (interactionId: string) => {
    if (!firebaseUser) return;

    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch(`/api/interactions?id=${interactionId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        throw new Error("Failed to remove");
      }

      // Update local state
      setLikedOutfits((prev) => prev.filter((o) => o.id !== interactionId));
      setDislikedOutfits((prev) => prev.filter((o) => o.id !== interactionId));
    } catch (err) {
      console.error("Error removing interaction:", err);
    }
  };

  const handleMove = async (interactionId: string, newAction: "accepted" | "rejected") => {
    if (!firebaseUser) return;

    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch("/api/interactions", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ id: interactionId, action: newAction }),
      });

      if (!res.ok) {
        throw new Error("Failed to update");
      }

      // Move between lists in local state
      if (newAction === "accepted") {
        // Moving from disliked to liked
        const outfit = dislikedOutfits.find((o) => o.id === interactionId);
        if (outfit) {
          setDislikedOutfits((prev) => prev.filter((o) => o.id !== interactionId));
          setLikedOutfits((prev) => [{ ...outfit, action: "accepted" }, ...prev]);
        }
      } else {
        // Moving from liked to disliked
        const outfit = likedOutfits.find((o) => o.id === interactionId);
        if (outfit) {
          setLikedOutfits((prev) => prev.filter((o) => o.id !== interactionId));
          setDislikedOutfits((prev) => [{ ...outfit, action: "rejected" }, ...prev]);
        }
      }
    } catch (err) {
      console.error("Error updating interaction:", err);
    }
  };

  const baseOutfits = activeTab === "liked" ? likedOutfits : dislikedOutfits;
  const currentOutfits = occasionFilter === "all"
    ? baseOutfits
    : baseOutfits.filter((outfit) => outfit.occasion.toLowerCase() === occasionFilter.toLowerCase());

  // Get counts for filter badges
  const filteredLikedCount = occasionFilter === "all"
    ? likedOutfits.length
    : likedOutfits.filter((o) => o.occasion.toLowerCase() === occasionFilter.toLowerCase()).length;
  const filteredDislikedCount = occasionFilter === "all"
    ? dislikedOutfits.length
    : dislikedOutfits.filter((o) => o.occasion.toLowerCase() === occasionFilter.toLowerCase()).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
    <div>
      <h1 className="text-3xl font-semibold tracking-tight">History</h1>
      <p className="mt-2 text-sm text-slate-600">
            Review your past outfit recommendations and feedback.
          </p>
        </div>

        {/* Occasion Filter */}
        <div className="flex items-center gap-2">
          <label htmlFor="occasion-filter" className="text-sm font-medium text-slate-600">
            Filter by:
          </label>
          <select
            id="occasion-filter"
            value={occasionFilter}
            onChange={(e) => setOccasionFilter(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-500"
          >
            {OCCASIONS.map((occasion) => (
              <option key={occasion.value} value={occasion.value}>
                {occasion.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200">
        <button
          onClick={() => setActiveTab("liked")}
          className={`relative px-6 py-3 text-sm font-medium transition-colors ${
            activeTab === "liked"
              ? "text-green-700"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          <span className="flex items-center gap-2">
            <span>👍</span>
            Liked
            {filteredLikedCount > 0 && (
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
                {filteredLikedCount}
              </span>
            )}
          </span>
          {activeTab === "liked" && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-green-600" />
          )}
        </button>
        <button
          onClick={() => setActiveTab("disliked")}
          className={`relative px-6 py-3 text-sm font-medium transition-colors ${
            activeTab === "disliked"
              ? "text-red-700"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          <span className="flex items-center gap-2">
            <span>👎</span>
            Disliked
            {filteredDislikedCount > 0 && (
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                {filteredDislikedCount}
              </span>
            )}
          </span>
          {activeTab === "disliked" && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-red-600" />
          )}
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-slate-600" />
            <p className="text-sm text-slate-500">Loading your history...</p>
          </div>
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-red-700">{error}</p>
          <button
            onClick={fetchHistory}
            className="mt-3 rounded-lg bg-red-100 px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-200"
          >
            Try Again
          </button>
        </div>
      ) : currentOutfits.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-12 text-center">
          <div className="text-4xl mb-3">
            {activeTab === "liked" ? "👍" : "👎"}
          </div>
          <p className="text-slate-600">
            {occasionFilter !== "all" ? (
              <>No {activeTab} outfits found for <span className="font-medium capitalize">{occasionFilter}</span>.</>
            ) : activeTab === "liked" ? (
              "You haven't liked any outfits yet."
            ) : (
              "You haven't disliked any outfits yet."
            )}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            {occasionFilter !== "all" ? (
              "Try selecting a different occasion or clear the filter."
            ) : (
              "Get recommendations on the Home page and provide feedback to see them here."
            )}
          </p>
          {occasionFilter !== "all" && (
            <button
              onClick={() => setOccasionFilter("all")}
              className="mt-3 rounded-lg bg-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-300"
            >
              Clear Filter
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {currentOutfits.map((outfit) => (
            <div
              key={outfit.id}
              className={`rounded-xl border p-5 shadow-sm transition-colors ${
                activeTab === "liked"
                  ? "border-green-200 bg-green-50/50"
                  : "border-red-200 bg-red-50/50"
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <span
                    className={`rounded-full px-3 py-1 text-sm font-medium ${
                      activeTab === "liked"
                        ? "bg-green-200 text-green-800"
                        : "bg-red-200 text-red-800"
                    }`}
                  >
                    {activeTab === "liked" ? "👍 Liked" : "👎 Disliked"}
                  </span>
                  <span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-medium text-slate-700 capitalize">
                    {outfit.occasion}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-500">
                    {formatDate(outfit.createdAt)}
                  </span>
                  {/* More options dropdown */}
                  <div className="relative" ref={openMenuId === outfit.id ? menuRef : null}>
                    <button
                      onClick={() => setOpenMenuId(openMenuId === outfit.id ? null : outfit.id)}
                      className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-700"
                      title="More options"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                      >
                        <circle cx="12" cy="5" r="2" />
                        <circle cx="12" cy="12" r="2" />
                        <circle cx="12" cy="19" r="2" />
                      </svg>
                    </button>
                    {openMenuId === outfit.id && (
                      <div className="absolute right-0 top-full mt-1 z-10 min-w-[160px] rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                        <button
                          onClick={() => {
                            handleMove(
                              outfit.id,
                              activeTab === "liked" ? "rejected" : "accepted"
                            );
                            setOpenMenuId(null);
                          }}
                          className={`w-full px-4 py-2 text-left text-sm transition-colors flex items-center gap-2 ${
                            activeTab === "liked"
                              ? "text-red-700 hover:bg-red-50"
                              : "text-green-700 hover:bg-green-50"
                          }`}
                        >
                          <span>{activeTab === "liked" ? "👎" : "👍"}</span>
                          {activeTab === "liked" ? "Move to Disliked" : "Move to Liked"}
                        </button>
                        <button
                          onClick={() => {
                            handleRemove(outfit.id);
                            setOpenMenuId(null);
                          }}
                          className="w-full px-4 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-slate-100 flex items-center gap-2"
                        >
                          <span>🗑️</span>
                          Remove
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {outfit.items.map((item) => {
                  const imgSrc = imageUrlFromPath(item.imagePath);
                  return (
                  <div
                    key={item.id}
                    className="flex gap-3 rounded-lg border border-slate-100 bg-white p-3"
                  >
                    {/* Image */}
                    <div className="h-20 w-20 flex-shrink-0 overflow-hidden rounded-lg bg-slate-100">
                      {imgSrc ? (
                        <img
                          src={imgSrc}
                          alt={item.name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-slate-400">
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="24"
                            height="24"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M20.38 3.46L16 2a4 4 0 01-8 0L3.62 3.46a2 2 0 00-1.34 2.23l.58 3.47a1 1 0 00.99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 002-2V10h2.15a1 1 0 00.99-.84l.58-3.47a2 2 0 00-1.34-2.23z" />
                          </svg>
                        </div>
                      )}
                    </div>
                    {/* Details */}
                    <div className="flex flex-col justify-center min-w-0">
                      <p className="font-medium text-slate-900 truncate">{item.name}</p>
                      <p className="text-sm text-slate-500 capitalize">{item.category}</p>
                      {item.colors.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {item.colors.slice(0, 3).map((color, i) => (
                            <span
                              key={i}
                              className="rounded bg-slate-200 px-2 py-0.5 text-xs text-slate-700"
                            >
                              {color}
                            </span>
                          ))}
                          {item.colors.length > 3 && (
                            <span className="rounded bg-slate-200 px-2 py-0.5 text-xs text-slate-500">
                              +{item.colors.length - 3}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
