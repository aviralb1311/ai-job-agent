import { describe, expect, it } from "vitest";
import { analyzeJob, scoreJobMatch } from "./intelligence.js";
describe("job intelligence", () => {
  it("extracts known skills and avoids substring false positives", () => {
    const result = analyzeJob("Backend Engineer", "Build Node.js services with PostgreSQL, Docker and REST APIs. Python is useful.");
    expect(result.category).toBe("BACKEND");
    expect(result.skills).toEqual(expect.arrayContaining(["node.js", "postgresql", "docker", "rest api", "python"]));
    expect(result.skills).not.toContain("go");
  });
  it("classifies common roles", () => {
    expect(analyzeJob("Senior Full Stack Engineer", "").category).toBe("FULL_STACK");
    expect(analyzeJob("Machine Learning Engineer", "").category).toBe("MACHINE_LEARNING");
    expect(analyzeJob("Product Manager", "").category).toBe("PRODUCT");
    expect(analyzeJob("Operations Associate", "").category).toBe("OTHER");
  });
  it("returns an explainable match score", () => {
    const result = scoreJobMatch({ title: "Backend Engineer", location: "Remote", category: "BACKEND", skills: ["node.js", "postgresql"] }, { skills: ["Node.js", "PostgreSQL", "Docker"], preferredRoles: ["BACKEND"], locations: [], remotePreference: "REMOTE" });
    expect(result.score).toBe(77);
    expect(result.matchedSkills).toEqual(["Node.js", "PostgreSQL"]);
    expect(result.missingSkills).toEqual(["Docker"]);
    expect(result.reasons).toHaveLength(3);
    expect(result.breakdown).toMatchObject({ skills: { score: 67, matched: 2, total: 3 }, role: { matched: true }, location: { matched: true } });
  });
  it("normalizes human-readable role preferences and rejects unknown on-site location", () => {
    const result = scoreJobMatch({ title: "Backend Engineer", location: null, category: "BACKEND", skills: [] }, { skills: [], preferredRoles: ["Backend Developer"], locations: [], remotePreference: "ONSITE" });
    expect(result.breakdown.role.matched).toBe(true);
    expect(result.breakdown.location.matched).toBe(false);
  });
  it("does not invent a score for an empty profile", () => {
    expect(scoreJobMatch({ title: "Engineer", location: null, category: "OTHER", skills: [] }, { skills: [], preferredRoles: [], locations: [], remotePreference: "ANY" }).score).toBeNull();
  });
});
