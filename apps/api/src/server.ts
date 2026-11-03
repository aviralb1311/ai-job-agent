import { app } from "./app.js";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { startScheduledSync } from "./jobs/scheduler.js";

const server = app.listen(config.PORT, () => {
  console.log(`AI Job Agent API listening on http://localhost:${config.PORT}`);
});

const stopScheduledSync = startScheduledSync(config.SOURCE_SYNC_INTERVAL_MINUTES);
let shuttingDown = false;

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  stopScheduledSync();
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
  await prisma.$disconnect();
}
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
