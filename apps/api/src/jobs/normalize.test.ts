import { describe, expect, it } from "vitest";
import { canonicalizeUrl, normalizeJob } from "./normalize.js";

describe("job normalization", () => {
  it("normalizes missing optional values safely", () => {
    const job = normalizeJob("TEST", { id: "1", title: " Backend ", company: " Acme ", url: "https://example.com/job" });
    expect(job.title).toBe("Backend");
    expect(job.location).toBeNull();
    expect(job.status).toBe("UNKNOWN");
  });

  it("removes tracking parameters and fragments for deduplication", () => {
    expect(canonicalizeUrl("https://example.com/jobs/1?utm_source=x#apply"))
      .toBe("https://example.com/jobs/1");
  });

  it("normalizes query parameter ordering and trailing path slashes", () => {
    expect(canonicalizeUrl("https://EXAMPLE.com/jobs/1/?b=2&a=1"))
      .toBe("https://example.com/jobs/1?a=1&b=2");
  });

  it("preserves meaningful query parameters", () => {
    expect(canonicalizeUrl("https://example.com/jobs/1?gh_src=abc&job=backend"))
      .toBe("https://example.com/jobs/1?job=backend");
  });

  it("leaves an invalid URL unchanged rather than crashing", () => {
    expect(canonicalizeUrl("not a url")).toBe("not a url");
  });
});
