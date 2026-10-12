import { planDayHint } from "@/lib/outfitPlanning/client";
import { suggestionLink } from "@/lib/suggestionLink";
it("carries an exact calendar day/timezone without UTC date conversion", () => {
  const day = planDayHint("2099-01-01", "Pacific/Kiritimati");
  expect(day).toEqual({ plannedFor: "2099-01-01", timezone: "Pacific/Kiritimati" });
  const params = new URL(suggestionLink({ snapshotId: "snapshot", candidateId: "child /?&" }, day), "http://localhost").searchParams;
  expect(params.get("candidateId")).toBe("child /?&"); expect(params.get("plannedFor")).toBe("2099-01-01"); expect(params.get("timezone")).toBe("Pacific/Kiritimati");
});
it.each([[null, "UTC"], ["2099-10-14", null], ["2099-02-29", "UTC"], ["2099-10-14", "Not/AZone"], ["2099-10-14", "+03:00"]])("ignores an invalid or incomplete hint pair %s %s", (date, zone) => {
  expect(planDayHint(date, zone)).toBeUndefined();
});
it("keeps a real past date as intent rather than silently changing it to today", () => {
  expect(planDayHint("2001-10-11", "UTC")).toEqual({ plannedFor: "2001-10-11", timezone: "UTC" });
});
