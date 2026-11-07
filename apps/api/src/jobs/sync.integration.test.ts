import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, randomBytes } from "node:crypto";


const { greenhouseFetch, leverFetch, ashbyFetch } = vi.hoisted(() => ({
  greenhouseFetch: vi.fn(),
  leverFetch: vi.fn(),
  ashbyFetch: vi.fn()
}));

vi.mock("./connectors/greenhouse.js", () => ({
  greenhouseConnector: { provider: "GREENHOUSE", fetchBoard: greenhouseFetch }
}));
vi.mock("./connectors/lever.js", () => ({
  leverConnector: { provider: "LEVER", fetchBoard: leverFetch }
}));
vi.mock("./connectors/ashby.js", () => ({
  ashbyConnector: { provider: "ASHBY", fetchBoard: ashbyFetch }
}));

import { prisma } from "../db.js";
import { app } from "../app.js";
import { syncJobs } from "./service.js";

const greenhouseJob = {
  id: "greenhouse-101",
  title: "Backend Engineer",
  company: "board-slug",
  location: "Remote",
  description: "Build reliable APIs",
  url: "https://jobs.example.test/backend?utm_source=greenhouse"
};

let testUserId = "";
let testCookie = "";

async function createTestAccount(): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const user = await prisma.user.create({ data: { email: `test-${randomBytes(6).toString("hex")}@example.test` } });
  await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000)
    }
  });
  testUserId = user.id;
  testCookie = `ai_job_session=${token}`;
}

async function authenticatedFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Cookie", testCookie);
  return fetch(input, { ...init, headers });
}

const leverJob = {
  id: "lever-202",
  title: "Backend Engineer",
  company: "lever-board",
  location: "Remote",
  description: "Build reliable APIs",
  url: "https://jobs.example.test/backend#apply"
};

describe("job sync SQLite integration", () => {
  beforeEach(async () => {
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
    await prisma.syncRun.deleteMany();
    await prisma.userSavedSearch.deleteMany();
    await prisma.savedSearch.deleteMany();
    await prisma.userSavedJob.deleteMany();
    await prisma.savedJob.deleteMany();
    await prisma.job.deleteMany();
    await prisma.jobSource.deleteMany();
    await prisma.candidateProfile.deleteMany();
    await prisma.userCandidateProfile.deleteMany();
    await prisma.userSavedJob.deleteMany();
    await prisma.userSavedSearch.deleteMany();
    await prisma.userApplicationDraft.deleteMany();
    await prisma.userApplicationTracking.deleteMany();
    await createTestAccount();

    greenhouseFetch.mockReset().mockResolvedValue([greenhouseJob]);
    leverFetch.mockReset().mockResolvedValue([]);
    ashbyFetch.mockReset().mockResolvedValue([]);
  });

  afterAll(async () => {
    await prisma.syncRun.deleteMany();
    await prisma.userSavedSearch.deleteMany();
    await prisma.savedSearch.deleteMany();
    await prisma.userSavedJob.deleteMany();
    await prisma.savedJob.deleteMany();
    await prisma.job.deleteMany();
    await prisma.jobSource.deleteMany();
    await prisma.candidateProfile.deleteMany();
    await prisma.$disconnect();
  });

  it("syncs only the requested enabled source board", async () => {
    await prisma.jobSource.createMany({ data: [
      { provider: "GREENHOUSE", boardId: "selected-board", displayName: "Selected" },
      { provider: "GREENHOUSE", boardId: "other-board", displayName: "Other" }
    ] });
    greenhouseFetch.mockImplementation(async (boardId: string) => [{
      ...greenhouseJob, id: `job-${boardId}`, url: `https://jobs.example.test/${boardId}`
    }]);
    const { syncSource } = await import("./service.js");
    const result = await syncSource("GREENHOUSE", "selected-board");
    expect(greenhouseFetch).toHaveBeenCalledTimes(1);
    expect(greenhouseFetch).toHaveBeenCalledWith("selected-board");
    expect(result).toMatchObject({ fetched: 1, inserted: 1, updated: 0, errors: [] });
    const stored = await prisma.job.findMany({ select: { sourceBoardId: true } });
    expect(stored.map(item => item.sourceBoardId)).toEqual(["selected-board"]);
  });

  it("records per-board sync outcomes and exposes diagnostic history", async () => {
    await prisma.jobSource.create({
      data: { provider: "GREENHOUSE", boardId: "history-board", displayName: "History Board" }
    });
    greenhouseFetch.mockRejectedValueOnce(new Error("provider unavailable"));
    const result = await syncJobs();
    expect(result.errors).toEqual(["GREENHOUSE/history-board: provider unavailable"]);

    const server = app.listen(0);
    try {
      await new Promise<void>(resolve => server.once("listening", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Test server did not bind to a TCP port");
      const response = await fetch(`http://127.0.0.1:${address.port}/api/sync-runs?limit=5&provider=GREENHOUSE&boardId=history-board`);
      const body = await response.json() as { data: Array<{ provider: string; boardId: string; status: string; fetched: number; errors: string[]; durationMs: number; completedAt: string }> };
      expect(response.status).toBe(200);
      expect(body.data).toHaveLength(1);
      expect(body.data[0]).toMatchObject({
        provider: "GREENHOUSE", boardId: "history-board", status: "FAILED", fetched: 0,
        errors: ["GREENHOUSE/history-board: provider unavailable"]
      });
      expect(body.data[0].durationMs).toBeGreaterThanOrEqual(0);
      expect(body.data[0].completedAt).toBeTruthy();
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });

  it("reports per-provider stored listing freshness without claiming live connectivity", async () => {
    await prisma.jobSource.create({
      data: { provider: "GREENHOUSE", boardId: "health-board", displayName: "Health Board" }
    });
    await prisma.job.create({
      data: {
        source: "GREENHOUSE", sourceBoardId: "health-board", externalId: "health-verified", title: "Verified Role",
        company: "Health Board", description: "A real description",
        applicationUrl: "https://jobs.example.test/verified",
        canonicalUrl: "https://jobs.example.test/verified",
        lastVerifiedAt: new Date()
      }
    });
    await prisma.job.create({
      data: {
        source: "GREENHOUSE", sourceBoardId: "health-board", externalId: "health-empty", title: "Missing Description",
        company: "Health Board", description: "",
        applicationUrl: "https://jobs.example.test/empty",
        canonicalUrl: "https://jobs.example.test/empty"
      }
    });

    const server = app.listen(0);
    try {
      await new Promise<void>(resolve => server.once("listening", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Test server did not bind to a TCP port");
      const response = await fetch(`http://127.0.0.1:${address.port}/api/sources`);
      const body = await response.json() as { data: Array<{ boardId: string; health: { listingCount: number; verifiedListingCount: number; missingDescriptionCount: number; freshness: string; lastVerifiedAt: string | null } }> };
      const source = body.data.find(item => item.boardId === "health-board");
      expect(response.status).toBe(200);
      expect(source?.health).toMatchObject({
        listingCount: 2,
        verifiedListingCount: 1,
        missingDescriptionCount: 1,
        freshness: "RECENTLY_VERIFIED"
      });
      expect(source?.health.lastVerifiedAt).toBeTruthy();
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });

  it("persists normalized public postings in SQLite with source attribution", async () => {
    const source = await prisma.jobSource.create({
      data: { provider: "GREENHOUSE", boardId: "acme", displayName: "Acme Inc" }
    });

    const result = await syncJobs();
    const stored = await prisma.job.findMany({ where: { source: "GREENHOUSE" } });

    expect(result).toMatchObject({ fetched: 1, inserted: 1, updated: 0, duplicatesSkipped: 0, errors: [] });
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      source: "GREENHOUSE",
      externalId: "greenhouse-101",
      company: "Acme Inc",
      title: "Backend Engineer",
      canonicalUrl: "https://jobs.example.test/backend"
    });
    expect(source.enabled).toBe(true);
  });

  it("marks a missing listing inactive only after a complete non-empty board snapshot", async () => {
    await prisma.jobSource.create({ data: { provider: "GREENHOUSE", boardId: "acme" } });
    greenhouseFetch.mockResolvedValueOnce([
      greenhouseJob,
      { ...greenhouseJob, id: "greenhouse-102", title: "Frontend Engineer", url: "https://jobs.example.test/frontend" }
    ]);
    await syncJobs();
    greenhouseFetch.mockResolvedValueOnce([greenhouseJob]);
    const result = await syncJobs();
    const stored = await prisma.job.findMany({ orderBy: { externalId: "asc" } });
    expect(result.deactivated).toBe(1);
    expect(stored.find(job => job.externalId === "greenhouse-101")?.status).toBe("ACTIVE");
    expect(stored.find(job => job.externalId === "greenhouse-102")?.status).toBe("INACTIVE");
  });

  it("does not deactivate listings when a board fetch returns an empty snapshot", async () => {
    await prisma.jobSource.create({ data: { provider: "GREENHOUSE", boardId: "acme" } });
    await syncJobs();
    greenhouseFetch.mockResolvedValueOnce([]);
    const result = await syncJobs();
    const stored = await prisma.job.findFirst({ where: { externalId: "greenhouse-101" } });
    expect(result.deactivated).toBe(0);
    expect(stored?.status).toBe("ACTIVE");
  });

  it("updates an existing provider posting on a subsequent sync", async () => {
    await prisma.jobSource.create({
      data: { provider: "GREENHOUSE", boardId: "acme", displayName: "Acme Inc" }
    });
    await syncJobs();

    greenhouseFetch.mockResolvedValueOnce([{
      ...greenhouseJob,
      title: "Senior Backend Engineer",
      description: "Updated role description"
    }]);

    const result = await syncJobs();
    const stored = await prisma.job.findMany({ where: { source: "GREENHOUSE" } });

    expect(result).toMatchObject({ fetched: 1, inserted: 0, updated: 1, duplicatesSkipped: 0, errors: [] });
    expect(stored).toHaveLength(1);
    expect(stored[0].title).toBe("Senior Backend Engineer");
    expect(stored[0].description).toBe("Updated role description");
  });

  it("skips a matching canonical URL across different providers", async () => {
    await prisma.jobSource.create({
      data: { provider: "GREENHOUSE", boardId: "acme", displayName: "Acme Inc" },
      select: { id: true }
    });
    await prisma.jobSource.create({
      data: { provider: "LEVER", boardId: "acme-lever", displayName: "Acme Inc" }
    });
    leverFetch.mockResolvedValue([leverJob]);

    const result = await syncJobs();
    const stored = await prisma.job.findMany();

    expect(result.fetched).toBe(2);
    expect(result.inserted).toBe(1);
    expect(result.duplicatesSkipped).toBe(1);
    expect(stored).toHaveLength(1);
  });

  it("continues importing from healthy sources when another source fails", async () => {
    await prisma.jobSource.create({
      data: { provider: "GREENHOUSE", boardId: "broken-board" }
    });
    await prisma.jobSource.create({
      data: { provider: "ASHBY", boardId: "healthy-board", displayName: "Healthy Co" }
    });
    greenhouseFetch.mockRejectedValue(new Error("temporary provider outage"));
    ashbyFetch.mockResolvedValue([{
      id: "ashby-303",
      title: "Platform Engineer",
      company: "healthy-board",
      url: "https://healthy.example.test/jobs/303"
    }]);

    const result = await syncJobs();
    const stored = await prisma.job.findMany();

    expect(result.inserted).toBe(1);
    expect(result.errors).toEqual(["GREENHOUSE/broken-board: temporary provider outage"]);
    expect(stored).toHaveLength(1);
    expect(stored[0].source).toBe("ASHBY");
  });

  it("serves explainable resume-to-job analysis from the stored candidate profile", async () => {
    await prisma.userCandidateProfile.create({
      data: {
        userId: testUserId,
        skillsJson: JSON.stringify(["Node.js", "PostgreSQL"]),
        preferredRoles: JSON.stringify(["BACKEND"]),
        locations: "[]",
        remotePreference: "REMOTE",
        educationJson: JSON.stringify(["B.Tech Computer Science"]),
        experienceJson: JSON.stringify(["Backend intern using Node.js"]),
        projectsJson: JSON.stringify(["Expense tracker built with PostgreSQL"]),
        certificationsJson: "[]"
      }
    });
    const job = await prisma.job.create({
      data: {
        source: "GREENHOUSE",
        externalId: "fit-analysis-1",
        title: "Backend Engineer",
        company: "Example Co",
        location: "Remote - India",
        description: "Required: Node.js. PostgreSQL experience preferred.",
        applicationUrl: "https://jobs.example.test/backend",
        canonicalUrl: "https://jobs.example.test/backend",
        category: "BACKEND",
        skillsJson: JSON.stringify(["node.js", "postgresql"])
      }
    });

    const server = app.listen(0);
    try {
      await new Promise<void>(resolve => server.once("listening", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Test server did not bind to a TCP port");
      const response = await authenticatedFetch(`http://127.0.0.1:${address.port}/api/jobs/${job.id}/analyze`);
      const body = await response.json() as { data?: { score: number; matchedSkills: string[]; evidence: Array<{ skill: string; sections: string[] }> } };
      expect(response.status).toBe(200);
      expect(body.data?.score).toBe(100);
      expect(body.data?.matchedSkills).toEqual(expect.arrayContaining(["Node.js", "PostgreSQL"]));
      expect(body.data?.evidence.find(item => item.skill === "Node.js")?.sections).toContain("Experience");
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });


  it("creates, edits and marks an application draft reviewed without submitting it", async () => {
    await prisma.userCandidateProfile.create({
      data: {
        userId: testUserId,
        skillsJson: JSON.stringify(["Node.js", "PostgreSQL"]),
        preferredRoles: JSON.stringify(["BACKEND"]),
        locations: "[]",
        remotePreference: "REMOTE",
        educationJson: JSON.stringify(["B.Tech Computer Science"]),
        experienceJson: JSON.stringify(["Built Node.js APIs"]),
        projectsJson: JSON.stringify(["Expense tracker using PostgreSQL"]),
        certificationsJson: "[]"
      }
    });
    const job = await prisma.job.create({
      data: {
        source: "GREENHOUSE",
        externalId: "application-draft-1",
        title: "Backend Engineer",
        company: "Example Co",
        location: "Remote",
        description: "Node.js and PostgreSQL",
        applicationUrl: "https://jobs.example.test/backend",
        canonicalUrl: "https://jobs.example.test/backend",
        category: "BACKEND",
        skillsJson: JSON.stringify(["node.js", "postgresql"])
      }
    });
    const server = app.listen(0);
    try {
      await new Promise<void>(resolve => server.once("listening", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Test server did not bind to a TCP port");
      const base = `http://127.0.0.1:${address.port}/api/jobs/${job.id}/application-draft`;
      const createdResponse = await authenticatedFetch(base, { method: "POST" });
      const created = await createdResponse.json() as { data?: { id: string; status: string; coverLetter: string }; error?: string };
      expect(createdResponse.status).toBe(201);
      expect(created.data?.status).toBe("DRAFT");
      expect(created.data?.coverLetter).toContain("Node.js");

      const duplicateResponse = await authenticatedFetch(base, { method: "POST" });
      expect(duplicateResponse.status).toBe(409);

      const updateResponse = await authenticatedFetch(base, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resumeSummary: "Edited summary with verified project details.",
          highlights: ["Built Node.js APIs"],
          coverLetter: "Edited cover letter for manual review."
        })
      });
      const updated = await updateResponse.json() as { data?: { status: string; coverLetter: string } };
      expect(updateResponse.status).toBe(200);
      expect(updated.data).toMatchObject({ status: "DRAFT", coverLetter: "Edited cover letter for manual review." });

      const reviewResponse = await authenticatedFetch(base + "/review", { method: "POST" });
      const reviewed = await reviewResponse.json() as { data?: { status: string; reviewedAt: string | null }; message?: string };
      expect(reviewResponse.status).toBe(200);
      expect(reviewed.data?.status).toBe("REVIEWED");
      expect(reviewed.data?.reviewedAt).toBeTruthy();
      expect(reviewed.message).toMatch(/No application was submitted/);
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });


  it("persists application progress, notes and follow-up dates in the tracker", async () => {
    const job = await prisma.job.create({
      data: {
        source: "GREENHOUSE",
        externalId: "tracking-1",
        title: "Software Engineer",
        company: "Example Co",
        location: "Remote",
        description: "Build software",
        applicationUrl: "https://jobs.example.test/software",
        canonicalUrl: "https://jobs.example.test/software"
      }
    });
    const server = app.listen(0);
    try {
      await new Promise<void>(resolve => server.once("listening", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Test server did not bind to a TCP port");
      const base = "http://127.0.0.1:" + address.port;
      const endpoint = base + "/api/jobs/" + job.id + "/application-tracking";
      const saveResponse = await authenticatedFetch(endpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "INTERVIEW",
          notes: "Technical round scheduled; revise system design.",
          appliedAt: "2026-11-01",
          followUpAt: "2026-11-08"
        })
      });
      const saved = await saveResponse.json() as { data?: { status: string; notes: string; appliedAt: string | null; followUpAt: string | null } };
      expect(saveResponse.status).toBe(200);
      expect(saved.data).toMatchObject({
        status: "INTERVIEW",
        notes: "Technical round scheduled; revise system design.",
        appliedAt: "2026-11-01",
        followUpAt: "2026-11-08"
      });

      const listResponse = await authenticatedFetch(base + "/api/applications?status=INTERVIEW");
      const list = await listResponse.json() as { data?: Array<{ jobId: string; job: { title: string } }>; count: number };
      expect(listResponse.status).toBe(200);
      expect(list.count).toBe(1);
      expect(list.data?.[0]).toMatchObject({ jobId: job.id, job: { title: "Software Engineer" } });

      const invalidResponse = await authenticatedFetch(endpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "SUBMITTED", notes: "", appliedAt: "not-a-date", followUpAt: "" })
      });
      expect(invalidResponse.status).toBe(400);
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });


  it("saves, lists and removes shortlisted jobs idempotently", async () => {
    const job = await prisma.job.create({
      data: {
        source: "GREENHOUSE",
        externalId: "saved-job-1",
        title: "Platform Engineer",
        company: "Example Co",
        location: "Remote",
        description: "Build and operate backend systems",
        applicationUrl: "https://jobs.example.test/platform",
        canonicalUrl: "https://jobs.example.test/platform",
        category: "BACKEND",
        skillsJson: JSON.stringify(["node.js", "postgresql"])
      }
    });
    const server = app.listen(0);
    try {
      await new Promise<void>(resolve => server.once("listening", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Test server did not bind to a TCP port");
      const base = "http://127.0.0.1:" + address.port;
      const jobEndpoint = base + "/api/jobs/" + job.id + "/save";

      const initialJobsResponse = await authenticatedFetch(base + "/api/jobs");
      const initialJobs = await initialJobsResponse.json() as { data: Array<{ id: string; isSaved: boolean }> };
      expect(initialJobs.data.find(item => item.id === job.id)?.isSaved).toBe(false);

      const saveResponse = await authenticatedFetch(jobEndpoint, { method: "POST" });
      const saved = await saveResponse.json() as { data?: { jobId: string; isSaved: boolean } };
      expect(saveResponse.status).toBe(201);
      expect(saved.data).toMatchObject({ jobId: job.id, isSaved: true });

      const repeatedSave = await authenticatedFetch(jobEndpoint, { method: "POST" });
      expect(repeatedSave.status).toBe(201);
      expect(await prisma.userSavedJob.count({ where: { jobId: job.id, userId: testUserId } })).toBe(1);

      const savedJobsResponse = await authenticatedFetch(base + "/api/saved-jobs");
      const savedJobs = await savedJobsResponse.json() as { data?: Array<{ id: string; title: string }>; count: number };
      expect(savedJobsResponse.status).toBe(200);
      expect(savedJobs.count).toBe(1);
      expect(savedJobs.data?.[0]).toMatchObject({ id: job.id, title: "Platform Engineer" });

      const removeResponse = await authenticatedFetch(jobEndpoint, { method: "DELETE" });
      expect(removeResponse.status).toBe(200);
      expect(await prisma.userSavedJob.count({ where: { jobId: job.id, userId: testUserId } })).toBe(0);
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });


  it("combines advanced filters and sorts matching jobs", async () => {
    const remoteJob = await prisma.job.create({
      data: {
        source: "GREENHOUSE",
        externalId: "advanced-search-remote",
        title: "Backend Engineer",
        company: "Acme Systems",
        location: "Remote - India",
        description: "Build APIs with Node.js and PostgreSQL.",
        employmentType: "FULL_TIME",
        applicationUrl: "https://jobs.example.test/remote",
        canonicalUrl: "https://jobs.example.test/remote",
        publishedAt: new Date("2026-10-30T10:00:00Z"),
        skillsJson: JSON.stringify(["Node.js", "PostgreSQL"])
      }
    });
    await prisma.job.create({
      data: {
        source: "LEVER",
        externalId: "advanced-search-onsite",
        title: "Backend Intern",
        company: "Acme Systems",
        location: "Bengaluru",
        description: "On-site internship using Node.js.",
        employmentType: "INTERNSHIP",
        applicationUrl: "https://jobs.example.test/onsite",
        canonicalUrl: "https://jobs.example.test/onsite",
        publishedAt: new Date("2026-11-01T10:00:00Z"),
        skillsJson: JSON.stringify(["Node.js"])
      }
    });
    const server = app.listen(0);
    try {
      await new Promise<void>(resolve => server.once("listening", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Test server did not bind to a TCP port");
      const base = "http://127.0.0.1:" + address.port;
      const response = await authenticatedFetch(base + "/api/jobs?company=Acme&employmentType=FULL_TIME&workMode=REMOTE&skills=node.js,postgres&sort=NEWEST");
      const body = await response.json() as { data: Array<{ id: string; workMode: string }>; total: number };
      expect(response.status).toBe(200);
      expect(body.total).toBe(1);
      expect(body.data).toHaveLength(1);
      expect(body.data[0]).toMatchObject({ id: remoteJob.id, workMode: "REMOTE" });

      const invalidResponse = await authenticatedFetch(base + "/api/jobs?workMode=SPACE");
      expect(invalidResponse.status).toBe(400);
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });


  it("paginates filtered and sorted job results without repeating records", async () => {
    const paginationJobs = [];
    for (let index = 0; index < 5; index++) {
      paginationJobs.push(await prisma.job.create({ data: {
        source: "GREENHOUSE",
        externalId: `pagination-job-${index}`,
        title: `Pagination Role ${index}`,
        company: "Pagination Co",
        location: "Remote - India",
        description: "Backend work with Node.js",
        employmentType: "FULL_TIME",
        skillsJson: JSON.stringify(["Node.js"]),
        applicationUrl: `https://jobs.example.test/pagination-${index}`,
        canonicalUrl: `https://jobs.example.test/pagination-${index}`,
        publishedAt: new Date(Date.UTC(2026, 0, 1, 0, index))
      } }));
    }
    await prisma.userSavedJob.create({ data: { userId: testUserId, jobId: paginationJobs[2].id } });

    const server = app.listen(0);
    try {
      await new Promise<void>(resolve => server.once("listening", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Test server did not bind to a TCP port");
      const base = `http://127.0.0.1:${address.port}/api/jobs`;
      const filters = { q: "pagination", company: "Pagination", source: "GREENHOUSE", employmentType: "FULL_TIME", workMode: "REMOTE", skills: "node.js", sort: "NEWEST", limit: "2" };
      const fetchPage = async (offset: number) => {
        const params = new URLSearchParams({ ...filters, offset: String(offset) });
        const response = await authenticatedFetch(`${base}?${params}`);
        return { response, body: await response.json() as { data: Array<{ id: string; isSaved: boolean }>; total: number; offset: number; nextOffset: number; hasMore: boolean } };
      };

      const first = await fetchPage(0);
      expect(first.response.status).toBe(200);
      expect(first.body).toMatchObject({ total: 5, offset: 0, nextOffset: 2, hasMore: true });
      expect(first.body.data.map(job => job.id)).toEqual([paginationJobs[4].id, paginationJobs[3].id]);

      const second = await fetchPage(first.body.nextOffset);
      expect(second.response.status).toBe(200);
      expect(second.body).toMatchObject({ total: 5, offset: 2, nextOffset: 4, hasMore: true });
      expect(second.body.data.map(job => job.id)).toEqual([paginationJobs[2].id, paginationJobs[1].id]);
      expect(second.body.data[0].isSaved).toBe(true);

      const third = await fetchPage(second.body.nextOffset);
      expect(third.body).toMatchObject({ total: 5, offset: 4, nextOffset: 5, hasMore: false });
      expect(third.body.data.map(job => job.id)).toEqual([paginationJobs[0].id]);
      const allIds = [...first.body.data, ...second.body.data, ...third.body.data].map(job => job.id);
      expect(new Set(allIds).size).toBe(allIds.length);

      const invalidOffset = await authenticatedFetch(`${base}?offset=-1`);
      expect(invalidOffset.status).toBe(400);
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });


  it("matches query words separately, explains text relevance and combines it with profile fit", async () => {
    await prisma.userCandidateProfile.create({
      data: {
        userId: testUserId,
        skillsJson: JSON.stringify(["Node.js", "PostgreSQL", "Docker"]),
        preferredRoles: JSON.stringify(["BACKEND"]),
        remotePreference: "REMOTE"
      }
    });
    const exactTitle = await prisma.job.create({ data: {
      source: "GREENHOUSE", externalId: "relevance-exact-title", title: "Backend Engineer", company: "Exact Title Co",
      location: "Remote", description: "Build APIs", category: "BACKEND", skillsJson: JSON.stringify(["Node.js", "PostgreSQL"]),
      applicationUrl: "https://jobs.example.test/relevance-title", canonicalUrl: "https://jobs.example.test/relevance-title"
    } });
    const reorderedTitle = await prisma.job.create({ data: {
      source: "LEVER", externalId: "relevance-reordered-title", title: "Engineer for Backend Systems", company: "Different Co",
      location: "Remote", description: "Build services", category: "OTHER", skillsJson: "[]",
      applicationUrl: "https://jobs.example.test/relevance-reordered", canonicalUrl: "https://jobs.example.test/relevance-reordered"
    } });
    const companyMatch = await prisma.job.create({ data: {
      source: "ASHBY", externalId: "relevance-company", title: "Product Designer", company: "Backend Engineer Labs",
      location: "Remote", description: "Design useful products", category: "OTHER", skillsJson: "[]",
      applicationUrl: "https://jobs.example.test/relevance-company", canonicalUrl: "https://jobs.example.test/relevance-company"
    } });
    const descriptionMatch = await prisma.job.create({ data: {
      source: "GREENHOUSE", externalId: "relevance-description", title: "Product Manager", company: "Another Co",
      location: "Remote", description: "Experience with backend engineering systems", category: "OTHER", skillsJson: "[]",
      applicationUrl: "https://jobs.example.test/relevance-description", canonicalUrl: "https://jobs.example.test/relevance-description"
    } });

    const server = app.listen(0);
    try {
      await new Promise<void>(resolve => server.once("listening", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Test server did not bind to a TCP port");
      const params = new URLSearchParams({ q: "BACKEND, Engineer!", sort: "RELEVANCE" });
      const response = await authenticatedFetch(`http://127.0.0.1:${address.port}/api/jobs?${params}`);
      const body = await response.json() as { data: Array<{ id: string; match: { score: number | null }; searchRelevance: { score: number; reasons: string[] } }>; total: number };

      expect(response.status).toBe(200);
      expect(body.total).toBe(4);
      expect(body.data.map(job => job.id)).toEqual([exactTitle.id, reorderedTitle.id, companyMatch.id, descriptionMatch.id]);
      expect(body.data[0].match.score).toBe(77);
      expect(body.data[0].searchRelevance.score).toBe(100);
      expect(body.data[0].searchRelevance.reasons).toContain("All search words appear together in the title.");
      expect(body.data[2].searchRelevance.score).toBeGreaterThan(body.data[3].searchRelevance.score);
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });


  it("saves a search and reports only newly discovered matching jobs once", async () => {
    const server = app.listen(0);
    try {
      await new Promise<void>(resolve => server.once("listening", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Test server did not bind to a TCP port");
      const base = "http://127.0.0.1:" + address.port;
      const createResponse = await authenticatedFetch(base + "/api/saved-searches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Remote backend roles",
          filters: { query: "BACKEND, engineer!", location: "India", company: "", source: "GREENHOUSE", employmentType: "FULL_TIME", workMode: "REMOTE", skills: ["Node.js"] }
        })
      });
      const created = await createResponse.json() as { data?: { id: string; name: string }; error?: string };
      expect(createResponse.status).toBe(201);
      expect(created.data?.name).toBe("Remote backend roles");
      const searchId = created.data!.id;
      await prisma.userSavedSearch.updateMany({
        where: { id: searchId, userId: testUserId },
        data: { lastCheckedAt: new Date(Date.now() - 10_000) }
      });

      const matchingJob = await prisma.job.create({
        data: {
          source: "GREENHOUSE",
          externalId: "saved-search-alert-match",
          title: "Backend Engineer",
          company: "Example Systems",
          location: "Remote - India",
          description: "Backend APIs using Node.js",
          employmentType: "FULL_TIME",
          applicationUrl: "https://jobs.example.test/alert-match",
          canonicalUrl: "https://jobs.example.test/alert-match",
          skillsJson: JSON.stringify(["Node.js"])
        }
      });
      const reorderedMatchingJob = await prisma.job.create({
        data: {
          source: "GREENHOUSE",
          externalId: "saved-search-alert-reordered-match",
          title: "Engineer for Backend Systems",
          company: "Example Systems",
          location: "Remote - India",
          description: "Backend APIs using Node.js",
          employmentType: "FULL_TIME",
          applicationUrl: "https://jobs.example.test/alert-reordered-match",
          canonicalUrl: "https://jobs.example.test/alert-reordered-match",
          skillsJson: JSON.stringify(["Node.js"])
        }
      });
      await prisma.job.create({
        data: {
          source: "LEVER",
          externalId: "saved-search-alert-nonmatch",
          title: "Backend Engineer",
          company: "Example Systems",
          location: "Remote - India",
          description: "Backend APIs using Node.js",
          employmentType: "FULL_TIME",
          applicationUrl: "https://jobs.example.test/alert-nonmatch",
          canonicalUrl: "https://jobs.example.test/alert-nonmatch",
          skillsJson: JSON.stringify(["Node.js"])
        }
      });

      const alertUrl = base + "/api/saved-searches/" + searchId + "/alerts";
      const alertResponse = await authenticatedFetch(alertUrl);
      const alertBody = await alertResponse.json() as { data: Array<{ id: string }>; count: number };
      expect(alertResponse.status).toBe(200);
      expect(alertBody.count).toBe(2);
      expect(alertBody.data.map(job => job.id)).toEqual(expect.arrayContaining([matchingJob.id, reorderedMatchingJob.id]));

      const repeatedCheck = await authenticatedFetch(alertUrl);
      const repeatedBody = await repeatedCheck.json() as { data: unknown[]; count: number };
      expect(repeatedBody.count).toBe(0);

      const listResponse = await authenticatedFetch(base + "/api/saved-searches");
      const listBody = await listResponse.json() as { data: Array<{ id: string; filters: { workMode: string } }> };
      expect(listBody.data).toHaveLength(1);
      expect(listBody.data[0]).toMatchObject({ id: searchId, filters: { workMode: "REMOTE" } });

      const deleteResponse = await authenticatedFetch(base + "/api/saved-searches/" + searchId, { method: "DELETE" });
      expect(deleteResponse.status).toBe(200);
      const missingResponse = await authenticatedFetch(alertUrl);
      expect(missingResponse.status).toBe(404);
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });


  it("returns full job description and verification metadata for the detail viewer", async () => {
    const verifiedAt = new Date("2026-11-02T09:30:00.000Z");
    const job = await prisma.job.create({
      data: {
        source: "GREENHOUSE",
        externalId: "job-details-viewer-001",
        title: "Backend Engineer",
        company: "Example Systems",
        location: "Remote - India",
        description: "<p>Build reliable APIs.</p><ul><li>Node.js</li><li>PostgreSQL</li></ul>",
        employmentType: "FULL_TIME",
        applicationUrl: "https://jobs.example.test/details",
        canonicalUrl: "https://jobs.example.test/details",
        publishedAt: new Date("2026-11-01T08:00:00.000Z"),
        lastVerifiedAt: verifiedAt,
        status: "ACTIVE",
        skillsJson: JSON.stringify(["Node.js", "PostgreSQL"])
      }
    });
    const server = app.listen(0);
    try {
      await new Promise<void>(resolve => server.once("listening", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Test server did not bind to a TCP port");
      const response = await authenticatedFetch("http://127.0.0.1:" + address.port + "/api/jobs?limit=10");
      const body = await response.json() as { data: Array<{ id: string; description: string; employmentType: string; lastVerifiedAt: string | null; discoveredAt: string }> };
      expect(response.status).toBe(200);
      const result = body.data.find(item => item.id === job.id);
      expect(result).toMatchObject({
        id: job.id,
        description: "<p>Build reliable APIs.</p><ul><li>Node.js</li><li>PostgreSQL</li></ul>",
        employmentType: "FULL_TIME",
        lastVerifiedAt: verifiedAt.toISOString()
      });
      expect(result?.discoveredAt).toBeTruthy();
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });


  it("derives revalidation age without treating old timestamps as proof a job closed", async () => {
    const now = Date.now();
    const jobs = [
      { externalId: "fresh-age", lastVerifiedAt: new Date(now - 2 * 24 * 60 * 60 * 1000) },
      { externalId: "stale-age", lastVerifiedAt: new Date(now - 10 * 24 * 60 * 60 * 1000) },
      { externalId: "expired-age", lastVerifiedAt: new Date(now - 45 * 24 * 60 * 60 * 1000) },
      { externalId: "unverified-age", lastVerifiedAt: null }
    ];
    for (const item of jobs) {
      await prisma.job.create({ data: {
        source: "GREENHOUSE", externalId: item.externalId, title: "Engineer", company: "Example",
        description: "Build software", applicationUrl: `https://jobs.example.test/${item.externalId}`,
        canonicalUrl: `https://jobs.example.test/${item.externalId}`, lastVerifiedAt: item.lastVerifiedAt, status: "ACTIVE"
      } });
    }
    const server = app.listen(0);
    try {
      await new Promise<void>(resolve => server.once("listening", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Test server did not bind to a TCP port");
      const response = await fetch(`http://127.0.0.1:${address.port}/api/jobs?listingStatus=ALL`);
      const body = await response.json() as { data: Array<{ externalId: string; revalidationState: string; status: string }> };
      expect(response.status).toBe(200);
      const states = Object.fromEntries(body.data.map(job => [job.externalId, job]));
      expect(states["fresh-age"].revalidationState).toBe("FRESH");
      expect(states["stale-age"].revalidationState).toBe("STALE");
      expect(states["expired-age"].revalidationState).toBe("EXPIRED");
      expect(states["unverified-age"].revalidationState).toBe("UNVERIFIED");
      expect(states["expired-age"].status).toBe("ACTIVE");
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });


  it("does not refresh verification timestamps after a partial board snapshot", async () => {
    await prisma.jobSource.create({ data: { provider: "GREENHOUSE", boardId: "partial-board" } });
    greenhouseFetch.mockResolvedValueOnce([greenhouseJob]);
    await syncJobs();
    const before = await prisma.job.findFirst({ where: { externalId: greenhouseJob.id } });
    expect(before?.lastVerifiedAt).toBeTruthy();

    await new Promise(resolve => setTimeout(resolve, 5));
    greenhouseFetch.mockResolvedValueOnce([
      greenhouseJob,
      { ...greenhouseJob, id: "invalid-job", company: undefined as unknown as string, url: "https://jobs.example.test/invalid" }
    ]);
    const result = await syncJobs();
    const after = await prisma.job.findFirst({ where: { externalId: greenhouseJob.id } });

    expect(result.errors).toHaveLength(1);
    expect(after?.lastVerifiedAt?.getTime()).toBe(before?.lastVerifiedAt?.getTime());
  });


  it("keeps saved jobs, drafts, tracking and candidate profiles isolated between accounts", async () => {
    const job = await prisma.job.create({
      data: {
        source: "GREENHOUSE",
        externalId: "account-isolation-1",
        title: "Private workflow test",
        company: "Example Co",
        location: "Remote",
        description: "Build secure APIs",
        applicationUrl: "https://jobs.example.test/isolation",
        canonicalUrl: "https://jobs.example.test/isolation"
      }
    });
    await prisma.userCandidateProfile.create({
      data: {
        userId: testUserId,
        skillsJson: JSON.stringify(["PrivateSkill"]),
        experienceJson: JSON.stringify(["Confidential experience"])
      }
    });
    await prisma.userSavedJob.create({ data: { userId: testUserId, jobId: job.id } });
    await prisma.userApplicationDraft.create({
      data: {
        userId: testUserId, jobId: job.id,
        resumeSummary: "First account private summary",
        coverLetter: "First account private cover letter"
      }
    });
    await prisma.userApplicationTracking.create({
      data: { userId: testUserId, jobId: job.id, status: "APPLIED", notes: "Private application notes" }
    });

    const secondUser = await prisma.user.create({
      data: { email: `second-${Date.now()}-${Math.random()}@example.test` }
    });
    const secondToken = randomBytes(32).toString("base64url");
    await prisma.session.create({
      data: {
        userId: secondUser.id,
        tokenHash: createHash("sha256").update(secondToken).digest("hex"),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000)
      }
    });
    const secondCookie = `ai_job_session=${secondToken}`;
    const secondFetch = (url: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      headers.set("Cookie", secondCookie);
      return fetch(url, { ...init, headers });
    };

    const server = app.listen(0);
    try {
      await new Promise<void>(resolve => server.once("listening", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Test server did not bind to a TCP port");
      const base = `http://127.0.0.1:${address.port}`;

      const savedJobsResponse = await secondFetch(base + "/api/saved-jobs");
      const savedJobs = await savedJobsResponse.json() as { data: unknown[]; count: number };
      expect(savedJobsResponse.status).toBe(200);
      expect(savedJobs.count).toBe(0);

      const draftResponse = await secondFetch(base + `/api/jobs/${job.id}/application-draft`);
      const draft = await draftResponse.json() as { data: unknown };
      expect(draftResponse.status).toBe(200);
      expect(draft.data).toBeNull();

      const trackingResponse = await secondFetch(base + `/api/jobs/${job.id}/application-tracking`);
      const tracking = await trackingResponse.json() as { data: unknown };
      expect(trackingResponse.status).toBe(200);
      expect(tracking.data).toBeNull();

      const applicationsResponse = await secondFetch(base + "/api/applications");
      const applications = await applicationsResponse.json() as { data: unknown[]; count: number };
      expect(applicationsResponse.status).toBe(200);
      expect(applications.count).toBe(0);

      const forbiddenEdit = await secondFetch(base + `/api/jobs/${job.id}/application-draft`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resumeSummary: "Attempted cross-account edit",
          highlights: ["Not allowed"],
          coverLetter: "Should not overwrite another user's draft"
        })
      });
      expect(forbiddenEdit.status).toBe(404);

      const originalDraft = await prisma.userApplicationDraft.findUnique({
        where: { userId_jobId: { userId: testUserId, jobId: job.id } }
      });
      expect(originalDraft?.resumeSummary).toBe("First account private summary");
      expect(originalDraft?.coverLetter).toBe("First account private cover letter");
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });

});
