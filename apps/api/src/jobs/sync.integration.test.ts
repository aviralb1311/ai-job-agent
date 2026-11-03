import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

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
    await prisma.savedSearch.deleteMany();
    await prisma.savedJob.deleteMany();
    await prisma.job.deleteMany();
    await prisma.jobSource.deleteMany();
    await prisma.candidateProfile.deleteMany();

    greenhouseFetch.mockReset().mockResolvedValue([greenhouseJob]);
    leverFetch.mockReset().mockResolvedValue([]);
    ashbyFetch.mockReset().mockResolvedValue([]);
  });

  afterAll(async () => {
    await prisma.savedSearch.deleteMany();
    await prisma.savedJob.deleteMany();
    await prisma.job.deleteMany();
    await prisma.jobSource.deleteMany();
    await prisma.candidateProfile.deleteMany();
    await prisma.$disconnect();
  });

  it("reports per-provider stored listing freshness without claiming live connectivity", async () => {
    await prisma.jobSource.create({
      data: { provider: "GREENHOUSE", boardId: "health-board", displayName: "Health Board" }
    });
    await prisma.job.create({
      data: {
        source: "GREENHOUSE", externalId: "health-verified", title: "Verified Role",
        company: "Health Board", description: "A real description",
        applicationUrl: "https://jobs.example.test/verified",
        canonicalUrl: "https://jobs.example.test/verified",
        lastVerifiedAt: new Date()
      }
    });
    await prisma.job.create({
      data: {
        source: "GREENHOUSE", externalId: "health-empty", title: "Missing Description",
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
    await prisma.candidateProfile.create({
      data: {
        id: "default",
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
      const response = await fetch(`http://127.0.0.1:${address.port}/api/jobs/${job.id}/analyze`);
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
    await prisma.candidateProfile.create({
      data: {
        id: "default",
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
      const createdResponse = await fetch(base, { method: "POST" });
      const created = await createdResponse.json() as { data?: { id: string; status: string; coverLetter: string }; error?: string };
      expect(createdResponse.status).toBe(201);
      expect(created.data?.status).toBe("DRAFT");
      expect(created.data?.coverLetter).toContain("Node.js");

      const duplicateResponse = await fetch(base, { method: "POST" });
      expect(duplicateResponse.status).toBe(409);

      const updateResponse = await fetch(base, {
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

      const reviewResponse = await fetch(base + "/review", { method: "POST" });
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
      const saveResponse = await fetch(endpoint, {
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

      const listResponse = await fetch(base + "/api/applications?status=INTERVIEW");
      const list = await listResponse.json() as { data?: Array<{ jobId: string; job: { title: string } }>; count: number };
      expect(listResponse.status).toBe(200);
      expect(list.count).toBe(1);
      expect(list.data?.[0]).toMatchObject({ jobId: job.id, job: { title: "Software Engineer" } });

      const invalidResponse = await fetch(endpoint, {
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

      const initialJobsResponse = await fetch(base + "/api/jobs");
      const initialJobs = await initialJobsResponse.json() as { data: Array<{ id: string; isSaved: boolean }> };
      expect(initialJobs.data.find(item => item.id === job.id)?.isSaved).toBe(false);

      const saveResponse = await fetch(jobEndpoint, { method: "POST" });
      const saved = await saveResponse.json() as { data?: { jobId: string; isSaved: boolean } };
      expect(saveResponse.status).toBe(201);
      expect(saved.data).toMatchObject({ jobId: job.id, isSaved: true });

      const repeatedSave = await fetch(jobEndpoint, { method: "POST" });
      expect(repeatedSave.status).toBe(201);
      expect(await prisma.savedJob.count({ where: { jobId: job.id, userId: "local" } })).toBe(1);

      const savedJobsResponse = await fetch(base + "/api/saved-jobs");
      const savedJobs = await savedJobsResponse.json() as { data?: Array<{ id: string; title: string }>; count: number };
      expect(savedJobsResponse.status).toBe(200);
      expect(savedJobs.count).toBe(1);
      expect(savedJobs.data?.[0]).toMatchObject({ id: job.id, title: "Platform Engineer" });

      const removeResponse = await fetch(jobEndpoint, { method: "DELETE" });
      expect(removeResponse.status).toBe(200);
      expect(await prisma.savedJob.count({ where: { jobId: job.id, userId: "local" } })).toBe(0);
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
      const response = await fetch(base + "/api/jobs?company=Acme&employmentType=FULL_TIME&workMode=REMOTE&skills=node.js,postgres&sort=NEWEST");
      const body = await response.json() as { data: Array<{ id: string; workMode: string }>; total: number };
      expect(response.status).toBe(200);
      expect(body.total).toBe(1);
      expect(body.data).toHaveLength(1);
      expect(body.data[0]).toMatchObject({ id: remoteJob.id, workMode: "REMOTE" });

      const invalidResponse = await fetch(base + "/api/jobs?workMode=SPACE");
      expect(invalidResponse.status).toBe(400);
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
      const createResponse = await fetch(base + "/api/saved-searches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Remote backend roles",
          filters: { query: "backend", location: "India", company: "", source: "GREENHOUSE", employmentType: "FULL_TIME", workMode: "REMOTE", skills: ["Node.js"] }
        })
      });
      const created = await createResponse.json() as { data?: { id: string; name: string }; error?: string };
      expect(createResponse.status).toBe(201);
      expect(created.data?.name).toBe("Remote backend roles");
      const searchId = created.data!.id;
      await prisma.savedSearch.update({
        where: { id: searchId },
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
      const alertResponse = await fetch(alertUrl);
      const alertBody = await alertResponse.json() as { data: Array<{ id: string }>; count: number };
      expect(alertResponse.status).toBe(200);
      expect(alertBody.count).toBe(1);
      expect(alertBody.data[0].id).toBe(matchingJob.id);

      const repeatedCheck = await fetch(alertUrl);
      const repeatedBody = await repeatedCheck.json() as { data: unknown[]; count: number };
      expect(repeatedBody.count).toBe(0);

      const listResponse = await fetch(base + "/api/saved-searches");
      const listBody = await listResponse.json() as { data: Array<{ id: string; filters: { workMode: string } }> };
      expect(listBody.data).toHaveLength(1);
      expect(listBody.data[0]).toMatchObject({ id: searchId, filters: { workMode: "REMOTE" } });

      const deleteResponse = await fetch(base + "/api/saved-searches/" + searchId, { method: "DELETE" });
      expect(deleteResponse.status).toBe(200);
      const missingResponse = await fetch(alertUrl);
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
      const response = await fetch("http://127.0.0.1:" + address.port + "/api/jobs?limit=10");
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

});
