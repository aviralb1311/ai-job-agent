export type WorkMode = "REMOTE" | "HYBRID" | "ONSITE" | "UNKNOWN";
export type JobSort = "NEWEST" | "MATCH" | "RELEVANCE";

export function inferWorkMode(location: string | null, description: string): WorkMode {
  const text = `${location ?? ""} ${description}`.toLowerCase();
  if (/\bhybrid\b/.test(text)) return "HYBRID";
  if (/\b(remote|work from home|work-from-home|fully distributed)\b/.test(text)) return "REMOTE";
  if (/\b(onsite|on-site|in office|in-office|office based|office-based)\b/.test(text)) return "ONSITE";
  return "UNKNOWN";
}

export function matchesWorkMode(location: string | null, description: string, requested: string): boolean {
  return requested === "ANY" || inferWorkMode(location, description) === requested;
}

export function matchesRequiredSkills(jobSkills: string[], requiredSkills: string[]): boolean {
  const normalized = jobSkills.map(skill => skill.toLowerCase());
  return requiredSkills.every(required => normalized.some(skill =>
    skill.includes(required.toLowerCase()) || required.toLowerCase().includes(skill)
  ));
}

export function textRelevance(title: string, company: string, description: string, query: string): number {
  const term = query.trim().toLowerCase();
  if (!term) return 0;
  const normalizedTitle = title.toLowerCase();
  const normalizedCompany = company.toLowerCase();
  if (normalizedTitle.startsWith(term)) return 4;
  if (normalizedTitle.includes(term)) return 3;
  if (normalizedCompany.startsWith(term)) return 2;
  if (normalizedCompany.includes(term)) return 1;
  if (description.toLowerCase().includes(term)) return 0.5;
  return 0;
}
