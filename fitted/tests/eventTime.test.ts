import { getEventTimeISO, localDateTimeValue } from "@/lib/eventTime";

it("formats local wall time for datetime-local rather than UTC", () => {
  expect(localDateTimeValue(new Date(2026, 9, 11, 14, 5))).toBe("2026-10-11T14:05");
});
it.each([18, 22, 23])("keeps later today on today's date at %i:30", hour => {
  const now = new Date(2026, 9, 11, hour, 30);
  const later = new Date(getEventTimeISO("later_today", "", now)!);
  expect(later.getDate()).toBe(now.getDate());
  expect(later.getTime()).toBeGreaterThan(now.getTime());
});
it("uses today's evening, tomorrow's noon, and the selected local custom time", () => {
  const now = new Date(2026, 9, 11, 9);
  expect(new Date(getEventTimeISO("later_today", "", now)!).getHours()).toBe(18);
  const tomorrow = new Date(getEventTimeISO("tomorrow", "", now)!);
  expect(tomorrow.getDate()).toBe(12); expect(tomorrow.getHours()).toBe(12);
  expect(getEventTimeISO("custom", "2026-10-12T14:05", now)).toBe(new Date(2026, 9, 12, 14, 5).toISOString());
  expect(getEventTimeISO("custom", "invalid", now)).toBeUndefined();
  expect(getEventTimeISO("now", "", now)).toBeUndefined();
});
