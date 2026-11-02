import { inflateRawSync } from "node:zlib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { analyzeJob } from "./intelligence.js";

export type ResumeDraft = {
  skills: string[];
  education: string[];
  experience: string[];
  projects: string[];
  certifications: string[];
};

export class ResumeParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResumeParseError";
  }
}

const MAX_ARCHIVE_ENTRY_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_CHARS = 100_000;

function decodeXml(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (match, entity: string) => {
    const key = entity.toLowerCase();
    if (key === "amp") return "&";
    if (key === "lt") return "<";
    if (key === "gt") return ">";
    if (key === "quot") return '"';
    if (key === "apos") return "'";
    const code = key.startsWith("#x") ? Number.parseInt(key.slice(2), 16) : Number.parseInt(key.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
}

function readZipEntry(archive: Buffer, entryName: string): Buffer {
  const minEocd = Math.max(0, archive.length - 65_557);
  let eocd = -1;
  for (let offset = archive.length - 22; offset >= minEocd; offset--) {
    if (archive.readUInt32LE(offset) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new ResumeParseError("The DOCX file is not a valid ZIP archive.");
  const entryCount = archive.readUInt16LE(eocd + 10);
  const directoryOffset = archive.readUInt32LE(eocd + 16);
  let cursor = directoryOffset;

  for (let index = 0; index < entryCount; index++) {
    if (cursor + 46 > archive.length || archive.readUInt32LE(cursor) !== 0x02014b50) break;
    const method = archive.readUInt16LE(cursor + 10);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const uncompressedSize = archive.readUInt32LE(cursor + 24);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const localOffset = archive.readUInt32LE(cursor + 42);
    const name = archive.toString("utf8", cursor + 46, cursor + 46 + nameLength);
    cursor += 46 + nameLength + extraLength + commentLength;

    if (name !== entryName) continue;
    if (uncompressedSize > MAX_ARCHIVE_ENTRY_BYTES || localOffset + 30 > archive.length) {
      throw new ResumeParseError("The DOCX document contains an oversized content entry.");
    }
    if (archive.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new ResumeParseError("The DOCX document has an invalid content entry.");
    }
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = archive.subarray(dataOffset, dataOffset + compressedSize);
    try {
      const data = method === 0
        ? Buffer.from(compressed)
        : method === 8
          ? inflateRawSync(compressed, { maxOutputLength: MAX_ARCHIVE_ENTRY_BYTES })
          : null;
      if (!data) throw new ResumeParseError("This DOCX compression method is not supported.");
      return data;
    } catch (error) {
      if (error instanceof ResumeParseError) throw error;
      throw new ResumeParseError("The DOCX document could not be decompressed safely.");
    }
  }
  throw new ResumeParseError("The DOCX file does not contain a readable document body.");
}

export function extractDocxText(buffer: Buffer): string {
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    throw new ResumeParseError("The uploaded file is not a valid DOCX document.");
  }
  const xml = readZipEntry(buffer, "word/document.xml").toString("utf8");
  const text = decodeXml(xml
    .replace(/<w:tab\b[^>]*\/>/g, "\t")
    .replace(/<w:br\b[^>]*\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, ""));
  return text.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_TEXT_CHARS);
}

export async function extractPdfText(buffer: Buffer): Promise<string> {
  if (buffer.length < 5 || buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new ResumeParseError("The uploaded file is not a valid PDF document.");
  }
  const task = getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    isEvalSupported: false,
    disableFontFace: true
  });
  try {
    const document = await task.promise;
    if (document.numPages > 25) {
      throw new ResumeParseError("Please upload a resume with 25 pages or fewer.");
    }
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.map(item => "str" in item ? item.str : "").filter(Boolean).join(" "));
    }
    return pages.join("\n").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT_CHARS);
  } catch (error) {
    if (error instanceof ResumeParseError) throw error;
    throw new ResumeParseError("The PDF could not be read. Try exporting it again as a text-based PDF.");
  } finally {
    await task.destroy();
  }
}

const sectionPatterns: Array<[keyof Omit<ResumeDraft, "skills">, RegExp]> = [
  ["education", /^(education|academic background|qualifications)$/i],
  ["experience", /^(experience|work experience|professional experience|employment history|internships?)$/i],
  ["projects", /^(projects|personal projects|academic projects)$/i],
  ["certifications", /^(certifications?|licenses?)$/i]
];

export function extractResumeDraft(text: string): ResumeDraft {
  const lines = text.replace(/\r/g, "").split("\n").map(line => line.trim()).filter(Boolean);
  const sections: ResumeDraft = { skills: [], education: [], experience: [], projects: [], certifications: [] };
  let active: keyof Omit<ResumeDraft, "skills"> | null = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/^[•*▪\-–—\s]+/, "").trim();
    const heading = sectionPatterns.find(([, pattern]) => pattern.test(line));
    const skillsHeading = /^(technical\s+skills|skills|technologies|core competencies)$/i.test(line);
    if (heading) {
      active = heading[0];
      continue;
    }
    if (skillsHeading) {
      active = null;
      continue;
    }
    if (/^(summary|profile|objective|contact|personal details|achievements|awards)$/i.test(line)) {
      active = null;
      continue;
    }
    if (active && line.length > 1) {
      sections[active].push(line.slice(0, 500));
    }
  }

  const skills = analyzeJob("Resume", text).skills;
  sections.skills = [...skills];
  for (const key of ["education", "experience", "projects", "certifications"] as const) {
    sections[key] = [...new Set(sections[key])].slice(0, 40);
  }
  return sections;
}

export async function parseResumeBuffer(buffer: Buffer, fileType: "pdf" | "docx"): Promise<{ text: string; draft: ResumeDraft }> {
  if (!buffer.length || buffer.length > 5 * 1024 * 1024) {
    throw new ResumeParseError("Resume files must be between 1 byte and 5 MB.");
  }
  const text = fileType === "pdf" ? await extractPdfText(buffer) : extractDocxText(buffer);
  if (text.trim().length < 30) {
    throw new ResumeParseError("No readable text was found. Scanned-image resumes are not supported yet; try a text-based PDF or DOCX.");
  }
  return { text, draft: extractResumeDraft(text) };
}
