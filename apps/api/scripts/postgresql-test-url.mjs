const allowedHosts = new Set(["127.0.0.1", "localhost"]);

export function parsePostgresTestDatabaseUrl(value) {
  if (!value) {
    throw new Error("Set POSTGRES_TEST_DATABASE_URL to the disposable local PostgreSQL test database.");
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("POSTGRES_TEST_DATABASE_URL must be a valid PostgreSQL URL.");
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("POSTGRES_TEST_DATABASE_URL must use the PostgreSQL protocol.");
  }
  if (url.password) {
    throw new Error("Do not include a password in POSTGRES_TEST_DATABASE_URL; the documented local test cluster uses trust authentication.");
  }
  if (!allowedHosts.has(url.hostname.toLowerCase())) {
    throw new Error("PostgreSQL integration tests are limited to localhost or 127.0.0.1.");
  }
  if (url.port !== "55432") {
    throw new Error("PostgreSQL integration tests require port 55432.");
  }
  if (url.pathname !== "/ai_job_agent_test") {
    throw new Error("PostgreSQL integration tests require database ai_job_agent_test.");
  }

  return url;
}
