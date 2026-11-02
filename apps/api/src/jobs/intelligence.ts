export const SKILL_KEYWORDS = [
  "javascript", "typescript", "node.js", "express", "react", "next.js", "python",
  "java", "c++", "go", "rust", "sql", "postgresql", "mysql", "sqlite", "mongodb",
  "redis", "prisma", "drizzle", "docker", "kubernetes", "aws", "azure", "gcp",
  "git", "linux", "rest api", "graphql", "microservices", "system design",
  "machine learning", "deep learning", "pytorch", "tensorflow", "scikit-learn",
  "opencv", "computer vision", "nlp", "llm", "generative ai", "data structures",
  "algorithms", "html", "css", "tailwind", "vite", "jest", "vitest", "playwright",
  "ci/cd", "terraform", "fastapi", "django", "flask", "spring boot", "agile"
] as const;

export type JobCategory = "BACKEND" | "FRONTEND" | "FULL_STACK" | "DEVOPS" | "DATA_SCIENCE" | "MACHINE_LEARNING" | "MOBILE" | "QA" | "SECURITY" | "PRODUCT" | "OTHER";
export interface JobIntelligence { category: JobCategory; skills: string[]; }
export interface CandidatePreferences { skills: string[]; preferredRoles: string[]; locations: string[]; remotePreference: "ANY" | "REMOTE" | "ONSITE" | "HYBRID"; }
export interface MatchResult {
  score: number | null;
  matchedSkills: string[];
  missingSkills: string[];
  reasons: string[];
  breakdown: {
    skills: { score: number | null; matched: number; total: number; weight: 70 };
    role: { matched: boolean | null; weight: 20 };
    location: { matched: boolean | null; weight: 10 };
  };
}

const categoryRules: Array<[JobCategory, RegExp]> = [
  ["MACHINE_LEARNING", /machine learning|deep learning|ml engineer|ai engineer|artificial intelligence|computer vision|nlp engineer/],
  ["DATA_SCIENCE", /data scientist|data science|analytics engineer|data analyst/],
  ["DEVOPS", /devops|site reliability|sre|platform engineer|cloud engineer|infrastructure engineer/],
  ["SECURITY", /security engineer|application security|cybersecurity|infosec/],
  ["QA", /quality assurance|qa engineer|test engineer|automation engineer/],
  ["MOBILE", /android|ios engineer|mobile developer|react native|flutter developer/],
  ["FULL_STACK", /full.?stack/], ["FRONTEND", /frontend|front.?end|ui engineer|web developer/],
  ["BACKEND", /backend|back.?end|server.?side|api engineer/], ["PRODUCT", /product manager|product owner|program manager/]
];

export function analyzeJob(title: string, description: string): JobIntelligence {
  const text = (title + " " + description).toLowerCase().replace(/<[^>]*>/g, " ");
  const skills = SKILL_KEYWORDS.filter(skill => {
    const escaped = skill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = skill === "rest api" ? "rest apis?" : escaped;
    return new RegExp("(^|[^a-z0-9+#])" + pattern + "($|[^a-z0-9+#])", "i").test(text);
  });
  const category = categoryRules.find(([, pattern]) => pattern.test(title.toLowerCase()))?.[0] ?? "OTHER";
  return { category, skills: [...skills] };
}

function normalizeRole(value: string): string {
  const text = value.toLowerCase().replace(/[_-]+/g, " ").trim();
  if (/machine learning|deep learning|\bml\b|\bai\b|artificial intelligence/.test(text)) return "MACHINE_LEARNING";
  if (/data science|data scientist|data analyst/.test(text)) return "DATA_SCIENCE";
  if (/devops|site reliability|\bsre\b|platform engineer|cloud engineer/.test(text)) return "DEVOPS";
  if (/security|cybersecurity|infosec/.test(text)) return "SECURITY";
  if (/quality assurance|\bqa\b|test engineer/.test(text)) return "QA";
  if (/mobile|android|ios|flutter|react native/.test(text)) return "MOBILE";
  if (/full stack/.test(text)) return "FULL_STACK";
  if (/frontend|front end|ui engineer/.test(text)) return "FRONTEND";
  if (/backend|back end|server side|api engineer/.test(text)) return "BACKEND";
  if (/product manager|product owner/.test(text)) return "PRODUCT";
  return text.toUpperCase().replace(/\s+/g, "_");
}

export function scoreJobMatch(
  job: { title: string; location: string | null; category: string; skills: string[] },
  profile: CandidatePreferences
): MatchResult {
  const dimensions: Array<{ points: number; max: number }> = [];
  const matchedSkills = profile.skills.filter(skill => job.skills.some(found => found.toLowerCase() === skill.toLowerCase()));
  const missingSkills = profile.skills.filter(skill => !matchedSkills.some(found => found.toLowerCase() === skill.toLowerCase()));
  const skillScore = profile.skills.length ? Math.round(matchedSkills.length / profile.skills.length * 100) : null;
  const reasons: string[] = [];

  if (profile.skills.length) {
    dimensions.push({ points: (matchedSkills.length / profile.skills.length) * 70, max: 70 });
    if (matchedSkills.length) reasons.push("Matches " + matchedSkills.length + " of " + profile.skills.length + " preferred skills");
  }

  let roleMatched: boolean | null = null;
  if (profile.preferredRoles.length) {
    const jobRole = normalizeRole(job.category);
    roleMatched = profile.preferredRoles.some(role => {
      const normalized = normalizeRole(role);
      return normalized === jobRole || normalized === "OTHER" && job.title.toLowerCase().includes(role.toLowerCase());
    });
    dimensions.push({ points: roleMatched ? 20 : 0, max: 20 });
    if (roleMatched) reasons.push("Matches a preferred role");
  }

  let locationMatched: boolean | null = null;
  if (profile.locations.length || profile.remotePreference !== "ANY") {
    const place = (job.location ?? "").toLowerCase();
    const remote = profile.remotePreference === "ANY"
      || (profile.remotePreference === "REMOTE" && /remote|anywhere|distributed/.test(place))
      || (profile.remotePreference === "HYBRID" && /hybrid/.test(place))
      || (profile.remotePreference === "ONSITE" && Boolean(place) && !/remote|hybrid/.test(place));
    const location = !profile.locations.length || profile.locations.some(item => place.includes(item.toLowerCase()));
    locationMatched = remote && location;
    dimensions.push({ points: locationMatched ? 10 : 0, max: 10 });
    if (locationMatched) reasons.push("Matches location preferences");
  }

  const totalMax = dimensions.reduce((sum, item) => sum + item.max, 0);
  const score = totalMax ? Math.round(dimensions.reduce((sum, item) => sum + item.points, 0) / totalMax * 100) : null;
  return {
    score, matchedSkills, missingSkills, reasons,
    breakdown: {
      skills: { score: skillScore, matched: matchedSkills.length, total: profile.skills.length, weight: 70 },
      role: { matched: roleMatched, weight: 20 },
      location: { matched: locationMatched, weight: 10 }
    }
  };
}
