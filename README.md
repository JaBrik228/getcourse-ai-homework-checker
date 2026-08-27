# GetCourse AI Homework Checker

An MVP TypeScript service that grades GetCourse text homework against local course knowledge with Gemini. It is dry-run by default: no comment or status is changed unless `AUTO_APPLY_RESULTS=true` is explicitly configured.

## Status

Phase 1 is complete: Docker PostgreSQL 17 + pgvector, validated configuration, Drizzle schema and migrations, and integration schema tests are available. Knowledge ingestion begins in Phase 2.

## Prerequisites

- Node.js 24.18.1 or newer within Node 24
- Corepack-enabled pnpm 11.21.0
- Docker Desktop

The system `pnpm` may be an incompatible version. Use `corepack pnpm` for all commands.

## Local database

```bash
Copy-Item .env.example .env

docker compose up -d
corepack pnpm db:migrate
corepack pnpm test:integration
```

The Compose environment creates `getcourse_ai` for local development and `getcourse_ai_test` for integration tests. To reset both local databases, run `docker compose down -v` and then `docker compose up -d`.

## Development commands

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm dev
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm test:integration
corepack pnpm build
corepack pnpm start
```

`db:generate` generates a migration from `src/db/schema.ts`; inspect the generated SQL and add any PostgreSQL extension statements before committing it. `db:migrate` only applies checked-in migrations.

See `docs/SPEC.md`, `docs/IMPLEMENTATION_PLAN.md`, and `docs/DECISIONS.md`.