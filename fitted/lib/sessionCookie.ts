/**
 * Client helper for the Firebase session cookie (§I images-route ownership). Mints the httpOnly
 * cookie (via /api/auth/session) from a fresh ID token so same-origin `<img src="/api/images/<id>">`
 * requests carry an identity the images route can verify + ownership-check. Best-effort: a failure
 * never traps the app (images just won't load until the cookie exists).
 */
import { type User as FirebaseUser } from "firebase/auth";

const MINTED_AT_KEY = "fitted_session_minted_at";
const REFRESH_MS = 60 * 60 * 1000; // re-mint at most hourly per tab session (the cookie lives days)

/** Mint the session cookie if one hasn't been minted recently in this tab session. Await it before
 *  rendering owner-only images so the first image request already carries the cookie. */
export async function ensureSessionCookie(user: FirebaseUser): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const last = Number(window.sessionStorage.getItem(MINTED_AT_KEY) ?? 0);
    if (Number.isFinite(last) && Date.now() - last < REFRESH_MS) return; // still fresh
    const token = await user.getIdToken();
    const res = await fetch("/api/auth/session", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) window.sessionStorage.setItem(MINTED_AT_KEY, String(Date.now()));
  } catch {
    // best-effort — a failed mint must not block the app
  }
}

/** Clear the session cookie on logout. */
export async function clearSessionCookie(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(MINTED_AT_KEY);
    await fetch("/api/auth/session", { method: "DELETE" });
  } catch {
    // best-effort
  }
}
