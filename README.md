# GetCourse AI Homework Checker

An MVP TypeScript service that grades GetCourse text homework against local course knowledge with Gemini. It is dry-run by default: no comment or status is changed unless `AUTO_APPLY_RESULTS=true` is explicitly configured.

## Status

Phase 3 is complete: lesson-scoped pgvector retrieval, explicit prerequisite retrieval, and deterministic bounded grading contexts are available. Phase 4 will add Gemini grading.

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
corepack pnpm knowledge:import -- ./knowledge/example-course
```

`db:generate` generates a migration from `src/db/schema.ts`; inspect the generated SQL and add any PostgreSQL extension statements before committing it. `db:migrate` only applies checked-in migrations.

See `docs/SPEC.md`, `docs/IMPLEMENTATION_PLAN.md`, and `docs/DECISIONS.md`.
## Knowledge import

Create `.env` from `.env.example`, set `GEMINI_API_KEY`, start PostgreSQL, apply migrations, then run:

```bash
corepack pnpm knowledge:import -- ./knowledge/example-course
```

The importer validates the complete YAML course structure before writing metadata, imports mandatory `transcript.md` and optional `notes.md`, and only re-embeds changed documents. If an individual document cannot be embedded, its previous chunks remain intact while other documents continue importing; the command reports the error and exits non-zero.

## Embedding compatibility prerequisite

gemini-embedding-2 now uses prompt-formatted document and query embeddings without taskType. If knowledge was imported with the earlier embedding contract, clean the database and re-import the knowledge before operational retrieval or grading. This is a deliberate operator action; it is not performed automatically and is not part of routine verification.
