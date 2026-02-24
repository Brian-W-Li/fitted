"use client";

import { useState } from "react";
import { auth } from "@/lib/firebaseClient";

interface OutfitItem {
  id: string;
  name: string;
  category: string;
  colors: string[];
}

interface Outfit {
  items: OutfitItem[];
  reason: string;
}

export default function OutfitsPage() {
  const [occasion, setOccasion] = useState("casual");
  const [outfits, setOutfits] = useState<Outfit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const getRecommendations = async () => {
    setLoading(true);
    setError("");
    setOutfits([]);

    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) {
        setError("Please sign in to get recommendations");
        setLoading(false);
        return;
      }

      const res = await fetch("/api/recommend", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ occasion }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to get recommendations");
        setLoading(false);
        return;
      }

      setOutfits(data.outfits || []);
    } catch (err) {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl">
      <h1 className="text-3xl font-semibold tracking-tight">Outfit Recommendations</h1>
      <p className="mt-2 text-sm text-slate-600">
        Get AI-powered outfit suggestions from your wardrobe.
      </p>

      <div className="mt-8 flex flex-wrap gap-4 items-end">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Occasion
          </label>
          <select
            value={occasion}
            onChange={(e) => setOccasion(e.target.value)}
            className="px-4 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="casual">Casual</option>
            <option value="formal">Formal</option>
            <option value="athletic">Athletic</option>
            <option value="streetwear">Streetwear</option>
          </select>
        </div>

        <button
          onClick={getRecommendations}
          disabled={loading}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? "Generating..." : "Get Recommendations"}
        </button>
      </div>

      {error && (
        <div className="mt-4 p-4 bg-red-50 text-red-700 rounded-lg">
          {error}
        </div>
      )}

      {outfits.length > 0 && (
        <div className="mt-8 space-y-6">
          <h2 className="text-xl font-medium">Suggested Outfits for {occasion}</h2>
          
          {outfits.map((outfit, index) => (
            <div
              key={index}
              className="p-6 bg-white border border-slate-200 rounded-xl shadow-sm"
            >
              <div className="flex items-center gap-2 mb-4">
                <span className="px-3 py-1 bg-blue-100 text-blue-800 text-sm font-medium rounded-full">
                  Outfit {index + 1}
                </span>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
                {outfit.items.map((item) => (
                  <div
                    key={item.id}
                    className="p-4 bg-slate-50 rounded-lg border border-slate-100"
                  >
                    <p className="font-medium text-slate-900">{item.name}</p>
                    <p className="text-sm text-slate-500">{item.category}</p>
                    {item.colors.length > 0 && (
                      <div className="mt-2 flex gap-1">
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
                ))}
              </div>

              <p className="text-sm text-slate-600 italic">
                {outfit.reason}
              </p>
            </div>
          ))}
        </div>
      )}

      {!loading && outfits.length === 0 && !error && (
        <div className="mt-8 p-8 text-center text-slate-500 bg-slate-50 rounded-xl">
          <p>Select an occasion and click &quot;Get Recommendations&quot; to see outfit suggestions.</p>
          <p className="mt-2 text-sm">Make sure you have items in your wardrobe first!</p>
        </div>
      )}
    </div>
  );
}
