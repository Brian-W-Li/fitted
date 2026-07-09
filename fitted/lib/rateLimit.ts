/**
 * Minimal in-process sliding-window rate limiter (M5 C7, §I — CV-route ceiling).
 *
 * Best-effort at solo/serverless scale: the window lives in module memory, so it resets on a cold
 * start and is per-instance (not global). That is acceptable for the CV route — it is a courtesy
 * guard against a runaway client loop, not a spend boundary (the paid boundary is the Fly render
 * service's own token bucket, §A). Keyed by user id.
 */
interface Window {
  hits: number[];
}

const windows = new Map<string, Window>();

/**
 * Returns true if this key is under `max` requests within the trailing `windowMs`, and records the
 * hit; returns false (deny) otherwise. Prunes expired timestamps lazily.
 */
export function allowRequest(key: string, max: number, windowMs: number, now: number = Date.now()): boolean {
  const w = windows.get(key) ?? { hits: [] };
  const cutoff = now - windowMs;
  w.hits = w.hits.filter((t) => t > cutoff);
  if (w.hits.length >= max) {
    windows.set(key, w);
    return false;
  }
  w.hits.push(now);
  windows.set(key, w);
  return true;
}

/** Test-only: clear all windows. */
export function __resetRateLimit(): void {
  windows.clear();
}
