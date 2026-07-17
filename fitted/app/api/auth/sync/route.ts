import { NextRequest, NextResponse } from "next/server";
import { initDatabase } from "@/lib/db";
import { adminAuth } from "@/lib/firebaseAdmin";

/**
 * POST /api/auth/sync — first-login upsert of the Firebase user into Mongo.
 *
 * §I gate: the identity (`authId`) is derived ONLY from the verified Firebase ID token, never from a
 * body `firebaseUid` — otherwise a caller could mint/return a row for someone else's uid. This route
 * cannot use the shared `verifyFirebaseUser` helper because it runs BEFORE the Mongo user exists (the
 * helper 404s on an absent user); it verifies the token directly and upserts. `displayName`/`photoURL`
 * are non-sensitive profile fields taken from the body; `authId`/`email` come from the token.
 */
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Missing or invalid Authorization header" }, { status: 401 });
    }
    const idToken = authHeader.slice("Bearer ".length).trim();

    let decoded;
    try {
      decoded = await adminAuth.verifyIdToken(idToken);
    } catch {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }

    const firebaseUid = decoded.uid;
    const body = (await request.json().catch(() => ({}))) as {
      displayName?: string;
      photoURL?: string;
    };
    // Email comes ONLY from the verified token — NEVER the body. `User.email` is a unique index, so a
    // body-supplied email would let a caller with a valid (email-less) token squat/collide on another
    // user's email. Google sign-in always carries `email`; a token without it is rejected (400).
    const email = decoded.email;
    if (!email) {
      return NextResponse.json({ error: "A verified email is required" }, { status: 400 });
    }

    const { User } = await initDatabase();
    let user = await User.findOne({ authProvider: "firebase", authId: firebaseUid });
    if (!user) {
      // About to CREATE a row — harden against the deleted-account ghost: a just-deleted user's
      // ID token stays cryptographically valid for up to ~1h, and a stale tab's sync would mint a
      // fresh row for a Firebase account that no longer exists. The unique email index would then
      // lock that address out of ever re-signing up (the new uid's create hits E11000 and the
      // authId re-find misses). Account deletion REVOKES tokens, so re-verify with checkRevoked
      // (an extra Firebase round-trip, paid only on the create path — first-ever sign-ins).
      try {
        await adminAuth.verifyIdToken(idToken, true);
      } catch {
        return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
      }
      try {
        user = await User.create({
          authProvider: "firebase",
          authId: firebaseUid,
          email,
          displayName: body.displayName || undefined,
          photoURL: body.photoURL || undefined,
        });
      } catch (err) {
        // First sign-in fires sync TWICE concurrently (the page click-handler + the auth-state
        // listener) — the racing loser hits E11000 on the unique {authProvider,authId} index.
        // Re-find the winner's row instead of flashing "Failed to sync user" on a healthy sign-in.
        // (An E11000 on the unique email index — a different account squatting the email — still
        // re-finds nothing and rethrows, preserving the §19 squat rejection.)
        if ((err as { code?: number })?.code === 11000) {
          user = await User.findOne({ authProvider: "firebase", authId: firebaseUid });
        }
        if (!user) throw err;
      }
    }

    return NextResponse.json({
      userId: user._id.toString(),
      user: { id: user._id.toString(), email: user.email, displayName: user.displayName },
    });
  } catch (error) {
    console.error("Error syncing user:", error);
    return NextResponse.json({ error: "Failed to sync user" }, { status: 500 });
  }
}
