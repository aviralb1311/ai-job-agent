import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const productionDb = "postgresql://user@localhost:5432/db";

describe("runtime configuration", () => {
  it("uses secure session cookies in production by default", () => {
    expect(loadConfig({ NODE_ENV: "production", DATABASE_URL: productionDb }).AUTH_COOKIE_SECURE).toBe(true);
  });

  it("keeps cookies suitable for localhost development by default", () => {
    expect(loadConfig({ NODE_ENV: "development" }).AUTH_COOKIE_SECURE).toBe(false);
  });

  it("allows the configured frontend origin and an explicit cookie override", () => {
    const config = loadConfig({
      NODE_ENV: "production",
      DATABASE_URL: productionDb,
      CORS_ORIGIN: "https://portfolio.example.com",
      AUTH_COOKIE_SECURE: "false"
    });
    expect(config.CORS_ORIGIN).toBe("https://portfolio.example.com");
    expect(config.AUTH_COOKIE_SECURE).toBe(false);
  });

  it("requires DATABASE_URL in production", () => {
    expect(() => loadConfig({ NODE_ENV: "production" })).toThrow(/DATABASE_URL is required in production/);
  });

  it("requires PostgreSQL protocol for DATABASE_URL in production", () => {
    expect(() => loadConfig({ NODE_ENV: "production", DATABASE_URL: "file:./dev.db" })).toThrow(/PostgreSQL protocol/);
    expect(() => loadConfig({ NODE_ENV: "production", DATABASE_URL: "sqlite:./dev.db" })).toThrow(/PostgreSQL protocol/);
  });

  it("accepts a PostgreSQL DATABASE_URL in production", () => {
    const config = loadConfig({
      NODE_ENV: "production",
      DATABASE_URL: productionDb
    });
    expect(config.DATABASE_URL).toBe(productionDb);
  });

  it("retains the SQLite default in development", () => {
    const config = loadConfig({ NODE_ENV: "development" });
    expect(config.DATABASE_URL).toBe("file:./dev.db");
  });
});
