import { describe, expect, it } from "vitest";
import { canonicalizeUrl, normalizeJob } from "./normalize.js";

describe("job normalization", () => {
  it("normalizes missing optional values safely", () => {
    const job = normalizeJob("TEST", { id: "1", title: " Backend ", company: " Acme ", url: "https://example.com/job" });
    expect(job.title).toBe("Backend");
    expect(job.location).toBeNull();
    expect(job.status).toBe("UNKNOWN");
  });
  it("removes tracking query params for deduplication", () => {
    expect(canonicalizeUrl("https://example.com/jobs/1?utm_source=x#apply")).toBe("https://example.com/jobs/1");
  });
});
