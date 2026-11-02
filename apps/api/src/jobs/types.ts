export interface ProviderJob {
  id: string;
  title: string;
  company: string;
  location?: string | null;
  description?: string | null;
  url: string;
  publishedAt?: string | null;
  employmentType?: string | null;
}
export interface JobConnector {
  provider: string;
  fetchBoard(boardId: string): Promise<ProviderJob[]>;
}
