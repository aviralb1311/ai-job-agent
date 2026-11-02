import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { extractDocxText, extractResumeDraft, parseResumeBuffer, ResumeParseError } from "./resume-parser.js";


function makeDocx(xml: string): Buffer {
  const name = Buffer.from("word/document.xml");
  const data = Buffer.from(xml);
  const compressed = deflateRawSync(data);
  const local = Buffer.alloc(30 + name.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  name.copy(local, 30);
  const central = Buffer.alloc(46 + name.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(0, 42);
  name.copy(central, 46);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(local.length + compressed.length, 16);
  return Buffer.concat([local, compressed, central, end]);
}

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

  it("extracts text from a DOCX document body", () => {
    const docx = makeDocx('<w:document><w:body><w:p><w:r><w:t>Backend Engineer &amp; Developer</w:t></w:r></w:p><w:p><w:r><w:t>Node.js</w:t></w:r></w:p></w:body></w:document>');
    expect(extractDocxText(docx)).toContain("Backend Engineer & Developer");
    expect(extractDocxText(docx)).toContain("Node.js");
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
