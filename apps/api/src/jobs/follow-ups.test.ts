import { describe, expect, it } from "vitest";
import { classifyFollowUpDate, isDateKey, matchesFollowUpBucket } from "./follow-ups.js";

describe("follow-up date helpers", () => {
  it("validates real YYYY-MM-DD date keys", () => {
    expect(isDateKey("2026-11-03")).toBe(true);
    expect(isDateKey("2026-02-30")).toBe(false);
    expect(isDateKey("03-11-2026")).toBe(false);
    expect(isDateKey("")).toBe(false);
  });

  it("classifies past, current and future dates", () => {
    expect(classifyFollowUpDate("2026-11-02", "2026-11-03")).toBe("OVERDUE");
    expect(classifyFollowUpDate("2026-11-03", "2026-11-03")).toBe("TODAY");
    expect(classifyFollowUpDate("2026-11-04", "2026-11-03")).toBe("UPCOMING");
  });

  it("classifies stored UTC Date values by calendar date", () => {
    expect(classifyFollowUpDate(new Date("2026-11-03T00:00:00.000Z"), "2026-11-03")).toBe("TODAY");
  });

  it("matches the requested bucket and ALL", () => {
    expect(matchesFollowUpBucket("2026-11-02", "OVERDUE", "2026-11-03")).toBe(true);
    expect(matchesFollowUpBucket("2026-11-02", "TODAY", "2026-11-03")).toBe(false);
    expect(matchesFollowUpBucket("2026-11-02", "ALL", "2026-11-03")).toBe(true);
  });
});
