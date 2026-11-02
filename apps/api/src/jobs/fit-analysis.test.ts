import { describe, expect, it } from "vitest";
import { analyzeJobFit } from "./fit-analysis.js";
import type { CandidatePreferences } from "./intelligence.js";

const profile: CandidatePreferences = {
  skills: ["Node.js", "PostgreSQL"],
  preferredRoles: ["Backend Developer"],
  locations: [],
  remotePreference: "REMOTE"
};

describe("resume-to-job fit analysis", () => {
  it("separates required, preferred and other skills and points to resume evidence", () => {
    const result = analyzeJobFit({
      title: "Backend Engineer",
      location: "Remote - India",
      category: "BACKEND",
      skills: ["node.js", "python", "docker"],
      description: "Required: Node.js. Python is preferred. Docker is mentioned."
    }, profile, {
      skills: ["Node.js"],
      education: ["B.Tech Computer Science"],
      experience: ["Built Node.js REST APIs during internship"],
      projects: ["Expense tracker API using Node.js and PostgreSQL"],
      certifications: []
    });

    expect(result.score).toBe(65);
    expect(result.breakdown).toMatchObject({
      skills: { score: 50, matched: 1, total: 2, weight: 70 },
      role: { matched: true, weight: 20 },
      location: { matched: true, weight: 10 }
    });
    expect(result.requiredSkills).toContain("node.js");
    expect(result.preferredSkills).toContain("python");
    expect(result.otherMentionedSkills).toContain("docker");
    expect(result.missingRequiredSkills).toEqual([]);
    expect(result.missingPreferredSkills).toContain("python");
    expect(result.evidence.find(item => item.skill === "Node.js")?.sections).toEqual(
      expect.arrayContaining(["Skills", "Experience", "Projects"])
    );
    expect(result.disclaimer).toMatch(/does not verify qualifications/);
  });

  it("does not invent a score when no candidate preferences are configured", () => {
    const result = analyzeJobFit({
      title: "Engineer",
      location: null,
      category: "OTHER",
      skills: ["python"],
      description: "Python experience preferred."
    }, { skills: [], preferredRoles: [], locations: [], remotePreference: "ANY" }, {
      skills: [], education: [], experience: [], projects: [], certifications: []
    });
    expect(result.score).toBeNull();
    expect(result.breakdown.skills.score).toBeNull();
    expect(result.breakdown.role.matched).toBeNull();
    expect(result.breakdown.location.matched).toBeNull();
    expect(result.evidence).toEqual([]);
  });

  it("treats unknown location as a non-match for on-site preference", () => {
    const result = analyzeJobFit({
      title: "Backend Engineer",
      location: null,
      category: "BACKEND",
      skills: [],
      description: "Backend role."
    }, { skills: [], preferredRoles: [], locations: [], remotePreference: "ONSITE" }, {
      skills: [], education: [], experience: [], projects: [], certifications: []
    });
    expect(result.breakdown.location.matched).toBe(false);
  });
});
