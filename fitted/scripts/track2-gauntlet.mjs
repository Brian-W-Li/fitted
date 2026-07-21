/**
 * Track 2 content-quality gauntlet — seed persona closets through the REAL live ingestion path, run
 * REAL gpt-5.4-mini renders on the deployed service, capture the shown outfits + the "why", and dump
 * one results JSON per persona for the contact-sheet + human/agent judging. Every test user is erased
 * at the end (the erasure IS the cleanup).
 *
 *   TRACK2_LIVE_OK=1 node scripts/track2-gauntlet.mjs run [persona-slug]   # all personas, or one
 *   TRACK2_LIVE_OK=1 node scripts/track2-gauntlet.mjs erase-all            # erase every persona uid
 *
 * Output: scratchpad JSON at $TRACK2_OUT (default ./track2-gauntlet-out). Feeds track2-contact-sheet.mjs.
 *
 * Photos: each item gets a small solid-color swatch JPEG (sharp) so the item is image-usable (corpus
 * yield) and the erasure check has real WardrobeImage rows. The stylist reasons over names/colors/
 * occasions/clothingType (H33 — photos never reach the prompt), so swatch photos don't bias content
 * judgment; the contact sheet shows names + colors + the outfit + the why, which IS what the model saw.
 */
import { mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import { randomUUID } from "crypto";
import { createRequire } from "module";
import { mintIdToken, api, uploadImage, testIdentity, requireLiveOk, adminAuth } from "./track2-live.mjs";

const require = createRequire(import.meta.url);
const sharp = require("sharp");

const OUT_DIR = resolve(process.env.TRACK2_OUT || "./track2-gauntlet-out");

// A small named-color → hex table for swatch generation + realistic color tags.
const HEX = {
  white: "#f5f5f5", black: "#111111", gray: "#888888", navy: "#1f2d4d", blue: "#3b6fb5",
  green: "#3fae5a", olive: "#6b7233", beige: "#d8c8a8", brown: "#6b4a2b", red: "#b53b3b",
  charcoal: "#333333", cream: "#efe7d3", tan: "#c8a97a", burgundy: "#5c1f2b", pink: "#e0a0b0",
};
async function swatch(color) {
  const hex = HEX[color] || "#999999";
  return sharp({
    create: { width: 240, height: 240, channels: 3, background: hex },
  })
    .jpeg({ quality: 80 })
    .toBuffer();
}

// item := { name, category, colors[], occasions[], layerRole? }
function item(name, category, colors, occasions = [], layerRole) {
  return { name, category, colors, occasions, layerRole };
}

const PERSONAS = {
  "college-male-minimal": {
    note: "Minimal college-male closet — the realistic first friend. Can the stylist build sane outfits from ~7 basics?",
    occasions: ["class on campus", "casual weekend"],
    items: [
      item("White Cotton T-Shirt", "top", ["white"], ["casual"]),
      item("Gray Crewneck Sweatshirt", "top", ["gray"], ["casual"]),
      item("Navy Flannel Shirt", "top", ["navy"], ["casual"]),
      item("Blue Denim Jeans", "bottom", ["blue"], ["casual"]),
      item("Black Chino Pants", "bottom", ["black"], ["casual", "class"]),
      item("White Sneakers", "footwear", ["white"], ["casual"]),
      item("Denim Jacket", "top", ["blue"], ["casual"], "outer"),
    ],
  },
  "fast-fashion-orphans": {
    note: "35-item fast-fashion feel with orphan statement pieces. Do the loud items get integrated or ignored?",
    occasions: ["brunch with friends", "night out"],
    items: [
      item("White Ribbed Tank Top", "top", ["white"], ["casual"]),
      item("Black Crop Top", "top", ["black"], ["casual", "night out"]),
      item("Beige Oversized Blouse", "top", ["beige"], ["casual", "work"]),
      item("Blue Mom Jeans", "bottom", ["blue"], ["casual"]),
      item("Black Faux-Leather Leggings", "bottom", ["black"], ["night out"]),
      item("Olive Cargo Pants", "bottom", ["olive"], ["casual"]),
      item("White Platform Sneakers", "footwear", ["white"], ["casual"]),
      item("Black Ankle Boots", "footwear", ["black"], ["night out"]),
      item("Gold Sequin Blazer", "top", ["beige"], ["night out"], "outer"),
      item("Leopard Print Midi Skirt", "bottom", ["brown"], ["night out"]),
      item("Red Satin Slip Dress", "one piece", ["red"], ["night out"]),
      item("Denim Trucker Jacket", "top", ["blue"], ["casual"], "outer"),
    ],
  },
  "all-black": {
    note: "All-black closet. Does the 'why' hallucinate color harmony/contrast that isn't there?",
    occasions: ["creative office", "gallery opening"],
    items: [
      item("Black Crew T-Shirt", "top", ["black"], ["casual", "work"]),
      item("Black Turtleneck", "top", ["black"], ["work"]),
      item("Black Slim Jeans", "bottom", ["black"], ["casual"]),
      item("Black Tailored Trousers", "bottom", ["black"], ["work"]),
      item("Black Chelsea Boots", "footwear", ["black"], ["work"]),
      item("Black Leather Sneakers", "footwear", ["black"], ["casual"]),
      item("Black Wool Overcoat", "top", ["black"], ["work"], "outer"),
      item("Black Bomber Jacket", "top", ["black"], ["casual"], "outer"),
    ],
  },
  "one-green-shirt": {
    note: "Neutral closet + ONE bright green graphic tee nobody can match (the green-shirt rescue stress case).",
    occasions: ["casual weekend"],
    rescueItemName: "Bright Green Graphic Tee",
    items: [
      item("Bright Green Graphic Tee", "top", ["green"], ["casual"]),
      item("White Oxford Shirt", "top", ["white"], ["work", "casual"]),
      item("Light Gray Henley", "top", ["gray"], ["casual"]),
      item("Navy Chinos", "bottom", ["navy"], ["casual", "work"]),
      item("Khaki Trousers", "bottom", ["tan"], ["casual"]),
      item("Dark Wash Jeans", "bottom", ["blue"], ["casual"]),
      item("Brown Leather Loafers", "footwear", ["brown"], ["work", "casual"]),
      item("White Canvas Sneakers", "footwear", ["white"], ["casual"]),
    ],
  },
  "formality-skewed": {
    note: "Mostly formal + one gym-casual outlier. Does the stylist mix formality spreads absurdly (suit pants + gym hoodie)?",
    occasions: ["business meeting", "weekend errands"],
    items: [
      item("White Dress Shirt", "top", ["white"], ["work", "formal"]),
      item("Light Blue Dress Shirt", "top", ["blue"], ["work"]),
      item("Charcoal Suit Trousers", "bottom", ["charcoal"], ["work", "formal"]),
      item("Navy Suit Trousers", "bottom", ["navy"], ["formal"]),
      item("Black Oxford Dress Shoes", "footwear", ["black"], ["formal", "work"]),
      item("Navy Blazer", "top", ["navy"], ["work", "formal"], "outer"),
      item("Gray Gym Hoodie", "top", ["gray"], ["gym", "casual"]),
      item("Black Athletic Shorts", "bottom", ["black"], ["gym"]),
      item("White Running Shoes", "footwear", ["white"], ["gym"]),
    ],
  },
  "tokcap-full-ask": {
    note:
      "TOKCAP-1 discharge driver — a 16-item closet whose sampled pool forces the full DAILY_MAX_CANDIDATES=12 ask " +
      "under the live default cap (M5_MAX_COMPLETION_TOKENS unset → 2200). Read the snapshot back BEFORE erasing: " +
      "diagnostics.candidateRequested must be 12 and generator.finishStatus unset (clean finish, no truncation).",
    occasions: ["casual weekend"],
    items: [
      item("White Oxford Shirt", "top", ["white"], ["casual", "work"]),
      item("Black Crew T-Shirt", "top", ["black"], ["casual"]),
      item("Navy Polo Shirt", "top", ["navy"], ["casual"]),
      item("Gray Pullover Hoodie", "top", ["gray"], ["casual"]),
      item("Cream Knit Sweater", "top", ["cream"], ["casual"]),
      item("Light Blue Linen Shirt", "top", ["blue"], ["casual"]),
      item("Dark Wash Jeans", "bottom", ["blue"], ["casual"]),
      item("Khaki Chinos", "bottom", ["tan"], ["casual", "work"]),
      item("Black Joggers", "bottom", ["black"], ["casual"]),
      item("Olive Cotton Shorts", "bottom", ["olive"], ["casual"]),
      item("Charcoal Wool Trousers", "bottom", ["charcoal"], ["work"]),
      item("White Leather Sneakers", "footwear", ["white"], ["casual"]),
      item("Brown Suede Loafers", "footwear", ["brown"], ["casual", "work"]),
      item("Black Running Shoes", "footwear", ["black"], ["casual", "gym"]),
      item("Navy Bomber Jacket", "top", ["navy"], ["casual"], "outer"),
      item("Beige Overcoat", "top", ["beige"], ["work", "casual"], "outer"),
    ],
  },
  "text-sparse": {
    note: "CV-off minimal manual entry — names + category only, no colors/occasions. Does the stylist collapse into generic filler?",
    occasions: ["casual weekend"],
    items: [
      item("Shirt", "top", [], []),
      item("T-Shirt", "top", [], []),
      item("Sweater", "top", [], []),
      item("Pants", "bottom", [], []),
      item("Jeans", "bottom", [], []),
      item("Shoes", "footwear", [], []),
      item("Sneakers", "footwear", [], []),
      item("Jacket", "top", [], [], "outer"),
    ],
  },
};

async function seedCloset(token, spec) {
  const created = [];
  for (const it of spec.items) {
    const res = await api("POST", "/api/wardrobe", {
      token,
      body: {
        name: it.name,
        category: it.category,
        colors: it.colors,
        occasions: it.occasions,
        ...(it.layerRole ? { layerRole: it.layerRole } : {}),
      },
    });
    if (res.status !== 201) {
      console.warn(`  ! add "${it.name}" → ${res.status} ${JSON.stringify(res.body).slice(0, 120)}`);
      continue;
    }
    const id = res.body.item.id;
    // photo (swatch of the first color, or gray for sparse)
    const buf = await swatch(it.colors[0]);
    const up = await uploadImage(id, buf, `${id}.jpg`, "image/jpeg", token);
    created.push({ id, name: it.name, clothingType: res.body.item.clothingType, colors: it.colors, photo: up.status === 200 });
  }
  return created;
}

async function render(token, body) {
  const res = await api("POST", "/api/recommend", { token, body: { requestId: randomUUID(), ...body } });
  return res;
}

async function runPersona(slug) {
  const spec = PERSONAS[slug];
  if (!spec) throw new Error(`unknown persona ${slug}`);
  const { uid, email } = testIdentity(slug.replace(/-/g, ""));
  console.log(`\n=== ${slug} ===\n${spec.note}`);
  const token = await mintIdToken(uid, email);
  await api("POST", "/api/auth/sync", { token, body: { displayName: slug } });
  console.log(`  seeding ${spec.items.length} items …`);
  const items = await seedCloset(token, spec);
  const photoCount = items.filter((i) => i.photo).length;
  console.log(`  seeded ${items.length} items (${photoCount} with photos)`);

  const renders = [];
  for (const occasion of spec.occasions) {
    process.stdout.write(`  daily render "${occasion}" … `);
    const r = await render(token, { occasion });
    const shown = r.body?.shown ?? [];
    console.log(`${r.status}, ${shown.length} candidate(s)${shown.length === 0 ? " " + JSON.stringify(r.body).slice(0, 120) : ""}`);
    renders.push({ intent: "daily", occasion, status: r.status, snapshotId: shown[0]?.snapshotId ?? null, shown });
    // one re-roll of the first daily to test variation
    if (shown.length > 0 && occasion === spec.occasions[0]) {
      const parent = shown[0].snapshotId;
      const rr = await render(token, { parentSnapshotId: parent, controls: {} });
      const rrShown = rr.body?.shown ?? [];
      renders.push({ intent: "reroll", occasion, status: rr.status, parentSnapshotId: parent, snapshotId: rrShown[0]?.snapshotId ?? null, shown: rrShown });
      console.log(`    re-roll → ${rr.status}, ${rrShown.length} candidate(s)`);
    }
  }

  // rescue on the flagged orphan item, if any
  if (spec.rescueItemName) {
    const orphan = items.find((i) => i.name === spec.rescueItemName);
    if (orphan) {
      process.stdout.write(`  RESCUE on "${orphan.name}" … `);
      const r = await render(token, { occasion: spec.occasions[0], forcedItemId: orphan.id });
      const shown = r.body?.shown ?? [];
      const centered = shown.every((c) => c.displayItems.some((d) => d.itemId === orphan.id));
      console.log(`${r.status}, ${shown.length} candidate(s), orphan-in-all=${centered}`);
      renders.push({ intent: "rescue", occasion: spec.occasions[0], forcedItemId: orphan.id, orphanName: orphan.name, orphanCentered: centered, status: r.status, snapshotId: shown[0]?.snapshotId ?? null, shown });
    }
  }

  // feedback: like the first shown candidate, dislike the second (if present) of the first render
  const firstWithShown = renders.find((r) => (r.shown ?? []).length > 0);
  const feedback = [];
  if (firstWithShown) {
    const s = firstWithShown.shown;
    const like = await api("POST", "/api/interactions", { token, body: { snapshotId: s[0].snapshotId, candidateId: s[0].candidateId, action: "accepted" } });
    feedback.push({ action: "accepted", candidateId: s[0].candidateId, status: like.status });
    if (s[1]) {
      const dis = await api("POST", "/api/interactions", { token, body: { snapshotId: s[1].snapshotId, candidateId: s[1].candidateId, action: "rejected" } });
      feedback.push({ action: "rejected", candidateId: s[1].candidateId, status: dis.status });
    }
    console.log(`  feedback: ${feedback.map((f) => `${f.action}=${f.status}`).join(", ")}`);
  }

  const result = { slug, note: spec.note, uid, items, renders, feedback, ranAt: new Date().toISOString() };
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(resolve(OUT_DIR, `${slug}.json`), JSON.stringify(result, null, 2));
  console.log(`  → wrote ${slug}.json`);
  return result;
}

async function eraseAll() {
  for (const slug of Object.keys(PERSONAS)) {
    const { uid, email } = testIdentity(slug.replace(/-/g, ""));
    try {
      const token = await mintIdToken(uid, email);
      const del = await api("DELETE", "/api/account", { token });
      console.log(`erase ${uid} → ${del.status}`);
    } catch (e) {
      console.log(`erase ${uid}: ${e.message}`);
    }
    try {
      await adminAuth().deleteUser(uid);
    } catch {
      /* already gone */
    }
  }
}

async function main() {
  requireLiveOk();
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === "run") {
    const slugs = arg ? [arg] : Object.keys(PERSONAS);
    for (const slug of slugs) await runPersona(slug);
    console.log(`\nDone. Results in ${OUT_DIR}. Build the contact sheet: node scripts/track2-contact-sheet.mjs`);
    console.log("Remember to erase: TRACK2_LIVE_OK=1 node scripts/track2-gauntlet.mjs erase-all");
    return;
  }
  if (cmd === "erase-all") {
    await eraseAll();
    return;
  }
  console.error("usage: node scripts/track2-gauntlet.mjs <run [slug] | erase-all>");
  process.exit(1);
}

main().catch((err) => {
  console.error("❌", err);
  process.exit(1);
});
