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

export async function syncJobs() {
  const summary = { fetched: 0, inserted: 0, updated: 0, errors: [] as string[] };
  for (const { connector, boards } of connectors) {
    for (const board of boards) {
      try {
        const jobs = await connector.fetchBoard(board);
        summary.fetched += jobs.length;
        for (const raw of jobs) {
          const normalized = normalizeJob(connector.provider, raw);
          const canonicalUrl = canonicalizeUrl(normalized.applicationUrl);
          const existing = await prisma.job.findUnique({
            where: { source_externalId: { source: normalized.source, externalId: normalized.externalId } }
          });
          const data = {
            ...normalized,
            publishedAt: normalized.publishedAt ? new Date(normalized.publishedAt) : null,
            canonicalUrl,
            lastVerifiedAt: new Date(),
            status: "ACTIVE"
          };
          if (existing) {
            await prisma.job.update({ where: { id: existing.id }, data });
            summary.updated++;
          } else {
            const duplicate = await prisma.job.findFirst({ where: { canonicalUrl } });
            if (!duplicate) {
              await prisma.job.create({ data });
              summary.inserted++;
            }
          }
        }
      } catch (error) {
        summary.errors.push(`${connector.provider}/${board}: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    }
  }
  return summary;
}
