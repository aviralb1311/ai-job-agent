import express from "express";
import { createHash, randomBytes } from "node:crypto";
import { register, login, logout, currentSession, requireAuth, requireAdmin, optionalAuth } from "./auth.js";
import cors from "cors";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { previewSource, syncJobs, syncSource } from "./jobs/service.js";
import { sourceCatalog } from "./jobs/source-catalog.js";
import { scoreJobMatch, type CandidatePreferences } from "./jobs/intelligence.js";
import { parseResumeBuffer, ResumeParseError } from "./jobs/resume-parser.js";
import { analyzeJobFit } from "./jobs/fit-analysis.js";
import { generateApplicationDraft } from "./jobs/application-draft.js";
import { inferWorkMode, matchesRequiredSkills, matchesWorkMode, textRelevance } from "./jobs/search.js";
import { FOLLOW_UP_BUCKETS, isDateKey, matchesFollowUpBucket, type FollowUpBucket } from "./jobs/follow-ups.js";

export const app = express();
app.use(cors({ origin: config.CORS_ORIGIN, credentials: true }));
app.use(express.json({ limit: "1mb" }));

const SUPPORTED_PROVIDERS = ["GREENHOUSE", "LEVER", "ASHBY"] as const;

// Account endpoints. Private API routes are migrated in small, ownership-safe steps;
 // do not expose this branch publicly until every private route is protected.
app.post("/api/auth/register", register);
app.post("/api/auth/login", login);
app.post("/api/auth/logout", logout);
app.get("/api/auth/me", currentSession);

function digestExtensionToken(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function requireExtensionToken(req: express.Request, res: express.Response, next: express.NextFunction): Promise<void> {
  const authorization = req.header("authorization") ?? "";
  const match = /^Bearer ([A-Za-z0-9_-]{40,100})$/.exec(authorization);
  if (!match) {
    res.status(401).json({ error: "Extension connection required." });
    return;
  }
  try {
    const token = await prisma.extensionAccessToken.findUnique({
      where: { tokenHash: digestExtensionToken(match[1]) }
    });
    if (!token || token.expiresAt <= new Date()) {
      if (token) await prisma.extensionAccessToken.delete({ where: { id: token.id } });
      res.status(401).json({ error: "Extension connection expired. Pair the extension again." });
      return;
    }
    res.locals.extensionUserId = token.userId;
    next();
  } catch {
    res.status(500).json({ error: "Unable to validate extension connection." });
  }
}

// Create a single-use, five-minute pairing code for the signed-in account.
app.post("/api/extension/pairing-code", requireAuth, async (_req, res) => {
  try {
    await prisma.extensionPairingCode.deleteMany({
      where: { userId: res.locals.userId, OR: [{ expiresAt: { lte: new Date() } }, { consumedAt: { not: null } }] }
    });
    const code = randomBytes(6).toString("hex").toUpperCase();
    await prisma.extensionPairingCode.create({
      data: {
        codeHash: digestExtensionToken(code),
        userId: res.locals.userId,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000)
      }
    });
    res.json({ data: { code, expiresInSeconds: 300 } });
  } catch {
    res.status(500).json({ error: "Unable to create extension pairing code." });
  }
});

// Exchange a one-time pairing code for a seven-day extension-only bearer token.
app.post("/api/extension/exchange", async (req, res) => {
  const code = typeof req.body?.code === "string" ? req.body.code.trim().toUpperCase() : "";
  if (!/^[A-F0-9]{12}$/.test(code)) {
    res.status(400).json({ error: "Enter a valid pairing code." });
    return;
  }
  try {
    const pairing = await prisma.extensionPairingCode.findUnique({ where: { codeHash: digestExtensionToken(code) } });
    if (!pairing || pairing.consumedAt || pairing.expiresAt <= new Date()) {
      res.status(401).json({ error: "Pairing code is invalid or expired. Generate a new code in your account." });
      return;
    }
    const consumed = await prisma.extensionPairingCode.updateMany({
      where: { id: pairing.id, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() }
    });
    if (consumed.count !== 1) {
      res.status(401).json({ error: "Pairing code has already been used. Generate a new code." });
      return;
    }
    const accessToken = randomBytes(32).toString("base64url");
    await prisma.extensionAccessToken.create({
      data: {
        tokenHash: digestExtensionToken(accessToken),
        userId: pairing.userId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      }
    });
    res.json({ data: { accessToken, expiresInSeconds: 7 * 24 * 60 * 60 } });
  } catch {
    res.status(500).json({ error: "Unable to connect the extension." });
  }
});

// Return only contact fields required for form autofill; never expose resume contents.
app.get("/api/extension/profile", requireExtensionToken, async (_req, res) => {
  try {
    const [profile, user] = await Promise.all([
      prisma.userCandidateProfile.findUnique({ where: { userId: res.locals.extensionUserId } }),
      prisma.user.findUnique({ where: { id: res.locals.extensionUserId }, select: { email: true } })
    ]);
    res.json({ data: {
      fullName: profile?.fullName ?? "",
      phone: profile?.phone ?? "",
      city: profile?.city ?? "",
      state: profile?.state ?? "",
      pinCode: profile?.pinCode ?? "",
      linkedinUrl: profile?.linkedinUrl ?? "",
      githubUrl: profile?.githubUrl ?? "",
      portfolioUrl: profile?.portfolioUrl ?? "",
      email: user?.email ?? ""
    } });
  } catch {
    res.status(500).json({ error: "Unable to retrieve extension profile." });
  }
});

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

const CONTACT_FIELDS = ["fullName", "phone", "city", "state", "pinCode", "linkedinUrl", "githubUrl", "portfolioUrl"] as const;
type ContactField = typeof CONTACT_FIELDS[number];
function parseContactFields(row: Partial<Record<ContactField, string>> | null): Record<ContactField, string> {
  return Object.fromEntries(CONTACT_FIELDS.map(field => [field, row?.[field] ?? ""])) as Record<ContactField, string>;
}

app.get("/api/profile", requireAuth, async (_req, res) => {
  try {
    const [profile, user] = await Promise.all([
      prisma.userCandidateProfile.findUnique({ where: { userId: res.locals.userId } }),
      prisma.user.findUnique({ where: { id: res.locals.userId }, select: { email: true } })
    ]);
    res.json({ data: { ...parseProfile(profile), ...parseContactFields(profile), email: user?.email ?? "" } });
  } catch (error) {
    res.status(500).json({ error: "Unable to retrieve candidate profile", detail: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.put("/api/profile", requireAuth, async (req, res) => {
  const body = req.body ?? {};
  const validList = (value: unknown): value is string[] =>
    Array.isArray(value) && value.length <= 50 && value.every(item => typeof item === "string" && item.trim().length > 0 && item.length <= 80);
  const validContact = CONTACT_FIELDS.every(field => body[field] === undefined ||
    (typeof body[field] === "string" && body[field].trim().length <= (field === "phone" ? 25 : 200)));
  if (!validList(body.skills) || !validList(body.preferredRoles) || !validList(body.locations) ||
      !REMOTE_PREFERENCES.includes(body.remotePreference) || !validContact) {
    res.status(400).json({ error: "Invalid profile. Check your preference lists and contact details." });
    return;
  }
  const clean = (items: string[]) => [...new Set(items.map(item => item.trim()))];
  try {
    const contact = Object.fromEntries(CONTACT_FIELDS.map(field => [field, typeof body[field] === "string" ? body[field].trim() : ""]])) as Record<ContactField, string>;
    const data = {
      skillsJson: JSON.stringify(clean(body.skills)),
      preferredRoles: JSON.stringify(clean(body.preferredRoles)),
      locations: JSON.stringify(clean(body.locations)),
      remotePreference: body.remotePreference as CandidatePreferences["remotePreference"],
      ...contact
    };
    const saved = await prisma.userCandidateProfile.upsert({
      where: { userId: res.locals.userId },
      create: { userId: res.locals.userId, ...data },
      update: data
    });
    const user = await prisma.user.findUnique({ where: { id: res.locals.userId }, select: { email: true } });
    res.json({ data: { ...parseProfile(saved), ...parseContactFields(saved), email: user?.email ?? "" } });
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

app.post("/api/resume/parse", requireAuth, express.raw({
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

app.put("/api/profile/resume", requireAuth, async (req, res) => {
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
    const saved = await prisma.userCandidateProfile.upsert({
      where: { userId: res.locals.userId },
      create: { userId: res.locals.userId, ...data },
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

app.get("/api/profile/resume", requireAuth, async (req, res) => {
  try {
    const profile = await prisma.userCandidateProfile.findUnique({ where: { userId: res.locals.userId } });
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

app.get("/api/saved-searches", requireAuth, async (_req, res) => {
  try {
    const searches = await prisma.userSavedSearch.findMany({
      where: { userId: res.locals.userId },
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

app.post("/api/saved-searches", requireAuth, async (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const filters = parseSavedSearchFilters(req.body?.filters);
  if (!name || name.length > 80 || !filters) {
    res.status(400).json({ error: "Provide a name up to 80 characters and valid search filters." });
    return;
  }
  try {
    const saved = await prisma.userSavedSearch.create({
      data: { userId: res.locals.userId, name, filtersJson: JSON.stringify(filters) }
    });
    res.status(201).json({ data: {
      id: saved.id, name: saved.name, filters, createdAt: saved.createdAt, lastCheckedAt: saved.lastCheckedAt
    } });
  } catch (error) {
    res.status(500).json({ error: "Unable to save search", detail: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.delete("/api/saved-searches/:id", requireAuth, async (req, res) => {
  try {
    const result = await prisma.userSavedSearch.deleteMany({
      where: { id: String(req.params.id), userId: res.locals.userId }
    });
    if (!result.count) {
      res.status(404).json({ error: "Saved search not found" });
      return;
    }
    res.json({ data: { id: String(req.params.id), deleted: true } });
  } catch (error) {
    res.status(500).json({ error: "Unable to delete saved search", detail: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.get("/api/saved-searches/:id/alerts", requireAuth, async (req, res) => {
  try {
    const search = await prisma.userSavedSearch.findFirst({
      where: { id: String(req.params.id), userId: res.locals.userId }
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
    await prisma.userSavedSearch.updateMany({ where: { id: search.id, userId: res.locals.userId }, data: { lastCheckedAt: checkedAt } });
    res.json({ data, count: data.length, checkedAt, search: { id: search.id, name: search.name } });
  } catch (error) {
    res.status(500).json({ error: "Unable to check saved-search alerts", detail: error instanceof Error ? error.message : "Unknown error" });
  }
});


app.get("/api/saved-jobs", requireAuth, async (_req, res) => {
  try {
    const records = await prisma.userSavedJob.findMany({
      where: { userId: res.locals.userId },
      orderBy: { createdAt: "desc" },
      include: { job: true }
    });
    const profileRow = await prisma.userCandidateProfile.findUnique({ where: { userId: res.locals.userId } });
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

app.post("/api/jobs/:id/save", requireAuth, async (req, res) => {
  try {
    const job = await prisma.job.findUnique({ where: { id: String(req.params.id) }, select: { id: true } });
    if (!job) {
      res.status(404).json({ error: "Job listing not found" });
      return;
    }
    const saved = await prisma.userSavedJob.upsert({
      where: { userId_jobId: { userId: res.locals.userId, jobId: job.id } },
      create: { userId: res.locals.userId, jobId: job.id },
      update: {}
    });
    res.status(201).json({ data: { jobId: saved.jobId, savedAt: saved.createdAt, isSaved: true } });
  } catch (error) {
    res.status(500).json({ error: "Unable to save job", detail: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.delete("/api/jobs/:id/save", requireAuth, async (req, res) => {
  try {
    const job = await prisma.job.findUnique({ where: { id: String(req.params.id) }, select: { id: true } });
    if (!job) {
      res.status(404).json({ error: "Job listing not found" });
      return;
    }
    await prisma.userSavedJob.deleteMany({ where: { userId: res.locals.userId, jobId: job.id } });
    res.json({ data: { jobId: job.id, isSaved: false } });
  } catch (error) {
    res.status(500).json({ error: "Unable to remove saved job", detail: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.get("/api/jobs", optionalAuth, async (req, res) => {
  try {
    const q = String(req.query.q ?? "").trim();
    const location = String(req.query.location ?? "").trim();
    const company = String(req.query.company ?? "").trim();
    const source = String(req.query.source ?? "").trim().toUpperCase();
    const employmentType = String(req.query.employmentType ?? "").trim().toUpperCase();
    const workMode = String(req.query.workMode ?? "ANY").trim().toUpperCase();
    const sort = String(req.query.sort ?? "NEWEST").trim().toUpperCase();
    const listingStatus = String(req.query.listingStatus ?? "OPEN").trim().toUpperCase();
    const requiredSkills = String(req.query.skills ?? "").split(",").map(skill => skill.trim()).filter(Boolean);
    const parsedLimit = Number(req.query.limit ?? 50);
    const take = Number.isFinite(parsedLimit) ? Math.min(Math.max(Math.floor(parsedLimit), 1), 100) : 50;
    const employmentTypes = ["FULL_TIME", "PART_TIME", "INTERNSHIP", "CONTRACT", "UNKNOWN"];
    const workModes = ["ANY", "REMOTE", "HYBRID", "ONSITE", "UNKNOWN"];
    const sortOptions = ["NEWEST", "MATCH", "RELEVANCE"];
    const listingStatuses = ["OPEN", "INACTIVE", "ALL"];

    if (employmentType && !employmentTypes.includes(employmentType)) {
      res.status(400).json({ error: "employmentType must be FULL_TIME, PART_TIME, INTERNSHIP, CONTRACT or UNKNOWN." });
      return;
    }
    if (!workModes.includes(workMode)) {
      res.status(400).json({ error: "workMode must be ANY, REMOTE, HYBRID, ONSITE or UNKNOWN." });
      return;
    }
    if (!listingStatuses.includes(listingStatus)) {
      res.status(400).json({ error: "listingStatus must be OPEN, INACTIVE or ALL." });
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
        employmentType ? { employmentType } : {},
        listingStatus === "OPEN" ? { status: { not: "INACTIVE" } } : listingStatus === "INACTIVE" ? { status: "INACTIVE" } : {}
      ]
    };

    const [jobs, savedRecords, profileRow] = await Promise.all([
      prisma.job.findMany({ where, orderBy: [{ publishedAt: "desc" }, { discoveredAt: "desc" }] }),
      res.locals.userId
        ? prisma.userSavedJob.findMany({
            where: { userId: res.locals.userId },
            select: { jobId: true }
          })
        : Promise.resolve([]),
      res.locals.userId
        ? prisma.userCandidateProfile.findUnique({ where: { userId: res.locals.userId } })
        : Promise.resolve(null)
    ]);
    const savedJobIds = new Set(savedRecords.map(record => record.jobId));
    const profile = parseProfile(profileRow);
    const now = Date.now();
    const enriched = jobs.map(job => {
      const skills = readJsonList(job.skillsJson);
      const verificationAgeMs = job.lastVerifiedAt ? now - job.lastVerifiedAt.getTime() : null;
      // Expiry is a revalidation deadline, not proof that an employer closed the role.
      const revalidationState = verificationAgeMs === null ? "UNVERIFIED"
        : verificationAgeMs > 30 * 24 * 60 * 60 * 1000 ? "EXPIRED"
        : verificationAgeMs > 7 * 24 * 60 * 60 * 1000 ? "STALE" : "FRESH";
      return {
        ...job,
        skills,
        revalidationState,
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
      filters: { employmentType: employmentType || null, workMode, company: company || null, skills: requiredSkills, sort, listingStatus }
    });
  } catch (error) {
    res.status(500).json({
      error: "Unable to retrieve jobs",
      detail: error instanceof Error ? error.message : "Unknown database error"
    });
  }
});


app.get("/api/jobs/:id/analyze", requireAuth, async (req, res) => {
  try {
    const job = await prisma.job.findUnique({ where: { id: String(req.params.id) } });
    if (!job) {
      res.status(404).json({ error: "Job listing not found" });
      return;
    }
    const profileRow = await prisma.userCandidateProfile.findUnique({ where: { userId: res.locals.userId } });
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
  reviewNotesJson: string; status: string; workflowStatus: string; approvedAt: Date | null;
  reviewedAt: Date | null; createdAt: Date; updatedAt: Date;
}) {
  return {
    id: draft.id,
    jobId: draft.jobId,
    resumeSummary: draft.resumeSummary,
    highlights: readJsonList(draft.highlightsJson),
    coverLetter: draft.coverLetter,
    reviewNotes: readJsonList(draft.reviewNotesJson),
    status: draft.status,
    workflowStatus: draft.workflowStatus,
    approvedAt: draft.approvedAt,
    reviewedAt: draft.reviewedAt,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt
  };
}

app.get("/api/jobs/:id/application-draft", requireAuth, async (req, res) => {
  try {
    const job = await prisma.job.findUnique({ where: { id: String(req.params.id) }, select: { id: true } });
    if (!job) {
      res.status(404).json({ error: "Job listing not found" });
      return;
    }
    const draft = await prisma.userApplicationDraft.findFirst({ where: { userId: res.locals.userId, jobId: job.id } });
    res.json({ data: draft ? serializeApplicationDraft(draft) : null });
  } catch (error) {
    res.status(500).json({ error: "Unable to retrieve application draft", detail: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/jobs/:id/application-draft", requireAuth, async (req, res) => {
  try {
    const job = await prisma.job.findUnique({ where: { id: String(req.params.id) } });
    if (!job) {
      res.status(404).json({ error: "Job listing not found" });
      return;
    }
    const existing = await prisma.userApplicationDraft.findFirst({ where: { userId: res.locals.userId, jobId: job.id } });
    if (existing) {
      res.status(409).json({ error: "An application draft already exists. Load and edit it instead of overwriting your changes.", data: serializeApplicationDraft(existing) });
      return;
    }
    const profileRow = await prisma.userCandidateProfile.findUnique({ where: { userId: res.locals.userId } });
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
    const draft = await prisma.userApplicationDraft.create({
      data: {
        userId: res.locals.userId,
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

app.put("/api/jobs/:id/application-draft", requireAuth, async (req, res) => {
  const body = req.body ?? {};
  const validHighlights = Array.isArray(body.highlights) && body.highlights.length <= 10 &&
    body.highlights.every((item: unknown) => typeof item === "string" && item.trim().length > 0 && item.length <= 500);
  if (typeof body.resumeSummary !== "string" || body.resumeSummary.length > 5000 ||
      typeof body.coverLetter !== "string" || body.coverLetter.length > 12000 || !validHighlights) {
    res.status(400).json({ error: "resumeSummary and coverLetter must be text within size limits; highlights must be up to 10 non-empty strings (500 characters max)." });
    return;
  }
  try {
    const existing = await prisma.userApplicationDraft.findFirst({ where: { userId: res.locals.userId, jobId: String(req.params.id) } });
    if (!existing) {
      res.status(404).json({ error: "Application draft not found. Generate it first." });
      return;
    }
    const saved = await prisma.userApplicationDraft.update({
      where: { userId_jobId: { userId: res.locals.userId, jobId: String(req.params.id) } },
      data: {
        resumeSummary: body.resumeSummary,
        highlightsJson: JSON.stringify([...new Set(body.highlights.map((item: string) => item.trim()))]),
        coverLetter: body.coverLetter,
        status: "DRAFT",
        workflowStatus: "DRAFT",
        approvedAt: null,
        reviewedAt: null
      }
    });
    res.json({ data: serializeApplicationDraft(saved) });
  } catch (error) {
    res.status(500).json({ error: "Unable to save application draft", detail: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/jobs/:id/application-draft/review", requireAuth, async (req, res) => {
  try {
    const existing = await prisma.userApplicationDraft.findFirst({ where: { userId: res.locals.userId, jobId: String(req.params.id) } });
    if (!existing) {
      res.status(404).json({ error: "Application draft not found. Generate it first." });
      return;
    }
    const saved = await prisma.userApplicationDraft.update({
      where: { userId_jobId: { userId: res.locals.userId, jobId: String(req.params.id) } },
      data: { status: "REVIEWED", workflowStatus: "READY_FOR_REVIEW", approvedAt: null, reviewedAt: new Date() }
    });
    res.json({ data: serializeApplicationDraft(saved), message: "Draft is ready for your final approval. No application was submitted." });
  } catch (error) {
    res.status(500).json({ error: "Unable to mark application draft reviewed", detail: error instanceof Error ? error.message : "Unknown error" });
  }
});


app.post("/api/jobs/:id/application-draft/approve", requireAuth, async (req, res) => {
  if (req.body?.approved !== true) {
    res.status(400).json({ error: "Explicit approval is required." });
    return;
  }
  try {
    const existing = await prisma.userApplicationDraft.findFirst({
      where: { userId: res.locals.userId, jobId: String(req.params.id) }
    });
    if (!existing) {
      res.status(404).json({ error: "Application draft not found." });
      return;
    }
    if (existing.workflowStatus !== "READY_FOR_REVIEW") {
      res.status(409).json({ error: "Save and mark the draft ready for review before approving it." });
      return;
    }
    const saved = await prisma.userApplicationDraft.update({
      where: { userId_jobId: { userId: res.locals.userId, jobId: String(req.params.id) } },
      data: { workflowStatus: "APPROVED", approvedAt: new Date() }
    });
    res.json({ data: serializeApplicationDraft(saved), message: "Approval recorded. No application has been submitted." });
  } catch (error) {
    res.status(500).json({ error: "Unable to record approval", detail: error instanceof Error ? error.message : "Unknown error" });
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

app.get("/api/applications/follow-ups", requireAuth, async (req, res) => {
  const bucketValue = typeof req.query.bucket === "string" ? req.query.bucket.toUpperCase() : "ALL";
  const bucket = FOLLOW_UP_BUCKETS.includes(bucketValue as FollowUpBucket) ? bucketValue as FollowUpBucket : null;
  const today = typeof req.query.today === "string" ? req.query.today : new Date().toISOString().slice(0, 10);
  if (!bucket || !isDateKey(today)) {
    res.status(400).json({ error: "bucket must be OVERDUE, TODAY, UPCOMING or ALL, and today must be a valid YYYY-MM-DD date." });
    return;
  }
  try {
    const records = await prisma.userApplicationTracking.findMany({
      where: {
        userId: res.locals.userId,
        followUpAt: { not: null },
        status: { notIn: ["REJECTED", "WITHDRAWN"] }
      },
      orderBy: [{ followUpAt: "asc" }, { updatedAt: "desc" }],
      include: { job: { select: { id: true, title: true, company: true, location: true, applicationUrl: true } } }
    });
    const scheduled = records.filter(record => record.followUpAt !== null);
    const counts = {
      OVERDUE: scheduled.filter(record => matchesFollowUpBucket(record.followUpAt!, "OVERDUE", today)).length,
      TODAY: scheduled.filter(record => matchesFollowUpBucket(record.followUpAt!, "TODAY", today)).length,
      UPCOMING: scheduled.filter(record => matchesFollowUpBucket(record.followUpAt!, "UPCOMING", today)).length,
      ALL: scheduled.length
    };
    const data = scheduled.filter(record => matchesFollowUpBucket(record.followUpAt!, bucket, today)).map(record => ({
      ...serializeApplicationTracking(record),
      followUpAt: record.followUpAt!.toISOString().slice(0, 10),
      job: record.job
    }));
    res.json({ data, count: data.length, counts, today });
  } catch (error) {
    res.status(500).json({ error: "Unable to retrieve follow-up reminders", detail: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.get("/api/applications", requireAuth, async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status.toUpperCase() : "";
  if (status && !APPLICATION_STATUSES.includes(status as ApplicationStatus)) {
    res.status(400).json({ error: "Unsupported application status filter." });
    return;
  }
  try {
    const records = await prisma.userApplicationTracking.findMany({
      where: { userId: res.locals.userId, ...(status ? { status } : {}) },
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

app.get("/api/jobs/:id/application-tracking", requireAuth, async (req, res) => {
  try {
    const job = await prisma.job.findUnique({ where: { id: String(req.params.id) }, select: { id: true } });
    if (!job) {
      res.status(404).json({ error: "Job listing not found" });
      return;
    }
    const record = await prisma.userApplicationTracking.findFirst({ where: { userId: res.locals.userId, jobId: job.id } });
    res.json({ data: record ? serializeApplicationTracking(record) : null });
  } catch (error) {
    res.status(500).json({ error: "Unable to retrieve application tracking details", detail: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.put("/api/jobs/:id/application-tracking", requireAuth, async (req, res) => {
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
    const job = await prisma.job.findUnique({ where: { id: String(req.params.id) }, select: { id: true } });
    if (!job) {
      res.status(404).json({ error: "Job listing not found" });
      return;
    }
    const record = await prisma.userApplicationTracking.upsert({
      where: { userId_jobId: { userId: res.locals.userId, jobId: job.id } },
      create: { userId: res.locals.userId, jobId: job.id, status: status as ApplicationStatus, notes: body.notes.trim(), appliedAt, followUpAt },
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
      const staleListingCount = sourceJobs.filter(job =>
        job.lastVerifiedAt !== null && now - job.lastVerifiedAt.getTime() > 7 * 24 * 60 * 60 * 1000 &&
        now - job.lastVerifiedAt.getTime() <= 30 * 24 * 60 * 60 * 1000
      ).length;
      const expiredListingCount = sourceJobs.filter(job =>
        job.lastVerifiedAt === null || now - job.lastVerifiedAt.getTime() > 30 * 24 * 60 * 60 * 1000
      ).length;
      return {
        ...source,
        health: {
          listingCount: sourceJobs.length,
          verifiedListingCount: verifiedDates.length,
          missingDescriptionCount: sourceJobs.filter(job => !job.description.trim()).length,
          staleListingCount,
          expiredListingCount,
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

app.post("/api/sources", requireAdmin, async (req, res) => {
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

app.post("/api/sources/:id/test", requireAdmin, async (req, res) => {
  try {
    const source = await prisma.jobSource.findUnique({ where: { id: String(req.params.id) } });
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

app.patch("/api/sources/:id", requireAdmin, async (req, res) => {
  if (typeof req.body?.enabled !== "boolean") {
    res.status(400).json({ error: "enabled must be a boolean" });
    return;
  }
  try {
    const source = await prisma.jobSource.update({
      where: { id: String(req.params.id) },
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

app.delete("/api/sources/:id", requireAdmin, async (req, res) => {
  try {
    await prisma.jobSource.delete({ where: { id: String(req.params.id) } });
    res.status(204).send();
  } catch (error) {
    res.status(404).json({
      error: "Unable to delete job source",
      detail: error instanceof Error ? error.message : "Source not found"
    });
  }
});

app.get("/api/sync-runs", async (req, res) => {
  const parsedLimit = Number(req.query.limit ?? 20);
  const limit = Number.isInteger(parsedLimit) ? Math.min(100, Math.max(1, parsedLimit)) : 20;
  const provider = typeof req.query.provider === "string" ? req.query.provider.trim().toUpperCase() : "";
  const boardId = typeof req.query.boardId === "string" ? req.query.boardId.trim() : "";
  if (provider && !SUPPORTED_PROVIDERS.includes(provider as typeof SUPPORTED_PROVIDERS[number])) {
    res.status(400).json({ error: "provider must be GREENHOUSE, LEVER or ASHBY" });
    return;
  }
  try {
    const data = await prisma.syncRun.findMany({
      where: { ...(provider ? { provider } : {}), ...(boardId ? { boardId } : {}) },
      orderBy: { startedAt: "desc" },
      take: limit
    });
    res.json({ data: data.map(run => ({
      ...run,
      errors: (() => { try { const parsed: unknown = JSON.parse(run.errorsJson); return Array.isArray(parsed) ? parsed : []; } catch { return []; } })()
    })) });
  } catch (error) {
    res.status(500).json({ error: "Unable to retrieve sync history", detail: error instanceof Error ? error.message : "Unknown database error" });
  }
});

app.post("/api/sources/:id/sync", requireAdmin, async (req, res) => {
  try {
    const source = await prisma.jobSource.findUnique({ where: { id: String(req.params.id) } });
    if (!source) {
      res.status(404).json({ error: "Job source not found" });
      return;
    }
    if (!source.enabled) {
      res.status(409).json({ error: "Enable this source before syncing it." });
      return;
    }
    const result = await syncSource(source.provider, source.boardId);
    res.json({ data: result, source: { id: source.id, provider: source.provider, boardId: source.boardId } });
  } catch (error) {
    res.status(500).json({
      error: "Unable to sync this job source",
      detail: error instanceof Error ? error.message : "Unknown synchronization error"
    });
  }
});

app.post("/api/jobs/sync", requireAdmin, async (_req, res) => {
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
