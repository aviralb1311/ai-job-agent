import { open, unlink } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parsePostgresTestDatabaseUrl } from "./postgresql-test-url.mjs";

let testUrl;
try {
  testUrl = parsePostgresTestDatabaseUrl(process.env.POSTGRES_TEST_DATABASE_URL);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Invalid PostgreSQL test URL.");
  process.exit(1);
}

const npmCli = process.env.npm_execpath;
if (!npmCli) {
  console.error("Run this command through npm: npm run test:postgresql.");
  process.exit(1);
}

const userId = typeof process.getuid === "function" ? process.getuid() : "user";
const lockPath = join(tmpdir(), `ai-job-agent-postgresql-test-${userId}.lock`);
let lockFile;
try {
  lockFile = await open(lockPath, "wx", 0o600);
  await lockFile.writeFile(`${process.pid}\n`);
  await lockFile.close();
} catch (error) {
  if (lockFile) await lockFile.close().catch(() => {});
  if (error?.code === "EEXIST") {
    console.error("Another PostgreSQL integration-test run holds the local test lock. If no runner is active, verify and remove the stale lock before retrying.");
  } else {
    console.error("Could not create the PostgreSQL integration-test lock.");
  }
  process.exit(1);
}

const apiDirectory = fileURLToPath(new URL("..", import.meta.url));
const testEnvironment = {
  ...process.env,
  POSTGRES_TEST_DATABASE_URL: testUrl.href,
  DATABASE_URL: testUrl.href,
  DIRECT_URL: testUrl.href,
  NODE_ENV: "test",
  CORS_ORIGIN: process.env.CORS_ORIGIN ?? "http://localhost:5173"
};

function runNpm(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [npmCli, ...args], {
      cwd: apiDirectory,
      env: testEnvironment,
      stdio: "inherit"
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(signal ? `npm exited after ${signal}.` : `npm exited with code ${code}.`));
    });
  });
}

try {
  await runNpm(["run", "db:generate:postgresql"]);
  await runNpm(["run", "db:migrate:deploy:postgresql"]);
  await runNpm([
    "exec", "--", "vitest", "run", "--config", "vitest.config.ts",
    "--maxWorkers=1", "--no-file-parallelism"
  ]);
} catch (error) {
  console.error(error instanceof Error ? error.message : "PostgreSQL integration tests failed.");
  process.exitCode = 1;
} finally {
  await unlink(lockPath).catch(() => {});
}
