/**
 * /api/auth/session — mint (POST) / clear (DELETE) the Firebase session cookie.
 *
 * The client presents a fresh Firebase ID token (Bearer); the server exchanges it for an httpOnly
 * session cookie the browser then attaches automatically to same-origin requests — including
 * `<img src="/api/images/<id>">`, which is how the images route enforces ownership (§I). Identity is
 * always token-derived; the cookie is httpOnly so client JS can never read or forge it.
 */
import { type NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebaseAdmin";
import { SESSION_COOKIE_NAME, SESSION_EXPIRES_IN_MS } from "@/lib/session";

const COOKIE_BASE = {
  name: SESSION_COOKIE_NAME,
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Missing or invalid Authorization header" }, { status: 401 });
  }
  const idToken = authHeader.slice("Bearer ".length).trim();
  try {
    const sessionCookie = await adminAuth.createSessionCookie(idToken, {
      expiresIn: SESSION_EXPIRES_IN_MS,
    });
    const res = NextResponse.json({ ok: true });
    res.cookies.set({ ...COOKIE_BASE, value: sessionCookie, maxAge: SESSION_EXPIRES_IN_MS / 1000 });
    return res;
  } catch (error) {
    console.error("Failed to mint session cookie:", error);
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set({ ...COOKIE_BASE, value: "", maxAge: 0 });
  return res;
}
