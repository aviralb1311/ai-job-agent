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
cp apps/api/env.example apps/api/.env
npm run db:generate:sqlite
npm run dev
```

For a **new, empty** SQLite file only, initialize its tables with `npm run db:push:sqlite`. Do not run that against an existing local database without first reviewing and backing up that file.

### Database modes

- **Local development:** SQLite uses `apps/api/prisma/schema.prisma` and `apps/api/prisma/migrations`. `npm run dev`, `npm run build:development`, and `npm run test:sqlite` generate the SQLite Prisma Client before compiling or running. Tests use the separate `integration-test.db` file.
- **PostgreSQL integration tests:** Use a disposable PostgreSQL instance bound to `127.0.0.1:55432` and a database named `ai_job_agent_test`. The dedicated command requires `POSTGRES_TEST_DATABASE_URL` and rejects non-PostgreSQL URLs, non-loopback hosts, other ports, or other database names before running Prisma commands. It maps the checked URL to `DATABASE_URL` and `DIRECT_URL`, generates the PostgreSQL client, applies only the checked-in PostgreSQL migrations, then runs the API suite sequentially. The API integration suite clears tables, so never point this command at a database with data you need. Do not run it at the same time as SQLite tests or builds because both providers share the generated Prisma Client location.
- **Production:** Neon PostgreSQL uses `apps/api/prisma/postgresql/schema.prisma` and its separate migration directory. `npm run build` (same as `npm run build:production`) generates the PostgreSQL client before compiling the API, then builds the frontend. `DATABASE_URL` is the runtime connection URL; `DIRECT_URL` is the direct connection URL used by Prisma migrations and schema-based client generation. Do not put these values in Vite variables or commit them.
- **Build ordering:** SQLite and PostgreSQL Prisma Clients are generated into the same `@prisma/client` output. Build scripts run generation and TypeScript compilation sequentially. Do not run `npm run dev`, `npm run test:sqlite`, `npm run build:development`, or `npm run build` at the same time; each can select a different client provider.
- **Migration safety:** Never apply SQLite migrations to PostgreSQL. The initial PostgreSQL baseline at `apps/api/prisma/postgresql/migrations/20261107104010_init/migration.sql` was generated locally from an empty schema and has not been applied anywhere. Review it, test it on an isolated PostgreSQL database or Neon development branch, then use `npm run db:migrate:deploy:postgresql` with `DIRECT_URL` set to the direct PostgreSQL URL when deploying. This creates an empty PostgreSQL schema; it does not copy local SQLite data.
- **Existing local data:** Keep the existing SQLite file and history. The SQLite migration history predates parts of the current schema, so do not run `npm run db:migrate:dev:sqlite` against an existing local database until its migration-history drift has been resolved. `npm run db:push:sqlite` remains available for local schema synchronization; back up local data before using it.
- **Schema consistency:** Run `npm run db:check-schemas` after editing either schema. It compares every model definition, including fields, relations, defaults, indexes, and constraints, while allowing the datasource blocks to differ.

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
- `npm run build` or `npm run build:production` — generate the PostgreSQL Prisma Client, then build shared code, API, and frontend in order
- `npm run build:development` — generate the SQLite Prisma Client, then build shared code, API, and frontend in order
- `npm run test` or `npm run test:sqlite` — prepare and run API tests against a separate `apps/api/integration-test.db` SQLite database; test fixtures and sync history cannot pollute your development `dev.db`.
- `npm run test:postgresql:guard` — test the PostgreSQL test URL safety checks without connecting to a database.
- `npm run test:postgresql` — guarded PostgreSQL API integration tests; requires the disposable local database described below.
- `npm run test:live-sources -w @job-agent/api` — manually smoke-test live public feeds (requires three board IDs)
- `npm run db:generate` — generate Prisma client
- `npm run db:migrate` — create/apply local migration
- `npm run db:generate:sqlite` / `npm run db:generate:postgresql` — generate the provider-specific Prisma Client into the shared `@prisma/client` import location
- `npm run db:migrate:dev:sqlite` / `npm run db:migrate:dev:postgresql` — create and apply a development migration for the selected provider
- `npm run db:migrate:deploy:sqlite` / `npm run db:migrate:deploy:postgresql` — apply checked-in migrations for the selected provider
- `npm run db:check-schemas` — check that the two model definitions stay aligned

### Disposable PostgreSQL integration-test database

These commands create a temporary PostgreSQL cluster under `/tmp`; they do not use Docker, Neon, Render, or production credentials. PostgreSQL 18 server tools must be installed. The temporary cluster uses trust authentication and listens only on loopback:

```bash
initdb -D /tmp/ai-job-agent-pg-test/data --username=postgres --auth-local=trust --auth-host=trust
pg_ctl -D /tmp/ai-job-agent-pg-test/data \
  -l /tmp/ai-job-agent-pg-test/postgres.log \
  -o "-h 127.0.0.1 -p 55432" -w start
createdb -h 127.0.0.1 -p 55432 -U postgres ai_job_agent_test
export POSTGRES_TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55432/ai_job_agent_test?schema=public'
npm run test:postgresql:guard
npm run test:postgresql
```

The test runner validates `POSTGRES_TEST_DATABASE_URL` before invoking Prisma. It supplies that URL to both `DATABASE_URL` and `DIRECT_URL`; no `.env` edit is needed. It refuses remote hosts, embedded passwords, and any database other than the designated test database. To stop the test server, run `pg_ctl -D /tmp/ai-job-agent-pg-test/data -m fast -w stop`. After confirming the directory contains only this disposable cluster, remove `/tmp/ai-job-agent-pg-test` to discard it. If a test process is interrupted and leaves the coordination lock, first verify no PostgreSQL test runner is active before removing `/tmp/ai-job-agent-postgresql-test-$(id -u).lock`.

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


## Individual source sync (Phase 1.23)

- Each enabled configured board has a **Sync now** action in the source manager. It imports or updates postings from only that board, without running every configured board.
- The targeted endpoint is `POST /api/sources/:id/sync`. It returns 404 for an unknown source and 409 when the source is disabled.
- A targeted sync writes the same per-board sync-history record used by full sync, so its result and errors appear in source diagnostics.
- Existing full sync remains available and unchanged. Targeted sync does not introduce automatic polling or background retries.


## Optional scheduled source sync (Phase 1.24)

Automatic synchronization is **disabled by default**. To enable a periodic full sync, set `SOURCE_SYNC_INTERVAL_MINUTES` in `apps/api/.env` to an integer from 1 to 1440 (24 hours). Set it to `0` to disable it. The first scheduled sync runs after one full interval; manual full sync and per-source sync remain available.

The scheduler runs inside the API process, uses the existing sync service and per-board history, logs its result, and avoids overlapping ticks in that process. It is intended for a **single API instance** in this local MVP. Do not enable this process-local scheduler on multiple replicas because each replica would run its own schedule; production multi-instance scheduling requires a shared distributed lock or external scheduler. The timer is stopped during graceful SIGINT/SIGTERM shutdown.


## Listing lifecycle and closed postings (Phase 1.25)

- A successful, non-empty, fully processed board sync marks previously stored postings from that same board as `INACTIVE` when they are absent from the latest feed snapshot.
- A posting that appears again in a later successful sync is restored to `ACTIVE`.
- Empty feed responses, failed board fetches, and partial runs do **not** deactivate existing postings. This avoids treating transient provider issues or incomplete processing as proof that a job has closed.
- The jobs API accepts `listingStatus=OPEN|INACTIVE|ALL`; the dashboard provides matching filters. The default is open listings.
- Sync history records the number of listings marked inactive in each run. Historical jobs and their application drafts, saved entries, and tracking records are retained.
- This is feed-based lifecycle inference, not authoritative confirmation from an employer. Always verify the original company listing before applying.
- After pulling this phase, run `npm run db:generate` and `npm run db:push` from the repository root to add the deactivation count to sync history.


## Job expiry and revalidation (Phase 1.26)

- Each returned job includes a derived revalidation state based on its last successful provider verification: **Fresh** (within 7 days), **Stale** (more than 7 and up to 30 days), **Revalidation overdue** (more than 30 days), or **Not yet verified** (no verification timestamp).
- These are age-based reminders, not claims that an employer closed or expired a role. A job is not automatically removed or marked inactive because its verification timestamp is old.
- The dashboard displays the state on each job and adds stale/overdue counts to each configured source. Use **Revalidate board** to fetch the latest public board snapshot through its existing provider connector.
- Only a successful, non-empty, fully processed source sync updates verification timestamps and listing lifecycle state. Empty, failed, or partial syncs do not refresh every job's timestamp or deactivate missing listings.
- The existing inactive state remains reserved for postings absent from a complete, non-empty provider snapshot (Phase 1.25). Always open the employer's original listing before applying.


## Application follow-up queue (Phase 1.27)

- The dashboard includes a dedicated follow-up queue for tracked applications with a follow-up date.
- Reminders are grouped by the user's local calendar date into **Overdue**, **Today**, and **Upcoming**; **All** shows every scheduled reminder. The browser supplies its local date to the API so date-only reminders are not classified using the server's timezone.
- Each reminder shows the role, company, location when available, application status, saved notes, due date, and a link to the original employer listing.
- Rejected and withdrawn applications are excluded from the active reminder queue. Existing application tracking records and dates are not modified.
- The queue is read-only: users continue to edit or clear follow-up dates in the existing application tracker. No email, push notification, recruiter message, or automated application action is sent.
- The API endpoint is `GET /api/applications/follow-ups?bucket=OVERDUE|TODAY|UPCOMING|ALL&today=YYYY-MM-DD`. The `today` value is validated and defaults to the API server's UTC date when omitted.
