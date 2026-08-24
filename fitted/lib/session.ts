/**
 * Firebase session-cookie boundary (M5 pre-C8, §I images-route ownership).
 *
 * `<img src="/api/images/<id>">` tags can't carry an `Authorization: Bearer` header, so the images
 * route can't use `verifyFirebaseUser`. A Firebase **session cookie** (httpOnly, minted from a fresh
 * ID token at sign-in) IS sent automatically by the browser on same-origin navigational/image
 * requests, so it is the mechanism that lets that route verify identity + enforce ownership.
 *
 * `verifySessionCookie(cookie, checkRevoked=false)` verifies the cookie's signature LOCALLY against
 * Google's cached public keys — no per-request Firebase backend round-trip, so it is cheap enough to
 * run on every image load. Revocation is not checked (a demo-scale tradeoff; the cookie expires in
 * days) — if that ever matters, flip the flag at the cost of a backend call per image.
 *
 * Reference: docs/plans/m5-cutover.md §I (images-route ownership residual).
 */
import { type NextRequest } from "next/server";
import { initDatabase } from "@/lib/db";
import { adminAuth } from "@/lib/firebaseAdmin";
import { type AuthResult } from "@/lib/apiAuth";

// `__session` is the safe cross-platform convention (Firebase Hosting only forwards a cookie by that
// exact name; harmless elsewhere). Keep the name + expiry in one place so mint and verify agree.
export const SESSION_COOKIE_NAME = "__session";
export const SESSION_EXPIRES_IN_MS = 5 * 24 * 60 * 60 * 1000; // 5 days (Firebase allows 5min–2weeks)

/** Verify the session cookie → the Mongo user id (or an `{error,status}` envelope). */
export async function verifySessionCookieUser(request: NextRequest): Promise<AuthResult> {
  const cookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) return { error: "Missing session cookie", status: 401 };
  let decoded;
  try {
    decoded = await adminAuth.verifySessionCookie(cookie, false);
  } catch {
    return { error: "Invalid or expired session", status: 401 };
  }
  // Same failure-class split as verifyFirebaseUser (DEFECTS-H88): past this point a throw is the
  // database, not the cookie — report it as a retryable 503, never as an expired session.
  try {
    const { User } = await initDatabase();
    const user = await User.findOne({ authProvider: "firebase", authId: decoded.uid }).exec();
    if (!user) return { error: "User not found", status: 401 };
    return { userId: user._id.toString() };
  } catch (error) {
    console.error("Database error resolving session user:", error);
    return { error: "We're having trouble reaching your closet — please try again in a moment.", status: 503 };
  }
}
