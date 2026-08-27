# AGENTS.md

## Project goal

GetCourse AI Homework Checker is a single TypeScript service that grades text homework submitted through GetCourse against relevant local course material using Gemini, storing every result and keeping mutations opt-in.

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
pnpm dev
pnpm start
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm test:unit
pnpm test:integration

# Introduced in later phases; do not add scripts before their implementation.
pnpm db:generate
pnpm db:migrate
pnpm knowledge:import -- <path>
pnpm getcourse:login
pnpm getcourse:discover
pnpm check:one -- <externalSubmissionId>
```

## Phase roadmap

- [ ] Phase 0 ? repository/bootstrap
- [ ] Phase 1 ? database/config
- [ ] Phase 2 ? knowledge ingestion
- [ ] Phase 3 ? retrieval/context builder
- [ ] Phase 4 ? Gemini grader
- [ ] Phase 5 ? GetCourse login/discovery
- [ ] Phase 6 ? GetCourse read adapter
- [ ] Phase 7 ? end-to-end dry-run worker
- [ ] Phase 8 ? GetCourse result application
- [ ] Phase 9 ? hardening/tests/docs
- [ ] Phase 10 ? MVP acceptance

## Current phase

Phase 0 ? Bootstrap and project memory.

## Last completed work

Phase 0 — repository/bootstrap completed: documentation, strict ESM scaffold, tooling lockfile, smoke test, and verification.

## Next action

start database/config bootstrap

## Known blockers

None.
