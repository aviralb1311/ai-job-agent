import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { jobFindUnique, jobFindFirst, jobUpsert, greenhouseFetch, leverFetch, ashbyFetch } = vi.hoisted(() => ({
  jobFindUnique: vi.fn(),
  jobFindFirst: vi.fn(),
  jobUpsert: vi.fn(),
  greenhouseFetch: vi.fn(),
  leverFetch: vi.fn(),
  ashbyFetch: vi.fn()
}));

vi.mock("../db.js", () => ({
  prisma: { job: { findUnique: jobFindUnique, findFirst: jobFindFirst, upsert: jobUpsert } }
}));
vi.mock("../config.js", () => ({
  config: { GREENHOUSE_BOARDS: "acme", LEVER_SITES: "", ASHBY_BOARDS: "" },
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

import { syncJobs } from "./service.js";

const job = {
  id: "gh-1",
  title: "Backend Engineer",
  company: "Acme",
  location: "Remote",
  description: "Build APIs",
  url: "https://example.com/jobs/1?utm_source=greenhouse"
};

describe("job sync persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    greenhouseFetch.mockResolvedValue([job]);
    leverFetch.mockResolvedValue([]);
    ashbyFetch.mockResolvedValue([]);
    jobFindUnique.mockResolvedValue(null);
    jobFindFirst.mockResolvedValue(null);
    jobUpsert.mockResolvedValue({ id: "db-1" });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("inserts a new source job using an idempotent upsert", async () => {
    const result = await syncJobs();
    expect(jobUpsert).toHaveBeenCalledOnce();
    expect(jobUpsert.mock.calls[0][0].where.source_externalId).toEqual({
      source: "GREENHOUSE", externalId: "gh-1"
    });
    expect(result).toMatchObject({ fetched: 1, inserted: 1, updated: 0, duplicatesSkipped: 0, errors: [] });
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

  it("coalesces overlapping sync requests", async () => {
    let release: ((jobs: typeof job[]) => void) | undefined;
    greenhouseFetch.mockImplementation(() => new Promise(resolve => {
      release = resolve;
    }));
    const first = syncJobs();
    const second = syncJobs();
    expect(second).toBe(first);
    release?.([job]);
    await Promise.all([first, second]);
    expect(greenhouseFetch).toHaveBeenCalledOnce();
  });
});
