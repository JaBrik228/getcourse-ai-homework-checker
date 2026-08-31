import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { loadConfig } from '../../src/config.js';
import { createDatabaseClient } from '../../src/db/client.js';
import { PgVectorKnowledgeRetriever } from '../../src/knowledge/pgvector-retriever.js';

const config = loadConfig({
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/getcourse_ai',
  TEST_DATABASE_URL:
    process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/getcourse_ai_test',
});
const database = createDatabaseClient({ databaseUrl: config.testDatabaseUrl ?? config.databaseUrl });
const courseIds: string[] = [];

beforeAll(async () => {
  await migrate(database.db, { migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)) });
});

afterEach(async () => {
  await Promise.all(courseIds.splice(0).map(deleteCourse));
});

afterAll(async () => {
  await database.close();
});

describe('PgVectorKnowledgeRetriever', () => {
  test('excludes a semantically perfect future-lesson chunk outside the supplied scopes', async () => {
    const courseId = randomUUID();
    courseIds.push(courseId);
    const currentLessonId = randomUUID();
    const dependencyLessonId = randomUUID();
    const futureLessonId = randomUUID();
    await seedCourse({ courseId, currentLessonId, dependencyLessonId, futureLessonId });

    const retriever = new PgVectorKnowledgeRetriever({
      database,
      config: { retrievalCurrentLessonTopK: 1, retrievalDependenciesTopK: 2 },
    });

    await expect(
      retriever.retrieve({
        queryVector: vector(1, 0),
        currentLessonId,
        dependencyLessonIds: [dependencyLessonId],
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        lessonId: currentLessonId,
        lessonTitle: 'Current lesson',
        documentKind: 'criteria',
        chunkIndex: 0,
        content: 'Current lesson guidance.',
      }),
      expect.objectContaining({
        lessonId: dependencyLessonId,
        lessonTitle: 'Direct dependency',
        documentKind: 'notes',
        chunkIndex: 0,
        content: 'Direct dependency guidance.',
      }),
    ]);
  });
});

async function seedCourse(input: {
  courseId: string;
  currentLessonId: string;
  dependencyLessonId: string;
  futureLessonId: string;
}): Promise<void> {
  await database.pool.query('INSERT INTO courses (id, slug, title) VALUES ($1, $2, $3)', [
    input.courseId,
    `retriever-course-${input.courseId}`,
    'Retriever test course',
  ]);
  await Promise.all([
    insertLesson(input.courseId, input.currentLessonId, 'current', 'Current lesson', 1),
    insertLesson(input.courseId, input.dependencyLessonId, 'dependency', 'Direct dependency', 2),
    insertLesson(input.courseId, input.futureLessonId, 'future', 'Future lesson', 3),
  ]);
  await Promise.all([
    insertChunk({
      lessonId: input.currentLessonId,
      kind: 'criteria',
      content: 'Current lesson guidance.',
      embedding: vector(0, 1),
    }),
    insertChunk({
      lessonId: input.dependencyLessonId,
      kind: 'notes',
      content: 'Direct dependency guidance.',
      embedding: vector(0.8, 0.6),
    }),
    insertChunk({
      lessonId: input.futureLessonId,
      kind: 'transcript',
      content: 'Future lesson answer, which must never be retrieved.',
      embedding: vector(1, 0),
    }),
  ]);
}

async function insertLesson(
  courseId: string,
  lessonId: string,
  slug: string,
  title: string,
  orderIndex: number,
): Promise<void> {
  await database.pool.query(
    'INSERT INTO lessons (id, course_id, slug, title, order_index) VALUES ($1, $2, $3, $4, $5)',
    [lessonId, courseId, slug, title, orderIndex],
  );
}

async function insertChunk(input: {
  lessonId: string;
  kind: 'transcript' | 'notes' | 'criteria';
  content: string;
  embedding: number[];
}): Promise<void> {
  const documentId = randomUUID();
  await database.pool.query(
    'INSERT INTO knowledge_documents (id, lesson_id, kind, content, content_hash) VALUES ($1, $2, $3, $4, $5)',
    [documentId, input.lessonId, input.kind, input.content, randomUUID()],
  );
  await database.pool.query(
    'INSERT INTO knowledge_chunks (id, document_id, lesson_id, chunk_index, content, content_hash, embedding) VALUES ($1, $2, $3, $4, $5, $6, $7::vector)',
    [randomUUID(), documentId, input.lessonId, 0, input.content, randomUUID(), `[${input.embedding.join(',')}]`],
  );
}

async function deleteCourse(courseId: string): Promise<void> {
  await database.pool.query(
    'DELETE FROM knowledge_chunks WHERE lesson_id IN (SELECT id FROM lessons WHERE course_id = $1)',
    [courseId],
  );
  await database.pool.query(
    'DELETE FROM knowledge_documents WHERE lesson_id IN (SELECT id FROM lessons WHERE course_id = $1)',
    [courseId],
  );
  await database.pool.query(
    'DELETE FROM lesson_dependencies WHERE lesson_id IN (SELECT id FROM lessons WHERE course_id = $1) OR depends_on_lesson_id IN (SELECT id FROM lessons WHERE course_id = $1)',
    [courseId],
  );
  await database.pool.query('DELETE FROM lessons WHERE course_id = $1', [courseId]);
  await database.pool.query('DELETE FROM courses WHERE id = $1', [courseId]);
}

function vector(first: number, second: number): number[] {
  return [first, second, ...Array.from({ length: 766 }, () => 0)];
}
describe('PgVectorKnowledgeRetriever limits and ordering', () => {
  test('applies the total dependency limit after deterministic cosine-distance tie breakers', async () => {
    const courseId = randomUUID();
    courseIds.push(courseId);
    const currentLessonId = randomUUID();
    const dependencyLessonId = randomUUID();
    const futureLessonId = randomUUID();
    await seedCourse({ courseId, currentLessonId, dependencyLessonId, futureLessonId });
    await Promise.all([
      insertChunkWithIds({
        chunkId: '00000000-0000-0000-0000-000000000003',
        documentId: '00000000-0000-0000-0000-000000000003',
        lessonId: currentLessonId,
        kind: 'notes',
        content: 'Current lesson lower document ID.',
        embedding: vector(1, 0),
      }),
      insertChunkWithIds({
        chunkId: '00000000-0000-0000-0000-000000000002',
        documentId: '00000000-0000-0000-0000-000000000002',
        lessonId: currentLessonId,
        kind: 'notes',
        content: 'Current lesson higher-priority tie.',
        embedding: vector(1, 0),
      }),
      insertChunkWithIds({
        chunkId: '00000000-0000-0000-0000-000000000005',
        documentId: '00000000-0000-0000-0000-000000000005',
        lessonId: dependencyLessonId,
        kind: 'notes',
        content: 'Dependency third after tie breakers.',
        embedding: vector(1, 0),
      }),
      insertChunkWithIds({
        chunkId: '00000000-0000-0000-0000-000000000004',
        documentId: '00000000-0000-0000-0000-000000000004',
        lessonId: dependencyLessonId,
        kind: 'notes',
        content: 'Dependency second after tie breakers.',
        embedding: vector(1, 0),
      }),
    ]);

    const retriever = new PgVectorKnowledgeRetriever({
      database,
      config: { retrievalCurrentLessonTopK: 1, retrievalDependenciesTopK: 2 },
    });

    await expect(
      retriever.retrieve({
        queryVector: vector(1, 0),
        currentLessonId,
        dependencyLessonIds: [dependencyLessonId],
      }),
    ).resolves.toMatchObject([
      { content: 'Current lesson higher-priority tie.' },
      { content: 'Dependency second after tie breakers.' },
      { content: 'Dependency third after tie breakers.' },
    ]);
  });
});

async function insertChunkWithIds(input: {
  chunkId: string;
  documentId: string;
  lessonId: string;
  kind: 'transcript' | 'notes' | 'criteria';
  content: string;
  embedding: number[];
}): Promise<void> {
  await database.pool.query(
    'INSERT INTO knowledge_documents (id, lesson_id, kind, content, content_hash) VALUES ($1, $2, $3, $4, $5)',
    [input.documentId, input.lessonId, input.kind, input.content, randomUUID()],
  );
  await database.pool.query(
    'INSERT INTO knowledge_chunks (id, document_id, lesson_id, chunk_index, content, content_hash, embedding) VALUES ($1, $2, $3, $4, $5, $6, $7::vector)',
    [
      input.chunkId,
      input.documentId,
      input.lessonId,
      0,
      input.content,
      randomUUID(),
      `[${input.embedding.join(',')}]`,
    ],
  );
}