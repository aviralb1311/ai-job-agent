export type WorkMode = "REMOTE" | "HYBRID" | "ONSITE" | "UNKNOWN";
export type JobSort = "NEWEST" | "MATCH" | "RELEVANCE";

export type TextRelevance = {
  score: number;
  reasons: string[];
};

const SEARCH_STOP_WORDS = new Set([
  "a", "an", "and", "at", "by", "for", "from", "in", "job", "jobs", "of", "on", "or", "the", "to", "with"
]);

function searchTokens(value: string): string[] {
  return value.normalize("NFKC").toLocaleLowerCase("en-IN").match(/[\p{L}\p{N}]+(?:[.#][\p{L}\p{N}]+|[+#]+)*/gu) ?? [];
}

export function tokenizeSearchQuery(query: string): string[] {
  const tokens = searchTokens(query);
  const meaningful = tokens.filter(token => !SEARCH_STOP_WORDS.has(token));
  // Preserve searches consisting only of common words, while ignoring punctuation-only input.
  return meaningful.length ? meaningful : tokens;
}

function tokenMatches(queryToken: string, fieldToken: string): boolean {
  if (queryToken.length < 2) return queryToken === fieldToken;
  return fieldToken.startsWith(queryToken);
}

export function matchesSearchQuery(title: string, company: string, description: string, query: string): boolean {
  const terms = tokenizeSearchQuery(query);
  if (!terms.length) return true;
  const fields = [title, company, description].map(searchTokens);
  return terms.every(term => fields.some(tokens => tokens.some(token => tokenMatches(term, token))));
}

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

function hasConsecutiveTerms(tokens: string[], terms: string[]): boolean {
  return tokens.some((_, start) => terms.every((term, index) =>
    tokens[start + index] !== undefined && tokenMatches(term, tokens[start + index])
  ));
}

export function textRelevance(title: string, company: string, description: string, query: string): TextRelevance {
  const terms = tokenizeSearchQuery(query);
  if (!terms.length) return { score: 0, reasons: [] };

  const fields = [
    { name: "Title", tokens: searchTokens(title), weight: 1, tier: 60, phraseBonus: 10 },
    { name: "Company", tokens: searchTokens(company), weight: 0.65, tier: 35, phraseBonus: 5 },
    { name: "Description", tokens: searchTokens(description), weight: 0.3, tier: 10, phraseBonus: 2 }
  ];
  const matches = fields.map(field => ({
    ...field,
    matchedTerms: terms.filter(term => field.tokens.some(token => tokenMatches(term, token)))
  }));
  const bestField = matches.find(field => field.matchedTerms.length > 0);
  if (!bestField) return { score: 0, reasons: [] };

  const coverage = terms.reduce((sum, term) => {
    const field = matches.find(candidate => candidate.tokens.some(token => tokenMatches(term, token)));
    return sum + (field?.weight ?? 0);
  }, 0) / terms.length;
  const phraseField = matches.find(field => hasConsecutiveTerms(field.tokens, terms));
  const score = Math.min(100, Math.round(bestField.tier + coverage * 30 + (phraseField?.phraseBonus ?? 0)));
  const reasons = matches
    .filter(field => field.matchedTerms.length)
    .map(field => `${field.name} contains: ${field.matchedTerms.join(", ")}`);
  if (phraseField) reasons.unshift(`All search words appear together in the ${phraseField.name.toLowerCase()}.`);
  return { score, reasons };
}

export function overallRelevanceScore(textScore: number, profileScore: number | null, hasQuery: boolean): number {
  if (!hasQuery) return profileScore ?? 0;
  if (profileScore === null) return textScore;
  // Search-term relevance leads the combined score; the existing profile score contributes 30%.
  return Math.round(textScore * 0.7 + profileScore * 0.3);
}
