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
export interface MatchResult { score: number | null; matchedSkills: string[]; missingSkills: string[]; reasons: string[]; }

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

export function scoreJobMatch(job: { title: string; location: string | null; category: string; skills: string[] }, profile: CandidatePreferences): MatchResult {
  const dimensions: Array<{ points: number; max: number }> = [];
  const matchedSkills = profile.skills.filter(skill => job.skills.some(found => found.toLowerCase() === skill.toLowerCase()));
  const missingSkills = profile.skills.filter(skill => !matchedSkills.some(found => found.toLowerCase() === skill.toLowerCase()));
  const reasons: string[] = [];
  if (profile.skills.length) {
    dimensions.push({ points: (matchedSkills.length / profile.skills.length) * 70, max: 70 });
    if (matchedSkills.length) reasons.push("Matches " + matchedSkills.length + " of " + profile.skills.length + " preferred skills");
  }
  if (profile.preferredRoles.length) {
    const matched = profile.preferredRoles.some(role => job.category.toLowerCase() === role.toLowerCase() || job.title.toLowerCase().includes(role.toLowerCase()));
    dimensions.push({ points: matched ? 20 : 0, max: 20 });
    if (matched) reasons.push("Matches a preferred role");
  }
  if (profile.locations.length || profile.remotePreference !== "ANY") {
    const place = (job.location ?? "").toLowerCase();
    const remote = profile.remotePreference === "ANY" || (profile.remotePreference === "REMOTE" && /remote|anywhere|distributed/.test(place)) || (profile.remotePreference === "HYBRID" && /hybrid/.test(place)) || (profile.remotePreference === "ONSITE" && !/remote|hybrid/.test(place));
    const location = !profile.locations.length || profile.locations.some(item => place.includes(item.toLowerCase()));
    dimensions.push({ points: remote && location ? 10 : 0, max: 10 });
    if (remote && location) reasons.push("Matches location preferences");
  }
  const totalMax = dimensions.reduce((sum, item) => sum + item.max, 0);
  const score = totalMax ? Math.round(dimensions.reduce((sum, item) => sum + item.points, 0) / totalMax * 100) : null;
  return { score, matchedSkills, missingSkills, reasons };
}
