# AGENTS.md

## Project goal

GetCourse AI Homework Checker is a single TypeScript service that grades text homework submitted through GetCourse against relevant local course material using Gemini, stores every result, and keeps mutations opt-in.

## Current MVP scope

- Text homework only.
- GetCourse integration through Playwright.
- PostgreSQL with pgvector.
- Gemini Flash for grading and Gemini embeddings.
- Local knowledge import.
- Dry-run by default.

## Architectural invariants

- Single TypeScript service; no microservices.
- No Redis or BullMQ.
- No separate vector database.
- No Notion in the MVP.
- No undocumented GetCourse HTTP API in the MVP.
- GetCourse-specific behavior stays behind `GetCourseAdapter`.
- Gemini-specific behavior stays behind grader and embedding adapters.
- Prompts are files, never hardcoded.
- No future-lesson knowledge during grading.
- Every homework revision is idempotent.
- Automatic mutations are disabled by default.

## Core flow

GetCourse -> submission -> lesson mapping -> retrieval -> Gemini -> stored result -> optional GetCourse mutation.

## Source-of-truth documents

- `docs/SPEC.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/DECISIONS.md`

## Commands

```bash
corepack pnpm dev
corepack pnpm start
corepack pnpm build
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm test:unit
corepack pnpm test:integration
corepack pnpm db:generate
corepack pnpm db:migrate

# Introduced in later phases; do not add scripts before their implementation.
corepack pnpm knowledge:import -- <path>
corepack pnpm getcourse:login
corepack pnpm getcourse:discover
corepack pnpm check:one -- <externalSubmissionId>
```

## Phase roadmap

- [x] Phase 0 - repository/bootstrap
- [x] Phase 1 - database/config
- [x] Phase 2 - knowledge ingestion
- [x] Phase 3 - retrieval/context builder
- [ ] Phase 4 - Gemini grader
- [ ] Phase 5 - GetCourse login/discovery
- [ ] Phase 6 - GetCourse read adapter
- [ ] Phase 7 - end-to-end dry-run worker
- [ ] Phase 8 - GetCourse result application
- [ ] Phase 9 - hardening/tests/docs
- [ ] Phase 10 - MVP acceptance

## Current phase

Phase 4 - Gemini grader.

## Last completed work

Phase 3 completed: prompt-formatted Gemini document/query embeddings, lesson-scoped pgvector retrieval with explicit prerequisite access, and a deterministic bounded grading context with a context hash.

## Next action

Start Gemini-grader work: load and hash the editable grading prompt, request structured Gemini output, and persist the grading result.

## Known blockers

Use `corepack pnpm`: the globally installed pnpm 9.7.1 is incompatible with this repository's pnpm 11 workspace format.

Gemini embedding compatibility: gemini-embedding-2 requires prompt-formatted document and query embeddings without taskType. Existing stored vectors are incompatible with this contract; clean the database and re-import knowledge before operational use. Do not treat this prerequisite as a routine verification step.
