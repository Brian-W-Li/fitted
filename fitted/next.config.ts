import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vercel's CommonJS loader cannot require jose's ESM entry, even on Node 24.
  // Bundle the Firebase Auth chain so the compiled routes retain real verification.
  transpilePackages: ["firebase-admin", "jwks-rsa", "jose"],
};

export default nextConfig;
