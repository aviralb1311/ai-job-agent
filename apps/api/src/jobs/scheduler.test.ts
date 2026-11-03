import { afterEach, describe, expect, it, vi } from "vitest";

const { syncJobs } = vi.hoisted(() => ({ syncJobs: vi.fn() }));
vi.mock("./service.js", () => ({ syncJobs }));

import { startScheduledSync } from "./scheduler.js";

describe("scheduled source sync", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("does not schedule when the interval is zero or invalid", () => {
    vi.useFakeTimers();
    const stop = startScheduledSync(0);
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(syncJobs).not.toHaveBeenCalled();
    stop();
  });

  it("runs only after the configured interval and logs the result", async () => {
    vi.useFakeTimers();
    syncJobs.mockResolvedValue({
      fetched: 12, inserted: 3, updated: 4, duplicatesSkipped: 5, errors: []
    });
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const stop = startScheduledSync(5, logger);

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(syncJobs).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      "Scheduled source sync completed: 12 fetched, 3 inserted, 4 updated."
    );
    stop();
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(syncJobs).toHaveBeenCalledTimes(1);
  });

  it("logs provider errors without crashing the scheduler", async () => {
    vi.useFakeTimers();
    syncJobs.mockResolvedValue({
      fetched: 2, inserted: 0, updated: 0, duplicatesSkipped: 0,
      errors: ["GREENHOUSE/acme: unavailable"]
    });
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const stop = startScheduledSync(1, logger);
    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(logger.warn).toHaveBeenCalledWith(
      "Scheduled source sync completed with 1 error(s): GREENHOUSE/acme: unavailable"
    );
    stop();
  });
});
