import { describe, expect, it } from "vitest";
import { inferWorkMode, matchesRequiredSkills, matchesWorkMode, textRelevance } from "./search.js";

describe("advanced job search helpers", () => {
  it("classifies explicit work modes without assuming unspecified roles are onsite", () => {
    expect(inferWorkMode("Remote - India", "Build APIs")).toBe("REMOTE");
    expect(inferWorkMode("Bengaluru", "This role follows a hybrid schedule")).toBe("HYBRID");
    expect(inferWorkMode("Pune", "Work from our in-office location")).toBe("ONSITE");
    expect(inferWorkMode("India", "Build software with the team")).toBe("UNKNOWN");
    expect(matchesWorkMode("India", "Build software", "ONSITE")).toBe(false);
    expect(matchesWorkMode("India", "Build software", "ANY")).toBe(true);
  });

  it("requires every selected skill and compares skill names case-insensitively", () => {
    expect(matchesRequiredSkills(["Node.js", "PostgreSQL"], ["node", "POSTGRES"])).toBe(true);
    expect(matchesRequiredSkills(["Node.js"], ["node", "python"])).toBe(false);
    expect(matchesRequiredSkills([], [])).toBe(true);
  });

  it("ranks title matches ahead of company and description matches", () => {
    expect(textRelevance("Backend Engineer", "Acme", "", "backend")).toBe(4);
    expect(textRelevance("Senior Backend Engineer", "Acme", "", "backend")).toBe(3);
    expect(textRelevance("Designer", "Backend Labs", "", "backend")).toBe(2);
    expect(textRelevance("Designer", "Labs Backend", "", "backend")).toBe(1);
    expect(textRelevance("Designer", "Labs", "Backend systems", "backend")).toBe(0.5);
  });
});
