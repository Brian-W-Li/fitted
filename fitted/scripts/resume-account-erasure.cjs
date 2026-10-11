#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS loader reuses production TS on Node 20. */
/** Manually finish a previously requested erasure, using existing server credentials.
 * Run from fitted/: node scripts/resume-account-erasure.cjs <mongo-user-id> --resume-pending
 * This accepts ONLY erasureStarted:true. It cannot initiate account deletion.
 */
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const appRoot = path.resolve(__dirname, "..");
const owner = process.argv[2];
if (!/^[a-fA-F0-9]{24}$/.test(owner ?? "") || process.argv[3] !== "--resume-pending" || process.argv.length !== 4) {
  console.error("Usage: node scripts/resume-account-erasure.cjs <mongo-user-id> --resume-pending");
  process.exit(1);
}
require("dotenv").config({ path: path.join(appRoot, ".env.local"), quiet: true });
// Reuse the production TypeScript helper on Node 20, using the installed compiler.
const ts = require("typescript");
const resolve = Module._resolveFilename;
Module._resolveFilename = function(id, ...args) {
  return resolve.call(this, id.startsWith("@/") ? path.join(appRoot, id.slice(2)) : id, ...args);
};
require.extensions[".ts"] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText, file);
(async () => {
  const { initDatabase, deleteUserWithData } = require("../lib/db.ts");
  const models = await initDatabase();
  const pending = await models.User.exists({ _id: owner, erasureStarted: true });
  if (!pending) throw new Error("Refusing recovery: owner is missing or account erasure was not requested");
  const { adminAuth } = require("../lib/firebaseAdmin.ts");
  const { resumeUserErasure } = require("../lib/resumeUserErasure.ts");
  const result = await resumeUserErasure(models, owner, uid => adminAuth.deleteUser(uid), () => deleteUserWithData(owner));
  console.log(JSON.stringify(result.body));
  process.exitCode = result.status === 200 ? 0 : 1;
})().catch(error => { console.error(error instanceof Error ? error.message : "Account erasure recovery failed"); process.exitCode = 1; })
  .finally(async () => { await require("mongoose").disconnect(); });
