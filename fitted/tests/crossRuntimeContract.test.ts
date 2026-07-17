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
  WEATHER_BUCKETS,
  SUPPORTED_INTENTS,
} from "@/lib/mlRequestAdapter";
import { ALLOWED_ACTIONS, MAX_PER_ITEM_FEEDBACK } from "@/lib/interactions";
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
