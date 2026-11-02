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
 * Candidate public boards found from employer career pages and recent public listings.
 * The live feed is checked when a user adds a source; this catalog does not imply
 * that any particular vacancy is still open or suitable for a given candidate.
 */
export const sourceCatalog: SourceCatalogEntry[] = [
  {
    id: "deepintent-greenhouse",
    provider: "GREENHOUSE",
    boardId: "deepintent",
    displayName: "DeepIntent",
    description: "Public Greenhouse board. Recent listings have included engineering roles.",
    careersUrl: "https://boards.greenhouse.io/deepintent",
    focus: "India · Pune"
  },
  {
    id: "sixsense-greenhouse",
    provider: "GREENHOUSE",
    boardId: "6sense",
    displayName: "6sense",
    description: "Public Greenhouse board with recent Bengaluru engineering listings.",
    careersUrl: "https://boards.greenhouse.io/6sense",
    focus: "India · Bengaluru"
  },
  {
    id: "shieldai-lever",
    provider: "LEVER",
    boardId: "shieldai",
    displayName: "Shield AI",
    description: "Public Lever board with engineering roles; check seniority and eligibility.",
    careersUrl: "https://jobs.lever.co/shieldai",
    focus: "India · Bengaluru"
  },
  {
    id: "sarvam-ashby",
    provider: "ASHBY",
    boardId: "sarvam",
    displayName: "Sarvam AI",
    description: "Public Ashby board; previously listed backend engineering internships.",
    careersUrl: "https://jobs.ashbyhq.com/sarvam",
    focus: "India · Bengaluru"
  },
  {
    id: "interview-kickstart-ashby",
    provider: "ASHBY",
    boardId: "interview-kickstart",
    displayName: "Interview Kickstart",
    description: "Public Ashby board with previously indexed India software engineering roles.",
    careersUrl: "https://jobs.ashbyhq.com/interview-kickstart",
    focus: "Remote · India"
  },
  {
    id: "certa-ashby",
    provider: "ASHBY",
    boardId: "certa",
    displayName: "Certa",
    description: "Public Ashby board; previously listed a Backend Engineer internship in India.",
    careersUrl: "https://jobs.ashbyhq.com/certa",
    focus: "India · Backend"
  },
  {
    id: "meraki-labs-ashby",
    provider: "ASHBY",
    boardId: "Meraki-Labs",
    displayName: "Meraki Labs",
    description: "Public Ashby board; previously listed an AI Engineer internship in Bengaluru.",
    careersUrl: "https://jobs.ashbyhq.com/Meraki-Labs",
    focus: "India · Bengaluru"
  },
  {
    id: "evaratus-ashby",
    provider: "ASHBY",
    boardId: "evaratus",
    displayName: "Evaratus",
    description: "Public Ashby board; previously listed a software engineering internship in Bengaluru.",
    careersUrl: "https://jobs.ashbyhq.com/evaratus",
    focus: "India · Bengaluru"
  }
];
