/**
 * Pure, testable gate logic for the destructive DB wipe (scripts/wipe-db.ts).
 *
 * Extracted from the script so the irreversible-action safety can be unit-tested
 * without importing the script (which runs main() on import). The reused CS148
 * .env.local may point MONGODB_URI at the SHARED team Atlas cluster, so a wipe
 * must be refused there.
 */

const ALLOWLIST_LABELS = ["localhost", "127.0.0.1", "fitted-dev"];

export function parseMongoUri(uri: string): { host: string; dbName: string } {
  try {
    const url = new URL(uri);
    const dbName = url.pathname.replace(/^\//, "") || "(default)";
    return { host: url.host || "(unknown)", dbName };
  } catch {
    return { host: "(unparseable)", dbName: "(unknown)" };
  }
}

/**
 * Allow a wipe only when an allowlisted label (localhost / 127.0.0.1 / fitted-dev)
 * appears at a LABEL BOUNDARY in the **host**, OR FITTED_ALLOW_WIPE=1.
 *
 * The HOST is the only trustworthy signal of "this is my local/dev box." The db NAME
 * is deliberately NOT consulted: a wipe must be refused against the shared team Atlas
 * cluster even if its database happens to be named `fitted-dev` (a real footgun — the
 * reused CS148 .env.local may point at that cluster). A genuine dev Atlas cluster is
 * authorized via a `fitted-dev`-labelled host, or explicitly via FITTED_ALLOW_WIPE=1.
 *
 * Boundary-anchoring is the point: a trailing hyphen does NOT count as a boundary,
 * so a prod host like "fitted-dev-shadow.prod.mongodb.net" is correctly refused.
 * The password never reaches here (URL parsing keeps it out of the host).
 */
export function isWipeAllowed(
  host: string,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (env.FITTED_ALLOW_WIPE === "1") return true;
  const atBoundary = (label: string) => {
    const esc = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[.@/:])${esc}([.:/]|$)`, "i");
  };
  return ALLOWLIST_LABELS.some((label) => atBoundary(label).test(host));
}
