import type { JobConnector, ProviderJob } from "../types.js";

export const leverConnector: JobConnector = {
  provider: "LEVER",
  async fetchBoard(site: string): Promise<ProviderJob[]> {
    const response = await fetch(`https://api.lever.co/v0/postings/${encodeURIComponent(site)}?mode=json`);
    if (!response.ok) throw new Error(`Lever ${site}: HTTP ${response.status}`);
    const data = await response.json() as any[];
    return data.map(job => ({
      id: String(job.id), title: job.text, company: site,
      location: job.categories?.location ?? null,
      description: [job.descriptionPlain, ...(job.lists ?? []).map((x: any) => x.text + "\n" + x.content)].filter(Boolean).join("\n\n"),
      url: job.hostedUrl, publishedAt: job.createdAt ? new Date(job.createdAt).toISOString() : null,
      employmentType: job.categories?.commitment ?? null
    }));
  }
};
