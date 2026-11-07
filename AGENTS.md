# AI Job Agent Working Rules

## Git and workflow
- Work only on `feature/multi-user-platform`.
- Never modify `main`.
- Never commit, push, merge, rebase, or publish unless I explicitly request it.
- Keep changes local while developing.
- Complete and test a feature before asking me whether I want to commit and push it.
- Never discard or overwrite my existing uncommitted changes.
- Before making changes, inspect `git status`.
- Do not include unrelated changes in a feature.

## Development
- Make small, focused changes.
- Understand the existing architecture before editing.
- Prefer existing patterns and dependencies.
- Do not introduce unnecessary dependencies.
- Run relevant tests and builds after implementation.
- Explain errors and solutions in simple, beginner-friendly language.

## Safety
- Ask before deleting files or running destructive commands.
- Ask before database resets, migrations that may affect data, or changing secrets.
- Never expose API keys, passwords, tokens, or environment secrets.
- Never automatically submit job applications.
- Never bypass CAPTCHA, OTP, or verification mechanisms.

## Project context
- Product: AI Job Agent.
- Frontend: React, Vite, TypeScript.
- Backend: Express, TypeScript.
- Database: Prisma and SQLite.
- Shared code: `packages/shared`.
- Browser extension: `apps/extension`.
- Job sources: Greenhouse, Lever, Ashby.
- Primary target market: India.

## Communication
- I am a beginner developer.
- Explain what you plan to do before complex changes.
- Prefer one logical task at a time.
- Report files changed, tests run, results, and remaining issues.
- Do not claim something works unless you have verified it.
