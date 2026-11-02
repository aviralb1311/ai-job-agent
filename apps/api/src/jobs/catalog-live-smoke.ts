import { greenhouseConnector } from "./connectors/greenhouse.js";
import { leverConnector } from "./connectors/lever.js";
import { ashbyConnector } from "./connectors/ashby.js";
import { sourceCatalog } from "./source-catalog.js";

const connectors = {
  GREENHOUSE: greenhouseConnector,
  LEVER: leverConnector,
  ASHBY: ashbyConnector
} as const;

let failed = false;
let totalJobs = 0;

for (const entry of sourceCatalog) {
  const connector = connectors[entry.provider];
  try {
    const jobs = await connector.fetchBoard(entry.boardId);
    const malformed = jobs.filter(job =>
      !job.id.trim() || !job.title.trim() || !/^https:\/\//i.test(job.url)
    );
    if (malformed.length) {
      throw new Error(`${malformed.length} postings have invalid required fields`);
    }
    totalJobs += jobs.length;
    console.log(JSON.stringify({
      board: entry.displayName,
      provider: entry.provider,
      boardId: entry.boardId,
      status: "reachable",
      jobs: jobs.length,
      note: jobs.length === 0 ? "Feed reachable but currently empty" : undefined
    }));
  } catch (error) {
    failed = true;
    console.error(JSON.stringify({
      board: entry.displayName,
      provider: entry.provider,
      boardId: entry.boardId,
      status: "failed",
      error: error instanceof Error ? error.message : "Unknown error"
    }));
  }
}

console.log(JSON.stringify({
  catalogBoards: sourceCatalog.length,
  totalJobsReturned: totalJobs,
  result: failed ? "failed" : "passed"
}));

if (failed) process.exitCode = 1;
