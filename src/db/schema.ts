import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';

export type AttachmentSummary = {
  name: string | null;
  type: string | null;
  url: string | null;
};

export type GradingIssue = {
  code: string;
  message: string;
};

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
};

export const courses = pgTable('courses', {
  id: uuid('id').defaultRandom().primaryKey(),
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
  ...timestamps,
});

export const modules = pgTable(
  'modules',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    orderIndex: integer('order_index').notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex('modules_course_slug_unique').on(table.courseId, table.slug)],
);

export const lessons = pgTable(
  'lessons',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id),
    moduleId: uuid('module_id').references(() => modules.id),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    orderIndex: integer('order_index').notNull(),
    getcourseLessonId: text('getcourse_lesson_id'),
    getcourseLessonUrl: text('getcourse_lesson_url'),
    summary: text('summary'),
    learningObjectives: jsonb('learning_objectives').$type<string[]>().default([]).notNull(),
    gradingCriteria: jsonb('grading_criteria').$type<string[]>().default([]).notNull(),
    commonMistakes: jsonb('common_mistakes').$type<string[]>().default([]).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('lessons_course_slug_unique').on(table.courseId, table.slug),
    index('lessons_getcourse_lesson_id_index').on(table.getcourseLessonId),
    index('lessons_getcourse_lesson_url_index').on(table.getcourseLessonUrl),
  ],
);

export const lessonDependencies = pgTable(
  'lesson_dependencies',
  {
    lessonId: uuid('lesson_id')
      .notNull()
      .references(() => lessons.id),
    dependsOnLessonId: uuid('depends_on_lesson_id')
      .notNull()
      .references(() => lessons.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.lessonId, table.dependsOnLessonId],
      name: 'lesson_dependencies_pk',
    }),
  ],
);

export const knowledgeDocuments = pgTable(
  'knowledge_documents',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    lessonId: uuid('lesson_id')
      .notNull()
      .references(() => lessons.id),
    kind: text('kind').notNull(),
    sourcePath: text('source_path'),
    content: text('content').notNull(),
    contentHash: text('content_hash').notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('knowledge_documents_lesson_kind_hash_unique').on(
      table.lessonId,
      table.kind,
      table.contentHash,
    ),
    check(
      'knowledge_documents_kind_check',
      sql`${table.kind} IN ('transcript', 'notes', 'criteria')`,
    ),
  ],
);

export const knowledgeChunks = pgTable(
  'knowledge_chunks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => knowledgeDocuments.id),
    lessonId: uuid('lesson_id')
      .notNull()
      .references(() => lessons.id),
    chunkIndex: integer('chunk_index').notNull(),
    content: text('content').notNull(),
    contentHash: text('content_hash').notNull(),
    embedding: vector('embedding', { dimensions: 768 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('knowledge_chunks_lesson_id_index').on(table.lessonId),
    uniqueIndex('knowledge_chunks_document_chunk_index_unique').on(
      table.documentId,
      table.chunkIndex,
    ),
    index('knowledge_chunks_embedding_hnsw_index').using(
      'hnsw',
      table.embedding.op('vector_cosine_ops'),
    ),
  ],
);

export const submissions = pgTable(
  'submissions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    source: text('source').notNull(),
    externalSubmissionId: text('external_submission_id').notNull(),
    externalUserId: text('external_user_id'),
    externalLessonId: text('external_lesson_id'),
    lessonId: uuid('lesson_id').references(() => lessons.id),
    sourceUrl: text('source_url').notNull(),
    lessonTitle: text('lesson_title'),
    assignmentText: text('assignment_text').notNull(),
    answerText: text('answer_text').notNull(),
    hasAttachments: boolean('has_attachments').notNull(),
    attachments: jsonb('attachments').$type<AttachmentSummary[]>().default([]).notNull(),
    revisionHash: text('revision_hash').notNull(),
    status: text('status').notNull(),
    discoveredAt: timestamp('discovered_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('submissions_source_external_revision_unique').on(
      table.source,
      table.externalSubmissionId,
      table.revisionHash,
    ),
    check('submissions_source_check', sql`${table.source} = 'getcourse'`),
    check(
      'submissions_status_check',
      sql`${table.status} IN ('pending', 'checking', 'checked', 'needs_review', 'applied', 'failed')`,
    ),
  ],
);

export const checks = pgTable(
  'checks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    submissionId: uuid('submission_id')
      .notNull()
      .references(() => submissions.id),
    status: text('status').notNull(),
    model: text('model').notNull(),
    promptHash: text('prompt_hash').notNull(),
    contextHash: text('context_hash').notNull(),
    decision: text('decision'),
    confidence: real('confidence'),
    feedback: text('feedback'),
    reason: text('reason'),
    issues: jsonb('issues').$type<GradingIssue[]>().default([]).notNull(),
    rawOutput: jsonb('raw_output'),
    attemptCount: integer('attempt_count').default(0).notNull(),
    lastError: text('last_error'),
    commentAppliedAt: timestamp('comment_applied_at', { withTimezone: true }),
    decisionAppliedAt: timestamp('decision_applied_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      'checks_status_check',
      sql`${table.status} IN ('pending', 'running', 'completed', 'needs_review', 'apply_pending', 'applied', 'failed')`,
    ),
    check(
      'checks_decision_check',
      sql`${table.decision} IS NULL OR ${table.decision} IN ('accept', 'reject', 'needs_review')`,
    ),
  ],
);