import { readFile, readdir } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { parseDocument } from 'yaml';
import { z } from 'zod';

export type KnowledgeDocumentKind = 'transcript' | 'notes';

export type LoadedKnowledgeDocument = {
  kind: KnowledgeDocumentKind;
  sourcePath: string;
  content: string;
};

export type LoadedLesson = {
  slug: string;
  title: string;
  order: number;
  module: { slug: string; title: string; order: number } | undefined;
  getcourse: { lessonId: string; lessonUrl: string } | undefined;
  summary: string | undefined;
  learningObjectives: string[];
  gradingCriteria: string[];
  commonMistakes: string[];
  dependsOn: string[];
  documents: LoadedKnowledgeDocument[];
};

export type LoadedCourse = {
  course: { slug: string; title: string };
  lessons: LoadedLesson[];
};

const slug = z.string().trim().min(1);
const courseSchema = z.object({ slug, title: z.string().trim().min(1) }).strict();
const lessonSchema = z
  .object({
    slug,
    title: z.string().trim().min(1),
    order: z.number().int().positive(),
    module: z
      .object({ slug, title: z.string().trim().min(1), order: z.number().int().positive() })
      .strict()
      .optional(),
    getcourse: z
      .object({ lesson_id: z.string().trim().min(1), lesson_url: z.string().url() })
      .strict()
      .optional(),
    depends_on: z.array(slug).default([]),
    summary: z.string().trim().min(1).optional(),
    learning_objectives: z.array(z.string().trim().min(1)).default([]),
    grading_criteria: z.array(z.string().trim().min(1)).default([]),
    common_mistakes: z.array(z.string().trim().min(1)).default([]),
  })
  .strict();

export class KnowledgeValidationError extends Error {
  public constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'KnowledgeValidationError';
  }
}

export async function loadCourseFromDirectory(rootPath: string): Promise<LoadedCourse> {
  const absoluteRoot = resolve(rootPath);
  const course = parseCourse(await readYaml(absoluteRoot, 'course.yaml'), resolve(absoluteRoot, 'course.yaml')); 
  const lessonsDirectory = resolve(absoluteRoot, 'lessons');
  const lessonEntries = (await readdir(lessonsDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .sort((first, second) => first.name.localeCompare(second.name));
  const lessons = await Promise.all(
    lessonEntries.map(async (entry) => loadLesson(absoluteRoot, resolve(lessonsDirectory, entry.name))),
  );
  validateLessonRelationships(lessons);
  return { course, lessons };
}

async function loadLesson(rootPath: string, lessonDirectory: string): Promise<LoadedLesson> {
  const parsed = parseLesson(await readYaml(lessonDirectory, 'lesson.yaml'), resolve(lessonDirectory, 'lesson.yaml')); 
  const transcriptPath = resolve(lessonDirectory, 'transcript.md');
  const documents: LoadedKnowledgeDocument[] = [
    {
      kind: 'transcript',
      sourcePath: toSourcePath(rootPath, transcriptPath),
      content: await readRequiredText(transcriptPath),
    },
  ];
  const notesPath = resolve(lessonDirectory, 'notes.md');
  try {
    documents.push({
      kind: 'notes',
      sourcePath: toSourcePath(rootPath, notesPath),
      content: await readFile(notesPath, 'utf8'),
    });
  } catch (error: unknown) {
    if (!isMissingFile(error)) throw error;
  }

  return {
    slug: parsed.slug,
    title: parsed.title,
    order: parsed.order,
    module: parsed.module,
    getcourse:
      parsed.getcourse === undefined
        ? undefined
        : { lessonId: parsed.getcourse.lesson_id, lessonUrl: parsed.getcourse.lesson_url },
    summary: parsed.summary,
    learningObjectives: parsed.learning_objectives,
    gradingCriteria: parsed.grading_criteria,
    commonMistakes: parsed.common_mistakes,
    dependsOn: parsed.depends_on,
    documents,
  };
}

function parseCourse(value: unknown, sourcePath: string): z.infer<typeof courseSchema> {
  const result = courseSchema.safeParse(value);
  if (!result.success) {
    throw new KnowledgeValidationError(`Invalid course YAML in ${sourcePath}: ${result.error.message}`);
  }
  return result.data;
}

function parseLesson(value: unknown, sourcePath: string): z.infer<typeof lessonSchema> {
  const result = lessonSchema.safeParse(value);
  if (!result.success) {
    throw new KnowledgeValidationError(`Invalid lesson YAML in ${sourcePath}: ${result.error.message}`);
  }
  return result.data;
}

async function readYaml(directory: string, fileName: string): Promise<unknown> {
  const sourcePath = resolve(directory, fileName);
  let source: string;
  try {
    source = await readFile(sourcePath, 'utf8');
  } catch (error: unknown) {
    throw new KnowledgeValidationError(`Unable to read ${sourcePath}.`, { cause: error });
  }
  const document = parseDocument(source, { prettyErrors: false, uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new KnowledgeValidationError(`Invalid YAML in ${sourcePath}: ${document.errors[0]?.message}`);
  }
  return document.toJS();
}

async function readRequiredText(sourcePath: string): Promise<string> {
  try {
    return await readFile(sourcePath, 'utf8');
  } catch (error: unknown) {
    throw new KnowledgeValidationError(`Required transcript is missing: ${sourcePath}.`, { cause: error });
  }
}

function validateLessonRelationships(lessons: LoadedLesson[]): void {
  const lessonSlugs = new Set<string>();
  for (const lesson of lessons) {
    if (lessonSlugs.has(lesson.slug)) {
      throw new KnowledgeValidationError(`Duplicate lesson slug: ${lesson.slug}.`);
    }
    lessonSlugs.add(lesson.slug);
  }
  for (const lesson of lessons) {
    for (const dependency of lesson.dependsOn) {
      if (dependency === lesson.slug) {
        throw new KnowledgeValidationError(`Lesson ${lesson.slug} cannot depend on itself.`);
      }
      if (!lessonSlugs.has(dependency)) {
        throw new KnowledgeValidationError(
          `Lesson ${lesson.slug} depends on unknown lesson: ${dependency}.`,
        );
      }
    }
  }
}

function toSourcePath(rootPath: string, sourcePath: string): string {
  return relative(rootPath, sourcePath).split(sep).join('/');
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

