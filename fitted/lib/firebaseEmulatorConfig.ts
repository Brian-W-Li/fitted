const BASELINE_PROJECT = "demo-fitted-baseline";
const BASELINE_ORIGIN = "http://127.0.0.1:3107";

interface BrowserBaseline { enabled?: string; origin?: string }
interface ServerBaseline {
  enabled?: string; publicEnabled?: string; publicProjectId?: string; mongoUri?: string;
  serviceUrl?: string; serviceKey?: string;
}
function productionBrowserBaseline(baseline: BrowserBaseline | undefined): boolean {
  return baseline?.enabled === "1" && (baseline.origin === undefined || baseline.origin === BASELINE_ORIGIN);
}
function productionServerBaseline(baseline: ServerBaseline | undefined): boolean {
  if (baseline?.enabled !== "1" || baseline.publicEnabled !== "1" || baseline.publicProjectId !== BASELINE_PROJECT ||
      baseline.serviceUrl !== "http://127.0.0.1:8097" || baseline.serviceKey !== "local-baseline-key") return false;
  try {
    const mongo = new URL(baseline.mongoUri ?? "");
    return mongo.protocol === "mongodb:" && mongo.hostname === "127.0.0.1" && mongo.port === "27027" &&
      !mongo.username && !mongo.password && mongo.pathname === "/fitted_baseline" && !mongo.hash &&
      [...mongo.searchParams.keys()].every(key => key === "replicaSet") &&
      mongo.searchParams.getAll("replicaSet").length <= 1;
  } catch { return false; }
}

/** Emulator auth is restricted to the isolated demo runner. Production builds additionally
 * require literal opt-in flags, synthetic storage/services and the browser's loopback origin.
 * This proves production bundle behavior with an emulator, not hosted Firebase/OAuth behavior.
 */
export function localAuthEmulatorUrl(
  url: string, projectId: string, nodeEnv: string | undefined, baseline?: BrowserBaseline,
): string {
  const parsed = new URL(url);
  if (
    (nodeEnv === "production" && !productionBrowserBaseline(baseline)) ||
    projectId !== BASELINE_PROJECT || parsed.hostname !== "127.0.0.1" ||
    parsed.port !== "9099" || parsed.protocol !== "http:" || parsed.username ||
    parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash
  ) throw new Error("Firebase Auth emulator requires the isolated local baseline demo project");
  return parsed.origin;
}

export function assertLocalAdminAuthEmulator(
  host: string, projectId: string | undefined, serviceAccountKey: string | undefined,
  nodeEnv: string | undefined, applicationCredentials: string | undefined, baseline?: ServerBaseline,
): void {
  if (
    (nodeEnv === "production" && !productionServerBaseline(baseline)) ||
    host !== "127.0.0.1:9099" || projectId !== BASELINE_PROJECT || serviceAccountKey || applicationCredentials
  ) throw new Error("Firebase Auth emulator requires the isolated local baseline demo project and no service account");
}
