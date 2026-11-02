import { analyzeJobFit, type ResumeEvidence } from "./fit-analysis.js";
import type { CandidatePreferences } from "./intelligence.js";

export type ApplicationDraftInput = {
  job: { title: string; company: string; location: string | null; category: string; skills: string[]; description: string };
  profile: CandidatePreferences;
  resume: ResumeEvidence;
};

export type GeneratedApplicationDraft = {
  resumeSummary: string;
  highlights: string[];
  coverLetter: string;
  reviewNotes: string[];
};

function unique(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

export function generateApplicationDraft(input: ApplicationDraftInput): GeneratedApplicationDraft {
  const { job, profile, resume } = input;
  const analysis = analyzeJobFit(job, profile, resume);
  const highlights = unique(analysis.evidence.flatMap(item => item.excerpts)).slice(0, 5);
  const skillMatches = analysis.matchedSkills.slice(0, 8);
  const relevantExperience = unique(resume.experience.filter(line =>
    analysis.evidence.some(item => item.sections.includes("Experience") && item.excerpts.includes(line.slice(0, 180)))
  )).slice(0, 3);
  const relevantProjects = unique(resume.projects.filter(line =>
    analysis.evidence.some(item => item.sections.includes("Projects") && item.excerpts.includes(line.slice(0, 180)))
  )).slice(0, 3);

  const summaryParts: string[] = [];
  if (skillMatches.length) summaryParts.push("Relevant profile skills: " + skillMatches.join(", ") + ".");
  if (relevantExperience.length) summaryParts.push("Relevant experience: " + relevantExperience.join(" "));
  if (relevantProjects.length) summaryParts.push("Relevant projects: " + relevantProjects.join(" "));
  const resumeSummary = summaryParts.join("\n\n");

  const evidenceParagraphs = [
    ...(skillMatches.length ? ["My reviewed candidate profile lists " + skillMatches.join(", ") + " among my skills."] : []),
    ...(relevantExperience.length ? ["Relevant experience from my resume includes: " + relevantExperience.join(" ") ] : []),
    ...(relevantProjects.length ? ["Relevant project work includes: " + relevantProjects.join(" ") ] : [])
  ];
  const coverLetter = [
    "Dear Hiring Team,",
    "",
    "I am writing to express my interest in the " + job.title + " position at " + job.company + ".",
    "",
    ...evidenceParagraphs,
    ...(evidenceParagraphs.length ? [""] : []),
    "I would welcome the opportunity to discuss how my background aligns with the role and the needs of your team.",
    "",
    "Thank you for your time and consideration.",
    "",
    "Sincerely,",
    "[Your Name]"
  ].join("\n");

  const reviewNotes = [
    ...(!profile.skills.length ? ["Your candidate profile has no saved skills yet; add only skills you can substantiate."] : []),
    ...(!highlights.length ? ["No direct resume evidence matched the detected job skills. Add relevant details only if they are accurate."] : []),
    "The draft uses only your reviewed local profile and resume entries. Verify every sentence and replace [Your Name] before using it.",
    "This is an editable preparation draft only. It does not submit an application or contact the employer."
  ];

  return { resumeSummary, highlights, coverLetter, reviewNotes };
}
