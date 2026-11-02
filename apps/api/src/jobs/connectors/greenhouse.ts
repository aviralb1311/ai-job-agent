import { config } from "../../config.js";
import type { JobConnector, ProviderJob } from "../types.js";

interface GreenhouseJob {
  id?: string | number;
  title?: string;
  absolute_url?: string;
  content?: string | null;
  location?: { name?: string | null } | null;
  custom_fields?: Array<{ name?: string; value?: unknown }>;
}

interface GreenhouseResponse {
  jobs?: GreenhouseJob[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getEmploymentType(fields: GreenhouseJob["custom_fields"]): string | null {
  if (!Array.isArray(fields)) return null;
  const field = fields.find(item =>
    typeof item?.name === "string" &&
    /employment[_ ]?type/i.test(item.name)
  );
  return typeof field?.value === "string" ? field.value : null;
}

export const greenhouseConnector: JobConnector = {
  provider: "GREENHOUSE",

  async fetchBoard(boardId: string): Promise<ProviderJob[]> {
    const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(boardId)}/jobs?content=true`;
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(config.SOURCE_TIMEOUT_MS)
    });

    if (!response.ok) {
      throw new Error(`Greenhouse board "${boardId}" returned HTTP ${response.status}`);
    }

    const payload: unknown = await response.json();
    if (!isRecord(payload) || !Array.isArray(payload.jobs)) {
      throw new Error(`Greenhouse board "${boardId}" returned an invalid jobs response`);
    }

    return (payload as GreenhouseResponse).jobs!
      .filter((job): job is GreenhouseJob => {
        return isRecord(job) &&
          (typeof job.id === "string" || typeof job.id === "number") &&
          typeof job.title === "string" &&
          typeof job.absolute_url === "string" &&
          job.absolute_url.length > 0;
      })
      .map(job => ({
        id: String(job.id),
        title: job.title!.trim(),
        company: boardId,
        location: typeof job.location?.name === "string" ? job.location.name : null,
        description: typeof job.content === "string" ? job.content : "",
        url: job.absolute_url!,
        // Greenhouse's updated_at is not a publication timestamp; do not infer one.
        publishedAt: null,
        employmentType: getEmploymentType(job.custom_fields)
      }))
      .filter(job => job.title.length > 0);
  }
};
