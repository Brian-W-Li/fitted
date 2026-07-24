/**
 * Cross-runtime contract guard (post-m5-reset §4.1 C1/C2/C4).
 *
 * A fact that must agree across the Next app (TS/Mongoose) and the Python render service — a clamp,
 * an enum value-set, an id/format regex — used to live as ≥2 hand-maintained copies with nothing
 * asserting they match, so a one-sided edit drifted silently (the recurring disease this campaign
 * targets). This test pins the TS side to the SINGLE source `ml-system/service/contract_fields.json`
 * (`crossRuntime`); the sibling `ml-system/service/tests/test_render_contract.py` pins the Python
 * side to the SAME file. Change a value on one side without the other → one of the two suites reddens.
 *
 * Exhaustiveness is the point: the clamp map must have EXACTLY the JSON's keys (a new mirrored clamp
 * forces a TS entry here), and regex agreement is proven behaviorally with shared accept/reject
 * vectors (the two runtimes' patterns differ syntactically but must not differ in behavior).
 */
import fs from "fs";
import path from "path";
import { recomputeCandidateCacheKey } from "./helpers/candidateCacheKey";
import {
  MAX_OCCASION_CHARS,
  MAX_WEATHER_RAW_CHARS,
  MAX_LOCATION_CHARS,
  MAX_WARDROBE_ITEMS,
  MAX_CONTROL_IDS,
  MAX_ITEM_NAME_CHARS,
  MAX_ITEM_TAG_CHARS,
  MAX_ITEM_TAGS,
  MAX_IMAGE_URL_CHARS,
  DEFAULT_MAX_COMPLETION_TOKENS,
  WEATHER_BUCKETS,
  SUPPORTED_INTENTS,
  GENERATOR_EXPECTATION,
} from "@/lib/mlRequestAdapter";
import { WARMTH_MIN, WARMTH_MAX } from "@/lib/warmth";
import { SERVICE_TIMEOUT_MS } from "@/lib/mlServiceClient";
import WardrobeItem from "@/models/WardrobeItem";
import { ALLOWED_ACTIONS, MAX_PER_ITEM_FEEDBACK } from "@/lib/interactions";
import { INTERACTION_ROWS_SCAN_LIMIT, REPETITION_WINDOW_SNAPSHOTS } from "@/lib/mlBehavioralRows";
import { ROLE_TO_SLOT } from "@/lib/mlSnapshotValidation";
import OutfitInteraction, { FEEDBACK_REASON_RAW_TEXT_MAX_CHARS } from "@/models/OutfitInteraction";
import { CLOTHING_TYPES } from "@/lib/clothingType";
import { OBJECT_ID_RE, SEED_DATE_RE, isValidRequestId } from "@/lib/formats";
import GenerationSnapshot, { ENGINE_FAILURE_MESSAGE_MAX_CHARS } from "@/models/GenerationSnapshot";

interface FormatVector {
  valid: string[];
  invalid: string[];
}
const CONTRACT = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../../ml-system/service/contract_fields.json"), "utf8"),
) as {
  crossRuntime: {
    clamps: Record<string, number>;
    reducerScanBounds: Record<string, number>;
    generatorExpectation: Record<string, string | number>;
    roleToSlot: Record<string, string>;
    enums: Record<string, string[]>;
    schemaEnums: Record<string, string[]>;
    formats: Record<string, FormatVector>;
  };
};

// The GenerationSnapshot candidate sub-schema enums (role/stageReached/template/optionPath/risk) are a
// SEPARATE copy from any adapter/config const — they exist ONLY in the Mongoose schema, mirrored from the
// fitted_core ontology (Role/Template/OptionPath/Risk/CANDIDATE_STAGES). Read the live schema enumValues
// off the nested candidate (and candidate.items) sub-schemas so a drift there — which would write-reject a
// valid service candidate — reddens here. (post-m5-reset §4.6 "role/candidate enums unpinned".)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CANDIDATE_SUBSCHEMA = (GenerationSnapshot.schema.path("candidates") as any).schema;
function candidateEnum(path: string): string[] {
  return (CANDIDATE_SUBSCHEMA.path(path) as { enumValues?: string[] }).enumValues ?? [];
}
const TS_SCHEMA_ENUMS: Record<string, string[]> = {
  stageReached: candidateEnum("stageReached"),
  // role lives one level deeper, on the candidate.items[] sub-schema.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  role: ((CANDIDATE_SUBSCHEMA.path("items") as any).schema.path("role") as { enumValues?: string[] }).enumValues ?? [],
  template: candidateEnum("template"),
  optionPath: candidateEnum("optionPath"),
  risk: candidateEnum("risk"),
};

// The TS-side value for every clamp the JSON mirrors. If the JSON gains a clamp with no entry here
// (or vice versa) the exhaustiveness test below reddens — the mirror can't be sampled.
const TS_CLAMPS: Record<string, number> = {
  MAX_OCCASION_CHARS,
  MAX_WEATHER_RAW_CHARS,
  MAX_LOCATION_CHARS,
  MAX_WARDROBE_ITEMS,
  MAX_CONTROL_IDS,
  MAX_ITEM_NAME_CHARS,
  MAX_ITEM_TAG_CHARS,
  MAX_ITEM_TAGS,
  MAX_IMAGE_URL_CHARS,
  MAX_PER_ITEM_FEEDBACK,
  FEEDBACK_REASON_RAW_TEXT_MAX_CHARS,
  ENGINE_FAILURE_MESSAGE_MAX_CHARS,
  // The warmth band (single-homed in lib/warmth) — the adapter's drop-predicate must equal the
  // service's accept-predicate exactly, or one out-of-band row sinks the whole closet (§15.2).
  WARMTH_MIN,
  WARMTH_MAX,
  // The maxCompletionTokens env-UNSET fallback (the live production case) — the env-SET value is
  // mirrored by shared-env (see the generator-expectation note below); this pins the static
  // default that shared-env story rests on against the service's DEFAULT_MAX_COMPLETION_TOKENS.
  DEFAULT_MAX_COMPLETION_TOKENS,
};

// The §H reducer scan bounds the Next behavioral-rows projection re-declares (lib/mlBehavioralRows.ts).
// Exhaustively pinned to the mirror so a TS drift DOWN — which silently starves personalization — reddens.
const TS_REDUCER_SCAN_BOUNDS: Record<string, number> = {
  INTERACTION_ROWS_SCAN_LIMIT,
  REPETITION_WINDOW_SNAPSHOTS,
};

// The §A.6 generator expectation values Next sends and the service exact-matches. `maxCompletionTokens`
// is deliberately excluded — it is env-driven (both sides read the same env var), mirrored by shared-env
// not a static value; the exhaustiveness check below pins that the mirror carries the STATIC set only.
// (The env-UNSET fallback IS static, and is pinned above as clamps.DEFAULT_MAX_COMPLETION_TOKENS.)
const TS_GENERATOR_EXPECTATION: Record<string, string | number> = {
  provider: GENERATOR_EXPECTATION.provider,
  model: GENERATOR_EXPECTATION.model,
  temperature: GENERATOR_EXPECTATION.temperature,
  apiSurface: GENERATOR_EXPECTATION.apiSurface,
  responseFormat: GENERATOR_EXPECTATION.responseFormat,
  reasoningEffort: GENERATOR_EXPECTATION.reasoningEffort,
  storeMode: GENERATOR_EXPECTATION.storeMode,
  promptCacheRetention: GENERATOR_EXPECTATION.promptCacheRetention,
  timeoutSeconds: GENERATOR_EXPECTATION.timeoutSeconds,
  maxRetries: GENERATOR_EXPECTATION.maxRetries,
};

const TS_ENUMS: Record<string, readonly string[]> = {
  weather: WEATHER_BUCKETS,
  intent: SUPPORTED_INTENTS,
  clothingType: CLOTHING_TYPES,
  // The live feedback vocabulary the route allowlist gates on — the Python reducers derive the
  // mirror from COUNTED_ACTIONS ∪ REJECTED_ACTION, so a one-sided action change reddens a suite.
  interactionAction: [...ALLOWED_ACTIONS],
};

const TS_FORMATS: Record<string, (s: string) => boolean> = {
  objectId: (s) => OBJECT_ID_RE.test(s),
  seedDate: (s) => SEED_DATE_RE.test(s),
  requestId: isValidRequestId,
};

describe("cross-runtime clamps (TS == contract_fields.json crossRuntime.clamps)", () => {
  const clamps = CONTRACT.crossRuntime.clamps;
  it("the TS clamp map has EXACTLY the mirrored keys (no un-pinned or stray clamp)", () => {
    expect(Object.keys(TS_CLAMPS).sort()).toEqual(Object.keys(clamps).sort());
  });
  for (const [name, value] of Object.entries(clamps)) {
    it(`${name} == ${value}`, () => {
      expect(TS_CLAMPS[name]).toBe(value);
    });
  }
  it("WardrobeItem.warmth schema min/max are single-homed on lib/warmth", () => {
    // The schema imports WARMTH_MIN/WARMTH_MAX (no separate literal), so pinning lib/warmth to the
    // mirror (above) transitively pins the schema — assert the source really is lib/warmth.
    const options = (WardrobeItem.schema.path("warmth") as { options?: { min?: number; max?: number } })
      .options;
    expect(options?.min).toBe(WARMTH_MIN);
    expect(options?.max).toBe(WARMTH_MAX);
  });
});

describe("service round-trip timeout margin (SERVICE_TIMEOUT_MS vs the pinned OpenAI timeout)", () => {
  // The prose invariant in lib/mlServiceClient.ts, made mechanical: Next's round-trip timeout must
  // exceed the service's OpenAI call timeout (cross-runtime-pinned generatorExpectation
  // .timeoutSeconds) plus overhead, and sit under the recommend route's maxDuration=60s budget
  // (the client clamps operator overrides to 50s for the same reason). Without this, bumping the
  // pinned 30s would silently invert the margin: the client would abort while the service is still
  // legitimately waiting on OpenAI. Runs on the module-load value (jest leaves
  // ML_SERVICE_TIMEOUT_MS unset, so this exercises the production default path).
  const openAiTimeoutMs = Number(CONTRACT.crossRuntime.generatorExpectation.timeoutSeconds) * 1000;
  it("exceeds the service OpenAI timeout with ≥5s overhead margin", () => {
    expect(SERVICE_TIMEOUT_MS).toBeGreaterThanOrEqual(openAiTimeoutMs + 5_000);
  });
  it("sits within the 50s clamp, under the route's 60s maxDuration budget", () => {
    expect(SERVICE_TIMEOUT_MS).toBeLessThanOrEqual(50_000);
  });
});

describe("cross-runtime reducer scan bounds (TS == contract_fields.json crossRuntime.reducerScanBounds)", () => {
  const bounds = CONTRACT.crossRuntime.reducerScanBounds;
  it("the TS scan-bound map has EXACTLY the mirrored keys (no un-pinned or stray bound)", () => {
    expect(Object.keys(TS_REDUCER_SCAN_BOUNDS).sort()).toEqual(Object.keys(bounds).sort());
  });
  for (const [name, value] of Object.entries(bounds)) {
    it(`${name} == ${value}`, () => {
      expect(TS_REDUCER_SCAN_BOUNDS[name]).toBe(value);
    });
  }
});

describe("cross-runtime generator expectation (TS == contract_fields.json crossRuntime.generatorExpectation)", () => {
  const gen = CONTRACT.crossRuntime.generatorExpectation;
  it("the TS generator-expectation map has EXACTLY the mirrored static keys (maxCompletionTokens is env-driven, excluded)", () => {
    expect(Object.keys(TS_GENERATOR_EXPECTATION).sort()).toEqual(Object.keys(gen).sort());
  });
  for (const [name, value] of Object.entries(gen)) {
    it(`${name} == ${JSON.stringify(value)}`, () => {
      expect(TS_GENERATOR_EXPECTATION[name]).toBe(value);
    });
  }
});

describe("cross-runtime role→slot map (TS == contract_fields.json crossRuntime.roleToSlot)", () => {
  const roleToSlot = CONTRACT.crossRuntime.roleToSlot;
  it("the TS ROLE_TO_SLOT map has EXACTLY the mirrored keys (no un-pinned or stray role)", () => {
    expect(Object.keys(ROLE_TO_SLOT).sort()).toEqual(Object.keys(roleToSlot).sort());
  });
  for (const [role, slot] of Object.entries(roleToSlot)) {
    it(`${role} → ${slot}`, () => {
      expect(ROLE_TO_SLOT[role]).toBe(slot);
    });
  }
});

describe("cross-runtime enums (TS == contract_fields.json crossRuntime.enums)", () => {
  const enums = CONTRACT.crossRuntime.enums;
  it("the TS enum map covers EXACTLY the mirrored keys (symmetry with the clamp guard)", () => {
    expect(Object.keys(TS_ENUMS).sort()).toEqual(Object.keys(enums).sort());
  });
  for (const [name, values] of Object.entries(enums)) {
    it(`${name} value-set matches`, () => {
      expect([...TS_ENUMS[name]].sort()).toEqual([...values].sort());
    });
  }

  // The Mongoose SCHEMA enums are a separate copy from the adapter/config consts pinned above — a
  // drift there would write-reject a valid render. Pin the schema literals to the same source.
  it("GenerationSnapshot.weather schema enum == the mirrored weather set", () => {
    const schemaWeather = (GenerationSnapshot.schema.path("weather") as { enumValues?: string[] }).enumValues ?? [];
    expect([...schemaWeather].sort()).toEqual([...enums.weather].sort());
  });
  it("WardrobeItem/snapshot clothingType schema enums are single-homed on CLOTHING_TYPES", () => {
    // clothingType schema enums import CLOTHING_TYPES (no separate literal), so pinning CLOTHING_TYPES
    // to the mirror (above) transitively pins the schemas — assert the source really is CLOTHING_TYPES.
    expect([...CLOTHING_TYPES].sort()).toEqual([...enums.clothingType].sort());
  });

  // The Mongoose OutfitInteraction.action enum is a deliberate SUPERSET of the live vocabulary:
  // planned/packed are [STAGED] board/routine scaffolding the route never emits and the Python
  // reducers treat as neutral. The live set must stay writable — a member dropped from the schema
  // would write-reject real feedback while the route/reducers still accept it.
  it("OutfitInteraction.action schema enum ⊇ the mirrored live vocabulary", () => {
    const schemaActions =
      (OutfitInteraction.schema.path("action") as { enumValues?: string[] }).enumValues ?? [];
    expect(schemaActions.length).toBeGreaterThan(0); // guard a wrong path yielding []
    for (const action of enums.interactionAction) {
      expect(schemaActions).toContain(action);
    }
  });

  // GenerationSnapshot.intent is likewise a deliberate SUPERSET: outfit_upgrade/translate are
  // [STAGED] intents the live route never sends (SUPPORTED_INTENTS = daily/rescue_item). The live set
  // must stay writable — dropping daily or rescue_item from the schema enum would write-reject the
  // real render the route just paid for. Pin superset, not equality (the staged members may exist).
  it("GenerationSnapshot.intent schema enum ⊇ the mirrored live intents", () => {
    const schemaIntents =
      (GenerationSnapshot.schema.path("intent") as { enumValues?: string[] }).enumValues ?? [];
    expect(schemaIntents.length).toBeGreaterThan(0);
    for (const intent of enums.intent) {
      expect(schemaIntents).toContain(intent);
    }
  });
});

describe("cross-runtime candidate/role schema enums (Mongoose == contract_fields.json crossRuntime.schemaEnums)", () => {
  const schemaEnums = CONTRACT.crossRuntime.schemaEnums;
  it("the TS schema-enum map covers EXACTLY the mirrored keys (no un-pinned or stray candidate enum)", () => {
    expect(Object.keys(TS_SCHEMA_ENUMS).sort()).toEqual(Object.keys(schemaEnums).sort());
  });
  for (const [name, values] of Object.entries(schemaEnums)) {
    it(`candidate.${name} schema enum value-set matches`, () => {
      expect([...TS_SCHEMA_ENUMS[name]].sort()).toEqual([...values].sort());
    });
  }
  it("reads REAL non-empty schema enums (guards a wrong Mongoose path silently yielding [])", () => {
    // If the nested-path traversal broke, every enum would be [] and the equality checks above would
    // pass only vacuously against a (non-empty) mirror — assert the traversal actually resolved.
    for (const values of Object.values(TS_SCHEMA_ENUMS)) expect(values.length).toBeGreaterThan(0);
  });
});

describe("cross-runtime id/format regexes (behavioral vectors)", () => {
  const formatEntries = Object.entries(CONTRACT.crossRuntime.formats).filter(([k]) => k !== "_comment");
  for (const [name, vec] of formatEntries) {
    const test = TS_FORMATS[name];
    it(`${name}: has a TS matcher`, () => expect(typeof test).toBe("function"));
    for (const v of vec.valid) {
      it(`${name} accepts ${JSON.stringify(v)}`, () => expect(test(v)).toBe(true));
    }
    for (const v of vec.invalid) {
      it(`${name} rejects ${JSON.stringify(v)}`, () => expect(test(v)).toBe(false));
    }
  }
});

describe("candidateCacheKey recompute — the JS mirror pinned to fitted_core.seed.candidate_cache_key", () => {
  // Known-answer vectors computed by the REAL Python unit:
  //   python3 -c "from fitted_core.seed import candidate_cache_key; print(candidate_cache_key(...))"
  // (re-verified against seed.py at landing). Covers multi-byte UTF-8 framing and the
  // None-vs-empty-string sentinel distinction ("-:" vs "0:"). The mirror itself lives in
  // tests/helpers/candidateCacheKey.ts and is consumed by the gated corpusReadback verifier —
  // this pin is what keeps that idle verifier from rotting when either runtime's framing moves.
  it("multi-byte occasion, null forcedItemId, dated seed", () => {
    expect(
      recomputeCandidateCacheKey({
        sessionId: "665f00000000000000000001",
        wardrobeVersion: 3,
        occasion: "weekend brunch — café ☕",
        weather: "mild",
        intent: "daily",
        forcedItemId: null,
        seedDate: "2026-07-16",
      }),
    ).toBe("9a8cf186e14025c3e08927a7d300edc42c3940491fd7dae64104b43ed4931c0f");
  });
  it("empty occasion ('0:' framing, NOT the '-:' null sentinel), forced item, null seedDate", () => {
    expect(
      recomputeCandidateCacheKey({
        sessionId: "665f00000000000000000001",
        wardrobeVersion: 0,
        occasion: "",
        weather: "mild",
        intent: "rescue_item",
        forcedItemId: "665f000000000000000000aa",
        seedDate: null,
      }),
    ).toBe("8c8bc8ad077b75464c5d636bde899ce75b1ed6784f6a4f4b69c51481eb9b5b11");
  });
});
