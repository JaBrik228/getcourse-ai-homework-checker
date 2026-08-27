# GetCourse AI Homework Checker Implementation Plan

**Goal:** Build the MVP incrementally, preserving fixed architecture and dry-run safety from `docs/SPEC.md`.

**Current status:** Phase 0 is complete. Current phase: Phase 1 — Database and configuration. Complete phases in order unless a concrete dependency requires a documented small adjustment.

## Phase checklist

- [x] Phase 0 — Bootstrap and project memory
- [ ] Phase 1 — Database and configuration
- [ ] Phase 2 — Knowledge ingestion
- [ ] Phase 3 — Retrieval and context builder
- [ ] Phase 4 — Gemini grader
- [ ] Phase 5 — GetCourse login and discovery
- [ ] Phase 6 — GetCourse read adapter
- [ ] Phase 7 — End-to-end dry-run worker
- [ ] Phase 8 — GetCourse result application
- [ ] Phase 9 — Hardening, tests, and operating documentation
- [ ] Phase 10 — MVP acceptance

## Phase 0 — Bootstrap and project memory

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
