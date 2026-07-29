import { describe, expect, it } from "vitest";
import {
  daysUntil,
  formatBytes,
  formatDate,
  formatDueLabel,
  formatMasked,
  formatMoney,
  initialsOf,
} from "./format";

/**
 * Formatting is where an administrative product quietly breaks trust. A deadline
 * rendered a day off is indistinguishable from a bug in the ledger itself, so these
 * tests pin the two rules that matter: dates resolve in the *household's* timezone,
 * and relative time stays calm.
 */

describe("timezone correctness", () => {
  it("resolves a late-evening UTC instant to the household's local day", () => {
    // 2026-03-10T02:30Z is still March 9th in New York. A naive implementation
    // renders "Mar 10" and the user is warned a day late.
    const instant = "2026-03-10T02:30:00.000Z";
    expect(formatDate(instant, { timeZone: "America/New_York", style: "medium" })).toContain("9");
    expect(formatDate(instant, { timeZone: "UTC", style: "medium" })).toContain("10");
  });

  it("counts whole days in the household timezone, not from the raw instant", () => {
    const now = new Date("2026-03-09T23:00:00.000Z"); // 6pm Mar 9 in NY
    const due = "2026-03-10T12:00:00.000Z"; // 8am Mar 10 in NY
    expect(daysUntil(due, "America/New_York", now)).toBe(1);
  });

  it("survives a spring-forward boundary without drifting", () => {
    // US DST began 2026-03-08. Crossing it must not produce 0 or 2.
    const now = new Date("2026-03-07T17:00:00.000Z");
    const due = "2026-03-09T17:00:00.000Z";
    expect(daysUntil(due, "America/New_York", now)).toBe(2);
  });

  it("returns an em dash for an unparseable date rather than 'Invalid Date'", () => {
    expect(formatDate("not-a-date", { timeZone: "UTC" })).toBe("—");
  });
});

describe("calm relative time", () => {
  const now = new Date("2026-03-01T12:00:00.000Z");
  const inDays = (n: number) =>
    new Date(now.getTime() + n * 86_400_000).toISOString();

  it.each([
    [0, "Due today"],
    [1, "Due tomorrow"],
    [-1, "Was due yesterday"],
    [12, "Due in 12 days"],
    [-5, "5 days overdue"],
  ])("renders %i days as %s", (offset, expected) => {
    expect(formatDueLabel(inDays(offset), "UTC", now)).toBe(expected);
  });

  it("rounds long horizons rather than showing an alarming day count", () => {
    expect(formatDueLabel(inDays(30), "UTC", now)).toBe("Due in about a month");
    expect(formatDueLabel(inDays(180), "UTC", now)).toBe("Due in about 6 months");
  });

  it("never shouts", () => {
    for (const offset of [-30, -1, 0, 1, 7, 200]) {
      const label = formatDueLabel(inDays(offset), "UTC", now);
      expect(label).not.toMatch(/!/);
      expect(label).not.toBe(label.toUpperCase());
    }
  });
});

describe("money", () => {
  it("omits cents when the amount is whole", () => {
    expect(formatMoney({ amountCents: 180000, currency: "USD" })).toBe("$1,800");
  });

  it("shows cents when they are significant", () => {
    expect(formatMoney({ amountCents: 4299, currency: "USD" })).toBe("$42.99");
  });

  it("renders an em dash rather than $0 for missing money", () => {
    // "$0.00" would read as a real amount owed; absence must look like absence.
    expect(formatMoney(null)).toBe("—");
    expect(formatMoney(undefined)).toBe("—");
  });
});

describe("identifier masking", () => {
  it("shows only the last four digits", () => {
    expect(formatMasked("4821")).toBe("•••• 4821");
  });

  it("masks completely when no hint is available", () => {
    expect(formatMasked(null)).toBe("••••");
    expect(formatMasked("")).toBe("••••");
  });
});

describe("misc", () => {
  it("formats byte sizes at human scale", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });

  it("derives at most two initials", () => {
    expect(initialsOf("Dana Reyes")).toBe("DR");
    expect(initialsOf("Maria de los Angeles Ruiz")).toBe("MD");
    expect(initialsOf("Cher")).toBe("C");
  });
});
