# Architectural and Bootstrap Decisions

## Fixed MVP architecture

1. One TypeScript service with separated GetCourse adapter, submission, worker, context-builder, Gemini-grader, and result-application modules; one process may host HTTP and worker loops.
2. Access GetCourse through Playwright. Poll the teacher answer feed; callbacks are not a correctness dependency. Keep selectors/UI behavior behind a Playwright-independent adapter. No undocumented HTTP client.
3. Poll every 60 seconds by default and do not overlap scans. A future callback may wake a scan but cannot replace polling.
4. PostgreSQL with pgvector is the only server-side state dependency. Queue semantics use database rows/statuses; no Redis or BullMQ. MVP has one worker.
5. Use the official Google GenAI SDK with configurable `GEMINI_MODEL=gemini-3.7-flash` and `GEMINI_THINKING_LEVEL=medium`; require JSON-schema structured output.
6. Use `gemini-embedding-2` at 768 dimensions in PostgreSQL `vector(768)`. Dimension changes require migration/re-embedding; mixed dimensions are prohibited.
7. Import local course files into PostgreSQL. Notion is not an MVP runtime dependency, though a future knowledge-source boundary may be added when justified.
8. Default `AUTO_APPLY_RESULTS=false`: grade, store, and log intended actions, but never mutate GetCourse. Mutation requires explicit `true`.
9. Grade text answers only. Attachments required for grading yield `needs_review`, never automatic rejection or mutation.

## Phase 0 ESM and tooling

- Project-scoped Corepack uses `pnpm@11.21.0`; Node is `^24.18.1`; pnpm 12 is intentionally deferred.
- The package is private native ESM (`"type": "module"`) with strict `NodeNext` TypeScript resolution.
- `tsconfig.json` is no-emit typechecking; `tsconfig.build.json` emits to `dist/`.
- TypeScript enables `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and `noImplicitReturns`.
- ESLint flat config uses JavaScript and TypeScript recommended correctness rules only; no Prettier or stylistic plugins.
- Vitest 4 runs one-shot unit tests under Node 24; empty integration tests succeed until Phase 1.
- Bootstrap dependencies are limited to TypeScript 5.9, `tsx`, Node 24 types, Vitest 4, ESLint 10, `@eslint/js`, and compatible `typescript-eslint`.

## Phase 1 database and configuration

- The local database image is `pgvector/pgvector:pg17`; Docker Compose exposes PostgreSQL only on localhost port 5432 and uses a named volume for persistence.
- Compose initialisation creates `getcourse_ai` for development and `getcourse_ai_test` for integration tests. Integration tests never use the development database.
- Drizzle is the schema source of truth. Generated SQL migrations are committed under `drizzle/`; schema changes use `db:generate`, generated SQL is reviewed, and `db:migrate` is the only application path.
- The initial migration explicitly creates `pgcrypto` for UUID defaults and `vector` for `vector(768)` plus the HNSW cosine index.
- `src/config.ts` loads `.env` and validates configuration with Zod. Only settings required for the active database layer are required now; Gemini and GetCourse credentials remain optional until their phases.
- `EMBEDDING_DIMENSIONS` is fixed at 768 in configuration and schema. A model-dimension change requires an explicit migration/re-embedding change in a later phase.
- Database foreign keys use PostgreSQL's default `NO ACTION`; accidental cascading deletion is not enabled.
- All project commands should use `corepack pnpm`, because the available global pnpm 9.7.1 cannot read the pnpm 11 workspace configuration.
