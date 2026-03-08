"use client";

import Link from "next/link";
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

function relativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const sec = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (sec < 60) return "Just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  const week = Math.floor(day / 7);
  if (week < 4) return `${week}w ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined });
}

export default function HistoryPage() {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>("liked");
  const [likedOutfits, setLikedOutfits] = useState<Interaction[]>([]);
  const [dislikedOutfits, setDislikedOutfits] = useState<Interaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
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

  const totalCount = likedOutfits.length + dislikedOutfits.length;

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
  const currentOutfits = baseOutfits;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
            History
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Your liked and disliked outfits. This helps us personalize future recommendations.
          </p>
        </div>
        {!loading && totalCount > 0 && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-500">
              <span className="font-medium text-green-600">{likedOutfits.length}</span> liked
              <span className="mx-1.5 text-slate-300">·</span>
              <span className="font-medium text-slate-600">{dislikedOutfits.length}</span> disliked
            </span>
            <button
              onClick={fetchHistory}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
              title="Refresh"
            >
              Refresh
            </button>
          </div>
        )}
      </div>

      {/* Tabs — pill style */}
      <div className="inline-flex rounded-xl bg-slate-100 p-1">
        <button
          onClick={() => setActiveTab("liked")}
          className={`rounded-lg px-4 py-2.5 text-sm font-medium transition-all ${
            activeTab === "liked"
              ? "bg-white text-green-700 shadow-sm"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          <span className="flex items-center gap-2">
            <span aria-hidden>👍</span>
            Liked
            {likedOutfits.length > 0 && (
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                  activeTab === "liked" ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-600"
                }`}
              >
                {likedOutfits.length}
              </span>
            )}
          </span>
        </button>
        <button
          onClick={() => setActiveTab("disliked")}
          className={`rounded-lg px-4 py-2.5 text-sm font-medium transition-all ${
            activeTab === "disliked"
              ? "bg-white text-red-700 shadow-sm"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          <span className="flex items-center gap-2">
            <span aria-hidden>👎</span>
            Disliked
            {dislikedOutfits.length > 0 && (
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                  activeTab === "disliked" ? "bg-red-100 text-red-700" : "bg-slate-200 text-slate-600"
                }`}
              >
                {dislikedOutfits.length}
              </span>
            )}
          </span>
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-16">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-200 border-t-slate-600" />
          <p className="mt-4 text-sm text-slate-500">Loading your history…</p>
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50/50 p-8 text-center">
          <p className="text-red-700">{error}</p>
          <button
            onClick={fetchHistory}
            className="mt-4 rounded-lg bg-red-100 px-4 py-2.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-200"
          >
            Try again
          </button>
        </div>
      ) : currentOutfits.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-12 text-center sm:p-16">
          <div className="text-5xl sm:text-6xl" aria-hidden>
            {activeTab === "liked" ? "👍" : "👎"}
          </div>
          <h2 className="mt-4 text-lg font-medium text-slate-800">
            {activeTab === "liked"
              ? "No liked outfits yet"
              : "No disliked outfits yet"}
          </h2>
          <p className="mt-2 max-w-sm mx-auto text-sm text-slate-500">
            Get recommendations on the home page and tap like or dislike — they’ll show up here.
          </p>
          <Link
            href="/dashboard"
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800"
          >
            Go to Home
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {currentOutfits.map((outfit) => {
            const isLiked = activeTab === "liked";
            return (
              <div
                key={outfit.id}
                className={`relative rounded-2xl border bg-white shadow-sm transition-shadow hover:shadow-md ${
                  isLiked ? "border-green-100" : "border-red-100"
                }`}
              >
                {/* Outfit thumbnails row — spaced, full image visible (no crop) */}
                <div className="flex gap-3 overflow-hidden rounded-t-2xl bg-slate-50 p-4">
                  {outfit.items.map((item) => {
                    const imgSrc = imageUrlFromPath(item.imagePath);
                    return (
                      <div
                        key={item.id}
                        className="flex flex-1 min-w-0 rounded-lg flex items-center justify-center overflow-hidden"
                        style={{ minHeight: 120 }}
                      >
                        {imgSrc ? (
                          <img
                            src={imgSrc}
                            alt=""
                            className="max-h-28 w-full object-contain"
                          />
                        ) : (
                          <div className="flex h-28 w-full items-center justify-center text-slate-300">
                            <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16" />
                            </svg>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Meta + actions */}
                <div className="p-4 pt-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p
                        className="text-xs font-medium text-slate-500 capitalize truncate"
                        title={outfit.occasion}
                      >
                        {outfit.occasion}
                      </p>
                      <p
                        className="text-xs text-slate-400 mt-0.5"
                        title={formatDate(outfit.createdAt)}
                      >
                        {relativeTime(outfit.createdAt)}
                      </p>
                    </div>
                    <div className="relative flex-shrink-0 pt-0.5" ref={openMenuId === outfit.id ? menuRef : null}>
                      <button
                        onClick={() => setOpenMenuId(openMenuId === outfit.id ? null : outfit.id)}
                        className="rounded-lg p-2.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                        title="Actions"
                        aria-expanded={openMenuId === outfit.id}
                        aria-haspopup="true"
                      >
                        <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                          <circle cx="12" cy="5" r="1.5" />
                          <circle cx="12" cy="12" r="1.5" />
                          <circle cx="12" cy="19" r="1.5" />
                        </svg>
                      </button>
                      {openMenuId === outfit.id && (
                        <div
                          className="absolute right-0 top-full z-20 mt-2 min-w-[200px] rounded-xl border border-slate-200 bg-white py-2 shadow-lg"
                          role="menu"
                        >
                          <button
                            onClick={() => {
                              handleMove(outfit.id, isLiked ? "rejected" : "accepted");
                              setOpenMenuId(null);
                            }}
                            className={`flex w-full items-center gap-2.5 px-4 py-3 text-left text-sm transition-colors ${
                              isLiked
                                ? "text-red-600 hover:bg-red-50"
                                : "text-green-600 hover:bg-green-50"
                            }`}
                            role="menuitem"
                          >
                            <span aria-hidden>{isLiked ? "👎" : "👍"}</span>
                            {isLiked ? "Move to disliked" : "Move to liked"}
                          </button>
                          <button
                            onClick={() => {
                              handleRemove(outfit.id);
                              setOpenMenuId(null);
                            }}
                            className="flex w-full items-center gap-2.5 px-4 py-3 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50"
                            role="menuitem"
                          >
                            <svg className="h-4 w-4 flex-shrink-0 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                            Remove from history
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Item names (compact) */}
                  <p className="mt-2 text-xs text-slate-500 truncate">
                    {outfit.items.map((i) => i.name).join(" · ")}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
