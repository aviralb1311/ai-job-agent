import { describe, expect, it } from "vitest";
import { inferWorkMode, matchesRequiredSkills, matchesSearchQuery, matchesWorkMode, overallRelevanceScore, textRelevance, tokenizeSearchQuery } from "./search.js";

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

  it("matches meaningful query words individually and handles case, punctuation and prefixes", () => {
    expect(tokenizeSearchQuery("BACKEND, Engineer! for jobs")).toEqual(["backend", "engineer"]);
    expect(matchesSearchQuery("Backend Engineer", "Acme", "", "BACKEND, ENGINEER!" )).toBe(true);
    expect(matchesSearchQuery("Backend", "Engineer Labs", "", "backend engineer")).toBe(true);
    expect(matchesSearchQuery("Senior Engineer", "Acme", "", "engin")).toBe(true);
    expect(matchesSearchQuery("Backend Engineer", "Acme", "", "!!!")).toBe(true);
    expect(matchesSearchQuery("Backend", "Acme", "", "backend engineer")).toBe(false);
  });

  it("matches case-insensitively when stored values use mixed case", () => {
    // Stored title has capitalised words, query is lowercase
    expect(matchesSearchQuery("Pagination Role 0", "Pagination Co", "Backend work with Node.js", "pagination")).toBe(true);
    // Stored title is lowercase, query is uppercase
    expect(matchesSearchQuery("backend engineer", "acme", "", "BACKEND")).toBe(true);
    // Mixed case in both directions
    expect(matchesSearchQuery("Backend Engineer", "Acme", "", "BACKEND, ENGINEER!")).toBe(true);
    // Company field mixed case
    expect(matchesSearchQuery("Designer", "Backend Engineer Labs", "", "backend engineer")).toBe(true);
    // Description field mixed case
    expect(matchesSearchQuery("Product Manager", "Acme", "Experience with backend engineering systems", "BACKEND")).toBe(true);
  });

  it("ranks case-insensitively with identical scores regardless of query casing", () => {
    const upper = textRelevance("Backend Engineer", "Acme", "", "BACKEND ENGINEER");
    const lower = textRelevance("Backend Engineer", "Acme", "", "backend engineer");
    expect(upper.score).toBe(lower.score);
    expect(upper.reasons).toEqual(lower.reasons);
  });

  it("ranks exact title phrases above company matches, and company above description matches", () => {
    const exactTitle = textRelevance("Backend Engineer", "Acme", "", "backend engineer");
    const reorderedTitle = textRelevance("Engineer for Backend Systems", "Acme", "", "backend engineer");
    const company = textRelevance("Designer", "Backend Engineer Labs", "", "backend engineer");
    const description = textRelevance("Product Manager", "Acme", "Backend engineering experience", "backend engineer");

    expect(exactTitle.score).toBe(100);
    expect(reorderedTitle.score).toBeGreaterThan(company.score);
    expect(company.score).toBeGreaterThan(description.score);
    expect(exactTitle.reasons).toContain("All search words appear together in the title.");
    expect(company.reasons).toContain("Company contains: backend, engineer");
    expect(description.reasons).toContain("Description contains: backend, engineer");
  });

  it("combines profile and text relevance for overall sorting while preserving empty-query behavior", () => {
    expect(overallRelevanceScore(100, 50, true)).toBe(85);
    expect(overallRelevanceScore(100, null, true)).toBe(100);
    expect(overallRelevanceScore(0, 77, false)).toBe(77);
    expect(textRelevance("Backend Engineer", "Acme", "", "   ")).toEqual({ score: 0, reasons: [] });
  });
});
