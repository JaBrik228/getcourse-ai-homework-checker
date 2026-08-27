# GetCourse AI Homework Checker — MVP Technical Specification

**Status:** implementation-ready MVP specification  
**Date:** 2026-08-27  
**Primary executor:** Codex  
**Project name:** `getcourse-ai-homework-checker`

---

## 0. Instruction to Codex

Implement this project incrementally. Do not redesign the architecture unless a concrete blocker is discovered.

Before writing application code:

1. Read this specification fully.
2. Create `AGENTS.md` in the repository root using the requirements in section **18**.
3. Create `docs/IMPLEMENTATION_PLAN.md` with the phase checklist from section **19**.
4. Create `docs/DECISIONS.md` and record the architectural decisions from section **2**.
5. Initialize git if the repository is new.
6. Commit the documentation/bootstrap files before implementing the first feature.
7. Work phase-by-phase.
8. After each completed phase:
   - run the required tests;
   - update `AGENTS.md`;
   - update `docs/IMPLEMENTATION_PLAN.md`;
   - commit the working state.
9. Do not introduce Redis, BullMQ, Pinecone, Weaviate, Qdrant, Kubernetes, microservices, a separate admin frontend, Notion integration, or an undocumented GetCourse HTTP client in the MVP unless this specification is explicitly changed.
10. Prefer a working, testable vertical slice over speculative abstractions.

If a GetCourse UI detail cannot be known without access to the real account, do not invent selectors or endpoints. Implement the adapter boundary, login/discovery tooling, fixtures, and all surrounding logic; then use the authenticated discovery step described below to finalize the selectors against the real account.

---

# 1. Goal

Build an MVP service that automatically checks text homework submitted by students in GetCourse using Gemini and course materials.

The end-to-end target flow is:

```text
GetCourse answer feed
        ↓
detect new/updated homework
        ↓
map submission → course lesson
        ↓
build limited lesson context
        ↓
Gemini 3.7 Flash
        ↓
structured grading result
        ↓
store result
        ↓
[dry-run by default]
        ↓
optional comment + accept/reject in GetCourse
```

The AI grading prompt already exists conceptually and must remain easy to edit without changing application code.

The system must allow all lesson transcripts to exist in the knowledge base, while sending Gemini only the information relevant to the current homework.

---

# 2. Fixed architectural decisions

These are intentional MVP decisions. Do not replace them merely because another option is newer or theoretically more scalable.

## 2.1 Application architecture

Use a **single TypeScript service**, not microservices.

The service contains logically separated modules:

```text
GetCourse Adapter
      ↓
Submission Service
      ↓
Check Worker
      ↓
Context Builder ← PostgreSQL + pgvector
      ↓
Gemini Grader
      ↓
Result Applier
      ↓
GetCourse Adapter
```

A single process may run both the HTTP server and background polling/worker loops.

## 2.2 GetCourse integration

For MVP:

- use **Playwright** as the supported GetCourse adapter;
- detect pending homework by polling GetCourse's teacher answer feed;
- do not depend on GetCourse callback/processes for correctness;
- centralize all selectors and GetCourse-specific UI behavior inside one adapter;
- keep the adapter interface independent from Playwright so a later internal-HTTP implementation can replace it.

Why:

- GetCourse has a public API and callbacks, but its public API does not provide a documented complete homework grading API;
- the teacher answer feed supports homework review actions in the UI;
- browser automation is therefore the safest MVP boundary without depending on undocumented endpoints.

A future optimization may inspect GetCourse's internal XHR/fetch calls and replace browser DOM operations with HTTP calls, but that is explicitly outside MVP.

## 2.3 Triggering model

MVP correctness must not depend on GetCourse callbacks.

Use polling:

```text
GETCOURSE_POLL_INTERVAL_MS=60000
```

Default: once every 60 seconds.

Polling loop must not overlap with itself. If one scan is still running, skip starting another.

Future optional optimization:

```text
GetCourse process → "Вызвать URL" → wake up scan
```

This can reduce latency later, but polling remains the fallback.

## 2.4 Persistence and queue

Use **PostgreSQL with pgvector** as the only server-side state dependency.

Do not add Redis/BullMQ.

Queue semantics are represented by rows/statuses in PostgreSQL.

MVP runs one check worker. The schema should not prevent adding multiple workers later, but multi-worker distributed coordination is not an MVP requirement.

## 2.5 AI

Use the official Google GenAI SDK.

Default grading model:

```env
GEMINI_MODEL=gemini-3.7-flash
```

The model ID must be configuration, not hardcoded throughout the code.

Use Gemini structured output with a JSON Schema.

Default thinking level:

```env
GEMINI_THINKING_LEVEL=medium
```

Do not configure obsolete sampling controls unless the current Gemini API explicitly supports them.

## 2.6 Embeddings

Default embedding model:

```env
GEMINI_EMBEDDING_MODEL=gemini-embedding-2
EMBEDDING_DIMENSIONS=768
```

Store embeddings in PostgreSQL `vector(768)`.

If the embedding model is changed to one with an incompatible vector dimension, require a migration/re-embedding operation rather than silently accepting mixed dimensions.

## 2.7 Knowledge source

For MVP, course knowledge is imported from local files into PostgreSQL.

Notion is **not** the runtime database and is not required for MVP.

The architecture should allow a future `KnowledgeSource` adapter for Notion, but do not implement it now.

## 2.8 Safety of automatic grading

Default mode:

```env
AUTO_APPLY_RESULTS=false
```

In this mode:

- detect homework;
- build context;
- call Gemini;
- store the result;
- log what would have been sent to GetCourse;
- do not post comments;
- do not accept/reject homework.

Automatic mutation is enabled only when:

```env
AUTO_APPLY_RESULTS=true
```

This allows grading quality to be validated before the service can modify real student work.

## 2.9 Scope of homework

MVP auto-grades **text answers**.

If a submission contains required attachments/images/audio/video/files that the grading result depends on:

```text
decision = needs_review
```

and no automatic GetCourse decision is applied.

Do not auto-reject merely because an attachment is unsupported.

---

# 3. Non-goals for MVP

Do not implement these unless required to make the vertical slice work:

- Notion synchronization;
- separate web admin panel;
- multi-tenant SaaS architecture;
- billing;
- student-facing UI outside GetCourse;
- Redis;
- BullMQ;
- Kafka/RabbitMQ;
- Kubernetes;
- Pinecone/Weaviate/Qdrant;
- OCR;
- image/file homework grading;
- automatic video transcription;
- automatic course scraping;
- full knowledge graph database;
- Neo4j;
- model fine-tuning;
- undocumented GetCourse internal API client;
- multiple concurrent GetCourse accounts;
- complex permissions system;
- analytics dashboard;
- automatic prompt optimization.

The code should have sensible boundaries so these features can be added later without redesigning the core grading pipeline.

---

# 4. Technology stack

Use:

```text
Runtime:        Node.js 24 LTS or newer supported LTS
Language:       TypeScript, strict mode
HTTP server:    Fastify
Validation:     Zod
Database:       PostgreSQL
Vector search:  pgvector
ORM/query:      Drizzle ORM + node-postgres
Browser:        Playwright Chromium
AI SDK:         @google/genai
Logging:        Pino
Tests:          Vitest
Containers:     Docker + docker compose
Hashing:        Node.js crypto
Package mgr:    pnpm
```

Do not add a framework such as NestJS for MVP.

---

# 5. Repository structure

Target structure:

```text
.
├── AGENTS.md
├── README.md
├── .env.example
├── .gitignore
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── vitest.config.ts
├── drizzle.config.ts
├── docker-compose.yml
├── Dockerfile
│
├── docs/
│   ├── SPEC.md
│   ├── IMPLEMENTATION_PLAN.md
│   └── DECISIONS.md
│
├── prompts/
│   └── homework-checker.md
│
├── knowledge/
│   └── example-course/
│       ├── course.yaml
│       └── lessons/
│           └── 001-example/
│               ├── lesson.yaml
│               └── transcript.md
│
├── drizzle/
│   └── <generated migrations>
│
├── playwright/
│   └── .auth/
│       └── .gitkeep
│
├── var/
│   └── .gitkeep
│
├── scripts/
│   ├── getcourse-login.ts
│   ├── getcourse-discover.ts
│   ├── import-knowledge.ts
│   └── run-one-check.ts
│
├── src/
│   ├── index.ts
│   ├── app.ts
│   ├── config.ts
│   │
│   ├── db/
│   │   ├── client.ts
│   │   ├── schema.ts
│   │   └── repositories/
│   │       ├── lessons.repository.ts
│   │       ├── submissions.repository.ts
│   │       └── checks.repository.ts
│   │
│   ├── domain/
│   │   ├── homework.ts
│   │   ├── grading.ts
│   │   └── knowledge.ts
│   │
│   ├── integrations/
│   │   ├── getcourse/
│   │   │   ├── getcourse-adapter.ts
│   │   │   ├── playwright-getcourse-adapter.ts
│   │   │   ├── selectors.ts
│   │   │   ├── types.ts
│   │   │   └── errors.ts
│   │   │
│   │   └── gemini/
│   │       ├── gemini-grader.ts
│   │       ├── gemini-embeddings.ts
│   │       └── schemas.ts
│   │
│   ├── knowledge/
│   │   ├── chunker.ts
│   │   ├── importer.ts
│   │   ├── retriever.ts
│   │   └── context-builder.ts
│   │
│   ├── grading/
│   │   ├── prompt-loader.ts
│   │   ├── grading-service.ts
│   │   └── result-applier.ts
│   │
│   ├── workers/
│   │   ├── submission-poller.ts
│   │   └── check-worker.ts
│   │
│   └── routes/
│       ├── health.ts
│       └── checks.ts
│
└── tests/
    ├── fixtures/
    │   └── getcourse/
    ├── unit/
    ├── integration/
    └── live/
```

Keep files focused. Do not create generic `utils.ts` dumping grounds.

---

# 6. Core domain interfaces

The domain layer must not depend on Playwright or Gemini SDK types.

## 6.1 Homework submission

```ts
export type HomeworkSubmission = {
  source: 'getcourse';

  externalSubmissionId: string;
  externalUserId: string | null;
  externalLessonId: string | null;

  sourceUrl: string;
  lessonTitle: string | null;

  assignmentText: string;
  answerText: string;

  hasAttachments: boolean;
  attachmentSummaries: Array<{
    name: string | null;
    type: string | null;
    url: string | null;
  }>;

  submittedAt: Date | null;
};
```

`externalSubmissionId` must represent the most stable identifier available from GetCourse.

If the UI exposes no stable submission ID, derive a deterministic fallback from stable page/thread identity. Document the fallback in `docs/DECISIONS.md`.

Do not use raw answer text alone as the external ID.

## 6.2 Revision hash

Each discovered answer revision gets:

```ts
revisionHash = sha256(
  normalize(assignmentText) +
  "\n---ANSWER---\n" +
  normalize(answerText) +
  "\n---ATTACHMENTS---\n" +
  normalizedAttachmentMetadata
)
```

This allows a rejected homework submission to be checked again when the student changes or resubmits the answer, even if GetCourse reuses the same thread/submission identifier.

Database uniqueness:

```text
(source, external_submission_id, revision_hash)
```

## 6.3 GetCourse adapter

```ts
export interface GetCourseAdapter {
  healthCheck(): Promise<GetCourseHealth>;

  listPendingSubmissions(): Promise<HomeworkSubmission[]>;

  getSubmission(
    externalSubmissionId: string
  ): Promise<HomeworkSubmission>;

  applyResult(input: {
    externalSubmissionId: string;
    feedback: string;
    decision: 'accept' | 'reject';
    checkId: string;
  }): Promise<void>;
}
```

`applyResult()` must be retry-safe at the application level.

The rest of the project must not know whether the adapter uses DOM clicks or HTTP requests.

## 6.4 Grading result

```ts
export type GradingDecision =
  | 'accept'
  | 'reject'
  | 'needs_review';

export type GradingResult = {
  decision: GradingDecision;

  feedback: string;

  reason: string;

  confidence: number;

  issues: Array<{
    code: string;
    message: string;
  }>;
};
```

Rules:

- `feedback` is the text intended for the student.
- `reason` is an internal explanation for logs/debugging and does not need to be sent to the student.
- `confidence` is telemetry only. Do not use it as the sole automatic-action rule.
- `needs_review` never mutates the homework status automatically.

Validate Gemini output strictly with Zod.

---

# 7. Database model

Use UUID primary keys for internal entities.

Use `timestamptz`.

## 7.1 `courses`

Fields:

```text
id uuid PK
slug text UNIQUE NOT NULL
title text NOT NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
```

## 7.2 `modules`

Fields:

```text
id uuid PK
course_id uuid FK → courses.id
slug text NOT NULL
title text NOT NULL
order_index integer NOT NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
```

Unique:

```text
(course_id, slug)
```

## 7.3 `lessons`

Fields:

```text
id uuid PK
course_id uuid FK → courses.id
module_id uuid NULL FK → modules.id
slug text NOT NULL
title text NOT NULL
order_index integer NOT NULL

getcourse_lesson_id text NULL
getcourse_lesson_url text NULL

summary text NULL
learning_objectives jsonb NOT NULL DEFAULT []
grading_criteria jsonb NOT NULL DEFAULT []
common_mistakes jsonb NOT NULL DEFAULT []

created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
```

Unique:

```text
(course_id, slug)
```

Add indexes for:

```text
getcourse_lesson_id
getcourse_lesson_url
```

## 7.4 `lesson_dependencies`

This is intentionally simple and is not a graph database.

Fields:

```text
lesson_id uuid FK → lessons.id
depends_on_lesson_id uuid FK → lessons.id
created_at timestamptz NOT NULL
```

Composite PK:

```text
(lesson_id, depends_on_lesson_id)
```

Dependencies mean:

> knowledge from `depends_on_lesson_id` is allowed to be used while checking `lesson_id`.

Do not automatically include future lessons.

## 7.5 `knowledge_documents`

Fields:

```text
id uuid PK
lesson_id uuid FK → lessons.id
kind text NOT NULL
source_path text NULL
content text NOT NULL
content_hash text NOT NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
```

Allowed `kind` values for MVP:

```text
transcript
notes
criteria
```

Unique where practical:

```text
(lesson_id, kind, content_hash)
```

## 7.6 `knowledge_chunks`

Fields:

```text
id uuid PK
document_id uuid FK → knowledge_documents.id
lesson_id uuid FK → lessons.id
chunk_index integer NOT NULL
content text NOT NULL
content_hash text NOT NULL
embedding vector(768) NOT NULL
created_at timestamptz NOT NULL
```

Indexes:

- B-tree on `lesson_id`
- unique `(document_id, chunk_index)`
- HNSW cosine index on `embedding`

## 7.7 `submissions`

Fields:

```text
id uuid PK
source text NOT NULL               -- "getcourse"
external_submission_id text NOT NULL
external_user_id text NULL
external_lesson_id text NULL

lesson_id uuid NULL FK → lessons.id

source_url text NOT NULL
lesson_title text NULL
assignment_text text NOT NULL
answer_text text NOT NULL

has_attachments boolean NOT NULL
attachments jsonb NOT NULL DEFAULT []

revision_hash text NOT NULL

status text NOT NULL
discovered_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
```

Allowed statuses:

```text
pending
checking
checked
needs_review
applied
failed
```

Unique:

```text
(source, external_submission_id, revision_hash)
```

## 7.8 `checks`

Fields:

```text
id uuid PK
submission_id uuid FK → submissions.id

status text NOT NULL

model text NOT NULL
prompt_hash text NOT NULL
context_hash text NOT NULL

decision text NULL
confidence real NULL
feedback text NULL
reason text NULL
issues jsonb NOT NULL DEFAULT []
raw_output jsonb NULL

attempt_count integer NOT NULL DEFAULT 0
last_error text NULL

comment_applied_at timestamptz NULL
decision_applied_at timestamptz NULL

created_at timestamptz NOT NULL
started_at timestamptz NULL
completed_at timestamptz NULL
updated_at timestamptz NOT NULL
```

Allowed check statuses:

```text
pending
running
completed
needs_review
apply_pending
applied
failed
```

For MVP create no separate generic job table unless implementation demonstrates a concrete need.

---

# 8. Knowledge file format

Knowledge is versionable and importable from the repository or another local folder.

Example:

```text
knowledge/
└── sales-course/
    ├── course.yaml
    └── lessons/
        ├── 010-needs/
        │   ├── lesson.yaml
        │   └── transcript.md
        └── 011-objections/
            ├── lesson.yaml
            ├── transcript.md
            └── notes.md
```

## 8.1 `course.yaml`

Example:

```yaml
slug: sales-course
title: Sales Course
```

## 8.2 `lesson.yaml`

Example:

```yaml
slug: objections
title: Работа с возражениями
order: 11

module:
  slug: sales
  title: Продажи
  order: 2

getcourse:
  lesson_id: "123456"
  lesson_url: "https://example.getcourse.ru/teach/control/lesson/view/id/123456"

depends_on:
  - needs

summary: >
  Урок объясняет базовый алгоритм работы с возражениями.

learning_objectives:
  - Определять реальное возражение клиента.
  - Не начинать спорить с клиентом.
  - Использовать алгоритм уточнения.

grading_criteria:
  - Ответ должен учитывать причину возражения.
  - Ученик должен объяснить последовательность действий.

common_mistakes:
  - Сразу давать контраргумент без уточнения.
  - Давить на клиента.
```

All optional structured fields may be empty, but `slug`, `title`, `order` and transcript must be importable.

## 8.3 Transcript

`transcript.md` contains the full transcript.

Do not send the entire transcript to Gemini during normal grading.

---

# 9. Knowledge import pipeline

Command:

```bash
pnpm knowledge:import -- ./knowledge/sales-course
```

The importer must:

1. validate YAML;
2. upsert course;
3. upsert modules;
4. upsert lessons;
5. resolve `depends_on`;
6. read transcript/notes;
7. hash each source document;
8. skip reprocessing unchanged documents;
9. chunk changed documents;
10. generate embeddings;
11. replace chunks for changed documents in a transaction;
12. print an import summary.

Expected summary:

```text
Course: sales-course
Lessons: 24
Documents new: 3
Documents changed: 1
Documents unchanged: 21
Chunks embedded: 37
Errors: 0
```

## 9.1 Chunking

Use a small deterministic paragraph-aware chunker.

Target:

```env
KNOWLEDGE_CHUNK_TARGET_CHARS=4000
KNOWLEDGE_CHUNK_OVERLAP_CHARS=400
```

Rules:

- prefer paragraph boundaries;
- do not split in the middle of a paragraph if avoidable;
- if one paragraph exceeds target size, split it;
- preserve ordering;
- overlap only enough neighboring text to maintain continuity;
- hash final chunk content.

Do not add a tokenizer dependency merely to obtain exact token counts in MVP.

## 9.2 Embedding

Use the configured Gemini embedding model.

Use a retrieval-appropriate task type if the current official SDK supports it.

Embedding dimension must be exactly 768.

Batch embeddings where supported and simple.

Implement retries for transient Gemini errors with bounded exponential backoff.

Do not retry permanent validation/authentication errors indefinitely.

---

# 10. Lesson mapping

A GetCourse submission must map to one internal lesson.

Mapping order:

1. exact `getcourse_lesson_id`;
2. normalized exact `getcourse_lesson_url`;
3. only if explicitly enabled, exact configured alias.

Do not map automatically by fuzzy lesson title in production.

If no lesson mapping exists:

```text
submission.status = needs_review
```

and Gemini must not grade it automatically.

Log enough information to add the mapping:

```text
externalLessonId
lessonTitle
sourceUrl
```

---

# 11. Retrieval and Context Builder

This is a core quality component.

Gemini must not receive the entire course.

## 11.1 Allowed knowledge

For homework attached to lesson `L`, the default allowed lesson set is:

```text
L
+
explicit lesson_dependencies of L
```

Do not search later/future lessons.

Do not automatically search the entire course in MVP.

## 11.2 Retrieval query

Build retrieval query from:

```text
assignmentText
+
answerText
```

Do not include teacher feedback from previous checks unless that feature is explicitly added later.

Generate one query embedding.

## 11.3 Retrieval strategy

1. Retrieve top chunks from current lesson.
2. Retrieve a smaller number from explicitly allowed prerequisite lessons.
3. Deduplicate identical/overlapping content.
4. Preserve source metadata.
5. Enforce a hard context size cap.

Defaults:

```env
RETRIEVAL_CURRENT_LESSON_TOP_K=6
RETRIEVAL_DEPENDENCIES_TOP_K=3
MAX_KNOWLEDGE_CONTEXT_CHARS=30000
```

`RETRIEVAL_DEPENDENCIES_TOP_K` is total across dependencies, not per dependency.

Use cosine distance.

MVP does not require a hard similarity threshold. Top-K and lesson filtering are the primary controls.

## 11.4 Context package

Build:

```ts
export type GradingContext = {
  lesson: {
    title: string;
    summary: string | null;
    learningObjectives: string[];
    gradingCriteria: string[];
    commonMistakes: string[];
  };

  prerequisiteLessons: Array<{
    title: string;
  }>;

  retrievedChunks: Array<{
    lessonId: string;
    lessonTitle: string;
    kind: 'transcript' | 'notes' | 'criteria';
    chunkIndex: number;
    content: string;
  }>;
};
```

The final prompt must clearly distinguish:

- assignment;
- student's answer;
- lesson criteria;
- retrieved source excerpts.

The model must be instructed not to invent requirements absent from the provided course context or grading prompt.

## 11.5 Context hash

Before calling Gemini:

```text
context_hash = sha256(canonical JSON of GradingContext)
```

Store it on the check for reproducibility/debugging.

---

# 12. AI grader

## 12.1 Prompt location

Store the main editable prompt at:

```text
prompts/homework-checker.md
```

Do not embed the full prompt inside TypeScript.

At process start:

- load the file;
- fail fast if missing/empty;
- compute SHA-256;
- store `prompt_hash` with every check.

A prompt change must be observable through a different hash.

## 12.2 Gemini request

Use:

```env
GEMINI_MODEL=gemini-3.7-flash
GEMINI_THINKING_LEVEL=medium
```

Send:

```text
SYSTEM/INSTRUCTIONS:
contents of prompts/homework-checker.md

LESSON CONTEXT:
structured GradingContext

ASSIGNMENT:
assignmentText

STUDENT ANSWER:
answerText
```

Use structured output.

## 12.3 Output schema

JSON Schema equivalent to:

```ts
const GradingResultSchema = z.object({
  decision: z.enum(['accept', 'reject', 'needs_review']),

  feedback: z.string().min(1).max(10000),

  reason: z.string().min(1).max(10000),

  confidence: z.number().min(0).max(1),

  issues: z.array(
    z.object({
      code: z.string().min(1).max(100),
      message: z.string().min(1).max(2000),
    })
  ).max(50),
});
```

If the response cannot be parsed/validated:

- do not infer a decision from free text;
- mark the attempt failed;
- retry according to retry policy;
- after max attempts, `needs_review`.

## 12.4 Retry policy

Default:

```env
AI_MAX_ATTEMPTS=3
```

Retry only on:

- transient network error;
- rate limiting;
- server error;
- malformed/invalid structured output.

Backoff:

```text
attempt 1 → immediate original call
attempt 2 → ~2 sec
attempt 3 → ~8 sec
```

Allow jitter.

Do not infinitely retry authentication/configuration errors.

## 12.5 Attachment rule

If `hasAttachments === true` and the attachment content is required to understand the answer:

- do not pretend the attachment was analyzed;
- result must be `needs_review`.

The GetCourse adapter may capture attachment metadata, but downloading/understanding attachments is outside MVP.

---

# 13. GetCourse Playwright integration

## 13.1 Authentication

Do not store GetCourse username/password in source code.

Create:

```bash
pnpm getcourse:login
```

Behavior:

1. launch Chromium headful;
2. open configured GetCourse admin/login URL;
3. user logs in manually;
4. wait until the configured authenticated page is reached;
5. save Playwright `storageState` to:

```text
playwright/.auth/getcourse.json
```

6. close browser.

`playwright/.auth/*` must be gitignored.

If session expires, the service must expose/log an explicit authentication error instead of repeatedly failing grading jobs.

## 13.2 Required environment

```env
GETCOURSE_BASE_URL=
GETCOURSE_ANSWER_FEED_URL=
GETCOURSE_AUTH_STATE_PATH=./playwright/.auth/getcourse.json
GETCOURSE_POLL_INTERVAL_MS=60000
```

Do not assume a universal account subdomain.

## 13.3 Discovery tool

Because exact GetCourse selectors can vary and undocumented endpoints must not be invented, create:

```bash
pnpm getcourse:discover
```

The discovery tool must:

1. use existing authenticated storage state;
2. launch headful Chromium;
3. open `GETCOURSE_ANSWER_FEED_URL`;
4. attach listeners for `request`/`response`;
5. log XHR/fetch URLs and HTTP methods to `var/getcourse-network.jsonl`;
6. allow the developer to inspect one pending homework manually;
7. optionally save DOM HTML to `var/getcourse-answer-feed.html`;
8. optionally save a screenshot to `var/getcourse-answer-feed.png`;
9. never commit `var/*`;
10. never make automatic grading mutations.

This tool is for implementation/debugging only.

After live inspection, finalize stable selectors inside:

```text
src/integrations/getcourse/selectors.ts
```

Prefer:

1. stable IDs/data attributes;
2. semantic text/roles;
3. stable URLs;
4. CSS structure only as last resort.

Keep selectors centralized.

## 13.4 Pending submission scan

`listPendingSubmissions()` must read homework that requires teacher attention.

For every visible candidate, extract:

- stable submission/thread identifier if available;
- user identifier if available;
- lesson identifier/URL;
- lesson title;
- assignment text;
- latest student answer text;
- attachment metadata;
- source URL;
- submitted timestamp if available.

If required data is hidden on a detail page, it is acceptable to open the detail page.

Do not have the poller grade directly. The poller only discovers/upserts submissions.

## 13.5 Browser lifecycle

Prefer one browser/context per poll cycle or a long-lived controlled context, whichever proves more stable during implementation.

Do not optimize prematurely.

The adapter must:

- use explicit timeouts;
- close pages/contexts reliably;
- surface auth errors distinctly;
- avoid opening unbounded tabs;
- not run overlapping scans.

## 13.6 Apply result

When `AUTO_APPLY_RESULTS=true` and result is `accept`/`reject`:

1. open the submission;
2. check whether the exact AI feedback is already present;
3. if absent, add the comment;
4. verify the comment is visible;
5. inspect current homework status;
6. if already in target status, do not click again;
7. otherwise click Accept or Reject;
8. verify target status;
9. update `comment_applied_at`;
10. update `decision_applied_at`.

This makes application retries safer.

If the browser times out after a mutation and the outcome is uncertain, retry by re-reading the page state first. Never blindly duplicate comments.

`needs_review` is never auto-applied.

---

# 14. Poller and worker behavior

## 14.1 Submission poller

Pseudo-flow:

```ts
while (!signal.aborted) {
  if (!scanInProgress) {
    scanInProgress = true;

    try {
      const submissions = await getCourse.listPendingSubmissions();

      for (const external of submissions) {
        await submissionService.upsertRevision(external);
      }
    } finally {
      scanInProgress = false;
    }
  }

  await sleep(pollInterval);
}
```

Each new `(externalSubmissionId, revisionHash)` becomes a pending local submission.

An unchanged revision must not create another check.

## 14.2 Check worker

Single-worker MVP:

```text
find oldest pending submission
      ↓
mark checking
      ↓
resolve lesson
      ↓
if unmapped → needs_review
      ↓
if unsupported attachment → needs_review
      ↓
build context
      ↓
call Gemini
      ↓
store result
      ↓
if needs_review → stop
      ↓
if AUTO_APPLY=false → completed
      ↓
if AUTO_APPLY=true → apply to GetCourse
      ↓
applied
```

The worker should sleep briefly when no jobs exist.

Default:

```env
CHECK_WORKER_IDLE_MS=2000
```

Use atomic status transitions so the same pending submission is not started twice by the same process.

Do not build a generic distributed queue framework in MVP.

## 14.3 Crash recovery

On process startup:

- checks stuck in `running` longer than a configured lease may be returned to `pending`;
- do not reset recently running rows.

Default:

```env
CHECK_RUNNING_STALE_AFTER_MS=900000
```

15 minutes.

---

# 15. HTTP API

The HTTP API is operational, not a full admin product.

## 15.1 `GET /health`

Return:

```json
{
  "status": "ok",
  "database": "ok",
  "getcourse": "ok",
  "geminiConfigured": true,
  "autoApplyResults": false
}
```

Possible top-level statuses:

```text
ok
degraded
error
```

Do not call Gemini on every health request.

GetCourse health can use cached recent status to avoid excessive browser activity.

## 15.2 `GET /checks`

Simple development endpoint.

Query:

```text
?limit=50
&status=completed
```

Return recent check metadata:

- check ID;
- submission;
- lesson;
- decision;
- feedback;
- timestamps;
- apply state;
- last error.

No HTML UI required.

## 15.3 `GET /checks/:id`

Return complete stored check:

- source submission;
- lesson mapping;
- context sources metadata;
- model;
- prompt hash;
- context hash;
- structured result;
- errors;
- apply timestamps.

Do not expose secrets/auth state.

## 15.4 Optional development endpoint

A manual one-submission check endpoint may be implemented only if protected by an explicit local/admin token.

Prefer the CLI in section 16 for MVP.

---

# 16. CLI commands

Required scripts:

```bash
pnpm dev
pnpm start
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm test:unit
pnpm test:integration

pnpm db:generate
pnpm db:migrate

pnpm knowledge:import -- <path>

pnpm getcourse:login
pnpm getcourse:discover

pnpm check:one -- <externalSubmissionId>
```

`check:one` should run one submission through the grading pipeline and respect `AUTO_APPLY_RESULTS`.

---

# 17. Configuration

`.env.example` must contain:

```env
NODE_ENV=development
PORT=3000
LOG_LEVEL=info

DATABASE_URL=postgresql://postgres:postgres@localhost:5432/getcourse_ai

GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.7-flash
GEMINI_THINKING_LEVEL=medium
GEMINI_EMBEDDING_MODEL=gemini-embedding-2
EMBEDDING_DIMENSIONS=768

GETCOURSE_BASE_URL=
GETCOURSE_ANSWER_FEED_URL=
GETCOURSE_AUTH_STATE_PATH=./playwright/.auth/getcourse.json
GETCOURSE_POLL_INTERVAL_MS=60000

AUTO_APPLY_RESULTS=false

KNOWLEDGE_CHUNK_TARGET_CHARS=4000
KNOWLEDGE_CHUNK_OVERLAP_CHARS=400
RETRIEVAL_CURRENT_LESSON_TOP_K=6
RETRIEVAL_DEPENDENCIES_TOP_K=3
MAX_KNOWLEDGE_CONTEXT_CHARS=30000

AI_MAX_ATTEMPTS=3
CHECK_WORKER_IDLE_MS=2000
CHECK_RUNNING_STALE_AFTER_MS=900000
```

Validate configuration with Zod at startup.

Fail fast for required settings that are needed by the selected runtime mode.

Test processes must be able to run without live Gemini/GetCourse credentials by using fakes/mocks.

---

# 18. Required `AGENTS.md`

Codex must create this file **before application implementation**.

It is the persistent project memory/instruction file.

Keep it concise enough to read at the start of every session, but include the entire phase roadmap.

Minimum structure:

```markdown
# AGENTS.md

## Project goal
One paragraph describing the GetCourse AI homework checker.

## Current MVP scope
- text homework only
- GetCourse via Playwright
- PostgreSQL + pgvector
- Gemini Flash
- local knowledge import
- dry-run by default

## Architectural invariants
- single TypeScript service
- no Redis/BullMQ
- no separate vector DB
- no Notion in MVP
- no undocumented GetCourse HTTP API in MVP
- GetCourse-specific behavior stays behind GetCourseAdapter
- Gemini-specific behavior stays behind grader/embedding adapters
- prompts are files, not hardcoded
- no future lesson knowledge during grading
- every homework revision is idempotent
- automatic mutations disabled by default

## Core flow
GetCourse → submission → lesson mapping → retrieval → Gemini → stored result → optional GetCourse mutation.

## Source-of-truth documents
- `docs/SPEC.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/DECISIONS.md`

## Commands
List all commands from section 16.

## Phase roadmap
- [ ] Phase 0 — repository/bootstrap
- [ ] Phase 1 — database/config
- [ ] Phase 2 — knowledge ingestion
- [ ] Phase 3 — retrieval/context builder
- [ ] Phase 4 — Gemini grader
- [ ] Phase 5 — GetCourse login/discovery
- [ ] Phase 6 — GetCourse read adapter
- [ ] Phase 7 — end-to-end dry-run worker
- [ ] Phase 8 — GetCourse result application
- [ ] Phase 9 — hardening/tests/docs
- [ ] Phase 10 — MVP acceptance

## Current phase
Keep this updated.

## Last completed work
Keep this updated after every meaningful implementation batch.

## Next action
Exactly one concrete next action.

## Known blockers
Only real blockers, no speculative risks.

## Rules for future Codex sessions
1. Read AGENTS.md first.
2. Read the relevant spec/plan section before coding.
3. Do not silently change architectural decisions.
4. If a requirement conflicts with current code, document the conflict.
5. Update tests with behavior changes.
6. Run typecheck + relevant tests before declaring a task complete.
7. Update AGENTS.md before ending a session.
8. Never commit secrets, Playwright storage state, GetCourse HTML/screenshots, or `var/*`.
```

Codex may improve wording, but must preserve the substance.

The detailed plan lives in `docs/IMPLEMENTATION_PLAN.md`; `AGENTS.md` contains the complete phase roadmap plus current state and links so any new Codex session can recover context quickly.

---

# 19. Implementation phases

The implementation must proceed in this order unless a concrete dependency requires a small adjustment.

## Phase 0 — Bootstrap and project memory

Deliverable: repository is understandable before feature code exists.

Tasks:

- create project;
- create `AGENTS.md`;
- copy this specification to `docs/SPEC.md`;
- create `docs/IMPLEMENTATION_PLAN.md`;
- create `docs/DECISIONS.md`;
- configure TypeScript strict mode;
- configure pnpm;
- configure ESLint or another lightweight linter if needed;
- configure Vitest;
- create `.env.example`;
- create `.gitignore`;
- add baseline README;
- make initial commit.

Acceptance:

```bash
pnpm typecheck
pnpm test
```

both run successfully, even if tests are initially minimal.

## Phase 1 — Database and configuration

Deliverable: local PostgreSQL/pgvector environment and schema.

Tasks:

- Docker Compose PostgreSQL with pgvector;
- configuration validation;
- Drizzle connection;
- schema and migrations;
- repository primitives;
- migration tests or integration schema tests.

Acceptance:

```bash
docker compose up -d
pnpm db:migrate
pnpm test:integration
```

Database starts cleanly and migrations are repeatable.

## Phase 2 — Knowledge ingestion

Deliverable: course transcripts can be imported and embedded.

Tasks:

- YAML schemas;
- importer;
- chunker;
- document hashing;
- Gemini embedding adapter;
- transactional replacement of changed chunks;
- dependency resolution;
- example course fixture;
- importer tests.

Acceptance:

```bash
pnpm knowledge:import -- ./knowledge/example-course
```

Run twice:

- first run embeds content;
- second run reports unchanged content and does not re-embed it.

## Phase 3 — Retrieval and context builder

Deliverable: given an internal lesson + homework text, produce a bounded `GradingContext`.

Tasks:

- vector retrieval;
- current-lesson filtering;
- explicit prerequisite retrieval;
- no-future-lesson guarantee;
- deduplication;
- context character cap;
- context hashing;
- unit/integration tests.

Critical test:

Create fixtures where a future lesson has a semantically perfect match. Assert it is not retrieved unless explicitly declared as a dependency.

## Phase 4 — Gemini grader

Deliverable: deterministic application contract around Gemini.

Tasks:

- prompt loader + hash;
- Zod result schema;
- Gemini client;
- structured output;
- retry policy;
- result validation;
- fake grader for tests;
- tests for invalid output/retries.

Acceptance:

A fixture homework can be graded with a fake in CI and with real Gemini via an opt-in local command.

## Phase 5 — GetCourse login and discovery

Deliverable: developer can safely authenticate and inspect real account behavior.

Tasks:

- `getcourse:login`;
- gitignored storage state;
- `getcourse:discover`;
- network logging;
- DOM dump/screenshot support in `var/`;
- auth-error classification;
- document discovered selectors/behavior in `docs/DECISIONS.md`.

This phase requires real GetCourse account access to finalize selectors.

No homework mutations are allowed in this phase.

## Phase 6 — GetCourse read adapter

Deliverable: `listPendingSubmissions()` returns normalized domain objects from real GetCourse.

Tasks:

- centralized selectors;
- answer feed parser;
- detail-page parser if needed;
- external ID extraction;
- fallback identity strategy if required;
- attachment metadata extraction;
- lesson identity extraction;
- HTML fixture tests.

Acceptance:

With a real account, print a normalized list of pending submissions without modifying them.

## Phase 7 — End-to-end dry-run

Deliverable: new GetCourse text homework is automatically graded and stored, but not modified in GetCourse.

Tasks:

- submission upsert;
- revision hash;
- lesson mapping;
- poller;
- worker;
- retrieval;
- Gemini grader;
- checks storage;
- `/health`;
- `/checks`;
- `check:one`;
- startup recovery;
- dry-run logs.

Acceptance scenario:

1. student homework appears in GetCourse;
2. poller discovers it;
3. local lesson mapping succeeds;
4. context uses only allowed lesson material;
5. Gemini returns structured result;
6. check is stored;
7. GetCourse remains unchanged;
8. same unchanged homework is not graded twice;
9. changed/resubmitted homework is graded again.

This is the first complete MVP vertical slice.

## Phase 8 — GetCourse result application

Deliverable: controlled automatic comment + accept/reject.

Tasks:

- comment action;
- Accept action;
- Reject action;
- current-status inspection;
- duplicate-comment avoidance;
- mutation verification;
- retry behavior;
- `AUTO_APPLY_RESULTS` gate;
- `needs_review` no-mutation guarantee.

Acceptance:

With `AUTO_APPLY_RESULTS=false`, no mutations occur.

With `AUTO_APPLY_RESULTS=true` on a dedicated test homework:

- comment appears once;
- decision status changes correctly;
- retrying the same check does not duplicate the comment/action.

## Phase 9 — Hardening

Deliverable: service can run unattended for MVP usage.

Tasks:

- graceful shutdown;
- clear auth-expired behavior;
- bounded retries;
- useful structured logs;
- health states;
- startup stale-job recovery;
- Dockerfile;
- README operating instructions;
- backup/restore notes for PostgreSQL;
- test suite cleanup.

Do not add monitoring infrastructure beyond logs/health endpoint unless there is a real deployment need.

## Phase 10 — MVP acceptance

Run the acceptance suite in section 22.

Update:

- `AGENTS.md`;
- `docs/IMPLEMENTATION_PLAN.md`;
- `docs/DECISIONS.md`;
- README.

Tag or commit the MVP state.

---

# 20. Testing strategy

Use three levels.

## 20.1 Unit tests

Must cover:

- text normalization;
- revision hashing;
- chunking;
- lesson dependency filtering;
- context cap;
- prompt hashing;
- Gemini result validation;
- grading decision handling;
- retry policy;
- auto-apply gating.

## 20.2 Integration tests

Use real PostgreSQL/pgvector in Docker.

Must cover:

- migrations;
- knowledge import/upsert;
- unchanged-document skip;
- vector retrieval;
- submission uniqueness;
- check persistence;
- stale running check recovery.

Gemini must be fake/mock by default.

## 20.3 GetCourse fixture tests

Store **sanitized** HTML fixtures under:

```text
tests/fixtures/getcourse/
```

Fixtures must contain no real student personal data.

Test:

- answer feed parsing;
- detail page parsing;
- pending state recognition;
- accept/reject state recognition;
- attachment detection.

## 20.4 Live tests

Put opt-in live tests under:

```text
tests/live/
```

Require:

```env
RUN_LIVE_GETCOURSE_TESTS=true
```

Live tests must be read-only by default.

A mutation test must require an additional explicit flag:

```env
RUN_LIVE_GETCOURSE_MUTATION_TESTS=true
```

Never let normal `pnpm test` modify GetCourse.

---

# 21. Error handling

Define typed/domain error categories where useful.

At minimum distinguish:

```text
ConfigurationError
GetCourseAuthError
GetCourseParsingError
GetCourseMutationError
LessonMappingError
KnowledgeImportError
GeminiAuthError
GeminiTransientError
GeminiInvalidOutputError
```

Rules:

- config/auth permanent errors: fail loudly or mark service degraded; no infinite retry loop;
- transient external errors: bounded retry;
- parsing changes in GetCourse: preserve submission/check state and surface actionable error;
- unmapped lesson: `needs_review`;
- unsupported attachment: `needs_review`;
- invalid Gemini output after retries: `needs_review`;
- mutation uncertainty: inspect current GetCourse state before retrying.

Never silently convert technical failure into `reject`.

---

# 22. MVP acceptance criteria

MVP is accepted only if all are true.

## A. Knowledge base

- A course with multiple lesson transcripts can be imported.
- Unchanged transcripts are not re-embedded on every import.
- Each chunk is associated with a lesson.
- `pgvector` retrieval works.

## B. Context isolation

For homework from lesson N:

- current lesson knowledge is available;
- explicit prerequisite knowledge may be included;
- future lessons are not included;
- total retrieved knowledge respects configured cap.

## C. AI grading

- Prompt is editable as a file.
- Every check stores prompt hash.
- Gemini output is schema validated.
- `accept`, `reject`, `needs_review` are supported.
- Invalid AI output cannot directly mutate GetCourse.

## D. GetCourse read path

- Auth state is stored outside git.
- Pending homework can be discovered.
- The latest answer text can be extracted.
- Lesson can be mapped.
- Student resubmission/change creates a new revision.

## E. Idempotency

- Same unchanged homework is not sent to Gemini twice.
- Restart does not duplicate successful checks.
- Re-running result application does not intentionally create duplicate feedback.

## F. Dry-run

With:

```env
AUTO_APPLY_RESULTS=false
```

the complete pipeline works without changing GetCourse.

## G. Automatic apply

With:

```env
AUTO_APPLY_RESULTS=true
```

for supported text homework:

- feedback is posted;
- accept/reject is applied;
- action is verified;
- `needs_review` is not applied automatically.

## H. Operational

- `/health` works.
- Recent checks can be inspected.
- Logs identify failed stage/check/submission without exposing secrets.
- Service restarts cleanly.
- `pnpm typecheck` passes.
- `pnpm test` passes.
- integration tests pass against a clean database.

---

# 23. Security and privacy

Homework contains student data.

Requirements:

- never commit GetCourse auth state;
- never commit `.env`;
- never log session cookies;
- never log Gemini API keys;
- do not save real GetCourse HTML/screenshots in git;
- sanitize fixtures;
- log student IDs only where useful for debugging;
- avoid logging full homework text at `info` level;
- full prompt/context/raw response may be persisted in DB only where needed for audit/debugging and must not be dumped indiscriminately into logs;
- database backup should be treated as sensitive data.

For MVP, no separate encryption-at-rest layer is required beyond the deployment/database platform, but secrets must come from environment/runtime secret management.

---

# 24. Logging

Use structured Pino logs.

Every check pipeline log should include when available:

```text
checkId
submissionId
externalSubmissionId
lessonId
stage
attempt
```

Stages:

```text
discovery
mapping
retrieval
grading
persist
apply_comment
apply_decision
```

Do not log:

- API keys;
- cookies;
- passwords;
- auth storage state;
- entire browser storage state.

---

# 25. Readiness for future versions

The following extension points should exist as interfaces/boundaries, but no unused complex framework is required.

## 25.1 Future Notion integration

Future:

```ts
interface KnowledgeSource {
  loadCourse(): Promise<...>;
}
```

MVP local-file importer can later be supplemented by `NotionKnowledgeSource`.

Do not build Notion now.

## 25.2 Future GetCourse HTTP adapter

Future:

```text
GetCourseAdapter
├── PlaywrightGetCourseAdapter
└── HttpGetCourseAdapter
```

Only add `HttpGetCourseAdapter` after actual internal requests are inspected and proven sufficiently stable.

Do not mix undocumented HTTP calls into domain services.

## 25.3 Future attachment grading

The domain already records attachment metadata.

Later implementations may add:

- image download;
- PDF extraction;
- Gemini multimodal grading.

MVP must route such cases to `needs_review`.

## 25.4 Future callback trigger

Later:

```text
POST /webhooks/getcourse
```

can enqueue/wake a scan.

Polling remains the correctness fallback unless a documented stable homework event is proven.

---

# 26. Architectural principles for Codex

When making implementation decisions, use this priority order:

1. Reliability.
2. Simplicity.
3. Supported existing solutions.
4. Minimum custom glue code.
5. Minimum moving parts.
6. Maintainability.
7. Performance only where practically relevant.
8. Extra capabilities only when needed.

Rules:

- Prefer simplification over added complexity.
- Do not introduce a component unless it solves a demonstrated problem.
- Do not replace a working component merely because another is newer.
- Avoid speculative future-proofing.
- Avoid premature optimization.
- Keep external-service details behind adapters.
- Every important behavior needs a testable contract.
- Do not invent GetCourse selectors/endpoints.
- Default to safe/dry-run behavior.
- A technical failure must never become a student-facing rejection.

---

# 27. First Codex execution sequence

Codex should begin with exactly this sequence:

```text
1. Create repository/bootstrap files.
2. Create AGENTS.md.
3. Save this document as docs/SPEC.md.
4. Create docs/IMPLEMENTATION_PLAN.md from section 19.
5. Create docs/DECISIONS.md from section 2.
6. Initialize TypeScript/pnpm/Vitest.
7. Add Docker Compose PostgreSQL + pgvector.
8. Implement schema/config/migrations.
9. Implement knowledge import + embeddings.
10. Implement retrieval/context builder.
11. Implement Gemini structured grader.
12. Implement GetCourse login/discovery tooling.
13. Inspect the real GetCourse account and finalize selectors.
14. Implement GetCourse read adapter.
15. Wire dry-run vertical slice.
16. Test on real pending homework without mutation.
17. Implement comment + accept/reject behind AUTO_APPLY_RESULTS.
18. Test on dedicated test homework.
19. Harden and complete MVP acceptance.
```

Do not start by implementing browser clicking before the domain, persistence, knowledge, and grader contracts exist.

Do not start by reverse-engineering an undocumented GetCourse API.

The first production-relevant milestone is **Phase 7: complete dry-run vertical slice**.

---

# 28. Implementation completion definition

Codex must not state that the project is "done" merely because code compiles.

Before MVP completion, Codex must provide evidence for:

```bash
pnpm typecheck
pnpm test
pnpm test:integration
```

and document results of:

```text
knowledge import twice
GetCourse read-only discovery
one real dry-run homework
one controlled auto-apply accept test
one controlled auto-apply reject test
one resubmission/idempotency test
```

If live GetCourse credentials/test homework are unavailable, Codex must clearly state that implementation is code-complete but live integration acceptance remains unverified.

---

# 29. Notes on current external APIs

At the time this specification was written (2026-08-27):

- GetCourse documents a public API and an Export API, but the public documentation does not expose a complete documented homework grading API.
- GetCourse documents callback/process operation "Вызвать URL" for sending events/data to external services.
- GetCourse teacher answer feed supports accepting/rejecting homework in the UI.
- Gemini 3.7 Flash is GA and supports structured outputs.
- Google documents `gemini-embedding-2` as the current embedding model and supports 768-dimensional embeddings.
- Drizzle supports PostgreSQL pgvector vector columns and HNSW indexes.
- Playwright supports persisted authentication state.

Codex should consult current official documentation if an SDK signature has changed, but must preserve the architectural behavior and interfaces defined here unless a concrete incompatibility requires a documented adjustment.
