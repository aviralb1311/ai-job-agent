import { greenhouseConnector } from "./greenhouse.js";
import { leverConnector } from "./lever.js";
import { ashbyConnector } from "./ashby.js";
import { normalizeJob } from "../normalize.js";

const boards = [
  { provider: greenhouseConnector, boardId: process.env.GREENHOUSE_SMOKE_BOARD },
  { provider: leverConnector, boardId: process.env.LEVER_SMOKE_BOARD },
  { provider: ashbyConnector, boardId: process.env.ASHBY_SMOKE_BOARD }
];

const missing = boards.filter(item => !item.boardId?.trim());
if (missing.length > 0) {
  throw new Error("Set GREENHOUSE_SMOKE_BOARD, LEVER_SMOKE_BOARD, and ASHBY_SMOKE_BOARD to valid public board IDs before running the live smoke test.");
}

let failed = false;

for (const { provider, boardId } of boards as Array<{ provider: typeof greenhouseConnector | typeof leverConnector | typeof ashbyConnector; boardId: string }>) {
  try {
    const jobs = await provider.fetchBoard(boardId);
    if (jobs.length === 0) throw new Error("The board returned zero public job postings");

    const invalid = jobs.filter(job =>
      !job.id.trim() || !job.title.trim() || !/^https:\/\//i.test(job.url)
    );
    if (invalid.length > 0) throw new Error(`${invalid.length} postings failed required-field validation`);

    const normalized = normalizeJob(provider.provider, jobs[0]);
    if (!normalized.externalId || !normalized.title || !normalized.applicationUrl.startsWith("https://")) {
      throw new Error("The normalized sample failed required-field validation");
    }

    console.log(JSON.stringify({
      provider: provider.provider,
      boardId,
      status: "passed",
      jobsFetched: jobs.length,
      sampleTitle: jobs[0].title,
      sampleLocation: jobs[0].location ?? null
    }));
  } catch (error) {
    failed = true;
    console.error(JSON.stringify({
      provider: provider.provider,
      boardId,
      status: "failed",
      error: error instanceof Error ? error.message : "Unknown error"
    }));
  }
}

if (failed) process.exitCode = 1;
