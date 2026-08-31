import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { loadConfig } from '../../src/config.js';
import { createDatabaseClient } from '../../src/db/client.js';
import { courses, knowledgeDocuments, lessons } from '../../src/db/schema.js';
import { type EmbeddingProvider } from '../../src/integrations/gemini/gemini-embeddings.js';
import { importKnowledge } from '../../src/knowledge/importer.js';

const config = loadConfig({
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/getcourse_ai',
  TEST_DATABASE_URL:
    process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/getcourse_ai_test',
});
const database = createDatabaseClient({ databaseUrl: config.testDatabaseUrl ?? config.databaseUrl });
const temporaryDirectories: string[] = [];

beforeAll(async () => {
  await migrate(database.db, { migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)) });
});

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

afterAll(async () => {
  await database.close();
});

describe('importKnowledge', () => {
  test('imports documents once and skips unchanged content on the next run', async () => {
    const course = await createCourse();
    const embeddings = new FakeEmbeddingProvider();

    await expect(
      importKnowledge({ rootPath: course.rootPath, database, embeddings, config }),
    ).resolves.toMatchObject({
      courseSlug: course.slug,
      lessons: 2,
      documentsNew: 3,
      documentsChanged: 0,
      documentsUnchanged: 0,
      chunksEmbedded: 3,
      errors: [],
    });
    await expect(
      importKnowledge({ rootPath: course.rootPath, database, embeddings, config }),
    ).resolves.toMatchObject({
      documentsNew: 0,
      documentsChanged: 0,
      documentsUnchanged: 3,
      chunksEmbedded: 0,
      errors: [],
    });
    expect(embeddings.embeddedTexts).toHaveLength(3);
  });

  test('keeps a failed changed document and imports other changed documents', async () => {
    const course = await createCourse();
    const embeddings = new FakeEmbeddingProvider();
    await importKnowledge({ rootPath: course.rootPath, database, embeddings, config });
    const notesPath = join(course.rootPath, 'lessons', '002-practice', 'notes.md');
    const transcriptPath = join(course.rootPath, 'lessons', '002-practice', 'transcript.md');
    await writeFile(notesPath, 'Broken replacement.\n');
    await writeFile(transcriptPath, 'Successful replacement.\n');
    embeddings.failForText = 'Broken replacement.\n';

    await expect(
      importKnowledge({ rootPath: course.rootPath, database, embeddings, config }),
    ).resolves.toMatchObject({
      documentsChanged: 1,
      documentsUnchanged: 1,
      chunksEmbedded: 1,
      errors: [{ sourcePath: 'lessons/002-practice/notes.md' }],
    });

    const documents = await database.db
      .select({ sourcePath: knowledgeDocuments.sourcePath, content: knowledgeDocuments.content })
      .from(knowledgeDocuments)
      .innerJoin(lessons, eq(knowledgeDocuments.lessonId, lessons.id))
      .innerJoin(courses, eq(lessons.courseId, courses.id))
      .where(
        and(
          eq(courses.slug, course.slug),
          eq(knowledgeDocuments.sourcePath, 'lessons/002-practice/notes.md'),
          eq(knowledgeDocuments.kind, 'notes'),
        ),
      );
    expect(documents).toHaveLength(1);
    expect(documents[0]?.content).toBe('Practice notes.\n');
  });
});

class FakeEmbeddingProvider implements EmbeddingProvider {
  public embeddedTexts: string[] = [];
  public failForText: string | undefined;

  public async embedDocuments(input: { texts: string[]; dimensions: 768 }): Promise<number[][]> {
    if (input.texts.includes(this.failForText ?? '')) {
      throw new Error('Embedding unavailable.');
    }
    this.embeddedTexts.push(...input.texts);
    return input.texts.map((text) => Array.from({ length: input.dimensions }, () => text.length));
  }

  public async embedQuery(input: { text: string; dimensions: 768 }): Promise<number[]> {
    return Array.from({ length: input.dimensions }, () => input.text.length);
  }
}

async function createCourse(): Promise<{ rootPath: string; slug: string }> {
  const rootPath = await mkdtemp(join(tmpdir(), 'knowledge-import-'));
  const slug = `import-course-${randomUUID()}`;
  temporaryDirectories.push(rootPath);
  await mkdir(join(rootPath, 'lessons', '001-intro'), { recursive: true });
  await mkdir(join(rootPath, 'lessons', '002-practice'), { recursive: true });
  await writeFile(join(rootPath, 'course.yaml'), `slug: ${slug}\ntitle: Import course\n`);
  await writeFile(
    join(rootPath, 'lessons', '001-intro', 'lesson.yaml'),
    'slug: intro\ntitle: Intro\norder: 1\nmodule:\n  slug: start\n  title: Start\n  order: 1\n',
  );
  await writeFile(join(rootPath, 'lessons', '001-intro', 'transcript.md'), 'Intro transcript.\n');
  await writeFile(
    join(rootPath, 'lessons', '002-practice', 'lesson.yaml'),
    'slug: practice\ntitle: Practice\norder: 2\ndepends_on:\n  - intro\n',
  );
  await writeFile(join(rootPath, 'lessons', '002-practice', 'transcript.md'), 'Practice transcript.\n');
  await writeFile(join(rootPath, 'lessons', '002-practice', 'notes.md'), 'Practice notes.\n');
  return { rootPath, slug };
}
