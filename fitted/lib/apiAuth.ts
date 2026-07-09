/**
 * Shared Firebase-token → user-id verification for API routes (M5 C7, §I retained-route auth).
 *
 * The single trust boundary: derive identity ONLY from a verified Firebase ID token, never from a
 * client-supplied body field (`firebaseUid`, a body UID, etc. — the §19 gap this closes). Returns
 * the Mongo user `_id` as a string on success, or a `{error, status}` envelope on failure.
 *
 * Reference: docs/plans/m5-cutover.md §I (retained-route auth); docs/Fitted_Spec_v2.md §19.
 */
import { type NextRequest } from "next/server";
import { initDatabase } from "@/lib/db";
import { adminAuth } from "@/lib/firebaseAdmin";

export interface AuthUserOk {
  userId: string;
}
export interface AuthUserErr {
  error: string;
  status: number;
}
export type AuthResult = AuthUserOk | AuthUserErr;

/** Extract + verify the Bearer ID token, then resolve the owning Mongo user. */
export async function verifyFirebaseUser(request: NextRequest): Promise<AuthResult> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { error: "Missing or invalid Authorization header", status: 401 };
  }
  const idToken = authHeader.slice("Bearer ".length).trim();
  if (!idToken) return { error: "Missing or invalid Authorization header", status: 401 };
  try {
    const decoded = await adminAuth.verifyIdToken(idToken);
    const { User } = await initDatabase();
    const user = await User.findOne({ authProvider: "firebase", authId: decoded.uid }).exec();
    if (!user) return { error: "User not found", status: 404 };
    return { userId: user._id.toString() };
  } catch (error) {
    console.error("Error verifying Firebase token:", error);
    return { error: "Invalid or expired token", status: 401 };
  }
}
