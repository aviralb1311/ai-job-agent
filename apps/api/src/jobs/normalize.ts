import type { NormalizedJob } from "@job-agent/shared";
import type { ProviderJob } from "./types.js";

export function normalizeJob(provider: string, raw: ProviderJob): NormalizedJob {
  const published = raw.publishedAt ? new Date(raw.publishedAt) : null;
  const validPublished = published && !Number.isNaN(published.getTime()) ? published.toISOString() : null;
  const type = (raw.employmentType ?? "").toLowerCase();
  const employmentType = type.includes("intern") ? "INTERNSHIP"
    : type.includes("part") ? "PART_TIME"
    : type.includes("contract") ? "CONTRACT"
    : type.includes("full") ? "FULL_TIME" : "UNKNOWN";
  return {
    source: provider,
    externalId: raw.id,
    title: raw.title.trim(),
    company: raw.company.trim(),
    location: raw.location?.trim() || null,
    description: raw.description ?? "",
    employmentType,
    applicationUrl: raw.url,
    publishedAt: validPublished,
    discoveredAt: new Date().toISOString(),
    lastVerifiedAt: null,
    status: "UNKNOWN"
  };
}

/**
 * Produces a stable URL key for cross-provider duplicate detection.
 * Tracking parameters and fragments are ignored; meaningful query parameters remain.
 */
export function canonicalizeUrl(value: string): string {
  try {
    const url = new URL(value.trim());
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_.+|gh_src|source)$/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString().replace(/\/$/, url.search ? "/" : "");
  } catch {
    return value.trim();
  }
}
