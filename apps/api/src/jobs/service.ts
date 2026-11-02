import { prisma } from "../db.js";
import { config, list } from "../config.js";
import { greenhouseConnector } from "./connectors/greenhouse.js";
import { leverConnector } from "./connectors/lever.js";
import { ashbyConnector } from "./connectors/ashby.js";
import { canonicalizeUrl, normalizeJob } from "./normalize.js";
import type { JobConnector } from "./types.js";

const connectors: { connector: JobConnector; boards: string[] }[] = [
  { connector: greenhouseConnector, boards: list(config.GREENHOUSE_BOARDS) },
  { connector: leverConnector, boards: list(config.LEVER_SITES) },
  { connector: ashbyConnector, boards: list(config.ASHBY_BOARDS) }
];

export interface JobSyncSummary {
  fetched: number;
  inserted: number;
  updated: number;
  duplicatesSkipped: number;
  errors: string[];
}

let activeSync: Promise<JobSyncSummary> | null = null;

async function runSync(): Promise<JobSyncSummary> {
  const summary: JobSyncSummary = {
    fetched: 0,
    inserted: 0,
    updated: 0,
    duplicatesSkipped: 0,
    errors: []
  };

  for (const { connector, boards } of connectors) {
    for (const board of boards) {
      try {
        const jobs = await connector.fetchBoard(board);
        summary.fetched += jobs.length;

        for (const raw of jobs) {
          try {
            const normalized = normalizeJob(connector.provider, raw);
            const canonicalUrl = canonicalizeUrl(normalized.applicationUrl);
            const where = {
              source_externalId: {
                source: normalized.source,
                externalId: normalized.externalId
              }
            };

            // A repeat sync of the same provider job updates the existing row.
            const existing = await prisma.job.findUnique({ where });

            // Different providers can expose the same application URL. Keep one
            // canonical listing rather than creating a second dashboard row.
            const duplicate = await prisma.job.findFirst({
              where: {
                canonicalUrl,
                ...(existing ? { NOT: { id: existing.id } } : {})
              },
              select: { id: true }
            });

            if (duplicate) {
              summary.duplicatesSkipped++;
              continue;
            }

            const data = {
              ...normalized,
              publishedAt: normalized.publishedAt ? new Date(normalized.publishedAt) : null,
              canonicalUrl,
              lastVerifiedAt: new Date(),
              status: "ACTIVE"
            };

            await prisma.job.upsert({
              where,
              create: data,
              update: data
            });

            if (existing) summary.updated++;
            else summary.inserted++;
          } catch (error) {
            summary.errors.push(
              `${connector.provider}/${board}/${raw.id}: ${error instanceof Error ? error.message : "Unknown job error"}`
            );
          }
        }
      } catch (error) {
        summary.errors.push(
          `${connector.provider}/${board}: ${error instanceof Error ? error.message : "Unknown source error"}`
        );
      }
    }
  }

  return summary;
}

/**
 * Coalesces overlapping sync requests in this API process. Database upsert on
 * (source, externalId) remains the durable idempotency boundary.
 */
export function syncJobs(): Promise<JobSyncSummary> {
  if (activeSync) return activeSync;
  activeSync = runSync().finally(() => {
    activeSync = null;
  });
  return activeSync;
}
