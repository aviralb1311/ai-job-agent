import { afterEach, describe, expect, it, vi } from "vitest";
import { greenhouseConnector } from "./greenhouse.js";

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body)
  };
}

describe("Greenhouse connector", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fetches and maps public job-board postings", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      jobs: [{
        id: 123,
        title: "Backend Engineer",
        absolute_url: "https://boards.greenhouse.io/acme/jobs/123",
        content: "<p>Build APIs</p>",
        location: { name: "Remote - India" },
        first_published: "2026-10-30T10:00:00Z",
        updated_at: "2026-10-31T10:00:00Z"
      }]
    }));
    vi.stubGlobal("fetch", fetchMock);
    const jobs = await greenhouseConnector.fetchBoard("acme");

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toContain("/v1/boards/acme/jobs?content=true");
    expect(jobs).toEqual([{
      id: "123",
      title: "Backend Engineer",
      company: "acme",
      location: "Remote - India",
      description: "<p>Build APIs</p>",
      url: "https://boards.greenhouse.io/acme/jobs/123",
      publishedAt: "2026-10-30T10:00:00.000Z",
      employmentType: null
    }]);
  });

  it("returns an empty list when the board has no jobs", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ jobs: [] })));
    await expect(greenhouseConnector.fetchBoard("empty-board")).resolves.toEqual([]);
  });

  it("safely handles missing optional fields", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      jobs: [{ id: "job-1", title: "Platform Engineer", absolute_url: "https://example.com/jobs/1" }]
    })));
    const [job] = await greenhouseConnector.fetchBoard("example");
    expect(job.location).toBeNull();
    expect(job.description).toBe("");
    expect(job.publishedAt).toBeNull();
    expect(job.employmentType).toBeNull();
  });

  it("skips malformed job records", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      jobs: [
        { id: "valid", title: "Engineer", absolute_url: "https://example.com/job" },
        { id: "missing-url", title: "Incomplete" },
        null,
        { id: 2, title: "   ", absolute_url: "https://example.com/blank" }
      ]
    })));
    const jobs = await greenhouseConnector.fetchBoard("example");
    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe("valid");
  });

  it("rejects an invalid response shape", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ data: [] })));
    await expect(greenhouseConnector.fetchBoard("broken"))
      .rejects.toThrow('Greenhouse board "broken" returned an invalid jobs response');
  });

  it("reports non-success HTTP responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 503)));
    await expect(greenhouseConnector.fetchBoard("unavailable"))
      .rejects.toThrow('Greenhouse board "unavailable" returned HTTP 503');
  });

  it("propagates network failures for the sync service to record", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network unavailable")));
    await expect(greenhouseConnector.fetchBoard("offline")).rejects.toThrow("network unavailable");
  });
});
