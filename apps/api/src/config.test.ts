import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("runtime configuration", () => {
  it("uses secure session cookies in production by default", () => {
    expect(loadConfig({ NODE_ENV: "production" }).AUTH_COOKIE_SECURE).toBe(true);
  });

  it("keeps cookies suitable for localhost development by default", () => {
    expect(loadConfig({ NODE_ENV: "development" }).AUTH_COOKIE_SECURE).toBe(false);
  });

  it("allows the configured frontend origin and an explicit cookie override", () => {
    const config = loadConfig({
      NODE_ENV: "production",
      CORS_ORIGIN: "https://portfolio.example.com",
      AUTH_COOKIE_SECURE: "false"
    });
    expect(config.CORS_ORIGIN).toBe("https://portfolio.example.com");
    expect(config.AUTH_COOKIE_SECURE).toBe(false);
  });
});
