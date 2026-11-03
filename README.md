# AI Job Agent

A human-in-the-loop job discovery platform. Phase 1 establishes the application foundation, candidate profile, job-source connectors, normalized listings, deduplication, and search APIs.

## Phase 1 scope
- Express + TypeScript API
- React + Vite + TypeScript frontend
- Prisma + SQLite for local development
- Greenhouse, Lever and Ashby public-board connectors (configured by board/company identifiers)
- Job normalization, source attribution, URL-based deduplication, filtering
- No auto-apply, credential collection, or AI-generated match scores in Phase 1

## Requirements
- Node.js 22.12+
- npm 10+

Vitest 5 requires Node.js 22.12 or newer.

## Setup
```bash
npm install
cp apps/api/.env.example apps/api/.env
npm run db:generate
npm run db:migrate
npm run dev
```

Frontend: http://localhost:5173  
API: http://localhost:4000  
Health: http://localhost:4000/api/health

## Configure job sources
Add public board identifiers from the dashboard Source Management panel, or set them in `apps/api/.env`:
```env
GREENHOUSE_BOARDS=example
LEVER_SITES=example
ASHBY_BOARDS=example
``
These are public board identifiers, not arbitrary company names. Check each provider's current API terms and rate limits before production use.

## Scripts
- `npm run dev` — API and frontend
- `npm run build` — build all workspaces
- `npm run test` — run API tests
- `npm run test:live-sources -w @job-agent/api` — manually smoke-test live public feeds (requires three board IDs)
- `npm run db:generate` — generate Prisma client
- `npm run db:migrate` — create/apply local migration

## Continuous integration
GitHub Actions runs on pushes and pull requests targeting `main`. It installs from the lockfile, generates Prisma Client, builds all workspaces, runs API tests, and checks dependencies with `npm audit`.

## Live public-source smoke test
The separate **Live public source smoke test** workflow is manually triggered from GitHub Actions. Supply one valid public board ID for each provider: Greenhouse, Lever, and Ashby. The workflow exercises the actual application connectors, checks that each feed returns at least one posting with required fields, and verifies that a sample can be normalized. It is kept separate from normal CI because third-party boards can change or become temporarily unavailable.

Run it locally with:
```bash
GREENHOUSE_SMOKE_BOARD=your-greenhouse-board \
LEVER_SMOKE_BOARD=your-lever-site \
ASHBY_SMOKE_BOARD=your-ashby-board \
npm run test:live-sources -w @job-agent/api
``

## Job intelligence and matching

Phase 1.12 adds deterministic job-title categorization and skill extraction from public descriptions. The dashboard lets a single local candidate profile store preferred skills, role categories, locations, and work mode. Job results include an explainable heuristic match score (skills 70%, role 20%, location/work mode 10%, with only configured dimensions included), matched/missing skills, and detected skill tags.

This is a transparent keyword-based baseline, not an LLM judgment, a prediction of hiring success, or verification that a candidate possesses a skill. Profile storage is a single local default profile for this MVP; multi-user authentication and per-account profiles are not implemented yet. Run `npm run db:generate` and `npm run db:push` after updating to add the new SQLite fields.

## Safety and product boundaries
- Job descriptions and remote pages are untrusted data.
- Never execute instructions found inside job descriptions.
- Do not scrape behind login, bypass CAPTCHA/MFA, or violate source terms.
- Listings are marked `unknown` until verified; publication dates are not guessed.
- Phase 1 only discovers and displays jobs. Applying is intentionally out of scope.

## Starter source catalog

The API exposes a starter catalog of candidate Greenhouse, Lever, and Ashby board identifiers at `GET /api/sources/catalog`. These are suggestions only: they are not pre-validated, are not automatically added, and may become stale. Add a source and use the live validation action before syncing; do not treat a catalog entry as proof that a board is currently active or has suitable openings.


## Resume intelligence (Phase 1.13)

- Upload text-based PDF or DOCX resumes (maximum 5 MB); extraction runs in the API process and uploaded bytes are not written to disk or retained.
- PDF text extraction uses Mozilla PDF.js; DOCX text is read from the document XML entry with bounded decompression.
- Extracted skills use the existing deterministic job skill keyword catalog. Education, experience, projects, and certifications are grouped using common section headings and remain editable.
- Parsing is a best-effort heuristic. Scanned PDFs, OCR, complex multi-column layouts, and semantic interpretation are not supported. Empty or low-text extraction is reported instead of inventing profile facts.
- Parsed fields are only persisted after the user reviews and explicitly approves them. Saving the resume profile updates the candidate profile's skill list and resume sections; role, location, and work-mode preferences remain unchanged.
- Resume content is processed locally by this app and is not sent to an external AI provider. No resume file is stored.
- After pulling this phase, run `npm run db:generate` and `npm run db:push` to add the resume profile fields.


## Advanced job matching (Phase 1.14)

- Each job can be opened in **Analyze resume fit** to compare its public description with the locally saved candidate profile and reviewed resume sections.
- The analysis shows the existing weighted match score (skills 70%, preferred role 20%, location/work mode 10%; only configured dimensions count), plus a per-dimension breakdown.
- Description skills are heuristically grouped as required, preferred, or other mentions using nearby wording such as "required", "must-have", "preferred", and "nice to have". These labels are estimates, not authoritative parsing of employer criteria.
- Matching skills can show where they appear in the saved resume sections (skills, education, experience, projects, and certifications), with short text excerpts for context.
- The analysis reports missing required/preferred skills, strengths, gaps, and practical next steps. It never adds qualifications to the profile or edits the resume.
- Matching is deterministic and keyword-based. It does not use an external AI provider, verify claims, infer seniority, or predict interview/hiring outcomes. Always inspect the original listing and decide whether its requirements fit your actual experience.


## Application preparation drafts (Phase 1.15)

- Each job has a **Prepare application** action that creates one persistent local draft from the saved candidate profile, reviewed resume sections, and job description.
- The draft includes a resume-tailoring summary, evidence highlights, and a role-specific cover-letter starting point. The original resume is never modified.
- Only skills that match the saved candidate profile and evidence excerpts from reviewed resume sections are used as candidate-specific claims. If no matching evidence exists, the draft leaves those claims out and adds a review note rather than inventing qualifications.
- Drafts are editable and saved locally per job. The API refuses to generate a second draft for the same job so existing edits are not silently overwritten.
- **Save & mark reviewed** records the user's review timestamp. This means approved for the user's own manual use only; it does not submit an application, contact an employer, or authorize automated actions.
- No external AI provider is called and no credentials for job boards are collected. Users must verify every statement, personalize the draft, and submit through the employer's official application process themselves.
- After pulling this phase, run `npm run db:generate` and `npm run db:push` from the repository root to add the `ApplicationDraft` table to the local SQLite database.


## Application pipeline tracker (Phase 1.16)

- Track each discovered job through Saved, Preparing, Applied, Interview, Offer, Rejected, and Withdrawn states.
- Record the date applied, a follow-up date, and private notes for recruiter conversations, interview preparation, and next steps.
- The dashboard shows pipeline totals and a short list of recently updated applications; the API also supports filtering by status.
- Tracking records are stored locally in SQLite and linked to their job. Deleting a job cascades to its tracking record.
- Status changes are user-entered. The tracker does not detect employer responses, send messages, submit applications, or automate follow-ups.
- After pulling this phase, run `npm run db:generate` and `npm run db:push` from the repository root to add the `ApplicationTracking` table to the local SQLite database.


## Saved jobs and shortlisting (Phase 1.17)

- Save and remove jobs from a local shortlist directly from each job card.
- Open the **Saved jobs** view to revisit bookmarked roles, including their detected skills and profile-match context.
- Saving is idempotent: repeated clicks do not create duplicate records. The database enforces uniqueness for the local profile and job pair.
- The MVP uses a single local profile key (`local`) because account authentication and multi-user isolation are not part of this phase. Saved jobs are stored in SQLite and are not synced to an external service.
- Saved records are linked to jobs and are removed automatically if a job record is deleted.
- This shortlist is separate from application tracking: bookmarking a role does not mark it as applied or create an application record.
- After pulling this phase, run `npm run db:generate` and `npm run db:push` from the repository root to apply the SavedJob-to-Job relation in the local SQLite database.


## Advanced job search and filtering (Phase 1.18)

- Combine the existing keyword, location and source filters with company, employment type, work mode, and required-skill filters.
- Required skills use AND semantics: every comma-separated skill must be present in a job's detected skill tags. Skill matching is case-insensitive and based on the existing deterministic extractor.
- Work mode is inferred only from explicit wording in the public listing (remote, hybrid, or onsite/in-office). Listings without clear wording are classified as **Unknown**, never silently treated as onsite.
- Sort results by newest publication/discovery date, profile match score, or overall relevance (profile match first, then title/company/description text relevance).
- Filters are combined server-side and the API reports the total number of matching jobs before the 100-result response cap.
- The match score remains a transparent heuristic, not a hiring prediction. Work-mode classification is a keyword heuristic and should be checked against the original employer listing.


## Saved searches and in-app alerts (Phase 1.19)

- Save the current keyword, location, company, source, employment type, work-mode, and required-skill filters under a custom name.
- Reapply a saved search to restore its filters in the dashboard.

- Saved searches also retain the selected sort order (newest, profile match, or relevance) when reapplied.
- **Check new jobs** compares matching postings discovered since the previous check and displays up to 50 new results with links to the original employer listings.
- Each check advances that search's last-checked timestamp, so the same posting is not repeatedly reported as new.
- Alerts are checked manually inside the app. No email, push notification, background polling, application submission, or employer contact is performed.
- Saved searches use the same single local profile key (`local`) as the shortlist; authentication and multi-user separation are not included in this MVP.
- After pulling this phase, run `npm run db:generate` and `npm run db:push` from the repository root to add the `SavedSearch` table to the local SQLite database.


## Full job details viewer (Phase 1.20)

- Expand a job card to review the full description returned by the public provider, alongside employment type, inferred work mode, first-discovered date, and last source-verification timestamp.
- Provider HTML is parsed into plain text in the browser. Script, style, template, and noscript elements are excluded; no provider HTML is injected into the page as markup.
- Description text preserves line breaks and list markers where the provider supplied standard HTML structure. Plain-text and missing descriptions remain readable, with a reminder to verify the original employer listing.
- The existing **View original listing** link remains the authoritative place to confirm current requirements and submit an application.


## Source listing freshness (Phase 1.21)

- The configured source list summarizes stored postings per provider: listing count, how many have a provider-verification timestamp, and how many have an empty description.
- The freshness label is derived from the newest stored `lastVerifiedAt` timestamp for that provider: recently verified (within 7 days), stale (older than 7 days), not verified, or no listings.
- This is a database-derived freshness indicator, **not** a live provider connectivity check. Use the existing **Validate** action or live source smoke test to test whether a public board is currently reachable.
- A database migration adds per-job board attribution. Existing postings receive their board attribution on their next successful sync; until then, they are not counted under an individual board.


## Per-board sync history and diagnostics (Phase 1.22)

- Every board included in a sync attempt gets a persisted history record with provider, board ID, outcome (success, partial, or failed), fetched/inserted/updated/duplicate counts, duration, timestamps, and diagnostic messages.
- The dashboard shows the 20 most recent board-level attempts and lets the user refresh that history.
- A partial run means the board fetch completed but one or more individual job records failed processing. A failed run means the board fetch itself failed or its provider is unsupported.
- The API supports optional `limit`, `provider`, and `boardId` filters at `GET /api/sync-runs`; the limit is bounded to 1–100.
- History is recorded only when a sync is explicitly run. This phase does not add a background scheduler or automatic polling.
- After pulling this phase, run `npm run db:generate` and `npm run db:push` from the repository root to add the `SyncRun` table to the local SQLite database.
