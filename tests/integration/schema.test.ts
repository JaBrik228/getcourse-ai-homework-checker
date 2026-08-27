import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import {
  isSameDatabaseTarget,
  loadConfig,
} from '../../src/config.js';
import { createDatabaseClient } from '../../src/db/client.js';

const developmentDatabaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5432/getcourse_ai';
const localTestDatabaseUrl =
  'postgresql://postgres:postgres@localhost:5432/getcourse_ai_test';
const config = loadConfig({
  DATABASE_URL: developmentDatabaseUrl,
  TEST_DATABASE_URL: process.env.TEST_DATABASE_URL ?? localTestDatabaseUrl,
});
const testDatabaseUrl = config.testDatabaseUrl;

if (
  testDatabaseUrl === undefined ||
  isSameDatabaseTarget(testDatabaseUrl, config.databaseUrl)
) {
  throw new Error(
    'TEST_DATABASE_URL must be configured and must differ from DATABASE_URL before integration tests run.',
  );
}

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));
const expectedTables = [
  'checks',
  'courses',
  'knowledge_chunks',
  'knowledge_documents',
  'lesson_dependencies',
  'lessons',
  'modules',
  'submissions',
];
const expectedIndexes = [
  'courses_slug_unique',
  'knowledge_chunks_document_chunk_index_unique',
  'knowledge_chunks_embedding_hnsw_index',
  'knowledge_chunks_lesson_id_index',
  'knowledge_documents_lesson_kind_hash_unique',
  'lessons_course_slug_unique',
  'lessons_getcourse_lesson_id_index',
  'lessons_getcourse_lesson_url_index',
  'modules_course_slug_unique',
  'submissions_source_external_revision_unique',
];
const expectedForeignKeys = [
  'checks_submission_id_submissions_id_fk',
  'knowledge_chunks_document_id_knowledge_documents_id_fk',
  'knowledge_chunks_lesson_id_lessons_id_fk',
  'knowledge_documents_lesson_id_lessons_id_fk',
  'lesson_dependencies_depends_on_lesson_id_lessons_id_fk',
  'lesson_dependencies_lesson_id_lessons_id_fk',
  'lessons_course_id_courses_id_fk',
  'lessons_module_id_modules_id_fk',
  'modules_course_id_courses_id_fk',
  'submissions_lesson_id_lessons_id_fk',
];
const expectedChecks = [
  'checks_decision_check',
  'checks_status_check',
  'knowledge_documents_kind_check',
  'submissions_source_check',
  'submissions_status_check',
];

const database = createDatabaseClient({ databaseUrl: testDatabaseUrl });

beforeAll(async () => {
  try {
    await database.pool.query('SELECT 1');
  } catch (error) {
    throw new Error(
      'Integration database is unavailable. Run "docker compose up -d" and retry.',
      { cause: error },
    );
  }

  await migrate(database.db, { migrationsFolder });
  await migrate(database.db, { migrationsFolder });
});

afterAll(async () => {
  await database.close();
});

describe('database migration', () => {
  test('installs required extensions and creates the complete Phase 1 schema', async () => {
    const extensions = await database.db.execute<{ extname: string }>(sql`
      SELECT extname
      FROM pg_extension
      WHERE extname IN ('pgcrypto', 'vector')
      ORDER BY extname
    `);
    const tables = await database.db.execute<{ table_name: string }>(sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
    `);
    const embeddingType = await database.db.execute<{ data_type: string }>(sql`
      SELECT format_type(attribute.atttypid, attribute.atttypmod) AS data_type
      FROM pg_attribute AS attribute
      WHERE attribute.attrelid = 'knowledge_chunks'::regclass
        AND attribute.attname = 'embedding'
        AND attribute.attnum > 0
        AND NOT attribute.attisdropped
    `);

    expect(extensions.rows).toEqual([{ extname: 'pgcrypto' }, { extname: 'vector' }]);
    expect(tables.rows.map((row) => row.table_name).sort()).toEqual(expectedTables);
    expect(embeddingType.rows).toEqual([{ data_type: 'vector(768)' }]);
  });

  test('creates all required indexes, foreign keys, and check constraints', async () => {
    const indexes = await database.db.execute<{ indexname: string; indexdef: string }>(sql`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
    `);
    const constraints = await database.db.execute<{ conname: string; contype: string }>(sql`
      SELECT conname, contype
      FROM pg_constraint
      WHERE connamespace = 'public'::regnamespace
        AND contype IN ('c', 'f')
    `);

    const indexByName = new Map(indexes.rows.map((index) => [index.indexname, index.indexdef]));
    const constraintNames = new Set(constraints.rows.map((constraint) => constraint.conname));

    expect([...indexByName.keys()]).toEqual(expect.arrayContaining(expectedIndexes));
    expect(indexByName.get('knowledge_chunks_embedding_hnsw_index')).toContain('USING hnsw');
    expect(indexByName.get('knowledge_chunks_embedding_hnsw_index')).toContain(
      'vector_cosine_ops',
    );
    expect([...constraintNames]).toEqual(
      expect.arrayContaining([...expectedForeignKeys, ...expectedChecks]),
    );
  });

  test('enforces unique keys, foreign keys, and status constraints', async () => {
    const slug = `test-course-${randomUUID()}`;
    const courseId = randomUUID();
    await database.pool.query(
      'INSERT INTO courses (id, slug, title) VALUES ($1, $2, $3)',
      [courseId, slug, 'Migration test course'],
    );

    await expect(
      database.pool.query(
        'INSERT INTO courses (id, slug, title) VALUES ($1, $2, $3)',
        [randomUUID(), slug, 'Duplicate course'],
      ),
    ).rejects.toMatchObject({ code: '23505' });

    const moduleSlug = `module-${randomUUID()}`;
    await database.pool.query(
      'INSERT INTO modules (id, course_id, slug, title, order_index) VALUES ($1, $2, $3, $4, $5)',
      [randomUUID(), courseId, moduleSlug, 'Migration test module', 1],
    );
    await expect(
      database.pool.query(
        'INSERT INTO modules (id, course_id, slug, title, order_index) VALUES ($1, $2, $3, $4, $5)',
        [randomUUID(), courseId, moduleSlug, 'Duplicate module', 2],
      ),
    ).rejects.toMatchObject({ code: '23505' });

    await expect(
      database.pool.query(
        'INSERT INTO modules (id, course_id, slug, title, order_index) VALUES ($1, $2, $3, $4, $5)',
        [randomUUID(), randomUUID(), `orphan-${randomUUID()}`, 'Orphan module', 1],
      ),
    ).rejects.toMatchObject({ code: '23503' });

    await expect(
      database.pool.query(
        'INSERT INTO submissions (id, source, external_submission_id, source_url, assignment_text, answer_text, has_attachments, revision_hash, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        [
          randomUUID(),
          'getcourse',
          `submission-${randomUUID()}`,
          'https://example.test/submission',
          'Assignment',
          'Answer',
          false,
          randomUUID(),
          'invalid',
        ],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});