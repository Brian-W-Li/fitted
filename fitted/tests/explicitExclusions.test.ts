import { normalizeExclusionInput, normalizeExclusionRef, emptyExclusionInput, violatesExplicitExclusions, validExplicitExclusions } from "@/lib/explicitExclusions";
import { buildExplicitExclusions, exclusionCommandKey, verifiedExplicitExclusions } from "@/lib/resolveExplicitExclusions";
import type { SavedExclusionSet } from "@/lib/styleMemory/contract";
const id = (n: number) => n.toString(16).padStart(24, "0");
const requestId = "11111111-1111-4111-8111-111111111111";
const nextId = "22222222-2222-4222-8222-222222222222";
const ref = { id: id(10), revision: 4 };
const set: SavedExclusionSet = { ...ref, profileVersion: 1, routineId: null, routineVersion: null,
  entries: [{ id: id(11), revision: 3, kind: "combination", itemIds: [id(1), id(2)] }] };

test("explicit item instructions and complete-outfit instructions have different membership meaning", () => {
  const policy = buildExplicitExclusions(requestId, set, emptyExclusionInput(), ref)!;
  expect(violatesExplicitExclusions(policy, [id(2), id(1)])).toBe(true);
  expect(violatesExplicitExclusions(policy, [id(1), id(3)])).toBe(false);
  expect(violatesExplicitExclusions(policy, [id(1)])).toBe(false);
  expect(violatesExplicitExclusions(policy, [id(1), id(2), id(3)])).toBe(false);
  const item = buildExplicitExclusions(requestId, null, { itemIds: [id(1)], outfitItemIds: [] }, null)!;
  expect(violatesExplicitExclusions(item, [id(1), id(2), id(3)])).toBe(true);
  const dress = buildExplicitExclusions(requestId, null, { itemIds: [], outfitItemIds: [[id(4)]] }, null)!;
  expect(violatesExplicitExclusions(dress, [id(4)])).toBe(true);
  expect(violatesExplicitExclusions(dress, [id(4), id(5)])).toBe(false);
});
test("one-request instructions freeze canonical input to one request; empty children inherit none", () => {
  const input = normalizeExclusionInput({ itemIds: [id(8), id(7)], outfitItemIds: [[id(3), id(2)]] });
  expect(input).toEqual({ itemIds: [id(7), id(8)], outfitItemIds: [[id(2), id(3)]] });
  const first = buildExplicitExclusions(requestId, null, input, null)!;
  const retry = buildExplicitExclusions(requestId, null, input, null)!;
  expect(retry).toEqual(first);
  expect(buildExplicitExclusions(nextId, null, input, null)!.digest).not.toBe(first.digest);
  expect(buildExplicitExclusions(nextId, null, emptyExclusionInput(), null)).toBeUndefined();
  expect(exclusionCommandKey(null, input)).not.toBe(exclusionCommandKey(null, emptyExclusionInput()));
  expect(exclusionCommandKey(null, input)).toBe(exclusionCommandKey(null, normalizeExclusionInput({ itemIds: [id(7), id(8)], outfitItemIds: [[id(2), id(3)]] })));
});
test("fresh saved references are checked independently of a valid captured completed policy", () => {
  const captured = buildExplicitExclusions(requestId, set, emptyExclusionInput(), ref)!;
  expect(captured.digest).toBe("b20c2fd3f45e08f08b1983c1572d4751e5171135cbbe8df5bf50cdd2ba488594"); // Independent Python canonical JSON golden.
  expect(verifiedExplicitExclusions(captured, requestId)).toBe(true);
  expect(() => buildExplicitExclusions(nextId, { ...set, revision: 5 }, emptyExclusionInput(), ref)).toThrow(/changed/);
  expect(() => buildExplicitExclusions(nextId, set, emptyExclusionInput(), null)).toThrow(/changed/);
  expect(verifiedExplicitExclusions(captured, nextId)).toBe(false);
  const edited = structuredClone(captured); edited.entries[0].itemIds = [id(9)];
  expect(verifiedExplicitExclusions(edited, requestId)).toBe(false);
  expect(verifiedExplicitExclusions(captured, requestId)).toBe(true);
});
test("strict fields and bounds reject hidden instructions, duplicate membership, bad references and excess rules", () => {
  expect(normalizeExclusionRef(null)).toBeNull();
  for (const bad of [{ ...ref, rawText: "hidden" }, { ...ref, revision: true }, { id: ref.id, revision: 0 }]) expect(() => normalizeExclusionRef(bad)).toThrow();
  for (const bad of [null, {}, { itemIds: [], outfitItemIds: [], text: "ban" }, { itemIds: [id(1), id(1)], outfitItemIds: [] },
    { itemIds: [], outfitItemIds: [[id(1), id(1)]] }, { itemIds: [], outfitItemIds: [[id(1), id(2)], [id(2), id(1)]] },
    { itemIds: [], outfitItemIds: [Array.from({ length: 6 }, (_, i) => id(i + 1))] }, { itemIds: Array.from({ length: 21 }, (_, i) => id(i + 1)), outfitItemIds: [] }])
    expect(() => normalizeExclusionInput(bad)).toThrow();
  const policy = buildExplicitExclusions(requestId, set, emptyExclusionInput(), ref)!;
  expect(validExplicitExclusions({ ...policy, extra: [] })).toBe(false);
  expect(validExplicitExclusions({ ...policy, entries: [...policy.entries, policy.entries[0]] })).toBe(false);
  expect(validExplicitExclusions({ ...policy, savedRef: null })).toBe(false);
  expect(validExplicitExclusions({ ...policy, requestId: "not-a-command" })).toBe(false);
  for (const malformed of [{ ...policy.entries[0], scope: ["saved"] }, { ...policy.entries[0], kind: ["combination"] }])
    expect(validExplicitExclusions({ ...policy, entries: [malformed] })).toBe(false);
});
test("combined saved and request-only limits accept eighty distinct entries without dropping any", () => {
  const saved: SavedExclusionSet = { ...set, entries: Array.from({ length: 40 }, (_, i) => ({ id: id(100 + i), revision: 2,
    kind: i < 20 ? "item" as const : "combination" as const, itemIds: i < 20 ? [id(200 + i)] : [id(200 + i), id(300 + i)] })) };
  const input = { itemIds: Array.from({ length: 20 }, (_, i) => id(400 + i)), outfitItemIds: Array.from({ length: 20 }, (_, i) => [id(500 + i), id(600 + i)]) };
  const policy = buildExplicitExclusions(requestId, saved, input, ref)!;
  expect(policy.entries).toHaveLength(80);
  expect(policy.entries.filter(entry => entry.scope === "saved")).toHaveLength(40);
  expect(policy.entries.filter(entry => entry.scope === "request")).toHaveLength(40);
  expect(verifiedExplicitExclusions(policy, requestId)).toBe(true);
});
