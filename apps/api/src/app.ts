import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { previewSource, syncJobs } from "./jobs/service.js";
import { sourceCatalog } from "./jobs/source-catalog.js";
import { scoreJobMatch, type CandidatePreferences } from "./jobs/intelligence.js";
import { parseResumeBuffer, ResumeParseError } from "./jobs/resume-parser.js";
import { analyzeJobFit } from "./jobs/fit-analysis.js";
import { generateApplicationDraft } from "./jobs/application-draft.js";
import { inferWorkMode, matchesRequiredSkills, matchesWorkMode, textRelevance } from "./jobs/search.js";

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



type SavedSearchFilters = {
  query: string;
  location: string;
  company: string;
  source: string;
  employmentType: string;
  workMode: string;
  sort: string;
  skills: string[];
};

function parseSavedSearchFilters(value: unknown): SavedSearchFilters | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const fields = ["query", "location", "company", "source", "employmentType", "workMode"] as const;
  if (fields.some(field => input[field] !== undefined && (typeof input[field] !== "string" || (input[field] as string).length > 120))) return null;
  const skills = input.skills ?? [];
  if (!Array.isArray(skills) || skills.length > 20 || skills.some(skill => typeof skill !== "string" || !skill.trim() || skill.length > 80)) return null;
  const workMode = typeof input.workMode === "string" ? input.workMode.toUpperCase() : "ANY";
  const sort = typeof input.sort === "string" ? input.sort.toUpperCase() : "NEWEST";
  const employmentType = typeof input.employmentType === "string" ? input.employmentType.toUpperCase() : "";
  if (!["ANY", "REMOTE", "HYBRID", "ONSITE", "UNKNOWN"].includes(workMode)) return null;
  if (employmentType && !["FULL_TIME", "PART_TIME", "INTERNSHIP", "CONTRACT", "UNKNOWN"].includes(employmentType)) return null;
  const source = typeof input.source === "string" ? input.source.toUpperCase() : "";
  if (source && !["GREENHOUSE", "LEVER", "ASHBY"].includes(source)) return null;
  if (!["NEWEST", "MATCH", "RELEVANCE"].includes(sort)) return null;
  return {
    query: typeof input.query === "string" ? input.query.trim() : "",
    location: typeof input.location === "string" ? input.location.trim() : "",
    company: typeof input.company === "string" ? input.company.trim() : "",
    source,
    employmentType,
    workMode,
    sort,
    skills: skills.map((skill: string) => skill.trim())
  };
}

function jobMatchesSavedSearch(job: {
  title: string; company: string; location: string | null; description: string; source: string;
  employmentType: string; skillsJson: string;
}, filters: SavedSearchFilters): boolean {
  const query = filters.query.toLowerCase();
  const jobSkills = readJsonList(job.skillsJson);
  return (!query || [job.title, job.company, job.description].some(value => value.toLowerCase().includes(query))) &&
    (!filters.location || (job.location ?? "").toLowerCase().includes(filters.location.toLowerCase())) &&
    (!filters.company || job.company.toLowerCase().includes(filters.company.toLowerCase())) &&
    (!filters.source || job.source === filters.source) &&
    (!filters.employmentType || job.employmentType === filters.employmentType) &&
    matchesWorkMode(job.location, job.description, filters.workMode) &&
    matchesRequiredSkills(jobSkills, filters.skills);
}

app.get("/api/saved-searches", async (_req, res) => {
  try {
    const searches = await prisma.savedSearch.findMany({
      where: { userId: LOCAL_SAVED_JOBS_USER_ID },
      orderBy: { createdAt: "desc" }
    });
    const data = searches.map(search => {
      let filters: SavedSearchFilters = { query: "", location: "", company: "", source: "", employmentType: "", workMode: "ANY", sort: "NEWEST", skills: [] };
      try { filters = parseSavedSearchFilters(JSON.parse(search.filtersJson)) ?? filters; } catch { /* use empty filter summary */ }
      return { id: search.id, name: search.name, filters, createdAt: search.createdAt, lastCheckedAt: search.lastCheckedAt };
    });
    res.json({ data, count: data.length });
  } catch (error) {
    res.status(500).json({ error: "Unable to retrieve saved searches", detail: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/saved-searches", async (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const filters = parseSavedSearchFilters(req.body?.filters);
  if (!name || name.length > 80 || !filters) {
    res.status(400).json({ error: "Provide a name up to 80 characters and valid search filters." });
    return;
  }
  try {
    const saved = await prisma.savedSearch.create({
      data: { userId: LOCAL_SAVED_JOBS_USER_ID, name, filtersJson: JSON.stringify(filters) }
    });
    res.status(201).json({ data: {
      id: saved.id, name: saved.name, filters, createdAt: saved.createdAt, lastCheckedAt: saved.lastCheckedAt
    } });
  } catch (error) {
    res.status(500).json({ error: "Unable to save search", detail: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.delete("/api/saved-searches/:id", async (req, res) => {
  try {
    const result = await prisma.savedSearch.deleteMany({
      where: { id: req.params.id, userId: LOCAL_SAVED_JOBS_USER_ID }
    });
    if (!result.count) {
      res.status(404).json({ error: "Saved search not found" });
      return;
    }
    res.json({ data: { id: req.params.id, deleted: true } });
  } catch (error) {
    res.status(500).json({ error: "Unable to delete saved search", detail: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.get("/api/saved-searches/:id/alerts", async (req, res) => {
  try {
    const search = await prisma.savedSearch.findFirst({
      where: { id: req.params.id, userId: LOCAL_SAVED_JOBS_USER_ID }
    });
    if (!search) {
      res.status(404).json({ error: "Saved search not found" });
      return;
    }
    const filters = parseSavedSearchFilters(JSON.parse(search.filtersJson));
    if (!filters) {
      res.status(422).json({ error: "Saved search filters are invalid. Delete and recreate this search." });
      return;
    }
    const matchingJobs = await prisma.job.findMany({
      where: { discoveredAt: { gt: search.lastCheckedAt } },
      orderBy: { discoveredAt: "desc" },
    });
    const data = matchingJobs.filter(job => jobMatchesSavedSearch(job, filters)).slice(0, 50).map(job => ({
      id: job.id, title: job.title, company: job.company, location: job.location,
      applicationUrl: job.applicationUrl, discoveredAt: job.discoveredAt
    }));
    const checkedAt = new Date();
    await prisma.savedSearch.update({ where: { id: search.id }, data: { lastCheckedAt: checkedAt } });
    res.json({ data, count: data.length, checkedAt, search: { id: search.id, name: search.name } });
  } catch (error) {
    res.status(500).json({ error: "Unable to check saved-search alerts", detail: error instanceof Error ? error.message : "Unknown error" });
  }
});


const LOCAL_SAVED_JOBS_USER_ID = "local";

app.get("/api/saved-jobs", async (_req, res) => {
  try {
    const records = await prisma.savedJob.findMany({
      where: { userId: LOCAL_SAVED_JOBS_USER_ID },
      orderBy: { createdAt: "desc" },
      include: { job: true }
    });
    const profileRow = await prisma.candidateProfile.findUnique({ where: { id: "default" } });
    const profile = parseProfile(profileRow);
    const data = records.map(record => {
      const job = record.job;
      return {
        ...job,
        savedAt: record.createdAt,
        skills: readJsonList(job.skillsJson),
        match: scoreJobMatch({
          title: job.title, location: job.location, category: job.category,
          skills: readJsonList(job.skillsJson)
        }, profile)
      };
    });
    res.json({ data, count: data.length });
  } catch (error) {
    res.status(500).json({ error: "Unable to retrieve saved jobs", detail: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/jobs/:id/save", async (req, res) => {
  try {
    const job = await prisma.job.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!job) {
      res.status(404).json({ error: "Job listing not found" });
      return;
    }
    const saved = await prisma.savedJob.upsert({
      where: { userId_jobId: { userId: LOCAL_SAVED_JOBS_USER_ID, jobId: job.id } },
      create: { userId: LOCAL_SAVED_JOBS_USER_ID, jobId: job.id },
      update: {}
    });
    res.status(201).json({ data: { jobId: saved.jobId, savedAt: saved.createdAt, isSaved: true } });
  } catch (error) {
    res.status(500).json({ error: "Unable to save job", detail: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.delete("/api/jobs/:id/save", async (req, res) => {
  try {
    const job = await prisma.job.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!job) {
      res.status(404).json({ error: "Job listing not found" });
      return;
    }
    await prisma.savedJob.deleteMany({ where: { userId: LOCAL_SAVED_JOBS_USER_ID, jobId: job.id } });
    res.json({ data: { jobId: job.id, isSaved: false } });
  } catch (error) {
    res.status(500).json({ error: "Unable to remove saved job", detail: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.get("/api/jobs", async (req, res) => {
  try {
    const q = String(req.query.q ?? "").trim();
    const location = String(req.query.location ?? "").trim();
    const company = String(req.query.company ?? "").trim();
    const source = String(req.query.source ?? "").trim().toUpperCase();
    const employmentType = String(req.query.employmentType ?? "").trim().toUpperCase();
    const workMode = String(req.query.workMode ?? "ANY").trim().toUpperCase();
    const sort = String(req.query.sort ?? "NEWEST").trim().toUpperCase();
    const requiredSkills = String(req.query.skills ?? "").split(",").map(skill => skill.trim()).filter(Boolean);
    const parsedLimit = Number(req.query.limit ?? 50);
    const take = Number.isFinite(parsedLimit) ? Math.min(Math.max(Math.floor(parsedLimit), 1), 100) : 50;
    const employmentTypes = ["FULL_TIME", "PART_TIME", "INTERNSHIP", "CONTRACT", "UNKNOWN"];
    const workModes = ["ANY", "REMOTE", "HYBRID", "ONSITE", "UNKNOWN"];
    const sortOptions = ["NEWEST", "MATCH", "RELEVANCE"];

    if (employmentType && !employmentTypes.includes(employmentType)) {
      res.status(400).json({ error: "employmentType must be FULL_TIME, PART_TIME, INTERNSHIP, CONTRACT or UNKNOWN." });
      return;
    }
    if (!workModes.includes(workMode)) {
      res.status(400).json({ error: "workMode must be ANY, REMOTE, HYBRID, ONSITE or UNKNOWN." });
      return;
    }
    if (!sortOptions.includes(sort)) {
      res.status(400).json({ error: "sort must be NEWEST, MATCH or RELEVANCE." });
      return;
    }
    if (requiredSkills.length > 20 || requiredSkills.some(skill => skill.length > 80)) {
      res.status(400).json({ error: "Select up to 20 required skills, each no longer than 80 characters." });
      return;
    }

    const where = {
      AND: [
        q ? { OR: [{ title: { contains: q } }, { company: { contains: q } }, { description: { contains: q } }] } : {},
        location ? { location: { contains: location } } : {},
        company ? { company: { contains: company } } : {},
        source ? { source } : {},
        employmentType ? { employmentType } : {}
      ]
    };

    const [jobs, savedRecords, profileRow] = await Promise.all([
      prisma.job.findMany({ where, orderBy: [{ publishedAt: "desc" }, { discoveredAt: "desc" }] }),
      prisma.savedJob.findMany({
        where: { userId: LOCAL_SAVED_JOBS_USER_ID },
        select: { jobId: true }
      }),
      prisma.candidateProfile.findUnique({ where: { id: "default" } })
    ]);
    const savedJobIds = new Set(savedRecords.map(record => record.jobId));
    const profile = parseProfile(profileRow);
    const enriched = jobs.map(job => {
      const skills = readJsonList(job.skillsJson);
      return {
        ...job,
        skills,
        workMode: inferWorkMode(job.location, job.description),
        isSaved: savedJobIds.has(job.id),
        match: scoreJobMatch({ title: job.title, location: job.location, category: job.category, skills }, profile)
      };
    }).filter(job =>
      matchesWorkMode(job.location, job.description, workMode) &&
      matchesRequiredSkills(job.skills, requiredSkills)
    );

    const newestFirst = (a: typeof enriched[number], b: typeof enriched[number]) =>
      new Date(b.publishedAt ?? b.discoveredAt).getTime() - new Date(a.publishedAt ?? a.discoveredAt).getTime();
    if (sort === "MATCH") {
      enriched.sort((a, b) => (b.match.score ?? -1) - (a.match.score ?? -1) || newestFirst(a, b));
    } else if (sort === "RELEVANCE") {
      enriched.sort((a, b) =>
        (b.match.score ?? -1) - (a.match.score ?? -1) ||
        textRelevance(b.title, b.company, b.description, q) - textRelevance(a.title, a.company, a.description, q) ||
        newestFirst(a, b)
      );
    } else {
      enriched.sort(newestFirst);
    }

    const total = enriched.length;
    const data = enriched.slice(0, take);
    res.json({
      data,
      count: data.length,
      total,
      profileConfigured: Boolean(profile.skills.length || profile.preferredRoles.length || profile.locations.length || profile.remotePreference !== "ANY"),
      filters: { employmentType: employmentType || null, workMode, company: company || null, skills: requiredSkills, sort }
    });
  } catch (error) {
    res.status(500).json({
      error: "Unable to retrieve jobs",
      detail: error instanceof Error ? error.message : "Unknown database error"
    });
  }
});


app.get("/api/jobs/:id/analyze", async (req, res) => {
  try {
    const job = await prisma.job.findUnique({ where: { id: req.params.id } });
    if (!job) {
      res.status(404).json({ error: "Job listing not found" });
      return;
    }
    const profileRow = await prisma.candidateProfile.findUnique({ where: { id: "default" } });
    const profile = parseProfile(profileRow);
    const readSkills = (value: string): string[] => {
      try {
        const parsed: unknown = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
      } catch { return []; }
    };
    const resume = {
      skills: readSkills(profileRow?.skillsJson ?? "[]"),
      education: readSkills(profileRow?.educationJson ?? "[]"),
      experience: readSkills(profileRow?.experienceJson ?? "[]"),
      projects: readSkills(profileRow?.projectsJson ?? "[]"),
      certifications: readSkills(profileRow?.certificationsJson ?? "[]")
    };
    const analysis = analyzeJobFit({
      title: job.title,
      location: job.location,
      category: job.category,
      skills: readSkills(job.skillsJson),
      description: job.description
    }, profile, resume);
    res.json({ data: analysis });
  } catch (error) {
    res.status(500).json({
      error: "Unable to analyze job fit",
      detail: error instanceof Error ? error.message : "Unknown analysis error"
    });
  }
});


function serializeApplicationDraft(draft: {
  id: string; jobId: string; resumeSummary: string; highlightsJson: string; coverLetter: string;
  reviewNotesJson: string; status: string; reviewedAt: Date | null; createdAt: Date; updatedAt: Date;
}) {
  return {
    id: draft.id,
    jobId: draft.jobId,
    resumeSummary: draft.resumeSummary,
    highlights: readJsonList(draft.highlightsJson),
    coverLetter: draft.coverLetter,
    reviewNotes: readJsonList(draft.reviewNotesJson),
    status: draft.status,
    reviewedAt: draft.reviewedAt,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt
  };
}

app.get("/api/jobs/:id/application-draft", async (req, res) => {
  try {
    const job = await prisma.job.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!job) {
      res.status(404).json({ error: "Job listing not found" });
      return;
    }
    const draft = await prisma.applicationDraft.findUnique({ where: { jobId: job.id } });
    res.json({ data: draft ? serializeApplicationDraft(draft) : null });
  } catch (error) {
    res.status(500).json({ error: "Unable to retrieve application draft", detail: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/jobs/:id/application-draft", async (req, res) => {
  try {
    const job = await prisma.job.findUnique({ where: { id: req.params.id } });
    if (!job) {
      res.status(404).json({ error: "Job listing not found" });
      return;
    }
    const existing = await prisma.applicationDraft.findUnique({ where: { jobId: job.id } });
    if (existing) {
      res.status(409).json({ error: "An application draft already exists. Load and edit it instead of overwriting your changes.", data: serializeApplicationDraft(existing) });
      return;
    }
    const profileRow = await prisma.candidateProfile.findUnique({ where: { id: "default" } });
    const profile = parseProfile(profileRow);
    const resume = {
      skills: readJsonList(profileRow?.skillsJson ?? "[]"),
      education: readJsonList(profileRow?.educationJson ?? "[]"),
      experience: readJsonList(profileRow?.experienceJson ?? "[]"),
      projects: readJsonList(profileRow?.projectsJson ?? "[]"),
      certifications: readJsonList(profileRow?.certificationsJson ?? "[]")
    };
    const generated = generateApplicationDraft({
      job: {
        title: job.title, company: job.company, location: job.location, category: job.category,
        skills: readJsonList(job.skillsJson), description: job.description
      },
      profile,
      resume
    });
    const draft = await prisma.applicationDraft.create({
      data: {
        jobId: job.id,
        resumeSummary: generated.resumeSummary,
        highlightsJson: JSON.stringify(generated.highlights),
        coverLetter: generated.coverLetter,
        reviewNotesJson: JSON.stringify(generated.reviewNotes)
      }
    });
    res.status(201).json({ data: serializeApplicationDraft(draft) });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      res.status(409).json({ error: "An application draft already exists for this job. Load it to preserve your edits." });
      return;
    }
    res.status(500).json({ error: "Unable to generate application draft", detail: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.put("/api/jobs/:id/application-draft", async (req, res) => {
  const body = req.body ?? {};
  const validHighlights = Array.isArray(body.highlights) && body.highlights.length <= 10 &&
    body.highlights.every((item: unknown) => typeof item === "string" && item.trim().length > 0 && item.length <= 500);
  if (typeof body.resumeSummary !== "string" || body.resumeSummary.length > 5000 ||
      typeof body.coverLetter !== "string" || body.coverLetter.length > 12000 || !validHighlights) {
    res.status(400).json({ error: "resumeSummary and coverLetter must be text within size limits; highlights must be up to 10 non-empty strings (500 characters max)." });
    return;
  }
  try {
    const existing = await prisma.applicationDraft.findUnique({ where: { jobId: req.params.id } });
    if (!existing) {
      res.status(404).json({ error: "Application draft not found. Generate it first." });
      return;
    }
    const saved = await prisma.applicationDraft.update({
      where: { jobId: req.params.id },
      data: {
        resumeSummary: body.resumeSummary,
        highlightsJson: JSON.stringify([...new Set(body.highlights.map((item: string) => item.trim()))]),
        coverLetter: body.coverLetter,
        status: "DRAFT",
        reviewedAt: null
      }
    });
    res.json({ data: serializeApplicationDraft(saved) });
  } catch (error) {
    res.status(500).json({ error: "Unable to save application draft", detail: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/jobs/:id/application-draft/review", async (req, res) => {
  try {
    const existing = await prisma.applicationDraft.findUnique({ where: { jobId: req.params.id } });
    if (!existing) {
      res.status(404).json({ error: "Application draft not found. Generate it first." });
      return;
    }
    const saved = await prisma.applicationDraft.update({
      where: { jobId: req.params.id },
      data: { status: "REVIEWED", reviewedAt: new Date() }
    });
    res.json({ data: serializeApplicationDraft(saved), message: "Marked reviewed for manual use only. No application was submitted." });
  } catch (error) {
    res.status(500).json({ error: "Unable to mark application draft reviewed", detail: error instanceof Error ? error.message : "Unknown error" });
  }
});


const APPLICATION_STATUSES = ["SAVED", "PREPARING", "APPLIED", "INTERVIEW", "OFFER", "REJECTED", "WITHDRAWN"] as const;
type ApplicationStatus = typeof APPLICATION_STATUSES[number];

function parseOptionalDate(value: unknown): Date | null | undefined {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(value + "T00:00:00.000Z");
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? undefined : date;
}

function serializeApplicationTracking(record: {
  id: string; jobId: string; status: string; notes: string; appliedAt: Date | null;
  followUpAt: Date | null; createdAt: Date; updatedAt: Date;
}) {
  return {
    id: record.id,
    jobId: record.jobId,
    status: record.status,
    notes: record.notes,
    appliedAt: record.appliedAt?.toISOString().slice(0, 10) ?? null,
    followUpAt: record.followUpAt?.toISOString().slice(0, 10) ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

app.get("/api/applications", async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status.toUpperCase() : "";
  if (status && !APPLICATION_STATUSES.includes(status as ApplicationStatus)) {
    res.status(400).json({ error: "Unsupported application status filter." });
    return;
  }
  try {
    const records = await prisma.applicationTracking.findMany({
      where: status ? { status } : {},
      orderBy: [{ followUpAt: "asc" }, { updatedAt: "desc" }],
      include: { job: { select: { id: true, title: true, company: true, location: true, applicationUrl: true } } }
    });
    res.json({ data: records.map(record => ({
      ...serializeApplicationTracking(record),
      job: record.job
    })), count: records.length });
  } catch (error) {
    res.status(500).json({ error: "Unable to retrieve application tracker", detail: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.get("/api/jobs/:id/application-tracking", async (req, res) => {
  try {
    const job = await prisma.job.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!job) {
      res.status(404).json({ error: "Job listing not found" });
      return;
    }
    const record = await prisma.applicationTracking.findUnique({ where: { jobId: job.id } });
    res.json({ data: record ? serializeApplicationTracking(record) : null });
  } catch (error) {
    res.status(500).json({ error: "Unable to retrieve application tracking details", detail: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.put("/api/jobs/:id/application-tracking", async (req, res) => {
  const body = req.body ?? {};
  const status = typeof body.status === "string" ? body.status.toUpperCase() : "";
  const appliedAt = parseOptionalDate(body.appliedAt);
  const followUpAt = parseOptionalDate(body.followUpAt);
  if (!APPLICATION_STATUSES.includes(status as ApplicationStatus) ||
      typeof body.notes !== "string" || body.notes.length > 5000 ||
      appliedAt === undefined || followUpAt === undefined) {
    res.status(400).json({ error: "Provide a supported status, notes up to 5,000 characters, and valid YYYY-MM-DD appliedAt/followUpAt dates or empty values." });
    return;
  }
  try {
    const job = await prisma.job.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!job) {
      res.status(404).json({ error: "Job listing not found" });
      return;
    }
    const record = await prisma.applicationTracking.upsert({
      where: { jobId: job.id },
      create: { jobId: job.id, status: status as ApplicationStatus, notes: body.notes.trim(), appliedAt, followUpAt },
      update: { status: status as ApplicationStatus, notes: body.notes.trim(), appliedAt, followUpAt }
    });
    res.json({ data: serializeApplicationTracking(record) });
  } catch (error) {
    res.status(500).json({ error: "Unable to save application tracking details", detail: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.get("/api/sources/catalog", (_req, res) => {
  res.json({ data: sourceCatalog });
});

app.get("/api/sources", async (_req, res) => {
  try {
    const sources = await prisma.jobSource.findMany({ orderBy: { createdAt: "desc" } });
    const jobs = await prisma.job.findMany({
      select: { source: true, sourceBoardId: true, lastVerifiedAt: true, description: true }
    });
    const now = Date.now();
    const data = sources.map(source => {
      const sourceJobs = jobs.filter(job => job.source === source.provider && job.sourceBoardId === source.boardId);
      const verifiedDates = sourceJobs
        .map(job => job.lastVerifiedAt)
        .filter((date): date is Date => date !== null);
      const lastVerifiedAt = verifiedDates.length
        ? new Date(Math.max(...verifiedDates.map(date => date.getTime())))
        : null;
      const freshness = sourceJobs.length === 0 ? "NO_LISTINGS"
        : !lastVerifiedAt ? "NOT_VERIFIED"
        : now - lastVerifiedAt.getTime() > 7 * 24 * 60 * 60 * 1000 ? "STALE"
        : "RECENTLY_VERIFIED";
      return {
        ...source,
        health: {
          listingCount: sourceJobs.length,
          verifiedListingCount: verifiedDates.length,
          missingDescriptionCount: sourceJobs.filter(job => !job.description.trim()).length,
          lastVerifiedAt,
          freshness
        }
      };
    });
    res.json({ data });
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
