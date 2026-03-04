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

function imageUrlFromPath(imagePath?: string) {
  if (!imagePath) return null;
  if (imagePath.startsWith("mongo:")) {
    return `/api/images/${imagePath.slice("mongo:".length)}`;
  }
  return null;
}

interface Outfit {
  items: OutfitItem[];
  reason: string;
  score?: number; // confidence score from LLM (0-100)
  feedback?: "liked" | "disliked";
}

export default function Home() {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  
  // Recommendation state
  const [eventDescription, setEventDescription] = useState("");
  const [outfits, setOutfits] = useState<Outfit[]>([]);
  const [recLoading, setRecLoading] = useState(false);
  const [recError, setRecError] = useState("");
  const [recMessage, setRecMessage] = useState("");

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
        body: JSON.stringify({ eventDescription }),
      });

      const data = await res.json();

      if (!res.ok) {
        setRecError(data.error || "Failed to get recommendations");
        return;
      }

      setOutfits(data.outfits || []);
      if (!data.outfits?.length && data.message) {
        setRecMessage(data.message);
      } else if (data.message) {
        // Optional: show a softer informational message even when outfits exist
        setRecMessage(data.message);
      }
    } catch {
      setRecError("Something went wrong. Please try again.");
    } finally {
      setRecLoading(false);
    }
  };

  const handleFeedback = async (outfitIndex: number, action: "accepted" | "rejected") => {
    if (!firebaseUser) return;

    const outfit = outfits[outfitIndex];
    const itemIds = outfit.items.map(item => item.id);

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
          // Keep sending a label for now; using the free-text description
          occasion: eventDescription,
        }),
      });

      // Update UI to show feedback
      setOutfits(prev => prev.map((o, i) => 
        i === outfitIndex 
          ? { ...o, feedback: action === "accepted" ? "liked" : "disliked" }
          : o
      ));
    } catch (error) {
      console.error("Error saving feedback:", error);
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return "text-green-600 bg-green-100";
    if (score >= 60) return "text-yellow-600 bg-yellow-100";
    return "text-orange-600 bg-orange-100";
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
              Our AI stylist uses your wardrobe, event description, and color/style cues to suggest outfits.
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-3">
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
              placeholder="e.g. Outdoor brunch with friends in mild weather, want something smart casual but comfortable."
            />
            <div className="mt-1 flex justify-between text-[11px] text-slate-500">
              <span>Tell the AI what the event is, vibe, and any constraints.</span>
              <span>{eventDescription.length}/280</span>
            </div>
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

        {outfits.length > 0 && (
          <div className="mt-6 space-y-4">
            {outfits.map((outfit, index) => (
              <div
                key={index}
                className={`p-5 border rounded-xl shadow-sm transition-colors ${
                  outfit.feedback === "liked" 
                    ? "bg-green-50 border-green-200" 
                    : outfit.feedback === "disliked"
                    ? "bg-red-50 border-red-200"
                    : "bg-slate-50 border-slate-200"
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="px-3 py-1 bg-slate-900 text-white text-sm font-medium rounded-full">
                      Outfit {index + 1}
                    </span>
                    {outfit.score !== undefined && (
                      <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getScoreColor(outfit.score)}`}>
                        {outfit.score}/100
                      </span>
                    )}
                  </div>
                  
                  {/* Like/Dislike buttons */}
                  {!outfit.feedback && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleFeedback(index, "accepted")}
                        className="px-3 py-1 bg-green-100 text-green-700 text-sm font-medium rounded-lg hover:bg-green-200 transition-colors flex items-center gap-1"
                      >
                        <span>👍</span> Like
                      </button>
                      <button
                        onClick={() => handleFeedback(index, "rejected")}
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

                <div className="grid grid-cols-2 gap-3 mb-3">
                  {outfit.items.map((item) => {
                    const imgSrc = imageUrlFromPath(item.imagePath);
                    return (
                      <div
                        key={item.id}
                        className="bg-white rounded-lg border border-slate-100 overflow-hidden"
                      >
                        {imgSrc ? (
                          <div className="h-56 w-full bg-slate-50 flex items-center justify-center p-2">
                            <img
                              src={imgSrc}
                              alt={item.name}
                              className="max-h-full max-w-full object-contain"
                              loading="lazy"
                            />
                          </div>
                        ) : (
                          <div className="flex h-56 w-full items-center justify-center bg-slate-50 text-xs text-slate-400">
                            No photo
                          </div>
                        )}
                        <div className="p-3">
                          <p className="font-medium text-slate-900">{item.name}</p>
                          <p className="text-sm text-slate-500">{item.category}</p>
                          {item.colors.length > 0 && (
                            <div className="mt-1 flex gap-1 flex-wrap">
                              {item.colors.map((color, i) => (
                                <span
                                  key={i}
                                  className="px-2 py-0.5 bg-slate-200 text-slate-700 text-xs rounded"
                                >
                                  {color}
                                </span>
                              ))}
                            </div>
                          )}
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
        <h3 className="font-semibold text-slate-900">How the ML Engine Works</h3>
        <div className="mt-4 grid md:grid-cols-3 gap-4">
          <div className="p-4 bg-blue-50 rounded-lg">
            <div className="text-2xl mb-2">🎨</div>
            <p className="font-medium text-slate-900">Color Theory</p>
            <p className="text-sm text-slate-600 mt-1">
              Analyzes color harmony using complementary, analogous, and neutral color matching.
            </p>
          </div>
          <div className="p-4 bg-purple-50 rounded-lg">
            <div className="text-2xl mb-2">👔</div>
            <p className="font-medium text-slate-900">Style Matching</p>
            <p className="text-sm text-slate-600 mt-1">
              Pairs items that suit the occasion (e.g. casual with casual, work-appropriate with work).
            </p>
          </div>
          <div className="p-4 bg-green-50 rounded-lg">
            <div className="text-2xl mb-2">🧠</div>
            <p className="font-medium text-slate-900">Learns from You</p>
            <p className="text-sm text-slate-600 mt-1">
              Your likes and dislikes improve future recommendations over time.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
