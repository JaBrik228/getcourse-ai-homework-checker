# GetCourse AI Homework Checker

An MVP TypeScript service for grading GetCourse text homework against local course knowledge with Gemini. The service is intentionally dry-run by default: it may store grading results but will not post comments or change homework status unless `AUTO_APPLY_RESULTS=true` is explicitly configured.

## Status

Phase 0 establishes project memory and a minimal executable toolchain. Database, Docker, Fastify, Gemini, Playwright, and knowledge-base implementation begin in later phases.

## Prerequisites

- Node.js 24.18.1 or newer within the supported Node 24 line
- Corepack-enabled pnpm 11.21.0

## Bootstrap commands

```bash
corepack pnpm install --frozen-lockfile
pnpm dev
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm start
```

`pnpm test:integration` intentionally succeeds with no tests until Phase 1.

## Planned commands

The following commands are documented for later phases and are deliberately not defined yet: `db:generate`, `db:migrate`, `knowledge:import`, `getcourse:login`, `getcourse:discover`, and `check:one`.

See `docs/SPEC.md`, `docs/IMPLEMENTATION_PLAN.md`, and `docs/DECISIONS.md`.
