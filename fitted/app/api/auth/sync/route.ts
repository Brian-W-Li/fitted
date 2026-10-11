import { NextRequest, NextResponse } from "next/server";
import { initDatabase } from "@/lib/db";
import { adminAuth } from "@/lib/firebaseAdmin";
import { admitFirebaseIdentity, verifyIdentityToken, IdentityAdmissionError } from "@/lib/identityAdmission";
import { sliceSurrogateSafe } from "@/lib/mlRequestAdapter";

/**
 * POST /api/auth/sync — resolve or transactionally admit the verified Firebase identity.
 *
 * §I gate: the identity (`authId`) is derived ONLY from the verified Firebase ID token, never from a
 * body `firebaseUid` — otherwise a caller could mint/return a row for someone else's uid. This route
 * cannot use the shared `verifyFirebaseUser` helper because it runs BEFORE the Mongo user exists (the
 * helper 404s on an absent user); it verifies and uses identity admission on first login. `displayName`/`photoURL`
 * are non-sensitive profile fields taken from the body; `authId`/`email` come from the token.
 */
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Missing or invalid Authorization header" }, { status: 401 });
    }
    const idToken = authHeader.slice("Bearer ".length).trim();

    const verify = (token: string, checkRevoked: boolean) => adminAuth.verifyIdToken(token, checkRevoked);
    const decoded = await verifyIdentityToken(verify, idToken, false);

    const firebaseUid = decoded.uid;
    const body = (await request.json().catch(() => ({}))) as {
      displayName?: string;
      photoURL?: string;
    };
    // Bound what the body can store (the only two body-sourced fields): unbounded strings here
    // would persist ~4.5MB per field into the users collection, and photoURL is later echoed to
    // the account UI as an <img src> — require an http(s) URL, not an arbitrary string. The
    // surrogate-safe slice keeps the truncation from minting ill-formed UTF-16 (same doctrine as
    // the wardrobe validator/adapter).
    const displayName =
      typeof body.displayName === "string" ? sliceSurrogateSafe(body.displayName, 200) : undefined;
    const photoURL =
      typeof body.photoURL === "string" && /^https?:\/\//.test(body.photoURL)
        ? body.photoURL.slice(0, 2048)
        : undefined;
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
      user = await admitFirebaseIdentity(User, idToken, {
        uid: firebaseUid, email, displayName: displayName || undefined, photoURL: photoURL || undefined,
      }, verify);
    }

    if (user.erasureStarted) return NextResponse.json({ error: "Account deletion is in progress", code: "account_deletion_pending" }, { status: 409 });

    return NextResponse.json({
      userId: user._id.toString(),
      user: { id: user._id.toString(), email: user.email, displayName: user.displayName },
    });
  } catch (error) {
    if (error instanceof IdentityAdmissionError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error("Error syncing user:", error);
    return NextResponse.json({ error: "Sign-in storage is unavailable — please try again.", code: "identity_storage_unavailable" }, { status: 503 });
  }
}
