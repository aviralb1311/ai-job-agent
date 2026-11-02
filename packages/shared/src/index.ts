export type EmploymentType = "FULL_TIME" | "PART_TIME" | "INTERNSHIP" | "CONTRACT" | "UNKNOWN";
export type JobStatus = "ACTIVE" | "EXPIRED" | "UNKNOWN";

export interface NormalizedJob {
  source: string;
  externalId: string;
  title: string;
  company: string;
  location: string | null;
  description: string;
  employmentType: EmploymentType;
  applicationUrl: string;
  publishedAt: string | null;
  discoveredAt: string;
  lastVerifiedAt: string | null;
  status: JobStatus;
  category: string;
  skillsJson: string;
}
