"use client";

import { useEffect, useRef, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth } from "@/lib/firebaseClient";
import { clearSessionCookie } from "@/lib/sessionCookie";

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

  const [firebaseUid, setFirebaseUid] = useState<string | null>(null);
  const [ageInput, setAgeInput] = useState("");
  const [genderInput, setGenderInput] = useState("");
  const [photoDraft, setPhotoDraft] = useState<string | null | undefined>(undefined);
  const [ratingScore10Input, setRatingScore10Input] = useState<number>(0);
  const [feedbackCommentInput, setFeedbackCommentInput] = useState("");
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const [deleting, setDeleting] = useState(false);

  /** The friend-facing data-deletion promise: wardrobe/photos/feedback AND generation snapshots
   *  are hard-deleted (erasure, §23-H43 Track 2 policy) and the Google sign-in binding removed
   *  (DELETE /api/account). Irreversible. */
  async function deleteAccount() {
    const fbUser = auth.currentUser;
    if (!fbUser || deleting) return;
    if (
      !confirm(
        "Delete your account and ALL your data (closet, photos, outfit history, feedback)? This cannot be undone.",
      )
    )
      return;
    if (!confirm("Really delete everything? There is no recovery.")) return;
    try {
      setDeleting(true);
      setError(null);
      const token = await fbUser.getIdToken();
      const res = await fetch("/api/account", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data?.dataDeleted) {
          // §23-H63: your data IS fully erased; only the Firebase sign-in unlink didn't complete (it
          // retries automatically on the next delete after a re-sign-in). Sign out so you're not
          // stranded on a now-dataless account — same cleanup as the success path.
          await clearSessionCookie();
          await signOut(auth).catch(() => {});
          try {
            window.sessionStorage.clear();
          } catch {
            // best-effort
          }
          window.location.href = "/";
          return;
        }
        setError(data.error ?? "Failed to delete account. Please try again.");
        setDeleting(false);
        return;
      }
      await clearSessionCookie();
      await signOut(auth).catch(() => {});
      // sessionStorage SURVIVES navigation — clear it so the deleted account's uid-keyed render
      // results / pending envelope don't linger in the tab; then a full navigation (not
      // router.push) flushes in-memory state too.
      try {
        window.sessionStorage.clear();
      } catch {
        // best-effort
      }
      window.location.href = "/";
    } catch (e) {
      console.error("Error deleting account:", e);
      setError("Failed to delete account. Please try again.");
      setDeleting(false);
    }
  }

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

        const token = await fbUser.getIdToken();
        const res = await fetch("/api/account", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
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

  async function saveProfile() {
    if (!firebaseUid) return;
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
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
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          // 0 means never-rated (a star tap minimum is 1) — don't store a phantom 0/10.
          ...(ratingScore10Input > 0 ? { appRatingScore10: ratingScore10Input } : {}),
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
          Manage your profile details
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
            <h3 className="text-lg font-medium text-slate-900">Rate the app</h3>
            <p className="mt-1 text-sm text-slate-600">
              Tap the stars — halves count ({ratingScore10Input}/10)
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

          <div className="rounded-2xl border border-red-200 bg-red-50/40 p-5">
            <h2 className="text-sm font-semibold text-red-800">Delete account</h2>
            <p className="mt-1 text-sm text-red-700/80">
              Permanently deletes your closet, photos, outfit history (including every
              generated-outfit record on our side), and feedback, and removes your sign-in. This
              cannot be undone.
            </p>
            <button
              type="button"
              onClick={deleteAccount}
              disabled={deleting}
              className="mt-3 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {deleting ? "Deleting…" : "Delete my account"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
