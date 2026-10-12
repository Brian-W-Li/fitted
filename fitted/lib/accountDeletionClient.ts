import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebaseClient";
import { clearSessionCookie } from "@/lib/sessionCookie";

/** Clear browser residue only after server-confirmed erasure. */
export async function finishAccountDeletion(uid: string) {
  try {
    for (let index = window.localStorage.length - 1; index >= 0; index--) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(`fitted:wear:${uid}:`) || key?.startsWith(`fitted:retract:${uid}:`)) window.localStorage.removeItem(key);
    }
  } catch { /* Storage may be disabled. */ }
  await clearSessionCookie().catch(() => {});
  await signOut(auth).catch(() => {});
  try { window.sessionStorage.clear(); } catch { /* Storage may be disabled. */ }
  window.location.href = "/";
}
