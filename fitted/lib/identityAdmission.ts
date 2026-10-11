import type { ClientSession } from "mongoose";
import type { DatabaseModels } from "@/lib/db";

export const IDENTITY_TRANSACTION_TIMEOUT_MS = 20_000;
export const FIREBASE_IDENTITY_TIMEOUT_MS = 8_000;
export type VerifiedIdentity = { uid: string; email?: string };
export type IdentityVerifier = (token: string, checkRevoked: boolean) => Promise<VerifiedIdentity>;
export type AdmittedUser = {
  _id: { toString(): string }; email: string; displayName?: string; erasureStarted?: boolean;
};
export class IdentityAdmissionError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
const rejectedCredentials = new Set([
  "auth/argument-error", "auth/invalid-argument", "auth/invalid-id-token",
  "auth/id-token-expired", "auth/id-token-revoked", "auth/user-disabled", "auth/user-not-found",
]);

/** Bound only the read-only Firebase call. A late reply has no DB continuation. */
export async function verifyIdentityToken(
  verify: IdentityVerifier, token: string, checkRevoked: boolean,
  timeoutMs = FIREBASE_IDENTITY_TIMEOUT_MS,
): Promise<VerifiedIdentity> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      verify(token, checkRevoked),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new IdentityAdmissionError(503, "identity_service_unavailable", "Sign-in verification is taking too long — please try again.")), timeoutMs);
      }),
    ]);
  } catch (error) {
    if (error instanceof IdentityAdmissionError) throw error;
    if (rejectedCredentials.has((error as { code?: string })?.code ?? "")) {
      throw new IdentityAdmissionError(401, "invalid_token", "Invalid or expired token");
    }
    throw new IdentityAdmissionError(503, "identity_service_unavailable", "Sign-in verification is unavailable — please try again.");
  } finally { if (timer) clearTimeout(timer); }
}

/** Read the actual deployed definitions; never build/drop indexes implicitly on sign-in. */
export async function requireIdentityIndexes(User: DatabaseModels["User"]): Promise<void> {
  let indexes;
  try { indexes = await User.collection.listIndexes({ maxTimeMS: 5_000 }).toArray(); }
  catch { throw new IdentityAdmissionError(503, "identity_indexes_unavailable", "Sign-in storage is not ready — please try again later."); }
  const exactUnique = (keys: string[]) => indexes.some((index: {
    key: Record<string, unknown>; unique?: boolean; sparse?: boolean;
    partialFilterExpression?: unknown; collation?: { locale?: string };
  }) => index.unique === true && !index.sparse && !index.partialFilterExpression &&
    (!index.collation || index.collation.locale === "simple") &&
    Object.keys(index.key).length === keys.length &&
    Object.keys(index.key).every((key, position) => key === keys[position] && index.key[key] === 1));
  if (!exactUnique(["authProvider", "authId"]) || !exactUnique(["email"])) {
    throw new IdentityAdmissionError(503, "identity_indexes_unavailable", "Sign-in storage is not ready — please try again later.");
  }
}

/** Reserve the unique identity BEFORE the fresh live Firebase verdict. R18 keeps any
 * old owner's identity until Firebase deletion precedes physical owner removal.
 * The transaction either excludes an erasure of another owner with this identity,
 * or reserves it after erasure, when the new live verdict rejects the old token.
 */
export async function admitFirebaseIdentity(
  User: DatabaseModels["User"], token: string,
  identity: { uid: string; email: string; displayName?: string; photoURL?: string },
  verify: IdentityVerifier,
  limits: { transactionMs?: number; firebaseMs?: number } = {},
): Promise<AdmittedUser> {
  await requireIdentityIndexes(User);
  const transactionMs = limits.transactionMs ?? IDENTITY_TRANSACTION_TIMEOUT_MS;
  const firebaseMs = limits.firebaseMs ?? FIREBASE_IDENTITY_TIMEOUT_MS;
  const deadline = Date.now() + transactionMs;
  const session: ClientSession = await User.db.startSession();
  const remaining = () => {
    const time = deadline - Date.now();
    if (time <= 0) throw new IdentityAdmissionError(503, "identity_admission_timeout", "Sign-in took too long — please try again.");
    return time;
  };
  let admitted: AdmittedUser | undefined;
  try {
    await session.withTransaction(async () => {
      remaining();
      // Every callback retry inserts afresh and performs its own verification. No verdict
      // is carried across a transaction abort/retry; commit-only retries reuse this reserve.
      const [created] = await User.create([{
        authProvider: "firebase", authId: identity.uid, email: identity.email,
        displayName: identity.displayName, photoURL: identity.photoURL,
      }], { session });
      const fresh = await verifyIdentityToken(verify, token, true, Math.min(firebaseMs, remaining()));
      remaining();
      if (fresh.uid !== identity.uid || fresh.email !== identity.email) {
        throw new IdentityAdmissionError(401, "invalid_token", "Invalid or expired token");
      }
      admitted = created as AdmittedUser;
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, timeoutMS: transactionMs });
  } catch (error) {
    // withTransaction has awaited abort before this refind. Never query in the failed
    // transaction, retry an ordinary insert, or treat an unrelated email collision as a user.
    if ((error as { code?: number })?.code === 11000) {
      const winner = await User.findOne({ authProvider: "firebase", authId: identity.uid });
      if (winner) {
        if (winner.erasureStarted) throw new IdentityAdmissionError(409, "account_deletion_pending", "Account deletion is in progress");
        return winner as AdmittedUser;
      }
    }
    if (error instanceof IdentityAdmissionError) throw error;
    throw new IdentityAdmissionError(503, "identity_admission_unavailable", "Couldn't finish signing in — please try again.");
  } finally { await session.endSession(); }
  if (!admitted) throw new IdentityAdmissionError(503, "identity_admission_unavailable", "Couldn't finish signing in — please try again.");
  return admitted;
}
