import type { JobConnector, ProviderJob } from "../types.js";

export const ashbyConnector: JobConnector = {
  provider: "ASHBY",
  async fetchBoard(board: string): Promise<ProviderJob[]> {
    const response = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board)}?includeCompensation=true`);
    if (!response.ok) throw new Error(`Ashby ${board}: HTTP ${response.status}`);
    const data = await response.json() as { jobs?: any[] };
    return (data.jobs ?? []).map(job => ({
      id: String(job.id), title: job.title, company: board,
      location: job.location ?? null, description: job.descriptionPlain ?? job.descriptionHtml ?? "",
      url: job.jobUrl, publishedAt: job.publishedAt ?? null,
      employmentType: job.employmentType ?? null
    })).filter(job => Boolean(job.url));
  }
};
