import { config } from "../../config.js";
import type { JobConnector, ProviderJob } from "../types.js";

interface AshbyPosting {
  id?: string;
  title?: string;
  jobUrl?: string;
  descriptionPlain?: string | null;
  descriptionHtml?: string | null;
  location?: string | null;
  publishedAt?: string | null;
  employmentType?: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export const ashbyConnector: JobConnector = {
  provider: "ASHBY",

  async fetchBoard(board: string): Promise<ProviderJob[]> {
    const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board)}?includeCompensation=true`;
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(config.SOURCE_TIMEOUT_MS)
    });

    if (!response.ok) {
      throw new Error(`Ashby board "${board}" returned HTTP ${response.status}`);
    }

    const payload: unknown = await response.json();
    if (!isRecord(payload) || !Array.isArray(payload.jobs)) {
      throw new Error(`Ashby board "${board}" returned an invalid jobs response`);
    }

    return (payload.jobs as unknown[])
      .filter((item): item is AshbyPosting => {
        return isRecord(item) &&
          typeof item.id === "string" &&
          typeof item.title === "string" &&
          typeof item.jobUrl === "string" &&
          item.jobUrl.length > 0;
      })
      .map(posting => ({
        id: posting.id!,
        title: posting.title!.trim(),
        company: board,
        location: typeof posting.location === "string" ? posting.location : null,
        description: typeof posting.descriptionPlain === "string"
          ? posting.descriptionPlain
          : typeof posting.descriptionHtml === "string" ? posting.descriptionHtml : "",
        url: posting.jobUrl!,
        publishedAt: validDate(posting.publishedAt),
        employmentType: typeof posting.employmentType === "string" ? posting.employmentType : null
      }))
      .filter(posting => posting.title.length > 0);
  }
};
