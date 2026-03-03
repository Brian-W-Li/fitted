"use client";

import { auth } from "@/lib/firebaseClient";
import { signOut, onAuthStateChanged, type User as FirebaseUser } from "firebase/auth";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";

interface OutfitItem {
  id: string;
  name: string;
  category: string;
  colors: string[];
  imagePath?: string;
}

interface BaseOutfit {
  top: OutfitItem;
  bottom: OutfitItem;
  reason: string;
  feedback?: "liked" | "disliked";
}

interface OuterLayerOption {
  id: string;
  name: string;
  category: string;
  colors: string[];
  imagePath?: string;
  reason: string;
}

interface FinalOutfit {
  top: OutfitItem;
  bottom: OutfitItem;
  outer?: OutfitItem;
  reason: string;
}

type RecommendationState =
  | { step: "idle" }
  | { step: "browsing"; outfits: BaseOutfit[]; hasOuterLayers: boolean }
  | { step: "selected"; outfit: BaseOutfit; hasOuterLayers: boolean }
  | { step: "outer_selection"; outfit: BaseOutfit; outerOptions: OuterLayerOption[] }
  | { step: "finalized"; outfit: FinalOutfit; feedback?: "liked" | "disliked" };

function imageUrlFromPath(imagePath?: string) {
  if (!imagePath) return null;
  if (imagePath.startsWith("mongo:")) {
    return `/api/images/${imagePath.slice("mongo:".length)}`;
  }
  return null;
}

export default function Home() {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);

  const [eventDescription, setEventDescription] = useState("");
  const [state, setState] = useState<RecommendationState>({ step: "idle" });
  const [currentOutfitIndex, setCurrentOutfitIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [outerLoading, setOuterLoading] = useState(false);
  const [error, setError] = useState("");

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

  const getRecommendations = async () => {
    if (!firebaseUser) {
      setError("Please sign in to get recommendations");
      return;
    }

    if (!eventDescription.trim()) {
      setError("Describe the event or context to get recommendations.");
      return;
    }

    setLoading(true);
    setError("");
    setCurrentOutfitIndex(0);

    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch("/api/recommend", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ eventContext: eventDescription }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to get recommendations");
        return;
      }

      if (!data.outfits?.length) {
        setError(data.message || "No outfit combinations found. Add more items to your wardrobe.");
        return;
      }

      setState({
        step: "browsing",
        outfits: data.outfits,
        hasOuterLayers: data.hasOuterLayers ?? false,
      });
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const selectOutfit = (outfit: BaseOutfit, hasOuterLayers: boolean) => {
    setState({ step: "selected", outfit, hasOuterLayers });
  };

  const goBackToBrowsing = () => {
    if (state.step === "selected" || state.step === "outer_selection") {
      const outfits = state.step === "selected" 
        ? [] // We need to re-fetch or store the outfits
        : [];
      getRecommendations(); // Re-fetch for simplicity
    }
  };

  const showOuterLayerOptions = async () => {
    if (state.step !== "selected" || !firebaseUser) return;

    setOuterLoading(true);

    try {
      const token = await firebaseUser.getIdToken();
      const { outfit } = state;
      
      const res = await fetch("/api/recommend/outer", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          topId: outfit.top.id,
          bottomId: outfit.bottom.id,
          topName: outfit.top.name,
          bottomName: outfit.bottom.name,
          topColors: outfit.top.colors,
          bottomColors: outfit.bottom.colors,
          eventContext: eventDescription,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to get outer layer recommendations");
        setOuterLoading(false);
        return;
      }

      if (!data.outerLayers?.length) {
        finalizeOutfit(outfit);
        return;
      }

      setState({
        step: "outer_selection",
        outfit,
        outerOptions: data.outerLayers,
      });
    } catch {
      setError("Failed to get outer layer options.");
    } finally {
      setOuterLoading(false);
    }
  };

  const finalizeOutfit = (baseOutfit: BaseOutfit, outer?: OuterLayerOption) => {
    const finalOutfit: FinalOutfit = {
      top: baseOutfit.top,
      bottom: baseOutfit.bottom,
      reason: baseOutfit.reason,
    };

    if (outer) {
      finalOutfit.outer = {
        id: outer.id,
        name: outer.name,
        category: outer.category,
        colors: outer.colors,
        imagePath: outer.imagePath,
      };
      finalOutfit.reason = outer.reason;
    }

    setState({ step: "finalized", outfit: finalOutfit });
  };

  const skipOuterLayer = () => {
    if (state.step === "selected") {
      finalizeOutfit(state.outfit);
    } else if (state.step === "outer_selection") {
      finalizeOutfit(state.outfit);
    }
  };

  const handleBrowsingFeedback = async (outfitIndex: number, action: "accepted" | "rejected") => {
    if (!firebaseUser || state.step !== "browsing") return;

    const outfit = state.outfits[outfitIndex];
    const itemIds = [outfit.top.id, outfit.bottom.id];

    try {
      const token = await firebaseUser.getIdToken();
      await fetch("/api/interactions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          itemIds,
          action,
          occasion: eventDescription,
        }),
      });

      // Update the outfit's feedback in state
      setState({
        ...state,
        outfits: state.outfits.map((o, i) =>
          i === outfitIndex
            ? { ...o, feedback: action === "accepted" ? "liked" : "disliked" }
            : o
        ),
      });
    } catch (error) {
      console.error("Error saving feedback:", error);
    }
  };

  const handleFeedback = async (action: "accepted" | "rejected") => {
    if (!firebaseUser || state.step !== "finalized") return;

    const { outfit } = state;
    const itemIds = [outfit.top.id, outfit.bottom.id];
    if (outfit.outer) itemIds.push(outfit.outer.id);

    try {
      const token = await firebaseUser.getIdToken();
      await fetch("/api/interactions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          itemIds,
          action,
          occasion: eventDescription,
        }),
      });

      setState({
        ...state,
        feedback: action === "accepted" ? "liked" : "disliked",
      });
    } catch (error) {
      console.error("Error saving feedback:", error);
    }
  };

  const startOver = () => {
    setState({ step: "idle" });
    setCurrentOutfitIndex(0);
    setError("");
  };

  const renderItemCard = (item: OutfitItem, label: string) => {
    const imgSrc = imageUrlFromPath(item.imagePath);
    return (
      <div className="flex flex-col items-center">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
          {label}
        </span>
        <div className="w-36 bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
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
          <div className="p-3 text-center">
            <p className="font-medium text-slate-900 text-sm truncate">{item.name}</p>
            {item.colors.length > 0 && (
              <p className="text-xs text-slate-500 mt-1">{item.colors.join(", ")}</p>
            )}
          </div>
        </div>
      </div>
    );
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

      <div className="rounded-xl border border-slate-200 bg-white p-6">
        {/* Step: idle */}
        {state.step === "idle" && (
          <>
            <div>
              <h2 className="text-xl font-semibold tracking-tight">Get Outfit Recommendations</h2>
              <p className="mt-1 text-sm text-slate-600">
                Tell us about your event and we&apos;ll suggest 5 outfit options.
              </p>
            </div>

            <div className="mt-4 flex flex-col gap-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600 mb-1">
                  Event description
                </label>
                <textarea
                  value={eventDescription}
                  onChange={(e) => setEventDescription(e.target.value)}
                  rows={3}
                  maxLength={280}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 placeholder:text-slate-400"
                  placeholder="e.g. Outdoor brunch with friends in mild weather, want something smart casual but comfortable."
                />
                <div className="mt-1 flex justify-between text-[11px] text-slate-500">
                  <span>Describe the vibe, weather, and any constraints.</span>
                  <span>{eventDescription.length}/280</span>
                </div>
              </div>

              <button
                onClick={getRecommendations}
                disabled={loading}
                className="self-start px-6 py-2.5 bg-slate-900 text-white rounded-lg hover:bg-slate-800 disabled:bg-slate-400 disabled:cursor-not-allowed transition-colors font-medium"
              >
                {loading ? "Generating..." : "Get Recommendations"}
              </button>
            </div>

            {error && (
              <div className="mt-4 p-4 bg-red-50 text-red-700 rounded-lg text-sm">
                {error}
              </div>
            )}

            <div className="mt-8 p-6 bg-slate-50 rounded-lg text-center">
              <p className="text-slate-600">
                Click &quot;Get Recommendations&quot; to see 5 outfit suggestions.
              </p>
              <p className="mt-2 text-sm text-slate-500">
                You&apos;ll pick one, then optionally add an outer layer.
              </p>
            </div>
          </>
        )}

        {/* Step: browsing - Carousel of 5 outfits */}
        {state.step === "browsing" && (
          <>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-xl font-semibold tracking-tight">Pick Your Base Outfit</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Swipe through {state.outfits.length} outfit options and select your favorite.
                </p>
              </div>
              <button
                onClick={startOver}
                className="text-sm text-slate-500 hover:text-slate-700"
              >
                Start Over
              </button>
            </div>

            <div className={`rounded-xl p-6 border transition-colors ${
              state.outfits[currentOutfitIndex].feedback === "liked"
                ? "bg-green-50 border-green-200"
                : state.outfits[currentOutfitIndex].feedback === "disliked"
                ? "bg-red-50 border-red-200"
                : "bg-slate-50 border-slate-200"
            }`}>
              <div className="flex items-center justify-between mb-4">
                <span className="px-3 py-1 bg-slate-900 text-white text-sm font-medium rounded-full">
                  Outfit {currentOutfitIndex + 1} of {state.outfits.length}
                </span>
                
                {/* Like/Dislike buttons */}
                {!state.outfits[currentOutfitIndex].feedback ? (
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleBrowsingFeedback(currentOutfitIndex, "accepted")}
                      className="px-3 py-1 bg-green-100 text-green-700 text-sm font-medium rounded-lg hover:bg-green-200 transition-colors flex items-center gap-1"
                    >
                      <span>👍</span> Like
                    </button>
                    <button
                      onClick={() => handleBrowsingFeedback(currentOutfitIndex, "rejected")}
                      className="px-3 py-1 bg-red-100 text-red-700 text-sm font-medium rounded-lg hover:bg-red-200 transition-colors flex items-center gap-1"
                    >
                      <span>👎</span> Dislike
                    </button>
                  </div>
                ) : (
                  <span className={`px-3 py-1 text-sm font-medium rounded-lg ${
                    state.outfits[currentOutfitIndex].feedback === "liked"
                      ? "bg-green-200 text-green-800"
                      : "bg-red-200 text-red-800"
                  }`}>
                    {state.outfits[currentOutfitIndex].feedback === "liked" ? "👍 Liked" : "👎 Disliked"}
                  </span>
                )}
              </div>

              <div className="flex justify-center gap-8 mb-6">
                {renderItemCard(state.outfits[currentOutfitIndex].top, "Top")}
                {renderItemCard(state.outfits[currentOutfitIndex].bottom, "Bottom")}
              </div>

              <p className="text-center text-sm text-slate-600 italic mb-6">
                &quot;{state.outfits[currentOutfitIndex].reason}&quot;
              </p>

              <div className="flex justify-center gap-3 mb-6">
                <button
                  onClick={() => setCurrentOutfitIndex((i) => Math.max(0, i - 1))}
                  disabled={currentOutfitIndex === 0}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <button
                  onClick={() => selectOutfit(state.outfits[currentOutfitIndex], state.hasOuterLayers)}
                  className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium"
                >
                  Select This Outfit
                </button>
                <button
                  onClick={() => setCurrentOutfitIndex((i) => Math.min(state.outfits.length - 1, i + 1))}
                  disabled={currentOutfitIndex === state.outfits.length - 1}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>

              {/* Pagination dots with feedback indicators */}
              <div className="flex justify-center gap-2">
                {state.outfits.map((outfit, i) => (
                  <button
                    key={i}
                    onClick={() => setCurrentOutfitIndex(i)}
                    className={`w-3 h-3 rounded-full transition-colors ${
                      outfit.feedback === "liked"
                        ? "bg-green-500"
                        : outfit.feedback === "disliked"
                        ? "bg-red-500"
                        : i === currentOutfitIndex
                        ? "bg-slate-900"
                        : "bg-slate-300 hover:bg-slate-400"
                    } ${i === currentOutfitIndex ? "ring-2 ring-offset-2 ring-slate-400" : ""}`}
                    aria-label={`Go to outfit ${i + 1}${outfit.feedback ? ` (${outfit.feedback})` : ""}`}
                  />
                ))}
              </div>
            </div>

            <div className="mt-4 text-center">
              <button
                onClick={getRecommendations}
                disabled={loading}
                className="text-sm text-slate-500 hover:text-slate-700"
              >
                {loading ? "Generating..." : "Generate New Options"}
              </button>
            </div>
          </>
        )}

        {/* Step: selected - Ask about outer layer */}
        {state.step === "selected" && (
          <>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-xl font-semibold tracking-tight">Add an Outer Layer?</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Your selection: {state.outfit.top.name} + {state.outfit.bottom.name}
                </p>
              </div>
              <button
                onClick={goBackToBrowsing}
                className="text-sm text-slate-500 hover:text-slate-700"
              >
                Back
              </button>
            </div>

            <div className="flex justify-center gap-8 mb-8">
              {renderItemCard(state.outfit.top, "Top")}
              {renderItemCard(state.outfit.bottom, "Bottom")}
            </div>

            <div className="bg-slate-50 rounded-xl p-6 border border-slate-200 max-w-md mx-auto">
              <p className="text-center text-slate-700 mb-6">
                Would you like to add a jacket, coat, or hoodie?
              </p>

              <div className="flex flex-col gap-3">
                {state.hasOuterLayers ? (
                  <button
                    onClick={showOuterLayerOptions}
                    disabled={outerLoading}
                    className="w-full px-6 py-3 bg-slate-900 text-white rounded-lg hover:bg-slate-800 disabled:bg-slate-400 font-medium"
                  >
                    {outerLoading ? "Loading options..." : "Yes, show me options"}
                  </button>
                ) : (
                  <div className="w-full px-6 py-3 bg-slate-200 text-slate-500 rounded-lg text-center">
                    No outer layers in your wardrobe
                  </div>
                )}

                <button
                  onClick={skipOuterLayer}
                  className="w-full px-6 py-3 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-100 font-medium"
                >
                  No, I&apos;m good with just top + bottom
                </button>
              </div>
            </div>
          </>
        )}

        {/* Step: outer_selection - Choose outer layer */}
        {state.step === "outer_selection" && (
          <>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-xl font-semibold tracking-tight">Choose an Outer Layer</h2>
                <p className="mt-1 text-sm text-slate-600">
                  For: {state.outfit.top.name} + {state.outfit.bottom.name}
                </p>
              </div>
              <button
                onClick={() => setState({ step: "selected", outfit: state.outfit, hasOuterLayers: true })}
                className="text-sm text-slate-500 hover:text-slate-700"
              >
                Back
              </button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
              {state.outerOptions.map((outer) => {
                const imgSrc = imageUrlFromPath(outer.imagePath);
                return (
                  <button
                    key={outer.id}
                    onClick={() => finalizeOutfit(state.outfit, outer)}
                    className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm hover:border-slate-400 hover:shadow-md transition-all text-left"
                  >
                    {imgSrc ? (
                      <div className="h-32 w-full bg-slate-50 flex items-center justify-center p-2">
                        <img
                          src={imgSrc}
                          alt={outer.name}
                          className="max-h-full max-w-full object-contain"
                          loading="lazy"
                        />
                      </div>
                    ) : (
                      <div className="flex h-32 w-full items-center justify-center bg-slate-50 text-xs text-slate-400">
                        No photo
                      </div>
                    )}
                    <div className="p-3">
                      <p className="font-medium text-slate-900 text-sm truncate">{outer.name}</p>
                      <p className="text-xs text-slate-500 mt-1 line-clamp-2">&quot;{outer.reason}&quot;</p>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="text-center">
              <button
                onClick={skipOuterLayer}
                className="px-6 py-2 text-slate-500 hover:text-slate-700"
              >
                Skip - Finalize without outer layer
              </button>
            </div>
          </>
        )}

        {/* Step: finalized - Show final outfit */}
        {state.step === "finalized" && (
          <>
            <div className="text-center mb-6">
              <h2 className="text-2xl font-semibold tracking-tight">Your Outfit is Ready!</h2>
            </div>

            <div className="bg-slate-50 rounded-xl p-6 border border-slate-200">
              <div className="flex justify-center gap-6 mb-6 flex-wrap">
                {renderItemCard(state.outfit.top, "Top")}
                {renderItemCard(state.outfit.bottom, "Bottom")}
                {state.outfit.outer && renderItemCard(state.outfit.outer, "Outer")}
              </div>

              <p className="text-center text-sm text-slate-600 italic mb-6">
                &quot;{state.outfit.reason}&quot;
              </p>

              {!state.feedback && (
                <div className="flex justify-center gap-4 mb-4">
                  <button
                    onClick={() => handleFeedback("accepted")}
                    className="px-6 py-2.5 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 font-medium flex items-center gap-2"
                  >
                    <span>👍</span> Like & Save
                  </button>
                  <button
                    onClick={() => handleFeedback("rejected")}
                    className="px-6 py-2.5 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 font-medium flex items-center gap-2"
                  >
                    <span>👎</span> Dislike
                  </button>
                </div>
              )}

              {state.feedback && (
                <div className="flex justify-center mb-4">
                  <span
                    className={`px-4 py-2 rounded-lg font-medium ${
                      state.feedback === "liked"
                        ? "bg-green-200 text-green-800"
                        : "bg-red-200 text-red-800"
                    }`}
                  >
                    {state.feedback === "liked" ? "👍 Saved to your history!" : "👎 Feedback recorded"}
                  </span>
                </div>
              )}

              <div className="text-center">
                <button
                  onClick={startOver}
                  className="px-6 py-2 text-slate-600 hover:text-slate-800 font-medium"
                >
                  Start Over with New Outfits
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* How it works - only show in idle state */}
      {state.step === "idle" && (
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <h3 className="font-semibold text-slate-900">How It Works</h3>
          <div className="mt-4 grid md:grid-cols-4 gap-4">
            <div className="p-4 bg-blue-50 rounded-lg">
              <div className="text-2xl mb-2">1️⃣</div>
              <p className="font-medium text-slate-900">Browse Outfits</p>
              <p className="text-sm text-slate-600 mt-1">
                We generate 5 top + bottom combinations for your event.
              </p>
            </div>
            <div className="p-4 bg-purple-50 rounded-lg">
              <div className="text-2xl mb-2">2️⃣</div>
              <p className="font-medium text-slate-900">Pick Your Favorite</p>
              <p className="text-sm text-slate-600 mt-1">
                Swipe through and select the outfit you like best.
              </p>
            </div>
            <div className="p-4 bg-orange-50 rounded-lg">
              <div className="text-2xl mb-2">3️⃣</div>
              <p className="font-medium text-slate-900">Add Outer Layer</p>
              <p className="text-sm text-slate-600 mt-1">
                Optionally add a jacket or hoodie that complements your outfit.
              </p>
            </div>
            <div className="p-4 bg-green-50 rounded-lg">
              <div className="text-2xl mb-2">4️⃣</div>
              <p className="font-medium text-slate-900">Save & Learn</p>
              <p className="text-sm text-slate-600 mt-1">
                Like or dislike to help AI learn your style preferences.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
