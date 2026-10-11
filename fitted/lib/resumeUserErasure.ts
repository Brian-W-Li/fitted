import type { DatabaseModels } from "@/lib/db";
import { cascadeDeleteUserData } from "@/models/User";
import { beginUserErasure } from "@/lib/userErasure";

export type ErasureOutcome = { status: number; body: {
  ok: boolean; error?: string; deletionPending?: boolean; dataDeleted?: boolean; authDeleted?: boolean;
} };

/** Server/operator erasure continuation. Only an already flagged owner can enter it;
 * this cannot initiate deletion of an active account and does not need a client token.
 * The retained owner is the durable recovery record, including after Firebase deletion.
 */
export async function resumeUserErasure(
  models: DatabaseModels, userId: string,
  deleteFirebaseUser: (authId: string) => Promise<unknown>,
  deleteOwner: () => Promise<boolean>,
): Promise<ErasureOutcome> {
  const { User, GenerationSnapshot } = models;
  const user = await User.findById(userId).select("authId erasureStarted").lean() as {
    authId?: string; erasureStarted?: boolean;
  } | null;
  if (!user) return { status: 404, body: { ok: false, error: "User not found" } };
  if (user.erasureStarted !== true) return { status: 409, body: { ok: false, error: "Account deletion has not started" } };

  const incomplete: ErasureOutcome = { status: 500, body: {
    ok: false, deletionPending: true, error: "Failed to finish account deletion",
  } };
  const ownerIsAbsent = async () => (await User.findById(userId).select("_id")
    .read("primary").readConcern("majority").lean()) === null;

  // Re-acknowledge a prior barrier before resuming even if its first response was lost.
  // Once this continuation has observed a pending owner, another continuation can
  // complete removal before this write. Absence is not a cleanup receipt: repeat
  // our own cascade and Firebase cleanup below. An unexpectedly retained owner after
  // a zero match fails closed; initial absence above still returns 404.
  if (!(await beginUserErasure(User, userId)) && !(await ownerIsAbsent())) return incomplete;
  await GenerationSnapshot.updateMany(
    { user: userId, redacted: { $ne: true } },
    { $set: { redacted: true, redactedAt: new Date(), redactionReason: "account_deleted" } },
  );
  await cascadeDeleteUserData(User.db, userId);
  if (user.authId) {
    let deleted = false;
    for (let attempt = 0; attempt < 2 && !deleted; attempt++) {
      try { await deleteFirebaseUser(user.authId); deleted = true; }
      catch (error) {
        if ((error as { code?: string })?.code === "auth/user-not-found") { deleted = true; break; }
        console.error(`Firebase deletion incomplete (attempt ${attempt + 1}):`, error);
        if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 300));
      }
    }
    if (!deleted) return { status: 502, body: {
      ok: false, dataDeleted: false, authDeleted: false, deletionPending: true, error: "auth_deletion_failed",
    } };
  }
  // A concurrent finisher can win this final delete. Only reconcile a negative
  // result after our data/Firebase steps succeeded, using durable primary absence.
  // Exceptions/uncertain acknowledgments still propagate without claiming success.
  if (!(await deleteOwner()) && !(await ownerIsAbsent())) return incomplete;
  return { status: 200, body: { ok: true } };
}
