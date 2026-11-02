import { prisma } from "../db.js";
import { config, list } from "../config.js";
import { greenhouseConnector } from "./connectors/greenhouse.js";
import { leverConnector } from "./connectors/lever.js";
import { ashbyConnector } from "./connectors/ashby.js";
import { canonicalizeUrl, normalizeJob } from "./normalize.js";
import type { JobConnector } from "./types.js";

const connectors: Record<string, JobConnector> = {
  GREENHOUSE: greenhouseConnector,
  LEVER: leverConnector,
  ASHBY: ashbyConnector
};

export function getConnector(provider: string): JobConnector | undefined {
  return connectors[provider.toUpperCase()];
}

export async function previewSource(provider: string, boardId: string) {
  const connector = getConnector(provider);
  if (!connector) throw new Error(`Unsupported job provider: ${provider}`);
  const jobs = await connector.fetchBoard(boardId);
  return {
    provider: connector.provider,
    boardId,
    jobCount: jobs.length,
    sample: jobs.slice(0, 3).map(job => ({
      title: job.title,
      location: job.location ?? null,
      url: job.url
    }))
  };
}

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

  // Prefer database-managed sources. Environment variables remain supported
  // as a backwards-compatible fallback for existing local installations.
  const savedSources = await prisma.jobSource.findMany({ orderBy: { createdAt: "asc" } });
  const sources = savedSources.length > 0
    ? savedSources.filter(source => source.enabled)
    : [
        ...list(config.GREENHOUSE_BOARDS).map(boardId => ({ provider: "GREENHOUSE", boardId, displayName: null })),
        ...list(config.LEVER_SITES).map(boardId => ({ provider: "LEVER", boardId, displayName: null })),
        ...list(config.ASHBY_BOARDS).map(boardId => ({ provider: "ASHBY", boardId, displayName: null }))
      ];

  for (const source of sources) {
    const connector = getConnector(source.provider);
    if (!connector) {
      summary.errors.push(`${source.provider}/${source.boardId}: Unsupported provider`);
      continue;
    }

    try {
      const jobs = await connector.fetchBoard(source.boardId);
      summary.fetched += jobs.length;

      for (const raw of jobs) {
        try {
          const normalized = normalizeJob(connector.provider, {
            ...raw,
            company: source.displayName?.trim() || raw.company
          });
          const canonicalUrl = canonicalizeUrl(normalized.applicationUrl);
          const where = {
            source_externalId: {
              source: normalized.source,
              externalId: normalized.externalId
            }
          };

          const existing = await prisma.job.findUnique({ where });
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

          await prisma.job.upsert({ where, create: data, update: data });
          if (existing) summary.updated++;
          else summary.inserted++;
        } catch (error) {
          summary.errors.push(
            `${connector.provider}/${source.boardId}/${raw.id}: ${error instanceof Error ? error.message : "Unknown job error"}`
          );
        }
      }
    } catch (error) {
      summary.errors.push(
        `${connector.provider}/${source.boardId}: ${error instanceof Error ? error.message : "Unknown source error"}`
      );
    }
  }

  return summary;
}

/** Coalesces overlapping sync requests in this API process. */
export function syncJobs(): Promise<JobSyncSummary> {
  if (activeSync) return activeSync;
  activeSync = runSync().finally(() => {
    activeSync = null;
  });
  return activeSync;
}
