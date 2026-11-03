import { syncJobs } from "./service.js";

/**
 * Starts a process-local periodic full sync. A zero interval disables scheduling.
 * The timer is deliberately not a durable/distributed scheduler.
 */
export function startScheduledSync(
  intervalMinutes: number,
  logger: Pick<Console, "info" | "warn" | "error"> = console
): () => void {
  if (!Number.isInteger(intervalMinutes) || intervalMinutes <= 0) return () => {};

  const intervalMs = intervalMinutes * 60 * 1000;
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void syncJobs()
      .then(summary => {
        if (summary.errors.length) {
          logger.warn(
            `Scheduled source sync completed with ${summary.errors.length} error(s): ${summary.errors.join("; ")}`
          );
        } else {
          logger.info(
            `Scheduled source sync completed: ${summary.fetched} fetched, ${summary.inserted} inserted, ${summary.updated} updated.`
          );
        }
      })
      .catch(error => {
        logger.error("Scheduled source sync failed unexpectedly", error);
      })
      .finally(() => {
        running = false;
      });
  }, intervalMs);

  // Do not keep the API process alive solely for this optional timer.
  timer.unref?.();
  return () => clearInterval(timer);
}
