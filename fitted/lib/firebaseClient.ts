import { initializeApp, getApps } from "firebase/app";
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { localAuthEmulatorUrl } from "@/lib/firebaseEmulatorConfig";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

export const auth = getAuth(app);

// Explicit demo-only emulator wiring. The browser baseline uses the real Firebase SDK and
// real emulator-issued ID tokens; no route accepts a test identity or skips verification.
const emulatorUrl = process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL;
if (emulatorUrl) {
  connectAuthEmulator(auth, localAuthEmulatorUrl(emulatorUrl, firebaseConfig.projectId, process.env.NODE_ENV, {
    enabled: process.env.NEXT_PUBLIC_FITTED_LOCAL_PRODUCTION_BASELINE,
    origin: typeof window === "undefined" ? undefined : window.location.origin,
  }), { disableWarnings: true });
  if (typeof window !== "undefined") {
    Object.assign(window, {
      __fittedBaselineSignIn: (email: string, password: string) =>
        signInWithEmailAndPassword(auth, email, password),
    });
  }
}
