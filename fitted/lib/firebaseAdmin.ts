import { cert, getApps, initializeApp, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { assertLocalAdminAuthEmulator } from "@/lib/firebaseEmulatorConfig";

/**
 * Firebase Admin initialization for server-side token verification.
 *
 * You must set one of:
 * - FIREBASE_SERVICE_ACCOUNT_KEY: JSON string of the service account key
 * - GOOGLE_APPLICATION_CREDENTIALS / application default credentials (for prod)
 */
function initFirebaseAdmin() {
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    assertLocalAdminAuthEmulator(
      process.env.FIREBASE_AUTH_EMULATOR_HOST,
      process.env.GCLOUD_PROJECT,
      process.env.FIREBASE_SERVICE_ACCOUNT_KEY,
      process.env.NODE_ENV,
      process.env.GOOGLE_APPLICATION_CREDENTIALS,
      { enabled: process.env.FITTED_LOCAL_PRODUCTION_BASELINE,
        publicEnabled: process.env.NEXT_PUBLIC_FITTED_LOCAL_PRODUCTION_BASELINE,
        publicProjectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
        mongoUri: process.env.MONGODB_URI, serviceUrl: process.env.ML_SERVICE_URL,
        serviceKey: process.env.FITTED_SERVICE_KEY },
    );
  }
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
        projectId: process.env.FIREBASE_AUTH_EMULATOR_HOST ? "demo-fitted-baseline" : undefined,
      });
    }
  }
}

initFirebaseAdmin();

export const adminAuth = getAuth();
