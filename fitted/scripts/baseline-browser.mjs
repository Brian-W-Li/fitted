import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { cp, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoClient, ObjectId } from "mongodb";
import { chromium } from "@playwright/test";
import { createServer } from "node:net";

const fitted = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(fitted, "..");
const project = "demo-fitted-baseline";
const production = process.argv.includes("--production");
assert.ok(process.argv.slice(2).every(arg => arg === "--production"), "unknown baseline argument");
const origin = "http://127.0.0.1:3107";
const authOrigin = "http://127.0.0.1:9099";
const serviceOrigin = "http://127.0.0.1:8097";
const children = [];
const temp = await mkdtemp(path.join(tmpdir(), "fitted-baseline-"));
let mongo, mongoClient, browser, debugPage;

function localTarget(url, allowed) {
  const parsed = new URL(url);
  assert.equal(parsed.hostname, "127.0.0.1", `refusing nonlocal target: ${url}`);
  assert.ok(allowed.includes(parsed.protocol), `refusing protocol: ${url}`);
}

function child(command, args, cwd, env) {
  const proc = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
  let output = "";
  proc.baselineError = null;
  proc.baselineClosed = false;
  proc.on("error", error => { proc.baselineError = error; });
  proc.on("close", () => { proc.baselineClosed = true; });
  for (const stream of [proc.stdout, proc.stderr]) stream?.on("data", data => {
    output = (output + data.toString()).slice(-12000);
  });
  proc.baselineOutput = () => output;
  children.push(proc);
  return { proc, output: () => output };
}

async function completed(running, timeoutMs = 180000, requireSuccess = true) {
  const deadline = Date.now() + timeoutMs;
  while (!running.proc.baselineClosed && Date.now() < deadline) {
    if (running.proc.baselineError) throw running.proc.baselineError;
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  assert.ok(running.proc.baselineClosed && (!requireSuccess || running.proc.exitCode === 0), `baseline build failed or timed out:\n${running.output()}`);
}

async function assertFreePort(port) {
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", error => reject(new Error(`local port ${port} unavailable: ${error.message}`)));
    server.listen(port, "127.0.0.1", () => server.close(resolve));
  });
}

function stopGroup(proc, signal) {
  if (!proc.pid) return;
  try { process.kill(-proc.pid, signal); }
  catch (error) { if (error.code !== "ESRCH") throw error; }
}

async function ready(url, running, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (running.proc.baselineError) throw new Error(`${url} failed to start: ${running.proc.baselineError.message}`);
    if (running.proc.baselineClosed || running.proc.exitCode !== null || running.proc.signalCode !== null)
      throw new Error(`${url} exited:\n${running.output()}`);
    let response;
    try { response = await fetch(url, { signal: AbortSignal.timeout(1500) }); } catch {}
    if (response?.ok) {
      if (running.proc.baselineError || running.proc.baselineClosed || running.proc.exitCode !== null || running.proc.signalCode !== null)
        throw new Error(`${url} responded from a process this runner does not own`);
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new Error(`${url} did not become ready:\n${running.output()}`);
}

async function json(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => null);
  assert.ok(response.ok, `${url}: ${response.status} ${JSON.stringify(body)}`);
  return body;
}

async function account(email) {
  const password = "baseline-only-Password-27";
  const created = await json(`${authOrigin}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  // First login is intentionally raced: the route must resolve one committed owner.
  const sync = () => json(`${origin}/api/auth/sync`, {
    method: "POST", headers: { Authorization: `Bearer ${created.idToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ displayName: email.split("@")[0] }),
  });
  const [synced, concurrent] = await Promise.all([sync(), sync()]);
  assert.equal(synced.userId, concurrent.userId, "concurrent first login resolves one owner");
  return { email, password, token: created.idToken, userId: synced.userId, firebaseUid: created.localId };
}

async function run() {
  for (const url of [origin, authOrigin, serviceOrigin]) localTarget(url, ["http:"]);
  // Preflight every fixed endpoint before starting any service. Otherwise ready() could
  // mistake an unrelated listener for the child that this runner owns.
  for (const port of [27027, 9099, 8097, 3107]) await assertFreePort(port);
  // Next's dotenv loader reads .env.local even with env -i. Stage only source/config files
  // into a private temp project, with node_modules linked, so live credentials are absent.
  await cp(fitted, path.join(temp, "app"), {
    recursive: true,
    filter: source => !["node_modules", ".next", "coverage"].includes(path.basename(source)) && !/^\.env(?:\.|$)/.test(path.basename(source)),
  });
  await symlink(path.join(fitted, "node_modules"), path.join(temp, "app/node_modules"), "dir");
  const config = path.join(temp, "firebase.json");
  await writeFile(config, JSON.stringify({ emulators: { auth: { host: "127.0.0.1", port: 9099 }, ui: { enabled: false } } }));

  mongo = await MongoMemoryReplSet.create({ instanceOpts: [{ port: 27027 }], replSet: { count: 1, ip: "127.0.0.1", storageEngine: "wiredTiger" } });
  const mongoUri = mongo.getUri("fitted_baseline");
  localTarget(mongoUri, ["mongodb:"]);
  mongoClient = new MongoClient(mongoUri);
  await mongoClient.connect();
  const db = mongoClient.db();
  if (production) {
    // Production admission inspects existing uniqueness. Provision only these
    // synthetic indexes; experience mutations retain their explicit provisioning.
    await db.collection("users").createIndex({ authProvider: 1, authId: 1 }, { unique: true });
    await db.collection("users").createIndex({ email: 1 }, { unique: true });
    await db.collection("generationsnapshots").createIndex({ user: 1, requestId: 1 },
      { unique: true, partialFilterExpression: { requestId: { $type: "string" } } });
    assert.equal((await db.collection("outfitexperiences").listIndexes().toArray().catch(() => [])).length, 0,
      "experience indexes are not provisioned by the runner");
  }
  const userEnv = { PATH: process.env.PATH ?? "", HOME: temp, CI: "true" };
  const firebase = child(path.join(fitted, "node_modules/.bin/firebase"),
    ["emulators:start", "--only", "auth", "--project", project, "--config", config], temp, userEnv);
  await ready(`${authOrigin}/`, firebase);

  // IDs are fixed before the service starts; the real Mongo records are inserted below.
  const ids = Array.from({ length: 5 }, (_, i) => new ObjectId(`65000000000000000000000${i + 1}`));
  const pythonEnv = { PATH: process.env.PATH ?? "", PYTHONPATH: path.join(root, "ml-system"),
    FITTED_BASELINE_ITEM_IDS: ids.map(x => x.toString()).join(",") };
  const localPython = path.join(root, "ml-system/.venv/bin/python");
  const python = child(existsSync(localPython) ? localPython : "python3",
    ["-m", "uvicorn", "service.baseline_app:app", "--host", "127.0.0.1", "--port", "8097"], path.join(root, "ml-system"), pythonEnv);
  await ready(`${serviceOrigin}/readyz`, python);

  const nextEnv = {
    PATH: process.env.PATH ?? "", HOME: temp, NODE_ENV: production ? "production" : "development", NEXT_TELEMETRY_DISABLED: "1",
    MONGODB_URI: mongoUri, ML_SERVICE_URL: serviceOrigin, FITTED_SERVICE_KEY: "local-baseline-key",
    USE_ML_SHORTLISTER: "true",
    FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099", GCLOUD_PROJECT: project,
    NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL: authOrigin,
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: project, NEXT_PUBLIC_FIREBASE_API_KEY: "fake-api-key",
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: `${project}.firebaseapp.com`, NEXT_PUBLIC_FIREBASE_APP_ID: "baseline-app",
    ...(production ? { FITTED_LOCAL_PRODUCTION_BASELINE: "1", NEXT_PUBLIC_FITTED_LOCAL_PRODUCTION_BASELINE: "1" } : {}),
  };
  // Hosted loaders may reject require(ESM) despite native Node 24 support.
  // Exercise the compiled auth chain with that native escape hatch disabled.
  const servingEnv = production
    ? { ...nextEnv, NODE_OPTIONS: "--no-experimental-require-module" }
    : nextEnv;
  if (production) {
    console.log("Building isolated production browser baseline");
    await completed(child("npm", ["run", "build"], path.join(temp, "app"), nextEnv));
    // Verify the compiled server refuses an incomplete production test opt-in.
    const invalid = child(path.join(fitted, "node_modules/.bin/next"),
      ["start", "--hostname", "127.0.0.1", "--port", "3107"], path.join(temp, "app"),
      { ...servingEnv, FITTED_LOCAL_PRODUCTION_BASELINE: "0" });
    await ready(`${origin}/signin`, invalid);
    const rejected = await fetch(`${origin}/api/auth/sync`, {
      method: "POST", headers: { Authorization: "Bearer synthetic-guard-check", "Content-Type": "application/json" }, body: "{}",
    });
    assert.equal(rejected.status, 500, "compiled server rejects missing production baseline authorization");
    assert.ok(invalid.output().includes("Firebase Auth emulator requires"), "compiled rejection comes from the emulator guard");
    assert.equal(await db.collection("users").countDocuments({}), 0, "invalid configuration admitted no owner");
    stopGroup(invalid.proc, "SIGTERM");
    await completed(invalid, 10000, false);
    await assertFreePort(3107);

  }
  const next = child(path.join(fitted, "node_modules/.bin/next"),
    [production ? "start" : "dev", ...(production ? [] : ["--webpack"]), "--hostname", "127.0.0.1", "--port", "3107"],
    path.join(temp, "app"), servingEnv);
  await ready(`${origin}/signin`, next, 120000);

  const owner = await account("owner@baseline.test");
  const other = await account("other@baseline.test");
  const items = [
    ["Baseline blue shirt", "top", "top"], ["Baseline chinos", "bottom", "bottom"],
    ["Baseline trousers", "bottom", "bottom"], ["Baseline shoes", "shoes", "footwear"],
    ["Baseline blazer", "outer_layer", "outer"],
  ];
  await db.collection("wardrobeitems").insertMany(items.map(([name, clothingType, category], i) => ({
    _id: ids[i], user: new ObjectId(owner.userId), name, clothingType, category,
    warmth: 5, colors: ["navy"], occasions: ["casual"], isAvailable: true,
    createdAt: new Date(), updatedAt: new Date(),
    ...(i === 0 ? { imagePath: "mongo:650000000000000000000010" } : {}),
  })));
  const imageId = new ObjectId("650000000000000000000010");
  await db.collection("wardrobeimages").insertOne({
    _id: imageId, user: new ObjectId(owner.userId), wardrobeItem: ids[0],
    // A synthetic shirt silhouette supports visual recognition checks (no participant photo).
    base64: "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAABjklEQVR4nO2azW2FMBCEx6NI6eLd00K6SRMpIk2km7SQO13klIgDkoX4sc2uCcx+xwfs7KzXBswDgiAIgiBQJfUSerx+/NZeM3y9u+eX/pvp3sVI3qafX94Ox/z5/nQrRoKT+dz4ZKCmGEvX5IWwKgLhbN6SPK7V9GIP89Nv81ZeY6tjrIvAK4y8ZxFST/N5Byydv3d86/zWNSGh88iXTIPWeC1FIA5S2/bj+WvXbB2z0jfpgMcJ896rC3h180cXRV7d/NEi8A7mjxSBdzHfWgTeyXxLEbgXLF9Vax9lrWnR37srpFLx0k6YJ+nxOlyqX3JLZGkSJZ3gNfKlOi3PA6wRHoNOgUextUS8dm/W4ua55Dm6PQoPC92QJ9ASs1Z7rtv9XWBoWBytsXgb5JEE5qI9dnGtdWmVTC/z1rq0TKY3FrqEOIQ4hDiEOIQ4hDiEOIQ49Ag67R1Y7SBNcSz/bzBBiEOIQ4hDiEOIQ4hDiEOIQ4hDiEOIQ4hDiPPkGfysL0Y18OwEgiAIgiDAWfwBhfDiKmvohoUAAAAASUVORK5CYII=",
    contentType: "image/png", sizeBytes: 455, createdAt: new Date(), updatedAt: new Date(),
  });
  const unauthorizedImage = await fetch(`${origin}/api/images/${imageId}`);
  assert.equal(unauthorizedImage.status, 401, "image requires session cookie");
  const otherWardrobe = await json(`${origin}/api/wardrobe`, { headers: { Authorization: `Bearer ${other.token}` } });
  assert.equal(otherWardrobe.items.length, 0, "bearer API isolates owner");
  const memoryHeaders = { Authorization: `Bearer ${owner.token}` };
  const oversized = await fetch(`${origin}/api/experiences`, {
    method: "POST", headers: { ...memoryHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ padding: "x".repeat(9000) }),
  });
  assert.equal(oversized.status, 413, "memory writes reject oversized bodies before persistence");
  const badQuery = await fetch(`${origin}/api/experiences?unexpected=1`, { headers: memoryHeaders });
  assert.equal(badQuery.status, 400, "memory reads reject unknown filters");
  assert.equal(badQuery.headers.get("cache-control"), "no-store", "memory responses are private from caches");

  browser = await chromium.launch({ headless: true, channel: process.env.FITTED_BASELINE_CHROME_CHANNEL || "chrome" });
  const context = await browser.newContext();
  const page = await context.newPage();
  debugPage = page;
  let generationCalls = 0;
  page.on("request", request => {
    if (request.url().endsWith("/api/recommend") && request.method() === "POST") {
      generationCalls++;
    }
  });
  await page.goto(`${origin}/signin`);
  await page.waitForFunction(() => typeof window.__fittedBaselineSignIn === "function");
  await page.evaluate(({ email, password }) => window.__fittedBaselineSignIn(email, password), owner);
  await page.goto(`${origin}/wardrobe`);
  await page.getByText("Baseline blue shirt").waitFor();
  await page.getByRole("link", { name: "Build an outfit around this" }).first().click();
  await page.getByText("Building an outfit around").waitFor();
  await page.locator("textarea").fill("Weekend casual lunch");
  // Manual conditions drive the real selection pipeline and survive saved return.
  await page.getByRole("combobox", { name: "Temperature", exact: true }).selectOption("cold");
  await page.getByRole("combobox", { name: "Rain", exact: true }).selectOption("rain");
  await page.getByRole("combobox", { name: "Wind", exact: true }).selectOption("windy");
  const [recommendResponse] = await Promise.all([
    page.waitForResponse(response => response.url().endsWith("/api/recommend") && response.request().method() === "POST"),
    page.getByRole("button", { name: /Get Recommendations/i }).click(),
  ]);
  const recommendation = await recommendResponse.json();
  assert.equal(recommendResponse.status(), 200, JSON.stringify(recommendation));
  assert.ok(recommendation.bindable && recommendation.shown?.length > 0, `empty rescue: ${JSON.stringify(recommendation)}`);
  assert.ok(recommendation.shown[0].displayItems.some(item => item.itemId === ids[0].toString()), "shown candidate includes forced item");
  const rescueCommand = recommendResponse.request().postDataJSON();
  assert.equal(rescueCommand.weatherSource, "manual");
  assert.equal(rescueCommand.weather, "cold");
  assert.equal(rescueCommand.weatherRaw, "Cold; rain expected; windy");
  assert.deepEqual(rescueCommand.weatherSignals, { rain: true, wind: true });
  assert.equal(recommendation.layerChoice?.status, "offered");
  assert.ok(recommendation.shown.some(entry => entry.displayItems.some(item =>
    item.itemId === ids[4].toString() && item.role === "outer_layer")),
    "wet/windy request preserves a synthetic owned outer through ranking and spread");
  assert.ok(recommendation.shown.every(entry => !/waterproof|wind[- ]resistant|protected from/i.test(entry.styleMove.oneSentence)),
    "visible styling does not invent protection for the metadata-unknown blazer");
  assert.ok(!("lat" in rescueCommand), "manual expected weather does not need location");
  const rescueSnapshot = await db.collection("generationsnapshots").findOne({ _id: new ObjectId(recommendation.shown[0].snapshotId) });
  assert.equal(rescueSnapshot.weatherSource, "manual", "strict persistence keeps weather provenance");
  assert.equal(rescueSnapshot.weatherRaw, rescueCommand.weatherRaw);
  assert.deepEqual(rescueSnapshot.weatherSignals, rescueCommand.weatherSignals);
  assert.equal(rescueSnapshot.layerChoice.status, "offered");
  const savedRescueUrl = `${origin}/memory/proposal?snapshotId=${rescueSnapshot._id}&candidateId=${recommendation.shown[0].candidateId}`;
  await page.goto(savedRescueUrl);
  await page.getByText(/Your expected conditions/).waitFor();
  await page.getByText(/Cold; rain expected; windy/).waitFor();
  await page.reload();
  await page.getByText(/Your expected conditions/).waitFor();
  await page.getByText(/Rain and wind protection are unknown/).waitFor();
  const replayResponse = await json(`${origin}/api/recommend`, {
    method: "POST", headers: { ...memoryHeaders, "Content-Type": "application/json" },
    body: JSON.stringify(rescueCommand),
  });
  assert.deepEqual(replayResponse.weatherSignals, rescueSnapshot.weatherSignals);
  assert.deepEqual(replayResponse.layerChoice, rescueSnapshot.layerChoice);
  assert.deepEqual(replayResponse.shown.map(entry => entry.candidateId), recommendation.shown.map(entry => entry.candidateId),
    "retry replays the captured offered set rather than selecting again");
  assert.equal(await db.collection("outfitexperiences").countDocuments({ user: new ObjectId(owner.userId) }), 0,
    "weather entry and saved return do not report wear");
  assert.equal(await db.collection("outfitplans").countDocuments({ user: new ObjectId(owner.userId) }), 0,
    "weather entry does not create a plan");
  // Delayed reporting starts from a shown candidate with no reaction. The item view
  // retrieves it from its immutable snapshot after leaving the generation screen.
  assert.equal(await db.collection("outfitinteractions").countDocuments({ user: new ObjectId(owner.userId) }), 0);
  await page.goto(`${origin}/memory?itemId=${ids[0]}`);
  await page.getByRole("heading", { name: "Recent suggestions for this garment" }).waitFor();
  await page.getByRole("button", { name: "Report what I wore" }).first().click();
  await page.getByRole("textbox", { name: "Actual situation", exact: true }).last().fill("Weekend casual lunch");
  await page.getByRole("combobox", { name: "How did it go?" }).first().selectOption("worked");
  await page.getByRole("button", { name: "Save wear report" }).first().click();
  await page.getByText("Wear report saved.", { exact: false }).first().waitFor();
  const report = await db.collection("outfitexperiences").findOne({ user: new ObjectId(owner.userId), lifecycle: "active" });
  assert.ok(report, "unliked shown suggestion was reportable");
  assert.equal(report.revisions.at(-1).state.outcome, "worked");
  assert.equal(generationCalls, 1, "reporting wear does not call the generator");
  await page.reload();
  await page.getByRole("heading", { name: "Reported wears" }).waitFor();
  await page.getByText("Worn", { exact: false }).first().waitFor();
  const oldPiece = report.memberItemIds.map(String).find(id => id !== ids[0].toString());
  assert.ok(oldPiece, "reported source has a piece to change");
  const otherBottom = [ids[1].toString(), ids[2].toString()].find(id => id !== oldPiece);
  assert.ok(otherBottom, "fixture has an alternative bottom");
  await page.getByRole("button", { name: "Make another outfit" }).first().click();
  await page.getByLabel("Leave out this old piece", { exact: true }).selectOption(oldPiece);
  await page.getByRole("textbox", { name: "New situation" }).fill("Dinner with friends");
  const [variationResponse] = await Promise.all([
    page.waitForResponse(response => response.url().endsWith("/api/recommend") && response.request().method() === "POST"),
    page.getByRole("button", { name: "Find an outfit" }).click(),
  ]);
  const variation = await variationResponse.json();
  assert.equal(variationResponse.status(), 200, JSON.stringify(variation));
  assert.ok(variation.shown?.length > 0, `changed-situation variation should surface an option: ${JSON.stringify(variation)}`);
  for (const proposal of variation.shown) {
    const members = proposal.displayItems.map(item => item.itemId);
    assert.ok(members.includes(ids[0].toString()), "variation keeps the selected shirt");
    assert.ok(!members.includes(oldPiece), "variation excludes the selected old piece");
  }
  await page.getByText("New proposal for Dinner with friends").waitFor();
  await page.getByText("These are new suggestions from your current closet. If you wore one, report that separately.").waitFor();
  const variationRequest = variationResponse.request().postDataJSON();
  const variationRow = await db.collection("generationsnapshots").findOne({ user: new ObjectId(owner.userId), requestId: variationRequest.requestId });
  assert.equal(variationRow.occasion, "Dinner with friends");
  assert.equal(variationRow.variationSourceCandidateId, report.candidateId);
  assert.equal(variationRow.controls.dislikedItemIds[0], oldPiece);
  assert.equal((await db.collection("outfitexperiences").findOne({ experienceId: report.experienceId })).revisions.length, 1,
    "new proposal does not alter past wear");
  // Leave the old piece available, remove the only alternate bottom, then the hard exclusion
  // must yield an honest empty result instead of silently relaxing the choice.
  await db.collection("wardrobeitems").updateOne({ _id: new ObjectId(otherBottom) }, { $set: { isAvailable: false } });
  await page.reload();
  await page.getByRole("button", { name: "Make another outfit" }).first().click();
  await page.getByLabel("Leave out this old piece", { exact: true }).selectOption(oldPiece);
  await page.getByRole("textbox", { name: "New situation" }).fill("Dinner with friends");
  const [emptyVariationResponse] = await Promise.all([
    page.waitForResponse(response => response.url().endsWith("/api/recommend") && response.request().method() === "POST"),
    page.getByRole("button", { name: "Find an outfit" }).click(),
  ]);
  const emptyVariation = await emptyVariationResponse.json();
  assert.equal(emptyVariationResponse.status(), 200);
  assert.equal(emptyVariation.shown.length, 0, "no candidate may violate the selected exclusion");
  await page.getByText(/No outfit met those exact choices/).waitFor();
  await db.collection("wardrobeitems").updateOne({ _id: new ObjectId(otherBottom) }, { $set: { isAvailable: true } });
  await page.getByRole("textbox", { name: "Filter actual situation" }).fill("Weekend casual lunch");
  await page.getByRole("button", { name: "Find", exact: true }).click();
  await page.getByRole("button", { name: "Correct wear report" }).first().click();
  await page.getByRole("textbox", { name: "Actual situation", exact: true }).first().fill("Office lunch");
  await page.getByRole("combobox", { name: "How did it go?" }).first().selectOption("change_next_time");
  const [correctionResponse] = await Promise.all([
    page.waitForResponse(response => response.url().includes("/api/experiences/") && response.request().method() === "PATCH"),
    page.getByRole("button", { name: "Save correction" }).first().click(),
  ]);
  assert.equal(correctionResponse.status(), 200, "correction acknowledged");
  await page.getByText("Wear report saved.", { exact: false }).first().waitFor();
  const corrected = await db.collection("outfitexperiences").findOne({ user: new ObjectId(owner.userId), experienceId: report.experienceId });
  assert.equal(corrected.revisions.at(-1).state.context.exactScopeKey, "Office lunch", "correction persisted the actual situation");
  await page.getByRole("textbox", { name: "Filter actual situation" }).fill("Office lunch");
  await page.getByRole("button", { name: "Find", exact: true }).click();
  await page.getByText("Change next time", { exact: false }).first().waitFor();
  await db.collection("wardrobeitems").updateOne({ _id: ids[0] }, { $set: { isAvailable: false } });
  await page.reload();
  await page.getByText("currently unavailable").first().waitFor();
  const memoryImage = page.locator(`img[src="/api/images/${imageId}"]`).first();
  assert.ok(await memoryImage.evaluate(image => image.complete && image.naturalWidth > 0), "owner can see historical item image in recall");
  const alienRead = await fetch(`${origin}/api/experiences/${report.experienceId}`, { headers: { Authorization: `Bearer ${other.token}` } });
  assert.equal(alienRead.status, 404, "other account cannot read a report");
  const alienCreate = await fetch(`${origin}/api/experiences`, { method: "POST", headers: { Authorization: `Bearer ${other.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ occurredOn: report.revisions[0].state.occurredOn, timezone: report.revisions[0].state.timezone, outcome: "unknown", compositionStatus: "as_shown", experienceId: randomUUID(), operationId: randomUUID(), snapshotId: String(report.snapshotId), candidateId: report.candidateId, context: { kind: "user", text: "Office lunch" } }) });
  assert.equal(alienCreate.status, 404, "other account cannot report from an owner's suggestion");
  assert.equal((await fetch(`${origin}/api/experiences`)).status, 401, "memory requires bearer auth");
  assert.equal(generationCalls, 3, "only the two deliberate variation requests generated after rescue");
  await page.getByRole("button", { name: "Erase report" }).click();
  await page.getByRole("button", { name: "Confirm permanent erasure" }).click();
  await page.getByText("No reported wears for this selection yet.").waitFor();
  const erased = await db.collection("outfitexperiences").findOne({ user: new ObjectId(owner.userId), experienceId: report.experienceId });
  assert.equal(erased.lifecycle, "erased");
  assert.ok(!("revisions" in erased), "erasure removed content");
  await page.getByRole("button", { name: "Report what I wore" }).first().click();
  await page.getByRole("textbox", { name: "Actual situation", exact: true }).last().fill("Office lunch");
  await page.getByRole("button", { name: "Save wear report" }).first().click();
  await page.getByRole("button", { name: "Retract report" }).first().waitFor();
  const [retractResponse] = await Promise.all([
    page.waitForResponse(response => response.url().endsWith("/retract") && response.request().method() === "POST"),
    page.getByRole("button", { name: "Retract report" }).first().click(),
  ]);
  assert.equal(retractResponse.status(), 200, "retraction acknowledged");
  const retractedSection = page.getByRole("heading", { name: "Retracted reports" }).locator("..");
  await retractedSection.getByRole("button", { name: "Erase report" }).click();
  await page.getByRole("button", { name: "Confirm permanent erasure" }).click();
  await page.getByText("No retracted reports for this selection.").waitFor();
  // R3: report a real substitution from the newest shown proposal. Recall must index the
  // confirmed substitute, never the suggested piece that was left unworn.
  await db.collection("wardrobeitems").updateOne({ _id: ids[0] }, { $set: { isAvailable: true } });
  await page.reload();
  await page.getByRole("heading", { name: "Recent suggestions for this garment" }).waitFor();
  const sourceBottom = variation.shown[0].displayItems.find(item => item.itemId === otherBottom);
  assert.ok(sourceBottom, "variation source has the alternative bottom");
  const suggestionCard = page.getByRole("heading", { name: "Recent suggestions for this garment" }).locator("..").locator("article").first();
  await suggestionCard.getByRole("button", { name: "Report what I wore" }).click();
  await suggestionCard.getByRole("radio", { name: "I changed some pieces" }).check();
  await suggestionCard.getByRole("checkbox", { name: sourceBottom.name }).uncheck();
  await suggestionCard.getByRole("combobox", { name: "Add a piece from your closet" }).selectOption(oldPiece);
  await suggestionCard.getByRole("textbox", { name: "Actual situation" }).fill("Evening class");
  await suggestionCard.getByRole("button", { name: "Save wear report" }).click();
  await page.getByText("Wear report saved.", { exact: false }).first().waitFor();
  await page.getByText("You reported a wear from this suggestion.", { exact: false }).first().waitFor();
  const changedReport = await db.collection("outfitexperiences").findOne({ user: new ObjectId(owner.userId), lifecycle: "active" });
  assert.ok(changedReport, "changed actual outfit was reported");
  assert.equal(changedReport.revisions.at(-1).state.compositionStatus, "changed");
  assert.ok(changedReport.memberItemIds.map(String).includes(oldPiece), "worn substitute is indexed");
  assert.ok(!changedReport.memberItemIds.map(String).includes(otherBottom), "unworn suggestion is not indexed");
  const wornLookup = await json(`${origin}/api/experiences?itemId=${oldPiece}`, { headers: memoryHeaders });
  const unwornLookup = await json(`${origin}/api/experiences?itemId=${otherBottom}`, { headers: memoryHeaders });
  assert.ok(wornLookup.experiences.some(row => row.experienceId === changedReport.experienceId), "substitute retrieves the wear");
  assert.ok(!unwornLookup.experiences.some(row => row.experienceId === changedReport.experienceId), "unworn suggestion does not retrieve the wear");
  // R4: the new proposal starts from the corrected actual composition, which contains oldPiece
  // and excludes the suggestion's otherBottom. The explicit choice keeps the shirt and leaves
  // out oldPiece; the server must resolve that choice from the active experience revision.
  await page.getByRole("button", { name: "Make another outfit" }).first().click();
  await page.getByText(/actual pieces you reported wearing/).waitFor();
  await page.getByLabel("Leave out this old piece", { exact: true }).selectOption(oldPiece);
  await page.getByRole("textbox", { name: "New situation" }).fill("Dinner after class");
  const [actualVariationResponse] = await Promise.all([
    page.waitForResponse(response => response.url().endsWith("/api/recommend") && response.request().method() === "POST"),
    page.getByRole("button", { name: "Find an outfit" }).click(),
  ]);
  const actualVariation = await actualVariationResponse.json();
  assert.equal(actualVariationResponse.status(), 200, JSON.stringify(actualVariation));
  assert.ok(actualVariation.shown.length > 0, "actual-outfit variation surfaces a proposal");
  const actualRequest = actualVariationResponse.request().postDataJSON();
  assert.equal(actualRequest.actualVariation.experienceId, changedReport.experienceId);
  assert.equal(actualRequest.actualVariation.expectedRevision, changedReport.currentRevision);
  assert.equal(actualRequest.actualVariation.leaveOutItemId, oldPiece);
  assert.ok(!("parentSnapshotId" in actualRequest), "client does not supply the source snapshot for actual-wear adaptation");
  for (const proposal of actualVariation.shown) {
    const members = proposal.displayItems.map(item => item.itemId);
    assert.ok(members.includes(ids[0].toString()), "actual-wear variation keeps the worn shirt");
    assert.ok(!members.includes(oldPiece), "actual-wear variation excludes the chosen worn piece");
  }
  const actualRow = await db.collection("generationsnapshots").findOne({ user: new ObjectId(owner.userId), requestId: actualRequest.requestId });
  assert.equal(actualRow.variationSourceExperienceId, changedReport.experienceId);
  assert.equal(actualRow.variationSourceRevision, changedReport.currentRevision);
  assert.equal((await db.collection("outfitexperiences").findOne({ experienceId: changedReport.experienceId })).currentRevision, 1,
    "making a new proposal does not rewrite actual wear");
  // R6: open the exact persisted proposal directly, reload, then explicitly report wear.
  // The new proposal is only an idea until this separate report is saved.
  const beforeSecondWear = await json(`${origin}/api/experiences?itemId=${ids[0]}&context=${encodeURIComponent("Dinner after class")}`,
    { headers: memoryHeaders });
  assert.equal(beforeSecondWear.experiences.length, 0, "generation alone is not counted as an actual wear");
  const proposalLink = page.getByRole("region", { name: "New outfit proposals" })
    .getByRole("link", { name: "Open saved proposal / report wear" }).first();
  const proposalHref = await proposalLink.getAttribute("href");
  assert.ok(proposalHref.includes(`snapshotId=${actualRow._id}`), "direct link binds the generated snapshot");
  await proposalLink.click();
  await page.getByRole("heading", { name: "Saved proposal" }).waitFor();
  await page.reload();
  const secondSuggestion = page.locator("article");
  await secondSuggestion.getByText("Suggested situation: Dinner after class", { exact: true }).waitFor();
  assert.deepEqual((await json(`${origin}/api/experiences/suggestion?${proposalHref.split("?")[1]}`, { headers: memoryHeaders })).suggestion.items.map(i => i.itemId).sort(),
    actualVariation.shown[0].displayItems.map(i => i.itemId).sort(), "direct return retrieves the exact proposal");
  // R7: plan the unliked proposal, return by the planning list and change/remove intent.
  const wearCountBeforePlanning = await db.collection("outfitexperiences").countDocuments({ user: new ObjectId(owner.userId) });
  const reactionCountBeforePlanning = await db.collection("outfitinteractions").countDocuments({ user: new ObjectId(owner.userId) });
  const callsBeforePlanning = generationCalls;
  await page.getByRole("button", { name: "Plan this outfit", exact: true }).click();
  await page.getByLabel("Plan for", { exact: true }).fill("2099-10-11");
  const [planResponse] = await Promise.all([
    page.waitForResponse(response => response.url().endsWith("/api/plans") && response.request().method() === "POST"),
    page.getByRole("button", { name: "Save plan", exact: true }).click(),
  ]);
  assert.equal(planResponse.status(), 200);
  const firstPlanCommand = planResponse.request().postDataJSON();
  await page.getByRole("link", { name: "View planned outfits" }).click();
  await page.reload();
  await page.getByRole("heading", { name: "Planned for 2099-10-11" }).waitFor();
  await page.getByLabel("Change planned day").fill("2099-10-12");
  await page.getByRole("button", { name: "Save new date" }).click();
  await page.getByRole("heading", { name: "Planned for 2099-10-12" }).waitFor();
  await page.getByRole("button", { name: "Remove plan" }).click();
  await page.getByText("No planned outfits yet.", { exact: false }).waitFor();
  const replayRemoved = await fetch(`${origin}/api/plans`, { method: "POST", headers: { ...memoryHeaders, "Content-Type": "application/json" }, body: JSON.stringify(firstPlanCommand) });
  assert.equal(replayRemoved.status, 410, "an old retry cannot restore a removed plan");
  await page.goto(`${origin}${proposalHref}`);
  await page.getByRole("button", { name: "Plan this outfit", exact: true }).click();
  await page.getByLabel("Plan for", { exact: true }).fill("2099-10-13");
  await page.getByRole("button", { name: "Save plan", exact: true }).click();
  await page.getByRole("link", { name: "View planned outfits" }).click();
  await page.getByRole("heading", { name: "Planned for 2099-10-13" }).waitFor();
  const otherPlans = await json(`${origin}/api/plans`, { headers: { Authorization: `Bearer ${other.token}` } });
  assert.equal(otherPlans.plans.length, 0, "planned outfits are owner-bound");
  assert.equal(await db.collection("outfitexperiences").countDocuments({ user: new ObjectId(owner.userId) }), wearCountBeforePlanning, "planning does not create wear");
  assert.equal(await db.collection("outfitinteractions").countDocuments({ user: new ObjectId(owner.userId) }), reactionCountBeforePlanning, "planning does not create preference feedback");
  assert.equal(generationCalls, callsBeforePlanning, "planning does not call the generator");
  await page.getByRole("link", { name: "Open proposal / report actual wear" }).click();
  await secondSuggestion.getByRole("button", { name: "Report what I wore" }).waitFor();
  await secondSuggestion.getByRole("button", { name: "Report what I wore" }).click();
  await secondSuggestion.getByRole("textbox", { name: "Actual situation" }).fill("Dinner after class");
  const [secondSaveResponse] = await Promise.all([
    page.waitForResponse(response => response.url().endsWith("/api/experiences") && response.request().method() === "POST"),
    secondSuggestion.getByRole("button", { name: "Save wear report" }).click(),
  ]);
  assert.equal(secondSaveResponse.status(), 200, "second wear report saves successfully");
  await secondSuggestion.getByText("Wear report saved. Find it in wear memory by the actual pieces and situation.", { exact: true }).waitFor();
  const secondReport = await db.collection("outfitexperiences").findOne({
    user: new ObjectId(owner.userId), snapshotId: actualRow._id, lifecycle: "active",
  });
  assert.ok(secondReport, "returning to the R4 proposal creates a separate reported wear");
  assert.notEqual(secondReport.experienceId, changedReport.experienceId);
  assert.equal(secondReport.revisions.at(-1).state.context.rawOccasion, "Dinner after class");
  assert.equal(secondReport.revisions.at(-1).state.compositionStatus, "as_shown");
  const secondProposal = actualVariation.shown.find(proposal => proposal.candidateId === secondReport.candidateId);
  assert.ok(secondProposal, "second report is bound to a shown R4 candidate");
  assert.deepEqual(secondReport.memberItemIds.map(String).sort(), secondProposal.displayItems.map(item => item.itemId).sort(),
    "second wear indexes the exact proposal explicitly reported as worn");
  const secondLookup = await json(`${origin}/api/experiences?itemId=${ids[0]}&context=${encodeURIComponent("Dinner after class")}`,
    { headers: memoryHeaders });
  assert.ok(secondLookup.experiences.some(row => row.experienceId === secondReport.experienceId),
    "the second actual wear is recalled by worn garment and situation");
  await page.goto(`${origin}/memory?itemId=${ids[0]}`);
  const originalWearCard = page.getByRole("heading", { name: "Reported wears" }).locator("..").locator("article")
    .filter({ hasText: "Actual situation: Evening class" });
  await originalWearCard.getByRole("button", { name: "Correct wear report" }).click();
  await page.getByRole("radio", { name: "Same as suggested" }).check();
  const [originalWearCorrectionResponse] = await Promise.all([
    page.waitForResponse(response => response.url().endsWith(`/api/experiences/${changedReport.experienceId}`) && response.request().method() === "PATCH"),
    originalWearCard.getByRole("button", { name: "Save correction" }).click(),
  ]);
  assert.equal(originalWearCorrectionResponse.status(), 200, "correcting the first wear succeeds");
  const resetReport = await db.collection("outfitexperiences").findOne({ experienceId: changedReport.experienceId });
  assert.equal(resetReport.revisions.at(-1).state.compositionStatus, "as_shown");
  assert.ok(!resetReport.memberItemIds.map(String).includes(oldPiece), "correction removes stale substitute membership");
  assert.ok(resetReport.memberItemIds.map(String).includes(otherBottom), "correction restores shown membership");
  assert.equal((await db.collection("generationsnapshots").findOne({ _id: actualRow._id })).redacted, true,
    "correcting the wear redacts the proposal derived from its old revision");
  await page.goto(`${origin}/plans`);
  await page.getByText("This proposal is no longer available.", { exact: false }).waitFor();
  assert.equal(await page.getByRole("link", { name: "Open proposal / report actual wear" }).count(), 0, "planning cannot reconstruct corrected-away source content");
  await page.getByRole("button", { name: "Remove plan" }).click();
  await page.getByText("No planned outfits yet.", { exact: false }).waitFor();
  await page.goto(`${origin}${proposalHref}`);
  await page.getByRole("alert").filter({ hasText: "This saved proposal is no longer available" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Report what I wore" }).count(), 0,
    "redacted derivative cannot be reported from its old link");
  await page.goto(`${origin}/memory?itemId=${ids[0]}`);
  const secondWearCard = page.getByRole("heading", { name: "Reported wears" }).locator("..").locator("article")
    .filter({ hasText: "Actual situation: Dinner after class" });
  await secondWearCard.getByText("Original suggestion is no longer available.").waitFor();
  for (const item of secondProposal.displayItems) await secondWearCard.getByRole("button", { name: item.name }).waitFor();
  const recalledSecond = await json(`${origin}/api/experiences?itemId=${ids[0]}&context=${encodeURIComponent("Dinner after class")}`,
    { headers: memoryHeaders });
  const retainedSecond = recalledSecond.experiences.find(row => row.experienceId === secondReport.experienceId);
  assert.ok(retainedSecond, "earlier-report correction does not erase a separately confirmed later wear");
  assert.equal(retainedSecond.sourceAvailable, false);
  assert.deepEqual(retainedSecond.items.map(item => item.itemId).sort(), secondProposal.displayItems.map(item => item.itemId).sort(),
    "confirmed second-wear membership survives source redaction");
  await secondWearCard.getByRole("button", { name: "Erase report" }).click();
  await secondWearCard.getByRole("button", { name: "Confirm permanent erasure" }).click();
  await secondWearCard.waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Erase report" }).first().click();
  await page.getByRole("button", { name: "Confirm permanent erasure" }).first().click();
  await page.getByText("No reported wears for this selection yet.").waitFor();
  // R8: adapt an unworn planned proposal, preserving the original intent and facts.
  await db.collection("wardrobeitems").updateMany({ user: new ObjectId(owner.userId) }, { $set: { isAvailable: true } });
  const unworn = await json(`${origin}/api/recommend`, { method: "POST", headers: { ...memoryHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ requestId: randomUUID(), forcedItemId: String(ids[0]), occasion: "Class tomorrow" }) });
  assert.ok(unworn.shown.length, "unworn source has a shown candidate");
  const unwornSource = unworn.shown[0];
  const unwornHref = `/memory/proposal?snapshotId=${unwornSource.snapshotId}&candidateId=${unwornSource.candidateId}`;
  await page.goto(`${origin}${unwornHref}`);
  await page.getByText("Saved weather context:", { exact: false }).waitFor();
  await page.getByRole("button", { name: "Plan this outfit", exact: true }).click();
  await page.getByLabel("Plan for", { exact: true }).fill("2099-10-14");
  await page.getByRole("button", { name: "Save plan", exact: true }).click();
  await page.getByRole("link", { name: "View planned outfits" }).click();
  const planPhoto = page.locator(`img[src="/api/images/${imageId}"]`).first();
  await planPhoto.waitFor();
  await page.waitForFunction(image => image.complete && image.naturalWidth > 0, await planPhoto.elementHandle());
  // R13: inspection is read-only and retains the saved photo, with native modal focus.
  const inspectionWrites = [];
  const observeInspection = request => { if (["POST", "PATCH", "DELETE"].includes(request.method()) && new URL(request.url()).origin === origin && !new URL(request.url()).pathname.startsWith("/api/auth/")) inspectionWrites.push(request.url()); };
  async function inspectSavedPhoto() {
    page.on("request", observeInspection);
    const trigger = page.getByRole("button", { name: "Enlarge saved photo of Baseline blue shirt", exact: true });
    await trigger.click();
    const viewer = page.getByRole("dialog", { name: "Saved photo: Baseline blue shirt", exact: true });
    await viewer.waitFor();
    assert.equal(await viewer.locator("img").getAttribute("src"), `/api/images/${imageId}`);
    assert.equal(await page.evaluate(() => document.body.style.overflow), "hidden");
    await page.keyboard.press("Tab"); await page.keyboard.press("Tab");
    assert.ok(await page.evaluate(() => document.activeElement === document.body || !!document.activeElement.closest("dialog")), "modal does not focus an underlying control");
    const bounds = await viewer.boundingBox();
    assert.ok(bounds.width <= page.viewportSize().width, "photo viewer fits viewport");
    if (process.env.FITTED_BROWSER_SCREENSHOT && page.viewportSize().width === 390)
      await page.screenshot({ path: process.env.FITTED_BROWSER_SCREENSHOT + ".photo.png" });
    await page.keyboard.press("Escape");
    await viewer.waitFor({ state: "detached" });
    assert.ok(await trigger.evaluate(element => element === document.activeElement), "Escape restores thumbnail focus");
    assert.notEqual(await page.evaluate(() => document.body.style.overflow), "hidden");
    page.off("request", observeInspection);
    assert.deepEqual(inspectionWrites, [], "photo inspection creates no writes");
  }
  await inspectSavedPhoto();
  const desktopViewport = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "planned card fits a narrow viewport");
  await inspectSavedPhoto();
  if (process.env.FITTED_BROWSER_SCREENSHOT) await page.screenshot({ path: process.env.FITTED_BROWSER_SCREENSHOT, fullPage: true });
  await page.setViewportSize(desktopViewport);
  const plansBeforeVariation = await json(`${origin}/api/plans`, { headers: memoryHeaders });
  const wearsBeforeVariation = await db.collection("outfitexperiences").countDocuments({ user: new ObjectId(owner.userId) });
  const reactionsBeforeVariation = await db.collection("outfitinteractions").countDocuments({ user: new ObjectId(owner.userId) });
  await page.getByRole("link", { name: "Open proposal / report actual wear" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await inspectSavedPhoto();
  await page.setViewportSize(desktopViewport);
  const inspectedProposalUrl = page.url();
  page.on("request", observeInspection);
  await page.getByRole("link", { name: "View current garment: Baseline blue shirt", exact: true }).click();
  const currentGarment = page.getByRole("region", { name: "Current garment", exact: true });
  await currentGarment.getByRole("heading", { name: "Baseline blue shirt", exact: true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get("itemId"), String(ids[0]), "link targets exact garment ID");
  assert.equal(await currentGarment.locator("img").first().getAttribute("src"), `/api/images/${imageId}`);
  assert.equal(await page.getByRole("button", { name: "Save item", exact: true }).count(), 0, "navigation does not open edit");
  assert.deepEqual(inspectionWrites, [], "garment inspection is read-only");
  page.off("request", observeInspection);
  // R17: attach a synthetic detail view through the existing Edit flow, then inspect
  // it as current evidence without changing the photo captured by the saved proposal.
  const primaryBytes = await db.collection("wardrobeimages").findOne({ _id: imageId });
  await currentGarment.getByRole("button", { name: "Edit this garment", exact: true }).click();
  await page.getByLabel("Additional view 1", { exact: true }).setInputFiles({
    name: "detail.png", mimeType: "image/png", buffer: Buffer.from(primaryBytes.base64, "base64"),
  });
  await page.getByRole("button", { name: "Save item", exact: true }).click();
  await page.getByRole("button", { name: "Select additional view 1", exact: true }).first().waitFor();
  const withDetail = await db.collection("wardrobeitems").findOne({ _id: ids[0] });
  assert.equal(withDetail.supplementalImages.length, 1, "edit saves one extra view on the same garment");
  const detailId = withDetail.supplementalImages[0].slice("mongo:".length);
  await page.reload();
  const currentViews = page.getByRole("region", { name: "Current garment", exact: true });
  await currentViews.getByRole("button", { name: "Select additional view 1", exact: true }).click();
  const enlargeCurrent = currentViews.getByRole("button", { name: "Enlarge current photo of Baseline blue shirt", exact: true });
  await enlargeCurrent.click();
  const currentViewer = page.getByRole("dialog", { name: "Current photo: Baseline blue shirt", exact: true });
  await currentViewer.waitFor();
  assert.equal(await currentViewer.locator("img").getAttribute("src"), `/api/images/${detailId}`);
  await page.keyboard.press("Escape");
  await currentViewer.waitFor({ state: "detached" });
  assert.ok(await enlargeCurrent.evaluate(element => element === document.activeElement), "current viewer restores focus");
  await page.goto(inspectedProposalUrl);
  await inspectSavedPhoto();
  assert.equal(await db.collection("wardrobeitems").countDocuments({ user: new ObjectId(owner.userId) }), 5, "extra view did not create another garment");
  await page.goto(`${origin}/wardrobe?itemId=${ids[0]}`);
  await page.getByRole("region", { name: "Current garment", exact: true }).getByRole("button", { name: "Edit this garment", exact: true }).click();
  await page.getByRole("button", { name: "Remove additional view 1", exact: true }).click();
  await page.getByRole("button", { name: "Save item", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[aria-label="Select additional view 1"]'));
  const withoutDetail = await db.collection("wardrobeitems").findOne({ _id: ids[0] });
  assert.deepEqual(withoutDetail.supplementalImages, [], "remove clears only the selected view");
  assert.equal(withoutDetail.imagePath, `mongo:${imageId}`, "remove preserves primary");
  assert.equal(await db.collection("wardrobeimages").countDocuments({ _id: new ObjectId(detailId) }), 0, "unreferenced detail bytes reclaimed");
  await page.goto(`${origin}/wardrobe?itemId=650000000000000000000099`);
  await page.getByRole("region", { name: "Current garment" }).getByText("This garment is not in your current wardrobe.", { exact: false }).waitFor();
  await page.goto(inspectedProposalUrl);
  await page.getByRole("button", { name: "Make another outfit" }).click();
  await page.getByLabel("Keep this piece", { exact: true }).selectOption(String(ids[0]));
  assert.equal(await page.getByLabel("Leave out this old piece", { exact: true }).inputValue(), "", "adaptation defaults to no rejection");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("New situation", { exact: true }).fill("Dinner tomorrow");
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "optional adaptation form fits a narrow viewport");
  for (const label of ["Keep this piece", "Leave out this old piece", "New situation"]) {
    assert.ok(await page.getByLabel(label, { exact: true }).evaluate(element => {
      const control = element.getBoundingClientRect();
      const container = element.parentElement.getBoundingClientRect();
      return control.left >= container.left && control.right <= container.right + 1;
    }), `${label} stays inside its form panel`);
  }
  if (process.env.FITTED_BROWSER_SCREENSHOT) await page.screenshot({ path: process.env.FITTED_BROWSER_SCREENSHOT, fullPage: true });
  const [unwornResponse] = await Promise.all([
    page.waitForResponse(response => response.url().endsWith("/api/recommend") && response.request().method() === "POST"),
    page.getByRole("button", { name: "Find an outfit" }).click(),
  ]);
  assert.equal(unwornResponse.status(), 200);
  const adapted = await unwornResponse.json();
  await page.setViewportSize(desktopViewport);
  assert.ok(adapted.shown.length, "planned unworn proposal can produce an alternative");
  for (const proposal of adapted.shown) {
    assert.ok(proposal.displayItems.some(item => item.itemId === String(ids[0])));
  }
  assert.ok(!Object.hasOwn(unwornResponse.request().postDataJSON().variation, "leaveOutItemId"));
  assert.deepEqual(await json(`${origin}/api/plans`, { headers: memoryHeaders }), plansBeforeVariation, "variation preserves original plan");
  assert.equal(await db.collection("outfitexperiences").countDocuments({ user: new ObjectId(owner.userId) }), wearsBeforeVariation);
  assert.equal(await db.collection("outfitinteractions").countDocuments({ user: new ObjectId(owner.userId) }), reactionsBeforeVariation);
  // R9: explicitly plan the alternative inline, using the original planned day as a default.
  const childCard = page.getByRole("region", { name: "New outfit proposals" }).getByRole("article").first();
  const callsBeforeInlinePlan = generationCalls;
  await page.setViewportSize({ width: 390, height: 844 });
  await childCard.getByRole("button", { name: "Plan this outfit", exact: true }).click();
  assert.equal(await childCard.getByLabel("Plan for", { exact: true }).inputValue(), "2099-10-14");
  const [inlinePlanResponse] = await Promise.all([
    page.waitForResponse(response => response.url().endsWith("/api/plans") && response.request().method() === "POST"),
    childCard.getByRole("button", { name: "Save plan", exact: true }).click(),
  ]);
  assert.equal(inlinePlanResponse.status(), 200);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "inline planning fits a narrow viewport");
  await page.setViewportSize(desktopViewport);
  const inlineCommand = inlinePlanResponse.request().postDataJSON();
  assert.equal(inlineCommand.snapshotId, adapted.shown[0].snapshotId);
  assert.equal(inlineCommand.candidateId, adapted.shown[0].candidateId);
  assert.equal(inlineCommand.timezone, plansBeforeVariation.plans[0].timezone, "carryover preserves the calendar's timezone");
  const afterInlinePlan = await json(`${origin}/api/plans`, { headers: memoryHeaders });
  assert.equal(afterInlinePlan.plans.length, 2, "alternative adds a separate plan");
  assert.deepEqual(afterInlinePlan.plans.find(plan => plan.planId === plansBeforeVariation.plans[0].planId), plansBeforeVariation.plans[0], "original plan stays unchanged");
  assert.equal(await db.collection("outfitexperiences").countDocuments({ user: new ObjectId(owner.userId) }), wearsBeforeVariation);
  assert.equal(await db.collection("outfitinteractions").countDocuments({ user: new ObjectId(owner.userId) }), reactionsBeforeVariation);
  assert.equal(generationCalls, callsBeforeInlinePlan, "inline planning does not generate another outfit");
  await childCard.getByRole("link", { name: "View planned outfits" }).click();
  await page.reload();
  const childReturn = page.locator(`a[href*="snapshotId=${inlineCommand.snapshotId}"]`);
  await childReturn.click();
  await page.reload();
  await page.getByText("Suggested situation: Dinner tomorrow", { exact: false }).waitFor();
  await page.getByRole("button", { name: "Plan this outfit", exact: true }).waitFor();
  await page.getByRole("button", { name: "Make another outfit" }).click();
  await page.getByLabel("Keep this piece", { exact: true }).selectOption(String(ids[0]));
  await page.getByLabel("Explore the saved situation", { exact: true }).check();
  assert.equal(await page.getByLabel("Saved situation", { exact: true }).inputValue(), "Dinner tomorrow");
  assert.equal(await page.getByLabel("Saved situation", { exact: true }).isDisabled(), true);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "exploration fits narrow viewport");
  if (process.env.FITTED_BROWSER_SCREENSHOT) await page.screenshot({ path: process.env.FITTED_BROWSER_SCREENSHOT, fullPage: true });
  // Compiled pages finish the earlier browser + direct-API renders inside one
  // rate window. Wait out the real sliding window before this next generation;
  // no test flag disables or raises the production six-per-minute ceiling.
  console.log("Pacing synthetic exploration within the real render rate window");
  const renderWindowEnds = Date.now() + 60_100;
  while (Date.now() < renderWindowEnds) {
    await new Promise(resolve => setTimeout(resolve, Math.min(30_000, renderWindowEnds - Date.now())));
  }
  const [exploreResponse] = await Promise.all([
    page.waitForResponse(response => response.url().endsWith("/api/recommend") && response.request().method() === "POST"),
    page.getByRole("button", { name: "Find another combination" }).click(),
  ]);
  assert.equal(exploreResponse.status(), 200);
  const explored = await exploreResponse.json();
  assert.ok(explored.shown.length, `fixture has a different combination for the same situation: ${JSON.stringify(explored)}`);
  const originalMembers = adapted.shown[0].displayItems.map(item => item.itemId).sort();
  const explorationCommand = exploreResponse.request().postDataJSON();
  assert.equal(explorationCommand.variation.mode, "explore");
  for (const proposal of explored.shown) {
    assert.notDeepEqual(proposal.displayItems.map(item => item.itemId).sort(), originalMembers);
    assert.ok(proposal.displayItems.some(item => item.itemId === explorationCommand.variation.anchorItemId));
  }
  const explorationRow = await db.collection("generationsnapshots").findOne({ user: new ObjectId(owner.userId), requestId: explorationCommand.requestId });
  assert.deepEqual(explorationRow.controls.excludedOutfitItemIds, originalMembers);
  assert.equal(explorationRow.occasion, "Dinner tomorrow");
  assert.deepEqual(await json(`${origin}/api/plans`, { headers: memoryHeaders }), afterInlinePlan, "exploration preserves planning intent");
  assert.equal(await db.collection("outfitexperiences").countDocuments({ user: new ObjectId(owner.userId) }), wearsBeforeVariation);
  assert.equal(await db.collection("outfitinteractions").countDocuments({ user: new ObjectId(owner.userId) }), reactionsBeforeVariation);
  await page.setViewportSize(desktopViewport);
  await page.goto(`${origin}/dashboard`);
  await page.getByRole("button", { name: "Like", exact: true }).first().click();
  await page.getByRole("link", { name: "History" }).click();
  await page.getByText("Baseline blue shirt").first().waitFor();
  await page.reload();
  await page.getByText("Baseline blue shirt").first().waitFor();

  // Exercise Chrome's actual cookie request. Playwright's APIRequestContext does
  // not share Chromium's Secure-cookie loopback handling on HTTP test origins.
  const cookieImage = await page.evaluate(async url => {
    const response = await fetch(url, { credentials: "same-origin" });
    return { status: response.status, type: response.headers.get("content-type"), size: (await response.arrayBuffer()).byteLength };
  }, `${origin}/api/images/${imageId}`);
  assert.equal(cookieImage.status, 200, "owner browser session cookie serves image after reload");
  assert.equal(cookieImage.type, "image/png");
  assert.ok(cookieImage.size > 0, "authenticated browser receives photo bytes");
  assert.equal((await context.request.get(`${origin}/api/wardrobe`, { headers: { Authorization: `Bearer ${owner.token}` } })).status(), 200);
  assert.equal(await page.evaluate(async url => (await fetch(url, { credentials: "same-origin" })).status,
    `${origin}/api/wardrobe`), 401, "bearer API rejects actual browser cookie alone");

  const snapshot = await db.collection("generationsnapshots").findOne({ _id: report.snapshotId, user: new ObjectId(owner.userId), intent: "rescue_item", generationIndex: 0 });
  assert.ok(snapshot?.candidates?.length, "rescue candidate persisted");
  assert.equal(snapshot.forcedItemId?.toString(), ids[0].toString());
  const reaction = await db.collection("outfitinteractions").findOne({ user: new ObjectId(owner.userId) });
  assert.ok(reaction, "reaction persisted");

  const otherContext = await browser.newContext();
  const otherPage = await otherContext.newPage();
  await otherPage.goto(`${origin}/signin`);
  await otherPage.waitForFunction(() => typeof window.__fittedBaselineSignIn === "function");
  await otherPage.evaluate(({ email, password }) => window.__fittedBaselineSignIn(email, password), other);
  const otherMemory = await json(`${origin}/api/experiences`, { headers: { Authorization: `Bearer ${other.token}` } });
  assert.equal(otherMemory.experiences.length, 0, "wear memory API isolates owner");
  await otherPage.goto(`${origin}/history`);
  await otherPage.getByRole("heading", { name: "No liked outfits yet" }).waitFor();
  assert.equal(await otherPage.getByText("Baseline blue shirt").count(), 0, "history isolates owner");
  const otherInteractions = await json(`${origin}/api/interactions`, { headers: { Authorization: `Bearer ${other.token}` } });
  assert.equal(otherInteractions.interactions.length, 0, "history API isolates owner");
  assert.equal(await otherPage.evaluate(async url => (await fetch(url, { credentials: "same-origin" })).status,
    `${origin}/api/images/${imageId}`), 404, "other browser account cannot read image");
  // R20: exercise actual garment insertion and missing-memory marker upsert before erasure.
  const addedGarment = await fetch(`${origin}/api/wardrobe`, {
    method: "POST", headers: { Authorization: `Bearer ${other.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Synthetic class tee", category: "top", colors: ["white"] }),
  });
  assert.equal(addedGarment.status, 201, "active owner can add a garment through the production route");
  // R21: the compiled UI confirms destructive clear, then reloads the current closet.
  await otherPage.goto(`${origin}/wardrobe`);
  await otherPage.getByText("Synthetic class tee", { exact: true }).first().waitFor();
  otherPage.once("dialog", dialog => dialog.accept());
  const [clearResponse] = await Promise.all([
    otherPage.waitForResponse(response => response.url().endsWith("/api/wardrobe/clear") && response.request().method() === "DELETE"),
    otherPage.getByRole("button", { name: "Delete all", exact: true }).click(),
  ]);
  assert.equal(clearResponse.status(), 200);
  assert.deepEqual(await clearResponse.json(), { ok: true, deletedCount: 1, itemsCleared: true, cleanupComplete: true });
  await otherPage.getByRole("button", { name: "Delete all", exact: true }).waitFor();
  await otherPage.waitForFunction(() => !document.body.textContent.includes("Synthetic class tee"));
  assert.equal(await db.collection("wardrobeitems").countDocuments({ user: new ObjectId(other.userId) }), 0);
  assert.ok(await db.collection("wardrobeitems").countDocuments({ user: new ObjectId(owner.userId) }) > 0, "clear preserves other owner's closet");
  const restoredGarment = await fetch(`${origin}/api/wardrobe`, {
    method: "POST", headers: { Authorization: `Bearer ${other.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Synthetic class tee", category: "top", colors: ["white"] }),
  });
  assert.equal(restoredGarment.status, 201, "cleared account can still add its next owned garment");
  const missingWearId = randomUUID();
  const erasedMarker = await fetch(`${origin}/api/experiences/${missingWearId}`, {
    method: "DELETE", headers: { Authorization: `Bearer ${other.token}` },
  });
  assert.equal(erasedMarker.status, 200, "missing wear erasure stores its replay marker");
  assert.equal(await db.collection("outfitexperiences").countDocuments({ user: new ObjectId(other.userId),
    experienceId: missingWearId, lifecycle: "erased" }), 1);
  // R18: a pending synthetic owner refreshes into the real deletion-only gate.
  await db.collection("users").updateOne({ _id: new ObjectId(other.userId) }, { $set: { erasureStarted: true } });
  await otherPage.reload();
  await otherPage.getByRole("button", { name: "Finish deletion" }).waitFor();
  assert.equal(await otherPage.getByRole("heading", { name: "No liked outfits yet" }).count(), 0);
  const [deletionResponse] = await Promise.all([
    otherPage.waitForResponse(response => response.url().endsWith("/api/account") && response.request().method() === "DELETE"),
    otherPage.getByRole("button", { name: "Finish deletion" }).click(),
  ]);
  assert.equal(deletionResponse.status(), 200);
  assert.equal(await db.collection("users").countDocuments({ _id: new ObjectId(other.userId) }), 0);
  assert.equal(await db.collection("users").countDocuments({ _id: new ObjectId(owner.userId) }), 1);
  for (const family of ["wardrobeitems", "generationsnapshots", "outfitinteractions", "outfitexperiences"]) {
    assert.equal(await db.collection(family).countDocuments({ user: new ObjectId(other.userId) }), 0,
      `account erasure removes the synthetic owner's ${family}`);
  }
  const staleSync = await fetch(`${origin}/api/auth/sync`, {
    method: "POST", headers: { Authorization: `Bearer ${other.token}`, "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(staleSync.status, 401, "deleted Firebase identity cannot recreate a Mongo owner");
  assert.equal(await db.collection("users").countDocuments({ authId: other.firebaseUid }), 0);
  const rejoined = await account(other.email);
  assert.notEqual(rejoined.firebaseUid, other.firebaseUid, "intentional re-signup gets a new Firebase identity");
  assert.notEqual(rejoined.userId, other.userId, "re-signup gets a new Mongo owner");
  assert.equal(await db.collection("users").countDocuments({ email: other.email }), 1);
  await otherContext.close();
  await context.close();
  console.log(`PASS ${production ? "production-build synthetic" : "development synthetic"} local browser: same-situation exploration, optional adaptation on narrow screen, rescue, plan photos and inline date carryover, direct unworn planned variation, dated planning/reschedule/removal, changed and second wear recall, shown/actual variation, no-option, correction, retraction, clear, erasure, image, history and owner isolation`);
}

try {
  await run();
} catch (error) {
  console.error(error);
  if (debugPage) console.error("browser text:", (await debugPage.locator("body").innerText().catch(() => "" )).slice(-2500));
  for (const proc of children) console.error("service log:\n", proc.baselineOutput());
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  for (const proc of children.reverse()) stopGroup(proc, "SIGTERM");
  await Promise.all(children.map(proc => new Promise(resolve => {
    if (proc.baselineClosed) return resolve();
    const timer = setTimeout(() => { stopGroup(proc, "SIGKILL"); resolve(); }, 3000);
    timer.unref();
    proc.once("close", () => { clearTimeout(timer); resolve(); });
  })));
  await mongoClient?.close().catch(() => {});
  await mongo?.stop().catch(() => {});
  await rm(temp, { recursive: true, force: true });
}
