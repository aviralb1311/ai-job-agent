import { afterEach, describe, expect, it, vi } from "vitest";
import { ashbyConnector } from "./ashby.js";

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: vi.fn().mockResolvedValue(body) };
}

describe("Ashby connector", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("maps public jobs and prefers plain-text descriptions", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ jobs: [{
      id: "ashby-1", title: "Software Engineer", jobUrl: "https://jobs.ashbyhq.com/acme/1",
      descriptionPlain: "Build products", descriptionHtml: "<p>Build products</p>",
      location: "Bengaluru, India", publishedAt: "2026-10-30T10:00:00Z",
      employmentType: "FullTime"
    }] })));
    const [job] = await ashbyConnector.fetchBoard("acme");
    expect(job).toEqual({
      id: "ashby-1", title: "Software Engineer", company: "acme",
      location: "Bengaluru, India", description: "Build products",
      url: "https://jobs.ashbyhq.com/acme/1",
      publishedAt: "2026-10-30T10:00:00.000Z", employmentType: "FullTime"
    });
  });

  it("returns an empty list for a board with no jobs", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ jobs: [] })));
    await expect(ashbyConnector.fetchBoard("empty")).resolves.toEqual([]);
  });

  it("handles optional fields, invalid dates and HTML fallback", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ jobs: [{
      id: "1", title: "Engineer", jobUrl: "https://example.com/1",
      descriptionHtml: "<p>Details</p>", publishedAt: "invalid"
    }] })));
    const [job] = await ashbyConnector.fetchBoard("acme");
    expect(job.description).toBe("<p>Details</p>");
    expect(job.location).toBeNull();
    expect(job.publishedAt).toBeNull();
    expect(job.employmentType).toBeNull();
  });

  it("skips malformed jobs and rejects invalid payloads", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ jobs: [
      { id: "ok", title: "Engineer", jobUrl: "https://example.com/ok" },
      { id: "missing-url", title: "Incomplete" },
      null
    ] })));
    expect(await ashbyConnector.fetchBoard("acme")).toHaveLength(1);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse([])));
    await expect(ashbyConnector.fetchBoard("broken")).rejects.toThrow("invalid jobs response");
  });

  it("surfaces HTTP and network errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 503)));
    await expect(ashbyConnector.fetchBoard("unavailable")).rejects.toThrow("HTTP 503");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(ashbyConnector.fetchBoard("offline")).rejects.toThrow("offline");
  });
});
