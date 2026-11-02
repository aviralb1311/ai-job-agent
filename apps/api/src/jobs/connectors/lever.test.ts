import { afterEach, describe, expect, it, vi } from "vitest";
import { leverConnector } from "./lever.js";

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: vi.fn().mockResolvedValue(body) };
}

describe("Lever connector", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("maps public postings and their list sections", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse([{
      id: "lever-1",
      text: "Backend Engineer",
      hostedUrl: "https://jobs.lever.co/acme/lever-1",
      descriptionPlain: "Build services",
      createdAt: 1793354400000,
      categories: { location: "Remote, India", commitment: "Full-time" },
      lists: [{ text: "Requirements", content: "Node.js\nPostgreSQL" }]
    }])));
    const [job] = await leverConnector.fetchBoard("acme");
    expect(job).toMatchObject({
      id: "lever-1", title: "Backend Engineer", company: "acme",
      location: "Remote, India", description: "Build services\n\nRequirements\nNode.js\nPostgreSQL",
      url: "https://jobs.lever.co/acme/lever-1", employmentType: "Full-time"
    });
    expect(job.publishedAt).toBe(new Date(1793354400000).toISOString());
  });

  it("returns an empty list for an empty board", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse([])));
    await expect(leverConnector.fetchBoard("empty")).resolves.toEqual([]);
  });

  it("handles missing optional fields and invalid dates", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse([{
      id: "1", text: "Engineer", hostedUrl: "https://example.com/1", createdAt: "not-a-date"
    }])));
    const [job] = await leverConnector.fetchBoard("acme");
    expect(job.location).toBeNull();
    expect(job.description).toBe("");
    expect(job.publishedAt).toBeNull();
    expect(job.employmentType).toBeNull();
  });

  it("skips malformed records and rejects an invalid payload", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse([
      { id: "ok", text: "Engineer", hostedUrl: "https://example.com/ok" },
      { id: "bad", text: "No URL" },
      null
    ])));
    expect(await leverConnector.fetchBoard("acme")).toHaveLength(1);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ postings: [] })));
    await expect(leverConnector.fetchBoard("broken")).rejects.toThrow("invalid postings response");
  });

  it("surfaces HTTP and network errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse([], 429)));
    await expect(leverConnector.fetchBoard("rate-limited")).rejects.toThrow("HTTP 429");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(leverConnector.fetchBoard("offline")).rejects.toThrow("offline");
  });
});
