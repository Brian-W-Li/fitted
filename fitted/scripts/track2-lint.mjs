/**
 * Run outfit-lint over the Track-2 gauntlet output (or, later, over live snapshots / the M6 export).
 * Reads every persona JSON in $TRACK2_OUT and lints every shown candidate.
 *
 *   node scripts/track2-lint.mjs
 *
 * Uses the SAME lib/outfitLint.ts logic the jest suite pins (transpiled on the fly with the repo's
 * typescript) — ONE source of truth, no mirrored rules to drift. The browser response already carries
 * clothingType per displayItem, so no item join is needed here.
 */
import { readdirSync, readFileSync } from "fs";
import { resolve } from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const OUT_DIR = resolve(process.env.TRACK2_OUT || "./track2-gauntlet-out");

// Transpile lib/outfitLint.ts on the fly with the repo's typescript, then eval the CJS. Keeps ONE
// source of truth (the jest-pinned lib/outfitLint.ts) — no mirrored rules to drift.
function loadOutfitLint() {
  const ts = require("typescript");
  const src = readFileSync(resolve("./lib/outfitLint.ts"), "utf8");
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = { exports: {} };
  const fn = new Function("module", "exports", "require", out);
  fn(mod, mod.exports, require);
  return mod.exports;
}

function main() {
  const { lintBatch } = loadOutfitLint();
  const files = readdirSync(OUT_DIR).filter((f) => f.endsWith(".json"));
  const outfits = [];
  for (const f of files) {
    const data = JSON.parse(readFileSync(resolve(OUT_DIR, f), "utf8"));
    for (const rd of data.renders ?? []) {
      for (const c of rd.shown ?? []) {
        outfits.push({
          label: `${data.slug}/${rd.intent}/${rd.occasion}: ${c.displayItems.map((d) => d.name).join(" + ")}`,
          items: c.displayItems.map((d) => ({ clothingType: d.clothingType, name: d.name })),
        });
      }
    }
  }
  const report = lintBatch(outfits);
  console.log(`Linted ${report.total} rendered candidates across ${files.length} personas.`);
  console.log(`Outfits with findings: ${report.withFindings} (${((100 * report.withFindings) / report.total).toFixed(1)}%)`);
  console.log(`By rule:`, report.byRule);
  if (report.findings.length) {
    console.log(`\nFlagged outfits:`);
    for (const f of report.findings) {
      console.log(`  • ${f.label}`);
      for (const x of f.findings) console.log(`      [${x.rule}] ${x.message}`);
    }
  }
}

main();
