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
