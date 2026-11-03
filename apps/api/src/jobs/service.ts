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
  deactivated: number;
  errors: string[];
}

let activeSync: Promise<JobSyncSummary> | null = null;
let activeSyncKind: "FULL" | "SOURCE" | null = null;

async function runSync(target?: { provider: string; boardId: string }): Promise<JobSyncSummary> {
  const summary: JobSyncSummary = {
    fetched: 0,
    inserted: 0,
    updated: 0,
    duplicatesSkipped: 0,
    deactivated: 0,
    errors: []
  };

  // Prefer database-managed sources. Environment variables remain supported
  // as a backwards-compatible fallback for existing local installations.
  const savedSources = await prisma.jobSource.findMany({ orderBy: { createdAt: "asc" } });
  const sources = target
    ? savedSources.filter(source => source.provider === target.provider && source.boardId === target.boardId && source.enabled)
    : savedSources.length > 0
    ? savedSources.filter(source => source.enabled)
    : [
        ...list(config.GREENHOUSE_BOARDS).map(boardId => ({ provider: "GREENHOUSE", boardId, displayName: null })),
        ...list(config.LEVER_SITES).map(boardId => ({ provider: "LEVER", boardId, displayName: null })),
        ...list(config.ASHBY_BOARDS).map(boardId => ({ provider: "ASHBY", boardId, displayName: null }))
      ];

  for (const source of sources) {
    const startedAt = new Date();
    const startedMs = Date.now();
    let fetched = 0;
    let inserted = 0;
    let updated = 0;
    let duplicatesSkipped = 0;
    let deactivated = 0;
    const seenExternalIds = new Set<string>();
    let sourceFetchFailed = false;
    const sourceErrors: string[] = [];
    const connector = getConnector(source.provider);

    if (!connector) {
      sourceFetchFailed = true;
      sourceErrors.push(`${source.provider}/${source.boardId}: Unsupported provider`);
    } else {
      try {
        const jobs = await connector.fetchBoard(source.boardId);
        fetched = jobs.length;
        summary.fetched += jobs.length;

        for (const raw of jobs) {
          try {
            const normalized = normalizeJob(connector.provider, {
              ...raw,
              company: source.displayName?.trim() || raw.company
            });
            seenExternalIds.add(normalized.externalId);
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
              duplicatesSkipped++;
              summary.duplicatesSkipped++;
              continue;
            }

            const data = {
              ...normalized,
              sourceBoardId: source.boardId,
              publishedAt: normalized.publishedAt ? new Date(normalized.publishedAt) : null,
              canonicalUrl,
              lastVerifiedAt: new Date(),
              status: "ACTIVE"
            };

            await prisma.job.upsert({ where, create: data, update: data });
            if (existing) {
              updated++;
              summary.updated++;
            } else {
              inserted++;
              summary.inserted++;
            }
          } catch (error) {
            const message = `${connector.provider}/${source.boardId}/${raw.id}: ${error instanceof Error ? error.message : "Unknown job error"}`;
            sourceErrors.push(message);
            summary.errors.push(message);
          }
        }
      } catch (error) {
        sourceFetchFailed = true;
        const message = `${connector.provider}/${source.boardId}: ${error instanceof Error ? error.message : "Unknown source error"}`;
        sourceErrors.push(message);
        summary.errors.push(message);
      }
    }

    const status = sourceFetchFailed ? "FAILED" : sourceErrors.length ? "PARTIAL" : "SUCCESS";
    // Only retire missing listings after a non-empty, fully processed board snapshot.
    // Empty feeds and partial/failed runs are not strong enough evidence to deactivate jobs.
    if (status === "SUCCESS" && fetched > 0 && connector && seenExternalIds.size > 0) {
      const result = await prisma.job.updateMany({
        where: {
          source: connector.provider,
          sourceBoardId: source.boardId,
          status: { not: "INACTIVE" },
          externalId: { notIn: [...seenExternalIds] }
        },
        data: { status: "INACTIVE" }
      });
      deactivated = result.count;
      summary.deactivated += deactivated;
    }
    await prisma.syncRun.create({
      data: {
        provider: source.provider,
        boardId: source.boardId,
        status,
        fetched,
        inserted,
        updated,
        duplicatesSkipped,
        deactivated,
        errorsJson: JSON.stringify(sourceErrors),
        durationMs: Date.now() - startedMs,
        startedAt,
        completedAt: new Date()
      }
    });
  }

  return summary;
}

/** Syncs one enabled, configured board and records its normal per-board history. */
export async function syncSource(provider: string, boardId: string): Promise<JobSyncSummary> {
  if (activeSync) await activeSync;
  activeSyncKind = "SOURCE";
  activeSync = runSync({ provider, boardId }).finally(() => {
    activeSync = null;
    activeSyncKind = null;
  });
  return activeSync;
}

/** Serializes source/full syncs and coalesces overlapping full-sync requests. */
export function syncJobs(): Promise<JobSyncSummary> {
  if (activeSync && activeSyncKind === "FULL") return activeSync;
  if (activeSync) return activeSync.then(() => syncJobs());
  activeSyncKind = "FULL";
  activeSync = runSync().finally(() => {
    activeSync = null;
    activeSyncKind = null;
  });
  return activeSync;
}
