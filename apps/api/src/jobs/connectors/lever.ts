import { config } from "../../config.js";
import type { JobConnector, ProviderJob } from "../types.js";

interface LeverPosting {
  id?: string;
  text?: string;
  hostedUrl?: string;
  descriptionPlain?: string | null;
  createdAt?: number | string | null;
  categories?: {
    location?: string | null;
    commitment?: string | null;
  } | null;
  lists?: Array<{ text?: string; content?: string }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCreatedAt(value: LeverPosting["createdAt"]): string | null {
  if (value === null || value === undefined) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function descriptionFor(posting: LeverPosting): string {
  const sections = [
    posting.descriptionPlain,
    ...(posting.lists ?? []).map(section =>
      [section.text, section.content].filter(Boolean).join("\n")
    )
  ].filter((section): section is string => typeof section === "string" && section.length > 0);
  return sections.join("\n\n");
}

export const leverConnector: JobConnector = {
  provider: "LEVER",

  async fetchBoard(site: string): Promise<ProviderJob[]> {
    const url = `https://api.lever.co/v0/postings/${encodeURIComponent(site)}?mode=json`;
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "AIJobAgent/0.1 (public job board reader)"
      },
      signal: AbortSignal.timeout(config.SOURCE_TIMEOUT_MS)
    });

    if (!response.ok) {
      throw new Error(`Lever site "${site}" returned HTTP ${response.status}`);
    }

    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) {
      throw new Error(`Lever site "${site}" returned an invalid postings response`);
    }

    return payload
      .filter((item): item is LeverPosting => {
        return isRecord(item) &&
          typeof item.id === "string" &&
          typeof item.text === "string" &&
          typeof item.hostedUrl === "string" &&
          item.hostedUrl.length > 0;
      })
      .map(posting => ({
        id: posting.id!,
        title: posting.text!.trim(),
        company: site,
        location: typeof posting.categories?.location === "string"
          ? posting.categories.location : null,
        description: descriptionFor(posting),
        url: posting.hostedUrl!,
        publishedAt: parseCreatedAt(posting.createdAt),
        employmentType: typeof posting.categories?.commitment === "string"
          ? posting.categories.commitment : null
      }))
      .filter(posting => posting.title.length > 0);
  }
};
