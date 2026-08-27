import { and, eq } from 'drizzle-orm';
import type { AppConfig } from '../config.js';
import type { DatabaseClient, DatabaseTransaction } from '../db/client.js';
import {
  courses,
  knowledgeChunks,
  knowledgeDocuments,
  lessonDependencies,
  lessons,
  modules,
} from '../db/schema.js';
import type { EmbeddingProvider } from '../integrations/gemini/gemini-embeddings.js';
import { chunkText, normalizeKnowledgeText, sha256 } from './chunker.js';
import {
  loadCourseFromDirectory,
  type LoadedCourse,
  type LoadedKnowledgeDocument,
  type LoadedLesson,
} from './course-loader.js';

export type ImportError = {
  sourcePath: string;
  message: string;
};

export type ImportSummary = {
  courseSlug: string;
  lessons: number;
  documentsNew: number;
  documentsChanged: number;
  documentsUnchanged: number;
  chunksEmbedded: number;
  errors: ImportError[];
};

type ImportConfig = Pick<
  AppConfig,
  'embeddingDimensions' | 'knowledgeChunkOverlapChars' | 'knowledgeChunkTargetChars'
>;

type ExistingDocument = {
  id: string;
  contentHash: string;
};

export async function importKnowledge(input: {
  rootPath: string;
  database: DatabaseClient;
  embeddings: EmbeddingProvider;
  config: ImportConfig;
}): Promise<ImportSummary> {
  const loadedCourse = await loadCourseFromDirectory(input.rootPath);
  const lessonIds = await upsertCourseStructure(input.database, loadedCourse);
  const summary: ImportSummary = {
    courseSlug: loadedCourse.course.slug,
    lessons: loadedCourse.lessons.length,
    documentsNew: 0,
    documentsChanged: 0,
    documentsUnchanged: 0,
    chunksEmbedded: 0,
    errors: [],
  };

  for (const lesson of loadedCourse.lessons) {
    const lessonId = lessonIds.get(lesson.slug);
    if (lessonId === undefined) throw new Error(`Missing persisted lesson for ${lesson.slug}.`);
    for (const document of lesson.documents) {
      const result = await importDocument({ ...input, lessonId, document });
      if (result.kind === 'unchanged') {
        summary.documentsUnchanged += 1;
      } else if (result.kind === 'new') {
        summary.documentsNew += 1;
        summary.chunksEmbedded += result.chunkCount;
      } else if (result.kind === 'changed') {
        summary.documentsChanged += 1;
        summary.chunksEmbedded += result.chunkCount;
      } else if (result.kind === 'failed') {
        summary.errors.push({ sourcePath: document.sourcePath, message: errorMessage(result.error) });
      }
    }
  }
  return summary;
}

async function importDocument(input: {
  database: DatabaseClient;
  embeddings: EmbeddingProvider;
  config: ImportConfig;
  lessonId: string;
  document: LoadedKnowledgeDocument;
}): Promise<
  | { kind: 'new' | 'changed'; chunkCount: number }
  | { kind: 'unchanged' }
  | { kind: 'failed'; error: unknown }
> {
  const content = normalizeKnowledgeText(input.document.content);
  const contentHash = sha256(content);
  const existing = await findDocument(input.database, input.lessonId, input.document);
  if (existing?.contentHash === contentHash) return { kind: 'unchanged' };

  try {
    const chunks = chunkText({
      content,
      targetChars: input.config.knowledgeChunkTargetChars,
      overlapChars: input.config.knowledgeChunkOverlapChars,
    });
    const embeddings =
      chunks.length === 0
        ? []
        : await input.embeddings.embedDocuments({
            texts: chunks.map((chunk) => chunk.content),
            dimensions: input.config.embeddingDimensions,
          });
    if (embeddings.length !== chunks.length) {
      throw new Error('Embedding provider returned a different number of vectors than chunks.');
    }
    await replaceDocumentChunks(input.database, {
      existingDocumentId: existing?.id,
      lessonId: input.lessonId,
      kind: input.document.kind,
      sourcePath: input.document.sourcePath,
      content,
      contentHash,
      chunks,
      embeddings,
    });
    return { kind: existing === undefined ? 'new' : 'changed', chunkCount: chunks.length };
  } catch (error: unknown) {
    return { kind: 'failed', error };
  }
}

async function upsertCourseStructure(
  database: DatabaseClient,
  loadedCourse: LoadedCourse,
): Promise<Map<string, string>> {
  return database.transaction(async (transaction) => {
    const now = new Date();
    const [course] = await transaction
      .insert(courses)
      .values({ slug: loadedCourse.course.slug, title: loadedCourse.course.title, updatedAt: now })
      .onConflictDoUpdate({ target: courses.slug, set: { title: loadedCourse.course.title, updatedAt: now } })
      .returning({ id: courses.id });
    if (course === undefined) throw new Error('Course upsert did not return an ID.');

    const moduleIds = await upsertModules(transaction, course.id, loadedCourse.lessons, now);
    const lessonIds = new Map<string, string>();
    for (const lesson of loadedCourse.lessons) {
      const [persistedLesson] = await transaction
        .insert(lessons)
        .values({
          courseId: course.id,
          moduleId: lesson.module === undefined ? null : moduleIds.get(lesson.module.slug) ?? null,
          slug: lesson.slug,
          title: lesson.title,
          orderIndex: lesson.order,
          getcourseLessonId: lesson.getcourse?.lessonId ?? null,
          getcourseLessonUrl: lesson.getcourse?.lessonUrl ?? null,
          summary: lesson.summary ?? null,
          learningObjectives: lesson.learningObjectives,
          gradingCriteria: lesson.gradingCriteria,
          commonMistakes: lesson.commonMistakes,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [lessons.courseId, lessons.slug],
          set: {
            moduleId: lesson.module === undefined ? null : moduleIds.get(lesson.module.slug) ?? null,
            title: lesson.title,
            orderIndex: lesson.order,
            getcourseLessonId: lesson.getcourse?.lessonId ?? null,
            getcourseLessonUrl: lesson.getcourse?.lessonUrl ?? null,
            summary: lesson.summary ?? null,
            learningObjectives: lesson.learningObjectives,
            gradingCriteria: lesson.gradingCriteria,
            commonMistakes: lesson.commonMistakes,
            updatedAt: now,
          },
        })
        .returning({ id: lessons.id });
      if (persistedLesson === undefined) throw new Error(`Lesson upsert did not return an ID: ${lesson.slug}.`);
      lessonIds.set(lesson.slug, persistedLesson.id);
    }

    for (const lesson of loadedCourse.lessons) {
      const lessonId = lessonIds.get(lesson.slug);
      if (lessonId === undefined) throw new Error(`Missing lesson ID: ${lesson.slug}.`);
      await transaction.delete(lessonDependencies).where(eq(lessonDependencies.lessonId, lessonId));
      if (lesson.dependsOn.length > 0) {
        await transaction.insert(lessonDependencies).values(
          lesson.dependsOn.map((dependencySlug) => ({
            lessonId,
            dependsOnLessonId: lessonIds.get(dependencySlug) as string,
          })),
        );
      }
    }
    return lessonIds;
  });
}

async function upsertModules(
  transaction: DatabaseTransaction,
  courseId: string,
  loadedLessons: LoadedLesson[],
  now: Date,
): Promise<Map<string, string>> {
  const moduleIds = new Map<string, string>();
  for (const module of loadedLessons.map((lesson) => lesson.module).filter((module) => module !== undefined)) {
    if (moduleIds.has(module.slug)) continue;
    const [persistedModule] = await transaction
      .insert(modules)
      .values({
        courseId,
        slug: module.slug,
        title: module.title,
        orderIndex: module.order,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [modules.courseId, modules.slug],
        set: { title: module.title, orderIndex: module.order, updatedAt: now },
      })
      .returning({ id: modules.id });
    if (persistedModule === undefined) throw new Error(`Module upsert did not return an ID: ${module.slug}.`);
    moduleIds.set(module.slug, persistedModule.id);
  }
  return moduleIds;
}

async function findDocument(
  database: DatabaseClient,
  lessonId: string,
  document: LoadedKnowledgeDocument,
): Promise<ExistingDocument | undefined> {
  const [existing] = await database.db
    .select({ id: knowledgeDocuments.id, contentHash: knowledgeDocuments.contentHash })
    .from(knowledgeDocuments)
    .where(
      and(
        eq(knowledgeDocuments.lessonId, lessonId),
        eq(knowledgeDocuments.kind, document.kind),
        eq(knowledgeDocuments.sourcePath, document.sourcePath),
      ),
    );
  return existing;
}

async function replaceDocumentChunks(
  database: DatabaseClient,
  input: {
    existingDocumentId: string | undefined;
    lessonId: string;
    kind: LoadedKnowledgeDocument['kind'];
    sourcePath: string;
    content: string;
    contentHash: string;
    chunks: ReturnType<typeof chunkText>;
    embeddings: number[][];
  },
): Promise<void> {
  await database.transaction(async (transaction) => {
    const now = new Date();
    const documentId =
      input.existingDocumentId === undefined
        ? await insertDocument(transaction, input, now)
        : await updateDocument(transaction, input.existingDocumentId, input, now);
    await transaction.delete(knowledgeChunks).where(eq(knowledgeChunks.documentId, documentId));
    if (input.chunks.length > 0) {
      await transaction.insert(knowledgeChunks).values(
        input.chunks.map((chunk, index) => ({
          documentId,
          lessonId: input.lessonId,
          chunkIndex: chunk.index,
          content: chunk.content,
          contentHash: chunk.contentHash,
          embedding: input.embeddings[index] as number[],
        })),
      );
    }
  });
}

async function insertDocument(
  transaction: DatabaseTransaction,
  input: Parameters<typeof replaceDocumentChunks>[1],
  now: Date,
): Promise<string> {
  const [document] = await transaction
    .insert(knowledgeDocuments)
    .values({
      lessonId: input.lessonId,
      kind: input.kind,
      sourcePath: input.sourcePath,
      content: input.content,
      contentHash: input.contentHash,
      updatedAt: now,
    })
    .returning({ id: knowledgeDocuments.id });
  if (document === undefined) throw new Error('Document insert did not return an ID.');
  return document.id;
}

async function updateDocument(
  transaction: DatabaseTransaction,
  documentId: string,
  input: Parameters<typeof replaceDocumentChunks>[1],
  now: Date,
): Promise<string> {
  const [document] = await transaction
    .update(knowledgeDocuments)
    .set({ content: input.content, contentHash: input.contentHash, updatedAt: now })
    .where(eq(knowledgeDocuments.id, documentId))
    .returning({ id: knowledgeDocuments.id });
  if (document === undefined) throw new Error(`Document update did not return an ID: ${documentId}.`);
  return document.id;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

