import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parsePostgresTestDatabaseUrl } from "./postgresql-test-url.mjs";

const validUrl = "postgresql://postgres@127.0.0.1:55432/ai_job_agent_test?schema=public";
const runnerPath = fileURLToPath(new URL("./run-postgresql-tests.mjs", import.meta.url));

test("accepts the dedicated local PostgreSQL test database", () => {
  assert.equal(parsePostgresTestDatabaseUrl(validUrl).hostname, "127.0.0.1");
});

test("rejects a missing URL", () => {
  assert.throws(() => parsePostgresTestDatabaseUrl(undefined), /Set POSTGRES_TEST_DATABASE_URL/);
});

test("rejects an invalid URL", () => {
  assert.throws(() => parsePostgresTestDatabaseUrl("not a URL"), /valid PostgreSQL URL/);
});

test("rejects non-PostgreSQL protocols", () => {
  assert.throws(
    () => parsePostgresTestDatabaseUrl("https://localhost:55432/ai_job_agent_test"),
    /PostgreSQL protocol/
  );
});

test("rejects remote hosts", () => {
  assert.throws(
    () => parsePostgresTestDatabaseUrl("postgresql://db.example.test:55432/ai_job_agent_test"),
    /limited to localhost or 127.0.0.1/
  );
});

test("rejects an embedded password", () => {
  assert.throws(
    () => parsePostgresTestDatabaseUrl("postgresql://user:password@localhost:55432/ai_job_agent_test"),
    /Do not include a password/
  );
});

test("rejects a wrong port", () => {
  assert.throws(
    () => parsePostgresTestDatabaseUrl("postgresql://postgres@localhost:5432/ai_job_agent_test"),
    /require port 55432/
  );
});

test("rejects a wrong database", () => {
  assert.throws(
    () => parsePostgresTestDatabaseUrl("postgresql://postgres@localhost:55432/other_database"),
    /require database ai_job_agent_test/
  );
});

test("the runner rejects unsafe URLs before invoking Prisma or Vitest", async t => {
  const invalidUrls = [
    ["missing", undefined],
    ["malformed", "not a URL"],
    ["remote host", "postgresql://db.example.test:55432/ai_job_agent_test"],
    ["wrong port", "postgresql://postgres@localhost:5432/ai_job_agent_test"],
    ["wrong database", "postgresql://postgres@localhost:55432/other_database"]
  ];

  for (const [label, url] of invalidUrls) {
    await t.test(label, () => {
      const env = { ...process.env, npm_execpath: "" };
      if (url === undefined) delete env.POSTGRES_TEST_DATABASE_URL;
      else env.POSTGRES_TEST_DATABASE_URL = url;
      const result = spawnSync(process.execPath, [runnerPath], { env, encoding: "utf8" });

      assert.notEqual(result.status, 0);
      assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /db:generate:postgresql|db:migrate:deploy:postgresql|vitest run/);
    });
  }
});
