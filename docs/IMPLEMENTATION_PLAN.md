# GetCourse AI Homework Checker Implementation Plan

**Goal:** Build the MVP incrementally, preserving fixed architecture and dry-run safety from `docs/SPEC.md`.

**Current status:** Phases 0, 1, and 2 are complete. Current phase: Phase 3 - Retrieval and context builder. Complete phases in order unless a concrete dependency requires a documented small adjustment.

## Phase checklist

- [x] Phase 0 вЂ” Bootstrap and project memory
- [x] Phase 1 - Database and configuration
- [x] Phase 2 — Knowledge ingestion
- [ ] Phase 3 вЂ” Retrieval and context builder
- [ ] Phase 4 вЂ” Gemini grader
- [ ] Phase 5 вЂ” GetCourse login and discovery
- [ ] Phase 6 вЂ” GetCourse read adapter
- [ ] Phase 7 вЂ” End-to-end dry-run worker
- [ ] Phase 8 вЂ” GetCourse result application
- [ ] Phase 9 вЂ” Hardening, tests, and operating documentation
- [ ] Phase 10 вЂ” MVP acceptance

## Phase 0 вЂ” Bootstrap and project memory

**Deliverable:** A documented, executable, dependency-minimal TypeScript bootstrap before feature code exists.

- [x] Initialize local Git on `main`; do not configure a remote.
- [x] Copy the supplied specification byte-for-byte to `docs/SPEC.md`.
- [x] Create `AGENTS.md` with complete project-memory recovery state.
- [x] Record fixed architecture plus ESM/tooling decisions in `docs/DECISIONS.md`.
- [x] Create private native-ESM package metadata with Node `^24.18.1`, pnpm `11.21.0`, and the exact lockfile.
- [x] Install only TypeScript 5.9, `tsx`, Node 24 types, Vitest 4, ESLint 10, `@eslint/js`, and compatible `typescript-eslint`.
- [x] Configure strict NodeNext no-emit and emitting `dist/` TypeScript configurations.
- [x] Configure ESLint flat recommended correctness rules and Vitest.
- [x] Add an ESM `SERVICE_NAME` export and unit import smoke test.
- [x] Add `.env.example`, README, and ignores for dependencies, builds, coverage, secrets, Playwright authentication, discovery artifacts, and logs.
- [x] Add only `playwright/.auth/.gitkeep` and `var/.gitkeep` runtime placeholders.
- [x] Verify Corepack, frozen install, lint, typecheck, unit/integration tests, build, and compiled execution.
- [x] Verify specification hash, ignores/trackability, and staged diff.
- [x] Mark Phase 0 complete; make Phase 1 current; record exactly one next action; commit `chore: bootstrap project`.

## Phase 1 - Database and configuration

**Deliverable:** A local PostgreSQL 17 + pgvector environment, strict runtime configuration, versioned schema, and integration verification.

- [x] Add Docker Compose PostgreSQL with pgvector, a healthcheck, persistent volume, and separate integration database.
- [x] Add Zod configuration validation with safe defaults and an enforced 768 embedding dimension.
- [x] Add Drizzle + node-postgres client and transaction primitives.
- [x] Define all eight Phase 1 tables, foreign keys, constraints, unique keys, JSONB defaults, B-tree indexes, and the HNSW cosine vector index.
- [x] Generate and review the initial Drizzle migration; create `pgcrypto` and `vector` extensions explicitly.
- [x] Add unit configuration tests and real PostgreSQL migration/schema integration tests.
- [x] Verify migrations apply repeatably to a clean local environment.
## Phase 2 — Knowledge ingestion

**Deliverable:** Course transcripts and notes can be validated, embedded, and imported into PostgreSQL idempotently.

- [x] Add strict YAML schemas and a repository example course fixture.
- [x] Add deterministic paragraph-aware chunking and SHA-256 content hashes.
- [x] Add an official Gemini embedding adapter with 768-dimensional validation and bounded retries.
- [x] Upsert course metadata and prerequisites; replace changed document chunks atomically.
- [x] Add the `knowledge:import` CLI, unit tests, and PostgreSQL importer integration tests.
- [x] Verify unchanged documents are not re-embedded and an embedding failure preserves the prior document state.
