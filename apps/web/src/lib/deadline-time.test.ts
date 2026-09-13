import { describe, expect, it } from "vitest";
import { deadlineInstants } from "./deadline-time";
describe("manual deadlines use the selected household timezone", () => {
  it("converts the same wall clock independently of the browser timezone", () => {
    expect(deadlineInstants("2026-09-20", "17:00", "America/Denver")).toEqual([{ iso: "2026-09-20T23:00:00Z", offset: "-06:00" }]);
    expect(deadlineInstants("2026-01-20", "17:00", "America/Denver")).toEqual([{ iso: "2026-01-21T00:00:00Z", offset: "-07:00" }]);
  });
  it("refuses nonexistent clocks and invalid dates rather than moving them", () => {
    for (const [date, time, zone] of [["2026-03-08", "02:30", "America/Denver"], ["2026-02-30", "09:00", "UTC"], ["2026-01-01", "24:01", "UTC"], ["2026-01-01", "09:00", "Unknown/Zone"]]) {
      expect(deadlineInstants(date!, time!, zone!)).toEqual([]);
    }
  });
  it("presents both possible instants when a clock repeats", () => {
    expect(deadlineInstants("2026-11-01", "01:30", "America/Denver")).toEqual([
      { iso: "2026-11-01T07:30:00Z", offset: "-06:00" }, { iso: "2026-11-01T08:30:00Z", offset: "-07:00" },
    ]);
  });
});
