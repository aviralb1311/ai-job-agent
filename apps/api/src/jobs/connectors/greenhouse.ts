import type { JobConnector, ProviderJob } from "../types.js";

export const greenhouseConnector: JobConnector = {
  provider: "GREENHOUSE",
  async fetchBoard(boardId: string): Promise<ProviderJob[]> {
    const response = await fetch(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(boardId)}/jobs?content=true`);
    if (!response.ok) throw new Error(`Greenhouse ${boardId}: HTTP ${response.status}`);
    const data = await response.json() as { jobs?: any[] };
    return (data.jobs ?? []).map(job => ({
      id: String(job.id), title: job.title, company: boardId,
      location: job.location?.name ?? null, description: job.content ?? "",
      url: job.absolute_url, publishedAt: job.updated_at ?? null
    }));
  }
};
