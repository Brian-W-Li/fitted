"use client";

import { useEffect, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebaseClient";

type AccountUser = {
  id: string;
  email: string;
  displayName: string | null;
  photoURL: string | null;
  hasCustomPhoto?: boolean;
  age: number | null;
  gender: string | null;
  appRatingScore10?: number | null;
  appFeedbackComment?: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export default function AccountPage() {
  const [user, setUser] = useState<AccountUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingFeedback, setSavingFeedback] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [styleSummary, setStyleSummary] = useState("");
  const [styleSummaryLoading, setStyleSummaryLoading] = useState(false);
  const [styleSummarySaving, setStyleSummarySaving] = useState(false);
  const [styleSummaryMessage, setStyleSummaryMessage] = useState<string | null>(null);
  const [styleSummaryNeedsUpdate, setStyleSummaryNeedsUpdate] = useState(false);

  const [firebaseUid, setFirebaseUid] = useState<string | null>(null);
  const [ageInput, setAgeInput] = useState("");
  const [genderInput, setGenderInput] = useState("");
  const [photoDraft, setPhotoDraft] = useState<string | null | undefined>(undefined);
  const [ratingScore10Input, setRatingScore10Input] = useState<number>(0);
  const [feedbackCommentInput, setFeedbackCommentInput] = useState("");
  const photoInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      try {
        setLoading(true);
        setError(null);
        setMessage(null);
        setFeedbackMessage(null);
        setUser(null);

        if (!fbUser) {
          setError("You must be signed in to view this page.");
          return;
        }

        setFirebaseUid(fbUser.uid);

        const res = await fetch("/api/account", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ firebaseUid: fbUser.uid }),
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error ?? "Failed to load account info.");
          return;
        }

        setUser(data.user);
        setAgeInput(data.user.age == null ? "" : String(data.user.age));
        setGenderInput(data.user.gender ?? "");
        setRatingScore10Input(
          typeof data.user.appRatingScore10 === "number" ? data.user.appRatingScore10 : 0,
        );
        setFeedbackCommentInput(data.user.appFeedbackComment ?? "");
        setPhotoDraft(undefined);
      } finally {
        setLoading(false);
      }
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    async function loadPreferenceSummary() {
      try {
        if (!auth.currentUser) return;
        setStyleSummaryLoading(true);
        const token = await auth.currentUser.getIdToken();
        const res = await fetch("/api/preferences/summarize", {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          // Non-fatal for account page; just skip
          return;
        }
        if (data.summary?.text) {
          setStyleSummary(data.summary.text);
        } else {
          setStyleSummary("");
        }
        setStyleSummaryNeedsUpdate(Boolean(data.needsUpdate));
      } finally {
        setStyleSummaryLoading(false);
      }
    }

    if (user) {
      void loadPreferenceSummary();
    }
  }, [user]);

  async function saveProfile() {
    if (!firebaseUid) return;
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const res = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firebaseUid,
          age: ageInput,
          gender: genderInput,
          photoDataUrl: photoDraft,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Failed to save.");
        return;
      }

      setUser(data.user);
      setAgeInput(data.user.age == null ? "" : String(data.user.age));
      setGenderInput(data.user.gender ?? "");
      setPhotoDraft(undefined);
      setMessage("Saved");
      setTimeout(() => setMessage(null), 2000);
    } finally {
      setSaving(false);
    }
  }

  async function saveFeedback() {
    if (!firebaseUid) return;
    setSavingFeedback(true);
    setError(null);
    setFeedbackMessage(null);

    try {
      const res = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firebaseUid,
          appRatingScore10: ratingScore10Input,
          appFeedbackComment: feedbackCommentInput,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Failed to save feedback.");
        return;
      }

      setUser(data.user);
      setRatingScore10Input(
        typeof data.user.appRatingScore10 === "number" ? data.user.appRatingScore10 : 0,
      );
      setFeedbackCommentInput(data.user.appFeedbackComment ?? "");
      setFeedbackMessage("Feedback submitted");
      setTimeout(() => setFeedbackMessage(null), 2000);
    } finally {
      setSavingFeedback(false);
    }
  }

  async function saveStyleSummary() {
    if (!auth.currentUser) return;
    setStyleSummarySaving(true);
    setStyleSummaryMessage(null);
    setError(null);
    try {
      const token = await auth.currentUser.getIdToken();
      const res = await fetch("/api/preferences/summarize", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ text: styleSummary }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Failed to save style preferences.");
        return;
      }
      if (data.summary?.text) {
        setStyleSummary(data.summary.text);
      }
      setStyleSummaryNeedsUpdate(false);
      setStyleSummaryMessage("Style preferences saved");
      setTimeout(() => setStyleSummaryMessage(null), 2000);
    } finally {
      setStyleSummarySaving(false);
    }
  }

  async function regenerateStyleSummary() {
    if (!auth.currentUser) return;
    setStyleSummarySaving(true);
    setStyleSummaryMessage(null);
    setError(null);
    try {
      const token = await auth.currentUser.getIdToken();
      const res = await fetch("/api/preferences/summarize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // If not enough feedback, show message in the style summary area
        if (data.message) {
          setStyleSummaryMessage(data.message);
        } else {
          setError(data.error ?? "Failed to regenerate style preferences.");
        }
        return;
      }
      if (data.summary?.text) {
        setStyleSummary(data.summary.text);
      }
      setStyleSummaryNeedsUpdate(false);
      setStyleSummaryMessage("Style preferences regenerated from your recent likes and dislikes");
      setTimeout(() => setStyleSummaryMessage(null), 2500);
    } finally {
      setStyleSummarySaving(false);
    }
  }

  async function handlePhotoSelected(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file");
      return;
    }
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.onerror = () => reject(new Error("Failed to read image"));
        reader.readAsDataURL(file);
      });
      setError(null);
      setPhotoDraft(dataUrl);
    } catch {
      setError("Failed to read image");
    }
  }

  function openPhotoPicker() {
    photoInputRef.current?.click();
  }

  function setStarRating(stars: number) {
    const clamped = Math.max(0, Math.min(5, stars));
    const normalizedToHalf = Math.round(clamped * 2) / 2;
    setRatingScore10Input(Math.round(normalizedToHalf * 2));
  }

  function currentRatingScore5() {
    return ratingScore10Input / 2;
  }

  function starFillType(starIndex: number): "empty" | "half" | "full" {
    const rating = currentRatingScore5();
    if (rating >= starIndex) return "full";
    if (rating >= starIndex - 0.5) return "half";
    return "empty";
  }

  function starFillPercent(starIndex: number): number {
    const fill = starFillType(starIndex);
    if (fill === "full") return 100;
    if (fill === "half") return 50;
    return 0;
  }

  return (
    <section className="mx-auto w-full max-w-5xl">
      <header className="mb-6">
        <h1 className="text-4xl font-semibold tracking-tight text-slate-900">Account</h1>
        <p className="mt-2 text-slate-600">
          Manage your profile details used in outfit recommendations
        </p>
      </header>

      {loading && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-slate-600">Loading account details...</p>
        </div>
      )}

      {!loading && error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}

      {!loading && user && (
        <div className="space-y-5">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">
                  {user.displayName ?? "No display name"}
                </h2>
                <p className="mt-1 text-sm text-slate-600">{user.email}</p>
              </div>

              <button
                type="button"
                onClick={openPhotoPicker}
                className="group relative block h-[84px] w-[84px] overflow-hidden rounded-full border border-slate-200"
              >
                {(photoDraft ?? user.photoURL) ? (
                  <img
                    src={photoDraft ?? user.photoURL ?? ""}
                    alt="Profile"
                    width={84}
                    height={84}
                    referrerPolicy="no-referrer"
                    className="h-[84px] w-[84px] object-cover"
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                    }}
                  />
                ) : (
                  <div className="inline-flex h-[84px] w-[84px] items-center justify-center bg-slate-100 text-2xl font-medium text-slate-500">
                    {user.email.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="absolute inset-0 flex items-center justify-center bg-slate-900/45 text-xs font-medium text-white opacity-0 transition group-hover:opacity-100">
                  Change photo
                </div>
              </button>
            </div>
            <input
              ref={photoInputRef}
              type="file"
              accept="image/png,image/jpeg,image/jpg,image/webp"
              className="hidden"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                void handlePhotoSelected(file);
                e.currentTarget.value = "";
              }}
            />
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="text-lg font-medium text-slate-900">Profile settings</h3>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium text-slate-700">Age</span>
                <input
                  type="number"
                  value={ageInput}
                  onChange={(e) => setAgeInput(e.target.value)}
                  className="h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200 placeholder:text-slate-400"
                  placeholder="Enter age"
                />
              </label>

              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium text-slate-700">Gender</span>
                <select
                  value={genderInput}
                  onChange={(e) => setGenderInput(e.target.value)}
                  className="h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                >
                  <option value="">Select</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="nonbinary">Non-binary</option>
                  <option value="other">Other</option>
                  <option value="prefer_not_to_say">Prefer not to say</option>
                </select>
              </label>
            </div>

            <div className="mt-5 flex items-center gap-3">
              <button
                onClick={saveProfile}
                disabled={saving}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save changes"}
              </button>
              {message && <p className="text-sm text-emerald-700">{message}</p>}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-lg font-medium text-slate-900">Style profile</h3>
                <p className="mt-1 text-sm text-slate-600">
                  This summary guides AI recommendations. Edit it or regenerate from your likes/dislikes.
                </p>
              </div>
              {styleSummaryNeedsUpdate && (
                <span className="inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-700">
                  Updated feedback available
                </span>
              )}
            </div>

            <div className="mt-4">
              {styleSummaryLoading ? (
                <p className="text-sm text-slate-500">Loading style profile…</p>
              ) : (
                <textarea
                  value={styleSummary}
                  onChange={(e) => setStyleSummary(e.target.value)}
                  rows={6}
                  maxLength={2000}
                  placeholder="Prefers neutral colors and simple patterns and dislikes heavy layering in warm weather"
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200 placeholder:text-slate-400"
                />
              )}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={saveStyleSummary}
                disabled={styleSummarySaving || styleSummaryLoading}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {styleSummarySaving ? "Saving..." : "Save style profile"}
              </button>
              <button
                type="button"
                onClick={regenerateStyleSummary}
                disabled={styleSummarySaving || styleSummaryLoading}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Regenerate from feedback
              </button>
              {styleSummaryMessage && (
                <p className="text-sm text-emerald-700">{styleSummaryMessage}</p>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="text-lg font-medium text-slate-900">Rate the app</h3>
            <p className="mt-1 text-sm text-slate-600">
              Rate from 0-10 with half-star support ({ratingScore10Input}/10)
            </p>

            <div className="mt-4 flex items-center gap-2">
              {[1, 2, 3, 4, 5].map((star) => {
                const fillPercent = starFillPercent(star);
                return (
                  <div key={star} className="relative h-9 w-9">
                    <svg
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-0 h-9 w-9 fill-slate-300"
                    >
                      <path d="M12 2.25 14.92 8.16l6.52.95-4.72 4.6 1.11 6.5L12 17.14 6.17 20.2l1.11-6.5-4.72-4.6 6.52-.95L12 2.25Z" />
                    </svg>
                    <div
                      className="pointer-events-none absolute inset-y-0 left-0 overflow-hidden"
                      style={{ width: `${fillPercent}%` }}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                        className="h-9 w-9 fill-amber-400"
                      >
                        <path d="M12 2.25 14.92 8.16l6.52.95-4.72 4.6 1.11 6.5L12 17.14 6.17 20.2l1.11-6.5-4.72-4.6 6.52-.95L12 2.25Z" />
                      </svg>
                    </div>
                    <button
                      type="button"
                      onClick={() => setStarRating(star - 0.5)}
                      aria-label={`Set rating to ${star - 0.5} stars`}
                      className="absolute inset-y-0 left-0 w-1/2"
                    />
                    <button
                      type="button"
                      onClick={() => setStarRating(star)}
                      aria-label={`Set rating to ${star} stars`}
                      className="absolute inset-y-0 right-0 w-1/2"
                    />
                  </div>
                );
              })}
            </div>

            <label className="mt-4 block">
              <span className="text-sm font-medium text-slate-700">Comments</span>
              <textarea
                value={feedbackCommentInput}
                onChange={(e) => setFeedbackCommentInput(e.target.value)}
                rows={4}
                maxLength={2000}
                placeholder="Tell us what worked well and what should be improved"
                className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200 placeholder:text-slate-400"
              />
            </label>

            <div className="mt-5 flex items-center gap-3">
              <button
                type="button"
                onClick={saveFeedback}
                disabled={savingFeedback}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {savingFeedback ? "Submitting..." : "Submit feedback"}
              </button>
              {feedbackMessage && <p className="text-sm text-emerald-700">{feedbackMessage}</p>}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
