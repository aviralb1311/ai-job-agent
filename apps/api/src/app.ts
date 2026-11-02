import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { previewSource, syncJobs } from "./jobs/service.js";
import { sourceCatalog } from "./jobs/source-catalog.js";
import { scoreJobMatch, type CandidatePreferences } from "./jobs/intelligence.js";
import { parseResumeBuffer, ResumeParseError, type ResumeDraft } from "./jobs/resume-parser.js";

export const app = express();
app.use(cors({ origin: config.CORS_ORIGIN }));
app.use(express.json({ limit: "1mb" }));

const SUPPORTED_PROVIDERS = ["GREENHOUSE", "LEVER", "ASHBY"] as const;

app.get("/api/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok", database: "connected" });
  } catch {
    res.status(503).json({ status: "degraded", database: "unavailable" });
  }
});

const DEFAULT_PROFILE: CandidatePreferences = { skills: [], preferredRoles: [], locations: [], remotePreference: "ANY" };
const REMOTE_PREFERENCES = ["ANY", "REMOTE", "ONSITE", "HYBRID"] as const;

function parseProfile(row: { skillsJson: string; preferredRoles: string; locations: string; remotePreference: string } | null): CandidatePreferences {
  if (!row) return DEFAULT_PROFILE;
  const read = (value: string): string[] => {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
    } catch { return []; }
  };
  return {
    skills: read(row.skillsJson),
    preferredRoles: read(row.preferredRoles),
    locations: read(row.locations),
    remotePreference: REMOTE_PREFERENCES.includes(row.remotePreference as typeof REMOTE_PREFERENCES[number])
      ? row.remotePreference as CandidatePreferences["remotePreference"] : "ANY"
  };
}

app.get("/api/profile", async (_req, res) => {
  try {
    const profile = await prisma.candidateProfile.findUnique({ where: { id: "default" } });
    res.json({ data: parseProfile(profile) });
  } catch (error) {
    res.status(500).json({ error: "Unable to retrieve candidate profile", detail: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.put("/api/profile", async (req, res) => {
  const body = req.body ?? {};
  const validList = (value: unknown): value is string[] =>
    Array.isArray(value) && value.length <= 50 && value.every(item => typeof item === "string" && item.trim().length > 0 && item.length <= 80);
  if (!validList(body.skills) || !validList(body.preferredRoles) || !validList(body.locations) ||
      !REMOTE_PREFERENCES.includes(body.remotePreference)) {
    res.status(400).json({ error: "skills, preferredRoles and locations must be arrays of up to 50 non-empty strings; remotePreference must be ANY, REMOTE, ONSITE or HYBRID" });
    return;
  }
  const clean = (items: string[]) => [...new Set(items.map(item => item.trim()))];
  try {
    const data = {
      skillsJson: JSON.stringify(clean(body.skills)),
      preferredRoles: JSON.stringify(clean(body.preferredRoles)),
      locations: JSON.stringify(clean(body.locations)),
      remotePreference: body.remotePreference as CandidatePreferences["remotePreference"]
    };
    const saved = await prisma.candidateProfile.upsert({
      where: { id: "default" }, create: { id: "default", ...data }, update: data
    });
    res.json({ data: parseProfile(saved) });
  } catch (error) {
    res.status(500).json({ error: "Unable to save candidate profile", detail: error instanceof Error ? error.message : "Unknown error" });
  }
});


const RESUME_SECTIONS = ["skills", "education", "experience", "projects", "certifications"] as const;
function readJsonList(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch { return []; }
}

app.post("/api/resume/parse", express.raw({
  type: ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  limit: "5mb"
}), async (req, res) => {
  const contentType = req.header("content-type")?.split(";")[0].trim().toLowerCase();
  const fileType = contentType === "application/pdf" ? "pdf"
    : contentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ? "docx" : null;
  if (!fileType) {
    res.status(415).json({ error: "Upload a PDF or DOCX resume." });
    return;
  }
  if (!Buffer.isBuffer(req.body) || !req.body.length) {
    res.status(400).json({ error: "The uploaded resume is empty or was not sent as a binary file." });
    return;
  }
  try {
    const parsed = await parseResumeBuffer(req.body, fileType);
    res.json({ data: parsed.draft, extractedCharacters: parsed.text.length, reviewRequired: true });
  } catch (error) {
    const status = error instanceof ResumeParseError ? 422 : 500;
    res.status(status).json({ error: error instanceof Error ? error.message : "Resume parsing failed." });
  }
});

app.put("/api/profile/resume", async (req, res) => {
  const body = req.body ?? {};
  const validList = (value: unknown): value is string[] =>
    Array.isArray(value) && value.length <= 50 && value.every(item =>
      typeof item === "string" && item.trim().length > 0 && item.length <= 500
    );
  if (!RESUME_SECTIONS.every(section => validList(body[section]))) {
    res.status(400).json({ error: "Each resume section must be an array of up to 50 non-empty strings (500 characters max each)." });
    return;
  }
  const clean = (items: string[]) => [...new Set(items.map(item => item.trim()))];
  try {
    const current = await prisma.candidateProfile.findUnique({ where: { id: "default" } });
    const data = {
      skillsJson: JSON.stringify(clean(body.skills)),
      educationJson: JSON.stringify(clean(body.education)),
      experienceJson: JSON.stringify(clean(body.experience)),
      projectsJson: JSON.stringify(clean(body.projects)),
      certificationsJson: JSON.stringify(clean(body.certifications))
    };
    const saved = await prisma.candidateProfile.upsert({
      where: { id: "default" },
      create: { id: "default", ...data },
      update: data
    });
    res.json({ data: {
      skills: readJsonList(saved.skillsJson),
      education: readJsonList(saved.educationJson),
      experience: readJsonList(saved.experienceJson),
      projects: readJsonList(saved.projectsJson),
      certifications: readJsonList(saved.certificationsJson)
    } });
  } catch (error) {
    res.status(500).json({ error: "Unable to save reviewed resume profile", detail: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.get("/api/profile/resume", async (_req, res) => {
  try {
    const profile = await prisma.candidateProfile.findUnique({ where: { id: "default" } });
    res.json({ data: {
      skills: readJsonList(profile?.skillsJson ?? "[]"),
      education: readJsonList(profile?.educationJson ?? "[]"),
      experience: readJsonList(profile?.experienceJson ?? "[]"),
      projects: readJsonList(profile?.projectsJson ?? "[]"),
      certifications: readJsonList(profile?.certificationsJson ?? "[]")
    } });
  } catch (error) {
    res.status(500).json({ error: "Unable to retrieve reviewed resume profile", detail: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.get("/api/jobs", async (req, res) => {
  try {
    const q = String(req.query.q ?? "").trim();
    const location = String(req.query.location ?? "").trim();
    const source = String(req.query.source ?? "").trim().toUpperCase();
    const parsedLimit = Number(req.query.limit ?? 50);
    const take = Number.isFinite(parsedLimit) ? Math.min(Math.max(Math.floor(parsedLimit), 1), 100) : 50;

    const where = {
      AND: [
        q ? { OR: [{ title: { contains: q } }, { company: { contains: q } }, { description: { contains: q } }] } : {},
        location ? { location: { contains: location } } : {},
        source ? { source } : {}
      ]
    };

    const [jobs, total] = await Promise.all([
      prisma.job.findMany({
        where,
        orderBy: [{ publishedAt: "desc" }, { discoveredAt: "desc" }],
        take
      }),
      prisma.job.count({ where })
    ]);

    const profileRow = await prisma.candidateProfile.findUnique({ where: { id: "default" } });
    const profile = parseProfile(profileRow);
    const enriched = jobs.map(job => {
      let skills: string[] = [];
      try {
        const parsed: unknown = JSON.parse(job.skillsJson);
        if (Array.isArray(parsed)) skills = parsed.filter((item): item is string => typeof item === "string");
      } catch { /* malformed stored metadata is treated as empty */ }
      return {
        ...job,
        skills,
        match: scoreJobMatch({ title: job.title, location: job.location, category: job.category, skills }, profile)
      };
    });
    res.json({ data: enriched, count: enriched.length, total, profileConfigured: Boolean(profile.skills.length || profile.preferredRoles.length || profile.locations.length || profile.remotePreference !== "ANY") });
  } catch (error) {
    res.status(500).json({
      error: "Unable to retrieve jobs",
      detail: error instanceof Error ? error.message : "Unknown database error"
    });
  }
});

app.get("/api/sources/catalog", (_req, res) => {
  res.json({ data: sourceCatalog });
});

app.get("/api/sources", async (_req, res) => {
  try {
    const sources = await prisma.jobSource.findMany({ orderBy: { createdAt: "desc" } });
    res.json({ data: sources });
  } catch (error) {
    res.status(500).json({
      error: "Unable to retrieve job sources",
      detail: error instanceof Error ? error.message : "Unknown database error"
    });
  }
});

app.post("/api/sources", async (req, res) => {
  const provider = typeof req.body?.provider === "string" ? req.body.provider.trim().toUpperCase() : "";
  const boardId = typeof req.body?.boardId === "string" ? req.body.boardId.trim() : "";
  const displayName = typeof req.body?.displayName === "string" ? req.body.displayName.trim() : "";

  if (!SUPPORTED_PROVIDERS.includes(provider as typeof SUPPORTED_PROVIDERS[number])) {
    res.status(400).json({ error: "provider must be GREENHOUSE, LEVER or ASHBY" });
    return;
  }
  if (!boardId || boardId.length > 120 || !/^[a-zA-Z0-9._-]+$/.test(boardId)) {
    res.status(400).json({ error: "boardId must be 1–120 letters, numbers, dots, underscores or hyphens" });
    return;
  }
  if (displayName.length > 120) {
    res.status(400).json({ error: "displayName must be 120 characters or fewer" });
    return;
  }

  try {
    const source = await prisma.jobSource.create({
      data: { provider, boardId, displayName: displayName || null, enabled: true }
    });
    res.status(201).json({ data: source });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      res.status(409).json({ error: "This provider and board ID are already configured" });
      return;
    }
    res.status(500).json({
      error: "Unable to save job source",
      detail: error instanceof Error ? error.message : "Unknown database error"
    });
  }
});

app.post("/api/sources/:id/test", async (req, res) => {
  try {
    const source = await prisma.jobSource.findUnique({ where: { id: req.params.id } });
    if (!source) {
      res.status(404).json({ error: "Job source not found" });
      return;
    }
    const preview = await previewSource(source.provider, source.boardId);
    res.json({ success: true, ...preview });
  } catch (error) {
    res.status(502).json({
      success: false,
      error: "Could not validate this public job board",
      detail: error instanceof Error ? error.message : "Unknown provider error"
    });
  }
});

app.patch("/api/sources/:id", async (req, res) => {
  if (typeof req.body?.enabled !== "boolean") {
    res.status(400).json({ error: "enabled must be a boolean" });
    return;
  }
  try {
    const source = await prisma.jobSource.update({
      where: { id: req.params.id },
      data: { enabled: req.body.enabled }
    });
    res.json({ data: source });
  } catch (error) {
    res.status(404).json({
      error: "Unable to update job source",
      detail: error instanceof Error ? error.message : "Source not found"
    });
  }
});

app.delete("/api/sources/:id", async (req, res) => {
  try {
    await prisma.jobSource.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (error) {
    res.status(404).json({
      error: "Unable to delete job source",
      detail: error instanceof Error ? error.message : "Source not found"
    });
  }
});

app.post("/api/jobs/sync", async (_req, res) => {
  try {
    const result = await syncJobs();
    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: "Job synchronization failed",
      detail: error instanceof Error ? error.message : "Unknown synchronization error"
    });
  }
});
