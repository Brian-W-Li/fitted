/**
 * Track 2 live driver — exercise the DEPLOYED Fitted pipeline end-to-end as a throwaway test user,
 * with no browser and no Google OAuth. Mints a Firebase custom token via the Admin SDK (local
 * FIREBASE_SERVICE_ACCOUNT_KEY), exchanges it for a real ID token (Firebase REST + the web API key),
 * and drives the live Vercel API exactly as the browser would (Bearer ID token).
 *
 * Reproduces the "admin-minted token" driver the 2026-07-16 deploy verification used. Used for: the
 * Track-2 friend gauntlet (Track A), the content-quality gauntlet (real renders), and the
 * throwaway-account erasure check. READ-MOSTLY against production; every test user it creates it also
 * ERASES (DELETE /api/account) — the erasure IS the cleanup.
 *
 *   node scripts/track2-live.mjs smoke                 # auth-chain smoke: mint → sync → GET wardrobe
 *   node scripts/track2-live.mjs erase <uid>           # DELETE /api/account for a test uid
 *
 * Higher-level flows (persona seed + render + contact sheet + erasure) live in the sibling
 * track2-gauntlet.mjs, which imports the helpers here.
 *
 * SAFETY: refuses to run unless TRACK2_LIVE_OK=1 (writing to the live corpus DB + spending OpenAI).
 * Test uids are namespaced `track2test_*` so the corpus + Firebase are trivially auditable/cleanable.
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// ---- env ----
export function loadEnvLocal() {
  try {
    const envFile = readFileSync(resolve(__dirname, "../.env.local"), "utf8");
    for (const line of envFile.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i === -1) continue;
      const k = t.slice(0, i).trim();
      if (!process.env[k]) process.env[k] = t.slice(i + 1).trim();
    }
  } catch {
    /* rely on existing env */
  }
}
loadEnvLocal();

export const APP_URL = process.env.TRACK2_APP_URL || "https://fitted-three.vercel.app";
const WEB_API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;

export function requireLiveOk() {
  if (process.env.TRACK2_LIVE_OK !== "1") {
    console.error(
      "Refusing to run: this driver writes to the LIVE Track-2 corpus DB and spends OpenAI budget.\n" +
        "Re-run with TRACK2_LIVE_OK=1 if that is intended.",
    );
    process.exit(1);
  }
}

// ---- firebase-admin (lazy singleton) ----
let _adminAuth = null;
export function adminAuth() {
  if (_adminAuth) return _adminAuth;
  const admin = require("firebase-admin");
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_KEY missing from env");
  const serviceAccount = JSON.parse(raw);
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  }
  _adminAuth = admin.auth();
  return _adminAuth;
}

/** Create (or reuse) a Firebase Auth user WITH an email (sync requires decoded.email), then mint a
 *  custom token and exchange it for a real ID token via the Firebase REST endpoint. */
export async function mintIdToken(uid, email) {
  const auth = adminAuth();
  try {
    await auth.getUser(uid);
  } catch {
    await auth.createUser({ uid, email, emailVerified: true, displayName: "Track2 Test" });
  }
  const customToken = await auth.createCustomToken(uid);
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${WEB_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    },
  );
  const data = await res.json();
  if (!res.ok || !data.idToken) {
    throw new Error(`signInWithCustomToken failed: ${res.status} ${JSON.stringify(data)}`);
  }
  return data.idToken;
}

/** JSON API call against the live app with a Bearer ID token. Returns {status, body}. */
export async function api(method, path, { token, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${APP_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let parsed;
  const text = await res.text();
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

/** Multipart image upload to /api/wardrobe/:id/image. `buf` is a Buffer; contentType e.g. image/jpeg. */
export async function uploadImage(itemId, buf, filename, contentType, token) {
  const form = new FormData();
  const blob = new Blob([buf], { type: contentType });
  form.append("file", blob, filename);
  const res = await fetch(`${APP_URL}/api/wardrobe/${itemId}/image`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  let parsed;
  const text = await res.text();
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

/** A throwaway test identity for a named persona/run. */
export function testIdentity(slug) {
  const uid = `track2test_${slug}`;
  const email = `track2test_${slug}@example.invalid`;
  return { uid, email };
}

// ---- CLI ----
async function main() {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === "smoke") {
    requireLiveOk();
    const { uid, email } = testIdentity("smoke");
    console.log(`Minting ID token for ${uid} …`);
    const token = await mintIdToken(uid, email);
    console.log("  ✓ ID token minted");
    const sync = await api("POST", "/api/auth/sync", { token, body: { displayName: "Track2 Smoke" } });
    console.log(`  sync → ${sync.status}`, JSON.stringify(sync.body).slice(0, 160));
    const wardrobe = await api("GET", "/api/wardrobe", { token });
    console.log(`  GET /api/wardrobe → ${wardrobe.status}`, JSON.stringify(wardrobe.body).slice(0, 160));
    console.log("\nCleaning up (DELETE /api/account) …");
    const del = await api("DELETE", "/api/account", { token });
    console.log(`  delete → ${del.status}`, JSON.stringify(del.body));
    process.exit(0);
  }
  if (cmd === "erase") {
    requireLiveOk();
    if (!arg) {
      console.error("usage: erase <uid>");
      process.exit(1);
    }
    const email = `${arg}@example.invalid`;
    const token = await mintIdToken(arg, email);
    const del = await api("DELETE", "/api/account", { token });
    console.log(`delete ${arg} → ${del.status}`, JSON.stringify(del.body));
    // Also remove the Firebase auth user if the account route missed it (e.g. no Mongo row yet).
    try {
      await adminAuth().deleteUser(arg);
      console.log(`  firebase auth user ${arg} deleted`);
    } catch (e) {
      console.log(`  firebase auth user ${arg}: ${e.message}`);
    }
    process.exit(0);
  }
  console.error("usage: node scripts/track2-live.mjs <smoke|erase <uid>>");
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("❌", err);
    process.exit(1);
  });
}
