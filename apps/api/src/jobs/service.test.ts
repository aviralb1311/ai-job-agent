import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { jobSourceFindMany, jobFindUnique, jobFindFirst, jobUpsert, jobUpdateMany, syncRunCreate, greenhouseFetch, leverFetch, ashbyFetch } = vi.hoisted(() => ({
  jobSourceFindMany: vi.fn(),
  jobFindUnique: vi.fn(),
  jobFindFirst: vi.fn(),
  jobUpsert: vi.fn(),
  jobUpdateMany: vi.fn(),
  syncRunCreate: vi.fn(),
  greenhouseFetch: vi.fn(),
  leverFetch: vi.fn(),
  ashbyFetch: vi.fn()
}));

vi.mock("../db.js", () => ({
  prisma: {
    jobSource: { findMany: jobSourceFindMany },
    job: { findUnique: jobFindUnique, findFirst: jobFindFirst, upsert: jobUpsert, updateMany: jobUpdateMany },
    syncRun: { create: syncRunCreate }
  }
}));
vi.mock("../config.js", () => ({
  config: { GREENHOUSE_BOARDS: "legacy", LEVER_SITES: "", ASHBY_BOARDS: "" },
  list: (value: string) => value.split(",").map(item => item.trim()).filter(Boolean)
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

import { previewSource, syncJobs } from "./service.js";

const job = {
  id: "gh-1",
  title: "Backend Engineer",
  company: "Board slug",
  location: "Remote",
  description: "Build APIs",
  url: "https://example.com/jobs/1?utm_source=greenhouse"
};

describe("database-managed job sources and sync persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    jobSourceFindMany.mockResolvedValue([
      { id: "source-1", provider: "GREENHOUSE", boardId: "acme", displayName: "Acme Inc", enabled: true }
    ]);
    greenhouseFetch.mockResolvedValue([job]);
    leverFetch.mockResolvedValue([]);
    ashbyFetch.mockResolvedValue([]);
    jobFindUnique.mockResolvedValue(null);
    jobFindFirst.mockResolvedValue(null);
    jobUpsert.mockResolvedValue({ id: "db-1" });
    jobUpdateMany.mockResolvedValue({ count: 0 });
    syncRunCreate.mockResolvedValue({ id: "sync-run-1" });
  });

  afterEach(() => vi.clearAllMocks());

  it("uses enabled database sources and persists the display name", async () => {
    const result = await syncJobs();
    expect(greenhouseFetch).toHaveBeenCalledWith("acme");
    expect(jobUpsert.mock.calls[0][0].create.company).toBe("Acme Inc");
    expect(result).toMatchObject({ fetched: 1, inserted: 1, updated: 0, duplicatesSkipped: 0, errors: [] });
  });

  it("uses legacy environment board IDs only when no database sources exist", async () => {
    jobSourceFindMany.mockResolvedValue([]);
    const result = await syncJobs();
    expect(greenhouseFetch).toHaveBeenCalledWith("legacy");
    expect(result.fetched).toBe(1);
  });

  it("does not sync disabled sources when the source registry is populated", async () => {
    jobSourceFindMany.mockResolvedValue([
      { id: "source-1", provider: "GREENHOUSE", boardId: "disabled", displayName: null, enabled: false }
    ]);
    const result = await syncJobs();
    expect(greenhouseFetch).not.toHaveBeenCalled();
    expect(result.fetched).toBe(0);
  });

  it("inserts a new source job using an idempotent upsert", async () => {
    const result = await syncJobs();
    expect(jobUpsert).toHaveBeenCalledOnce();
    expect(jobUpsert.mock.calls[0][0].where.source_externalId).toEqual({
      source: "GREENHOUSE", externalId: "gh-1"
    });
    expect(result.inserted).toBe(1);
  });

  it("updates an existing provider job instead of inserting another row", async () => {
    jobFindUnique.mockResolvedValue({ id: "existing-1" });
    const result = await syncJobs();
    expect(jobUpsert).toHaveBeenCalledOnce();
    expect(result.updated).toBe(1);
    expect(result.inserted).toBe(0);
  });

  it("skips a canonical URL already stored under another provider", async () => {
    jobFindFirst.mockResolvedValue({ id: "other-provider-job" });
    const result = await syncJobs();
    expect(jobUpsert).not.toHaveBeenCalled();
    expect(result.duplicatesSkipped).toBe(1);
  });

  it("records provider failures without crashing the whole sync", async () => {
    greenhouseFetch.mockRejectedValue(new Error("provider unavailable"));
    const result = await syncJobs();
    expect(result.errors).toEqual(["GREENHOUSE/acme: provider unavailable"]);
  });

  it("previews a public board without persisting jobs", async () => {
    const preview = await previewSource("GREENHOUSE", "acme");
    expect(preview).toMatchObject({
      provider: "GREENHOUSE", boardId: "acme", jobCount: 1,
      sample: [{ title: "Backend Engineer", location: "Remote", url: job.url }]
    });
    expect(jobUpsert).not.toHaveBeenCalled();
  });

  it("rejects unsupported source providers", async () => {
    await expect(previewSource("OTHER", "acme")).rejects.toThrow("Unsupported job provider");
  });
});
