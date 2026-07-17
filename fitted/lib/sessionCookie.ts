/**
 * Client helper for the Firebase session cookie (§I images-route ownership). Mints the httpOnly
 * cookie (via /api/auth/session) from a fresh ID token so same-origin `<img src="/api/images/<id>">`
 * requests carry an identity the images route can verify + ownership-check. Best-effort: a failure
 * never traps the app (images just won't load until the cookie exists).
 */
import { type User as FirebaseUser } from "firebase/auth";

/** Mint the session cookie on every app load. The cookie is httpOnly (the client cannot detect
 *  its absence), so a freshness gate here turned a lost/rejected cookie into up-to-an-hour of
 *  broken image tiles that reloads could not fix — the mint is one cheap call; just always do it. */
export async function ensureSessionCookie(user: FirebaseUser): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const token = await user.getIdToken();
    const res = await fetch("/api/auth/session", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    void res;
  } catch {
    // best-effort — a failed mint must not block the app
  }
}

/** Clear the session cookie on logout. */
export async function clearSessionCookie(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    await fetch("/api/auth/session", { method: "DELETE" });
  } catch {
    // best-effort
  }
}
