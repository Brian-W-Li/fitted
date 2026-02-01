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
        //console.log("account user from api:", data.user);
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
      setMessage("Saved!");
      setTimeout(() => setMessage(null), 2000);

    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ padding: 24, maxWidth: 520 }}>
      <h1>Account</h1>

      {loading && <p>Loading...</p>}
      {!loading && error && <p>{error}</p>}

      {!loading && user && (
        <>
          <p><b>Email:</b> {user.email}</p>
          <p><b>Display name:</b> {user.displayName ?? "(not set)"}</p>

          {user.photoURL ? (
            <img
              src={user.photoURL}
              alt="profile"
              width = {80}
              height = {80}
              referrerPolicy="no-referrer"
              style={{ borderRadius: 9999, objectFit: "cover", display: "block" }}
              onLoad={() => console.log("pfp loaded")}
              onError={(e) => {
                console.log("pfp failed to load", user.photoURL);
                e.currentTarget.style.display = "none";
              }}
            />
          ) : (
                <p style={{ marginTop: 8, opacity: 0.7 }}>(No profile photo)</p>
           )}

          <div style={{ marginTop: 16 }}>
            <div>
              <label>Age</label><br />
              <input
                type = "number"
                value={ageInput}
                onChange={(e) => setAgeInput(e.target.value)}
                style={{ padding: 8, width: 200 }}
              />
            </div>

            <div style={{ marginTop: 12 }}>
              <label>Gender</label><br />
              <select
                value={genderInput}
                onChange={(e) => setGenderInput(e.target.value)}
                style={{ padding: 8, width: 220 }}
              >
                <option value="">(select)</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="nonbinary">Non-binary</option>
                <option value="other">Other</option>
                <option value="prefer_not_to_say">Prefer not to say</option>
              </select>
            </div>

            <button
              onClick={saveProfile}
              disabled={saving}
              style={{ marginTop: 16, padding: "8px 12px" }}
            >
              {saving ? "Saving..." : "Save"}
            </button>
            {message && <p style={{ marginTop: 12 }}>{message}</p>}
          </div>
        </>
      )}
    </div>
  );
}
