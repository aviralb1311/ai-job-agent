import { describe, expect, it } from "vitest";
import { sourceCatalog } from "./source-catalog.js";

describe("curated public source catalog", () => {
  it("contains unique identifiers and provider/board combinations", () => {
    expect(new Set(sourceCatalog.map(item => item.id)).size).toBe(sourceCatalog.length);
    expect(new Set(sourceCatalog.map(item => `${item.provider}:${item.boardId}`)).size).toBe(sourceCatalog.length);
  });

  it("contains only supported providers and HTTPS career URLs", () => {
    for (const item of sourceCatalog) {
      expect(["GREENHOUSE", "LEVER", "ASHBY"]).toContain(item.provider);
      expect(item.careersUrl).toMatch(/^https:\/\//);
      expect(item.boardId).toMatch(/^[a-zA-Z0-9._-]+$/);
    }
  });
});
