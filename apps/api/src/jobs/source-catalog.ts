export type SourceProvider = "GREENHOUSE" | "LEVER" | "ASHBY";

export interface SourceCatalogEntry {
  id: string;
  provider: SourceProvider;
  boardId: string;
  displayName: string;
  description: string;
  careersUrl: string;
  focus: string;
}

/**
 * Curated starter boards discovered from publicly indexed employer career pages.
 * Availability and board slugs can change; every source must be validated live
 * by the user before it is used for synchronization.
 */
export const sourceCatalog: SourceCatalogEntry[] = [
  {
    id: "deepintent-greenhouse",
    provider: "GREENHOUSE",
    boardId: "deepintent",
    displayName: "DeepIntent",
    description: "Public Greenhouse board; recent listings include Pune-based engineering roles.",
    careersUrl: "https://boards.greenhouse.io/deepintent",
    focus: "India · Pune"
  },
  {
    id: "sixsense-greenhouse",
    provider: "GREENHOUSE",
    boardId: "6sense",
    displayName: "6sense",
    description: "Public Greenhouse board with engineering listings in Bengaluru.",
    careersUrl: "https://boards.greenhouse.io/6sense",
    focus: "India · Bengaluru"
  },
  {
    id: "aleph-lever",
    provider: "LEVER",
    boardId: "aleph",
    displayName: "Aleph",
    description: "Public Lever board with India-based roles, including Mumbai listings.",
    careersUrl: "https://jobs.lever.co/aleph",
    focus: "India · Mumbai"
  },
  {
    id: "shieldai-lever",
    provider: "LEVER",
    boardId: "shieldai",
    displayName: "Shield AI",
    description: "Public Lever board with engineering roles in Bengaluru and New Delhi.",
    careersUrl: "https://jobs.lever.co/shieldai",
    focus: "India · Bengaluru / New Delhi"
  },
  {
    id: "sarvam-ashby",
    provider: "ASHBY",
    boardId: "sarvam",
    displayName: "Sarvam AI",
    description: "Public Ashby board; recently indexed a Bengaluru backend internship.",
    careersUrl: "https://jobs.ashbyhq.com/sarvam",
    focus: "India · Bengaluru"
  },
  {
    id: "interview-kickstart-ashby",
    provider: "ASHBY",
    boardId: "interview-kickstart",
    displayName: "Interview Kickstart",
    description: "Public Ashby board; recently indexed remote-India software engineering internships.",
    careersUrl: "https://jobs.ashbyhq.com/interview-kickstart",
    focus: "Remote · India"
  }
];
