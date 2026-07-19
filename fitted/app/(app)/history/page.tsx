"use client";

import Link from "next/link";
import { auth } from "@/lib/firebaseClient";
import { onAuthStateChanged, type User as FirebaseUser } from "firebase/auth";
import { useState, useEffect } from "react";
import { resolveImageSrc } from "@/lib/imageUrl";

// ============================================================================
// M5 §I history — the CURATION view. Writes stay append-only, but a friend can CURATE from here
// (D-1): FLIP a reaction (an appended opposite action via POST — H61 latest-state makes it win) or
// REMOVE it (a user-scoped hard-delete of every row for the {snapshotId, candidateId} binding, DELETE
// /api/interactions — the "little bro tapped 5 reactions" case). The server collapses to per-candidate
// latest-state (§23-H61), so one card shows per outfit (a dislike + its "why" enrich, or a since-flipped
// like, read as ONE card in its winning tab, never two). Card content is server-JOINED from the bound
// snapshot candidate at read time, never denormalized interaction-row content.
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

// Code-aware curation error copy (audit #8): a storage/rate ceiling must not read as a generic
// "try again" the friend can retry forever without effect.
function curationErrorMessage(code: string | undefined, verb: "update" | "remove"): string {
  if (code === "rate_limited") return "You're doing that a lot — wait a moment and try again.";
  if (code === "storage_limit") return "You've hit the feedback limit — remove a few reactions first.";
  return verb === "remove"
    ? "Couldn't remove that reaction. Please try again."
    : "Couldn't update that reaction. Please try again.";
}

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
  const [cards, setCards] = useState<HistoryCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Curation state: which card is mid-request (buttons disabled), which is awaiting remove-confirm,
  // and a transient per-action error that doesn't blow away the whole list.
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");

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
    setActionError("");
    try {
      const token = await user.getIdToken();
      // ONE call — the server returns latest-state for BOTH signs; we split into tabs client-side (a
      // per-action query would strand a flipped candidate under its stale sign, and one call halves
      // the cold-connect round-trips on the free-tier Atlas).
      const res = await fetch("/api/interactions", { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error("Failed to fetch history");
      const data = await res.json();
      setCards((data.interactions ?? []) as HistoryCard[]);
    } catch (err) {
      console.error("Error fetching history:", err);
      setError("Failed to load your outfit history. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  // FLIP — append the opposite action (POST); H61 latest-state makes it win, so the card moves tabs.
  async function flipReaction(card: HistoryCard) {
    if (!firebaseUser || busyId || !card.snapshotId || !card.candidateId) return;
    const opposite = card.action === "accepted" ? "rejected" : "accepted";
    setBusyId(card.id);
    setActionError("");
    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch("/api/interactions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ snapshotId: card.snapshotId, candidateId: card.candidateId, action: opposite }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { code?: string } | null;
        setActionError(curationErrorMessage(body?.code, "update"));
        return;
      }
      // Update the action in place — the card leaves THIS tab (shownCards filters by activeTab) and
      // its count moves to the other. We deliberately do NOT auto-switch tabs: a friend curating a
      // list shouldn't be yanked away mid-review; the other tab's badge shows where it went.
      setCards((prev) => prev.map((c) => (c.id === card.id ? { ...c, action: opposite } : c)));
    } catch {
      setActionError("Couldn't update that reaction. Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  // REMOVE — hard-delete every row for the binding (DELETE). A 404 means it's already gone → treat as
  // success (idempotent): the card leaves the list either way.
  async function removeReaction(card: HistoryCard) {
    if (!firebaseUser || busyId || !card.snapshotId || !card.candidateId) return;
    setBusyId(card.id);
    setActionError("");
    try {
      const token = await firebaseUser.getIdToken();
      const qs = `snapshotId=${encodeURIComponent(card.snapshotId)}&candidateId=${encodeURIComponent(card.candidateId)}`;
      const res = await fetch(`/api/interactions?${qs}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok && res.status !== 404) {
        const body = (await res.json().catch(() => null)) as { code?: string } | null;
        setActionError(curationErrorMessage(body?.code, "remove"));
        return;
      }
      setCards((prev) => prev.filter((c) => c.id !== card.id));
    } catch {
      setActionError("Couldn't remove that reaction. Please try again.");
    } finally {
      setBusyId(null);
      setConfirmRemoveId(null);
    }
  }

  const liked = cards.filter((c) => c.action === "accepted");
  const disliked = cards.filter((c) => c.action === "rejected");
  const shownCards = activeTab === "liked" ? liked : disliked;
  const total = cards.length;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">History</h1>
          <p className="mt-1 text-sm text-slate-500">
            Your liked and disliked outfits — this helps personalize your recommendations. Changed your
            mind? <span className="font-medium text-slate-600">Flip</span> a reaction or{" "}
            <span className="font-medium text-slate-600">Remove</span> it entirely.
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

      {actionError && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{actionError}</div>
      )}

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
      ) : shownCards.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-12 text-center sm:p-16">
          <h2 className="text-lg font-medium text-slate-800">
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
          {shownCards.map((card) => {
            const isLiked = card.action === "accepted";
            const busy = busyId === card.id;
            const confirming = confirmRemoveId === card.id;
            const curatable = Boolean(card.snapshotId && card.candidateId);
            return (
              <div
                key={`${card.snapshotId}:${card.candidateId}`}
                className={`relative rounded-2xl border bg-white shadow-sm transition-shadow hover:shadow-md ${isLiked ? "border-green-100" : "border-red-100"} ${busy ? "opacity-60" : ""}`}
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

                  {/* Curation controls (D-1). Hidden for the (Track-2-nonexistent) unbound legacy row. */}
                  {curatable && (
                    <div className="mt-3 border-t border-slate-100 pt-3">
                      {confirming ? (
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs text-slate-600">Remove this reaction?</span>
                          <div className="flex gap-1.5">
                            <button
                              onClick={() => removeReaction(card)}
                              disabled={busy}
                              className="rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                            >
                              Remove
                            </button>
                            <button
                              onClick={() => setConfirmRemoveId(null)}
                              disabled={busy}
                              className="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-200 disabled:opacity-50"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => flipReaction(card)}
                            disabled={busy}
                            className={`rounded-md px-2.5 py-1 text-xs font-medium disabled:opacity-50 ${isLiked ? "bg-red-50 text-red-700 hover:bg-red-100" : "bg-green-50 text-green-700 hover:bg-green-100"}`}
                          >
                            {isLiked ? "Change to dislike" : "Change to like"}
                          </button>
                          <button
                            onClick={() => { setConfirmRemoveId(card.id); setActionError(""); }}
                            disabled={busy}
                            className="rounded-md px-2.5 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
                          >
                            Remove
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
