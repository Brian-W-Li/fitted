/**
 * Track-2 daily monitor (runbook §8 pre-recruit checklist) — the CI-shaped ops artifact.
 *
 * The app fails SILENTLY: a dead service link, a lost single-machine pin, or a mistyped env var all
 * degrade to an empty "no outfits" state with no 500 and no alarm — a friend just quietly bounces and
 * you learn days later. This monitor pokes the things that fail silently and notifies on failure.
 *
 * Two HARD liveness checks (a FAIL fires a macOS notification + appends the log + exits non-zero):
 *   1. the render service /readyz returns 200 with ready:true
 *   2. the Fly render service is pinned to EXACTLY 1 machine (G1 — >1 silently multiplies the
 *      per-instance rate ceiling)
 * One INFORMATIONAL readout (never fails the monitor — a thin corpus is legitimate pre-recruit):
 *   3. the live corpus yield/growth (users / snapshots / labeled interactions). The CERTIFIED yield
 *      (scoreable-cluster decidability) is export_track2.mjs's job — this is a cheap liveness peek.
 *
 * All checks are READ-ONLY: no writes, no OpenAI spend. Safe to run any time / on a daily schedule.
 *
 *   node scripts/track2-monitor.mjs            # run all checks; notify + exit 1 on any hard FAIL
 *   node scripts/track2-monitor.mjs --quiet    # suppress the OK stdout line (cron-friendly)
 *
 * SCHEDULING (NOT installed by this script — your call): a launchd daily plist. The ready-to-edit
 * plist + install one-liner live in runbook §8. The plist must put /opt/homebrew/bin on PATH so the
 * `fly` CLI resolves under launchd's minimal environment (or set FLY_BIN to its absolute path).
 */
import { execFileSync } from "child_process";
import { appendFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import { loadEnvLocal } from "./track2-live.mjs";

loadEnvLocal();

const __dirname = dirname(fileURLToPath(import.meta.url));

const SERVICE_URL = process.env.ML_SERVICE_URL || "https://fitted-render-service.fly.dev";
const FLY_APP = process.env.FLY_APP || "fitted-render-service";
const FLY_BIN = process.env.FLY_BIN || "fly"; // launchd may need an absolute path (/opt/homebrew/bin/fly)
const ATLAS_URI = process.env.MONGODB_URI_ATLAS;
const LOG_PATH = process.env.TRACK2_MONITOR_LOG || resolve(__dirname, "../track2-monitor.log");
const QUIET = process.argv.includes("--quiet");

// ---- pure helpers (unit-reasoned; the I/O below feeds them) --------------------------------

/** Parse `fly machines list --json` into a machine tally. Throws on unparseable output so a broken
 *  fly CLI reads as a hard FAIL (unknown state) rather than a false pass. */
export function parseMachineCount(jsonStr) {
  const machines = JSON.parse(jsonStr);
  if (!Array.isArray(machines)) throw new Error("fly machines list did not return a JSON array");
  const total = machines.length;
  const started = machines.filter((m) => m && m.state === "started").length;
  return { total, started };
}

/** The verdict from the two HARD checks. A machine tally is a pass iff EXACTLY one machine exists
 *  (a stopped 2nd HA machine still violates G1 — Fly can start it, doubling the rate ceiling). */
export function evaluateChecks({ readyz, machine }) {
  const failures = [];
  if (!readyz.ok) failures.push(readyz.detail);
  if (!machine.ok) failures.push(machine.detail);
  return { ok: failures.length === 0, failures };
}

// ---- I/O checks ----------------------------------------------------------------------------

async function checkReadyz() {
  try {
    const res = await fetch(`${SERVICE_URL}/readyz`, { signal: AbortSignal.timeout(15000) });
    const body = await res.json().catch(() => ({}));
    const ok = res.status === 200 && body.ready === true;
    return {
      ok,
      detail: ok
        ? `readyz 200 ready:true (fittedCore ${body.versions?.fittedCoreVersion ?? "?"})`
        : `readyz FAIL status=${res.status} ready=${body.ready}`,
    };
  } catch (e) {
    return { ok: false, detail: `readyz FAIL unreachable: ${e.message}` };
  }
}

function checkMachineCount() {
  try {
    const out = execFileSync(FLY_BIN, ["machines", "list", "--json", "--app", FLY_APP], {
      encoding: "utf8",
      timeout: 30000,
    });
    const { total, started } = parseMachineCount(out);
    const ok = total === 1;
    return {
      ok,
      detail: ok
        ? `fly machines: 1 (started ${started})`
        : `machine-count FAIL total=${total} started=${started} (G1 requires exactly 1)`,
    };
  } catch (e) {
    return { ok: false, detail: `machine-count FAIL fly CLI error: ${e.message.split("\n")[0]}` };
  }
}

/** Informational only — never flips the monitor verdict. Read-only aggregate counts. */
async function yieldReadout() {
  if (!ATLAS_URI) return "yield: MONGODB_URI_ATLAS unset — skipped";
  let conn;
  try {
    conn = await mongoose.createConnection(ATLAS_URI, { serverSelectionTimeoutMS: 15000 }).asPromise();
    const db = conn.db;
    const [users, snaps, interactions, accepted] = await Promise.all([
      db.collection("users").countDocuments(),
      db.collection("generationsnapshots").countDocuments(),
      db.collection("outfitinteractions").countDocuments(),
      db.collection("outfitinteractions").countDocuments({ action: "accepted" }),
    ]);
    return `yield: users=${users} snapshots=${snaps} interactions=${interactions} (accepted=${accepted}) — certified decidability = export_track2`;
  } catch (e) {
    return `yield: WARN Atlas read failed: ${e.message.split("\n")[0]}`;
  } finally {
    if (conn) await conn.close().catch(() => {});
  }
}

function notifyFail(summary) {
  try {
    execFileSync("osascript", [
      "-e",
      `display notification ${JSON.stringify(summary)} with title "Fitted Track-2 monitor — FAIL"`,
    ]);
  } catch {
    /* osascript absent (non-mac / headless) — the log + non-zero exit are the fallback signal */
  }
}

function log(line) {
  try {
    appendFileSync(LOG_PATH, line + "\n");
  } catch {
    /* best-effort */
  }
}

async function main() {
  const readyz = await checkReadyz();
  const machine = checkMachineCount();
  const verdict = evaluateChecks({ readyz, machine });
  const yieldLine = await yieldReadout();

  const stamp = new Date().toISOString();
  const status = verdict.ok ? "PASS" : "FAIL";
  const line = `${stamp} ${status} | ${readyz.detail} | ${machine.detail} | ${yieldLine}`;
  log(line);

  if (!verdict.ok) {
    const summary = `Track-2 monitor FAIL: ${verdict.failures.join("; ")}`;
    notifyFail(summary);
    console.error(line);
    process.exit(1);
  }
  if (!QUIET) console.log(line);
  process.exit(0);
}

// Run only when invoked directly (importing for the pure helpers must not execute the checks).
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
