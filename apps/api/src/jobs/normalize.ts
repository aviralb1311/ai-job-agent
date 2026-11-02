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

export function canonicalizeUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|gh_src|source)/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return value.trim();
  }
}
