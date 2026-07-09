"use client";

import Link from "next/link";
import { auth } from "@/lib/firebaseClient";
import { onAuthStateChanged, type User as FirebaseUser } from "firebase/auth";
import { useState, useEffect } from "react";
import { resolveImageSrc } from "@/lib/imageUrl";

// ============================================================================
// M5 §I history — APPEND-ONLY. Corrections are new events, so there is no move/remove/edit
// affordance (the PATCH/DELETE handlers are gone). Card content is server-JOINED from the bound
// snapshot candidate via {snapshotId, candidateId} at read time (styleMove/items/displayItems),
// never denormalized interaction-row content.
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

interface HistoryCard {
  id: string;
  action: "accepted" | "rejected";
  occasion: string;
  createdAt: string;
  snapshotId: string | null;
  candidateId: string | null;
  displayItems: DisplayItem[];
  styleMove: StyleMove | null;
  optionPath?: string;
  risk?: string;
  templateType?: string;
}

type TabType = "liked" | "disliked";

// §6.5 displayItems.imageUrl is already "/api/images/<id>" (or external) — resolve via the shared,
// unit-tested helper (the mongo:-only version rendered no image for the resolved form).
const imageUrlFromPath = resolveImageSrc;

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
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function HistoryPage() {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>("liked");
  const [liked, setLiked] = useState<HistoryCard[]>([]);
  const [disliked, setDisliked] = useState<HistoryCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => setFirebaseUser(user));
    return () => unsub();
  }, []);

  useEffect(() => {
    if (firebaseUser) void fetchHistory(firebaseUser);
  }, [firebaseUser]);

  async function fetchHistory(user: FirebaseUser) {
    setLoading(true);
    setError("");
    try {
      const token = await user.getIdToken();
      const [likedRes, dislikedRes] = await Promise.all([
        fetch("/api/interactions?action=accepted", { headers: { Authorization: `Bearer ${token}` } }),
        fetch("/api/interactions?action=rejected", { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (!likedRes.ok || !dislikedRes.ok) throw new Error("Failed to fetch history");
      const [likedData, dislikedData] = await Promise.all([likedRes.json(), dislikedRes.json()]);
      setLiked(likedData.interactions ?? []);
      setDisliked(dislikedData.interactions ?? []);
    } catch (err) {
      console.error("Error fetching history:", err);
      setError("Failed to load your outfit history. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const cards = activeTab === "liked" ? liked : disliked;
  const total = liked.length + disliked.length;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">History</h1>
          <p className="mt-1 text-sm text-slate-500">
            Your liked and disliked outfits. This helps us personalize future recommendations. Feedback is a
            running log — to change your mind, just react again.
          </p>
        </div>
        {!loading && total > 0 && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-500">
              <span className="font-medium text-green-600">{liked.length}</span> liked
              <span className="mx-1.5 text-slate-300">·</span>
              <span className="font-medium text-slate-600">{disliked.length}</span> disliked
            </span>
            <button
              onClick={() => firebaseUser && fetchHistory(firebaseUser)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
            >
              Refresh
            </button>
          </div>
        )}
      </div>

      <div className="inline-flex rounded-xl bg-slate-100 p-1">
        {(["liked", "disliked"] as TabType[]).map((tab) => {
          const count = tab === "liked" ? liked.length : disliked.length;
          const activeColor = tab === "liked" ? "text-green-700" : "text-red-700";
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`rounded-lg px-4 py-2.5 text-sm font-medium transition-all ${
                activeTab === tab ? `bg-white ${activeColor} shadow-sm` : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <span className="flex items-center gap-2">
                <span aria-hidden>{tab === "liked" ? "👍" : "👎"}</span>
                {tab === "liked" ? "Liked" : "Disliked"}
                {count > 0 && (
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${activeTab === tab ? "bg-slate-100 text-slate-700" : "bg-slate-200 text-slate-600"}`}>
                    {count}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-16">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-200 border-t-slate-600" />
          <p className="mt-4 text-sm text-slate-500">Loading your history…</p>
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50/50 p-8 text-center">
          <p className="text-red-700">{error}</p>
          <button
            onClick={() => firebaseUser && fetchHistory(firebaseUser)}
            className="mt-4 rounded-lg bg-red-100 px-4 py-2.5 text-sm font-medium text-red-700 hover:bg-red-200"
          >
            Try again
          </button>
        </div>
      ) : cards.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-12 text-center sm:p-16">
          <div className="text-5xl sm:text-6xl" aria-hidden>
            {activeTab === "liked" ? "👍" : "👎"}
          </div>
          <h2 className="mt-4 text-lg font-medium text-slate-800">
            {activeTab === "liked" ? "No liked outfits yet" : "No disliked outfits yet"}
          </h2>
          <p className="mt-2 max-w-sm mx-auto text-sm text-slate-500">
            Get recommendations on the home page and tap like or dislike — they&apos;ll show up here.
          </p>
          <Link href="/dashboard" className="mt-6 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800">
            Go to Home
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((card) => {
            const isLiked = activeTab === "liked";
            return (
              <div
                key={card.id}
                className={`relative rounded-2xl border bg-white shadow-sm transition-shadow hover:shadow-md ${isLiked ? "border-green-100" : "border-red-100"}`}
              >
                <div className="flex gap-3 overflow-hidden rounded-t-2xl bg-slate-50 p-4">
                  {card.displayItems.length === 0 ? (
                    <div className="flex h-28 w-full items-center justify-center text-xs text-slate-400">Outfit unavailable</div>
                  ) : (
                    card.displayItems.map((item) => {
                      const imgSrc = imageUrlFromPath(item.imageUrl);
                      return (
                        <div key={item.itemId} className="flex flex-1 min-w-0 items-center justify-center overflow-hidden rounded-lg" style={{ minHeight: 120 }}>
                          {imgSrc ? (
                            <img src={imgSrc} alt={item.name ?? ""} className="max-h-28 w-full object-contain" />
                          ) : (
                            <div className="flex h-28 w-full items-center justify-center text-slate-300">
                              <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16" />
                              </svg>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>

                <div className="p-4 pt-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-slate-500 capitalize truncate" title={card.occasion}>
                        {card.occasion}
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5">{relativeTime(card.createdAt)}</p>
                    </div>
                    {card.risk && (
                      <span className="flex-shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">{card.risk}</span>
                    )}
                  </div>

                  {card.styleMove?.oneSentence && (
                    <p className="mt-2 text-xs italic text-slate-500 line-clamp-2">“{card.styleMove.oneSentence}”</p>
                  )}
                  <p className="mt-2 text-xs text-slate-500 truncate">
                    {card.displayItems.map((i) => i.name ?? "Item").join(" · ")}
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
