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
    await prisma.savedJob.deleteMany();
    await prisma.job.deleteMany();
    await prisma.jobSource.deleteMany();

    greenhouseFetch.mockReset().mockResolvedValue([greenhouseJob]);
    leverFetch.mockReset().mockResolvedValue([]);
    ashbyFetch.mockReset().mockResolvedValue([]);
  });

  afterAll(async () => {
    await prisma.savedJob.deleteMany();
    await prisma.job.deleteMany();
    await prisma.jobSource.deleteMany();
    await prisma.$disconnect();
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
});
