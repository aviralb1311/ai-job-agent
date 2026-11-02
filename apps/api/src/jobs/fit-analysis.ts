import { SKILL_KEYWORDS, scoreJobMatch, type CandidatePreferences } from "./intelligence.js";

export type ResumeEvidence = {
  skills: string[];
  education: string[];
  experience: string[];
  projects: string[];
  certifications: string[];
};

export type JobFitAnalysis = {
  score: number | null;
  breakdown: {
    skills: { score: number | null; matched: number; total: number; weight: 70 };
    role: { matched: boolean | null; weight: 20 };
    location: { matched: boolean | null; weight: 10 };
  };
  matchedSkills: string[];
  missingSkills: string[];
  requiredSkills: string[];
  preferredSkills: string[];
  otherMentionedSkills: string[];
  missingRequiredSkills: string[];
  missingPreferredSkills: string[];
  evidence: Array<{ skill: string; sections: string[]; excerpts: string[] }>;
  strengths: string[];
  gaps: string[];
  recommendations: string[];
  disclaimer: string;
};

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function skillPattern(skill: string): RegExp {
  const normalized = skill.toLowerCase();
  const source = normalized === "rest api" ? "rest apis?" : escapeRegex(normalized);
  return new RegExp("(^|[^a-z0-9+#])" + source + "($|[^a-z0-9+#])", "i");
}

function classifyRequirements(description: string, skills: string[]) {
  const plain = description.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ");
  const sentences = plain.split(/[.!?;\n•]+/).map(item => item.trim()).filter(Boolean);
  const required: string[] = [];
  const preferred: string[] = [];
  const mentioned: string[] = [];

  for (const skill of skills) {
    const matching = sentences.filter(sentence => skillPattern(skill).test(sentence));
    const context = matching.join(" ").toLowerCase();
    if (/\b(required|must[- ]have|must|required to|minimum|proficien(?:t|cy)|strong knowledge|hands[- ]on|experience with|need to)\b/.test(context)) {
      required.push(skill);
    } else if (/\b(preferred|nice to have|bonus|plus|ideally|desirable|good to have)\b/.test(context)) {
      preferred.push(skill);
    } else {
      mentioned.push(skill);
    }
  }
  return { required, preferred, mentioned };
}

function findEvidence(skill: string, resume: ResumeEvidence) {
  const sections: Array<[keyof ResumeEvidence, string]> = [
    ["skills", "Skills"], ["experience", "Experience"], ["projects", "Projects"],
    ["certifications", "Certifications"], ["education", "Education"]
  ];
  const matchedSections: string[] = [];
  const excerpts: string[] = [];
  const pattern = skillPattern(skill);
  for (const [key, label] of sections) {
    const lines = resume[key].filter(line => pattern.test(line));
    if (lines.length) {
      matchedSections.push(label);
      excerpts.push(...lines.slice(0, 2).map(line => line.slice(0, 180)));
    }
  }
  return { skill, sections: matchedSections, excerpts: excerpts.slice(0, 4) };
}

export function analyzeJobFit(
  job: { title: string; location: string | null; category: string; skills: string[]; description: string },
  profile: CandidatePreferences,
  resume: ResumeEvidence
): JobFitAnalysis {
  const base = scoreJobMatch(job, profile);
  const requirements = classifyRequirements(job.description, job.skills.length ? job.skills : [...SKILL_KEYWORDS].filter(skill => skillPattern(skill).test(job.description)));
  const matched = new Set(base.matchedSkills.map(item => item.toLowerCase()));
  const missingRequiredSkills = requirements.required.filter(skill => !matched.has(skill.toLowerCase()));
  const missingPreferredSkills = requirements.preferred.filter(skill => !matched.has(skill.toLowerCase()));
  const evidence = base.matchedSkills.map(skill => findEvidence(skill, resume));
  const strengths = [
    ...base.reasons,
    ...(evidence.some(item => item.sections.includes("Projects")) ? ["A matching skill appears in your saved project details"] : []),
    ...(evidence.some(item => item.sections.includes("Experience")) ? ["A matching skill appears in your saved experience details"] : [])
  ];
  const gaps = [
    ...(missingRequiredSkills.length ? ["Required skills not listed in your profile: " + missingRequiredSkills.join(", ")] : []),
    ...(missingPreferredSkills.length ? ["Preferred skills not listed in your profile: " + missingPreferredSkills.join(", ")] : []),
    ...(base.missingSkills.length ? ["Profile skills not detected in this job description: " + base.missingSkills.join(", ")] : [])
  ];
  const recommendations = [
    ...(missingRequiredSkills.length ? ["Review the role's required skills and add evidence only if you genuinely have that experience."] : []),
    ...(evidence.some(item => item.sections.includes("Projects")) ? ["Consider highlighting the relevant project evidence when tailoring your application."] : []),
    ...(evidence.some(item => item.sections.includes("Experience")) ? ["Use the matching experience entries to support relevant claims in your application."] : []),
    ...(!evidence.length && base.matchedSkills.length ? ["Add project or experience context to your profile if you have genuine examples for these skills."] : [])
  ];
  const skillsScore = base.matchedSkills.length || base.missingSkills.length
    ? Math.round(base.matchedSkills.length / (base.matchedSkills.length + base.missingSkills.length) * 100) : null;
  return {
    score: base.score,
    breakdown: {
      skills: { score: skillsScore, matched: base.matchedSkills.length, total: base.matchedSkills.length + base.missingSkills.length, weight: 70 },
      role: { matched: base.breakdown.role.matched, weight: 20 },
      location: { matched: base.breakdown.location.matched, weight: 10 }
    },
    matchedSkills: base.matchedSkills,
    missingSkills: base.missingSkills,
    requiredSkills: requirements.required,
    preferredSkills: requirements.preferred,
    otherMentionedSkills: requirements.mentioned,
    missingRequiredSkills,
    missingPreferredSkills,
    evidence,
    strengths: [...new Set(strengths)],
    gaps,
    recommendations: [...new Set(recommendations)],
    disclaimer: "This is a transparent keyword-based comparison of your saved profile and the public job description. It does not verify qualifications or predict hiring outcomes. Requirement labels are heuristic; review the original listing."
  };
}
