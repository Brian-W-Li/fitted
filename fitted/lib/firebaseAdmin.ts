import { cert, getApps, initializeApp, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

/**
 * Firebase Admin initialization for server-side token verification.
 *
 * You must set one of:
 * - FIREBASE_SERVICE_ACCOUNT_KEY: JSON string of the service account key
 * - GOOGLE_APPLICATION_CREDENTIALS / application default credentials (for prod)
 */
function initFirebaseAdmin() {
  const apps = getApps();
  if (!apps.length) {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
      const serviceAccount = JSON.parse(
        process.env.FIREBASE_SERVICE_ACCOUNT_KEY,
      );
      initializeApp({
        credential: cert(serviceAccount),
      });
    } else {
      // Fallback to application default credentials (useful on GCP/Vercel with proper setup)
      initializeApp({
        credential: applicationDefault(),
      });
    }
  }
}

initFirebaseAdmin();

export const adminAuth = getAuth();

