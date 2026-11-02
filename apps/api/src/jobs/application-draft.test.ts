import { describe, expect, it } from "vitest";
import { generateApplicationDraft } from "./application-draft.js";

describe("application draft generation", () => {
  it("uses only matching reviewed profile and resume evidence", () => {
    const result = generateApplicationDraft({
      job: {
        title: "Backend Engineer",
        company: "Example Co",
        location: "Remote",
        category: "BACKEND",
        skills: ["node.js", "postgresql", "python"],
        description: "Required: Node.js and PostgreSQL. Python is preferred."
      },
      profile: {
        skills: ["Node.js", "PostgreSQL"],
        preferredRoles: ["BACKEND"],
        locations: [],
        remotePreference: "REMOTE"
      },
      resume: {
        skills: ["Node.js", "PostgreSQL"],
        education: ["B.Tech Computer Science"],
        experience: ["Built REST APIs with Node.js during an internship."],
        projects: ["Created an expense tracker using PostgreSQL."],
        certifications: []
      }
    });

    expect(result.resumeSummary).toContain("Node.js");
    expect(result.resumeSummary).toContain("Built REST APIs with Node.js");
    expect(result.resumeSummary).toContain("Created an expense tracker using PostgreSQL");
    expect(result.highlights.length).toBeGreaterThan(0);
    expect(result.coverLetter).toContain("Backend Engineer");
    expect(result.coverLetter).toContain("Example Co");
    expect(result.coverLetter).toContain("Node.js");
    expect(result.coverLetter).not.toContain("Python");
    expect(result.coverLetter).toContain("[Your Name]");
    expect(result.reviewNotes.join(" ")).toMatch(/does not submit/i);
  });

  it("does not invent experience when the profile has no matching evidence", () => {
    const result = generateApplicationDraft({
      job: {
        title: "Machine Learning Engineer",
        company: "Example AI",
        location: null,
        category: "MACHINE_LEARNING",
        skills: ["pytorch", "tensorflow"],
        description: "Experience with PyTorch and TensorFlow required."
      },
      profile: { skills: [], preferredRoles: [], locations: [], remotePreference: "ANY" },
      resume: { skills: [], education: [], experience: [], projects: [], certifications: [] }
    });

    expect(result.resumeSummary).toBe("");
    expect(result.highlights).toEqual([]);
    expect(result.coverLetter).not.toMatch(/PyTorch|TensorFlow|machine learning experience/i);
    expect(result.reviewNotes.join(" ")).toMatch(/no saved skills/i);
    expect(result.reviewNotes.join(" ")).toMatch(/No direct resume evidence/i);
  });
});
