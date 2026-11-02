import { describe, expect, it } from "vitest";
import { extractDocxText, extractResumeDraft, parseResumeBuffer, ResumeParseError } from "./resume-parser.js";

describe("resume parser", () => {
  it("extracts reviewable sections and known skills without inventing fields", () => {
    const draft = extractResumeDraft([
      "Technical Skills",
      "Node.js, PostgreSQL, Docker",
      "Education",
      "B.Tech Computer Science, 2028",
      "Experience",
      "Backend Intern at Example Co",
      "Projects",
      "Expense Tracker API",
      "Certifications",
      "AWS Cloud Practitioner"
    ].join("\n"));
    expect(draft.skills).toEqual(expect.arrayContaining(["node.js", "postgresql", "docker"]));
    expect(draft.education).toEqual(["B.Tech Computer Science, 2028"]);
    expect(draft.experience).toEqual(["Backend Intern at Example Co"]);
    expect(draft.projects).toEqual(["Expense Tracker API"]);
    expect(draft.certifications).toEqual(["AWS Cloud Practitioner"]);
  });

  it("rejects invalid DOCX archives", () => {
    expect(() => extractDocxText(Buffer.from("not a zip"))).toThrow(ResumeParseError);
  });

  it("rejects empty and oversized uploads", async () => {
    await expect(parseResumeBuffer(Buffer.alloc(0), "pdf")).rejects.toThrow("between 1 byte and 5 MB");
    await expect(parseResumeBuffer(Buffer.alloc(5 * 1024 * 1024 + 1), "docx")).rejects.toThrow("between 1 byte and 5 MB");
  });

  it("does not accept a file with a non-PDF signature", async () => {
    await expect(parseResumeBuffer(Buffer.from("plain text that is long enough to be a resume"), "pdf"))
      .rejects.toThrow("not a valid PDF");
  });
});
