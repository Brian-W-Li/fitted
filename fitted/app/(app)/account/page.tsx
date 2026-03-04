"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebaseClient";

type AccountUser = {
  id: string;
  email: string;
  displayName: string | null;
  photoURL: string | null;
  age: number | null;
  gender: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export default function AccountPage() {
  const [user, setUser] = useState<AccountUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [firebaseUid, setFirebaseUid] = useState<string | null>(null);
  const [ageInput, setAgeInput] = useState("");
  const [genderInput, setGenderInput] = useState("");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      try {
        setLoading(true);
        setError(null);
        setMessage(null);
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
      const res = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firebaseUid,
          age: ageInput,
          gender: genderInput,
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
      setMessage("Saved");
      setTimeout(() => setMessage(null), 2000);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mx-auto w-full max-w-3xl">
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

              {user.photoURL ? (
                <img
                  src={user.photoURL}
                  alt="Profile"
                  width={84}
                  height={84}
                  referrerPolicy="no-referrer"
                  className="h-[84px] w-[84px] rounded-full border border-slate-200 object-cover"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
              ) : (
                <div className="inline-flex h-[84px] w-[84px] items-center justify-center rounded-full border border-slate-200 bg-slate-100 text-2xl font-medium text-slate-500">
                  {user.email.charAt(0).toUpperCase()}
                </div>
              )}
            </div>
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
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                  placeholder="Enter age"
                />
              </label>

              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium text-slate-700">Gender</span>
                <select
                  value={genderInput}
                  onChange={(e) => setGenderInput(e.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
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
        </div>
      )}
    </section>
  );
}
