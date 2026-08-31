import { createHash } from 'node:crypto';
import type { AppConfig } from '../config.js';
import type { DatabaseClient } from '../db/client.js';
import type { EmbeddingProvider } from '../integrations/gemini/gemini-embeddings.js';
import type {
  RetrievedKnowledgeChunk,
  RetrieveKnowledgeInput,
} from './pgvector-retriever.js';

export const GRADING_QUERY_SEPARATOR = '\n\n--- STUDENT ANSWER ---\n\n';

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
  retrievedChunks: GradingContextChunk[];
};

export type GradingContextChunk = {
  chunkId: string;
  documentId: string;
  lessonId: string;
  lessonTitle: string;
  kind: 'transcript' | 'notes' | 'criteria';
  sourcePath: string | null;
  chunkIndex: number;
  content: string;
  contentHash: string;
  distance: number;
};

export type BuildGradingContextInput = {
  lessonId: string;
  assignmentText: string;
  answerText: string;
};

export type BuiltGradingContext = {
  context: GradingContext;
  contextHash: string;
};

export type KnowledgeRetriever = {
  retrieve(input: RetrieveKnowledgeInput): Promise<RetrievedKnowledgeChunk[]>;
};

type ContextBuilderConfig = Pick<AppConfig, 'embeddingDimensions' | 'maxKnowledgeContextChars'>;

type LessonRow = {
  id: string;
  title: string;
  summary: string | null;
  learning_objectives: string[];
  grading_criteria: string[];
  common_mistakes: string[];
};

type DependencyRow = {
  id: string;
  title: string;
};

export class LessonNotFoundError extends Error {
  public constructor(lessonId: string) {
    super(`Lesson not found: ${lessonId}.`);
    this.name = 'LessonNotFoundError';
  }
}

export class GradingContextBuilder {
  private readonly database: DatabaseClient;
  private readonly embeddings: EmbeddingProvider;
  private readonly retriever: KnowledgeRetriever;
  private readonly config: ContextBuilderConfig;

  public constructor(input: {
    database: DatabaseClient;
    embeddings: EmbeddingProvider;
    retriever: KnowledgeRetriever;
    config: ContextBuilderConfig;
  }) {
    this.database = input.database;
    this.embeddings = input.embeddings;
    this.retriever = input.retriever;
    this.config = input.config;
  }

  public async build(input: BuildGradingContextInput): Promise<BuiltGradingContext> {
    const lesson = await this.loadLesson(input.lessonId);
    if (lesson === undefined) throw new LessonNotFoundError(input.lessonId);

    const dependencies = await this.loadDirectDependencies(input.lessonId);
    const queryVector = await this.embeddings.embedQuery({
      text: buildGradingQuery(input),
      dimensions: this.config.embeddingDimensions,
    });
    const dependencyLessonIds = dependencies.map((dependency) => dependency.id);
    const retrievedChunks = await this.retriever.retrieve({
      queryVector,
      currentLessonId: input.lessonId,
      dependencyLessonIds,
    });
    const context: GradingContext = {
      lesson: {
        title: lesson.title,
        summary: lesson.summary,
        learningObjectives: lesson.learning_objectives,
        gradingCriteria: lesson.grading_criteria,
        commonMistakes: lesson.common_mistakes,
      },
      prerequisiteLessons: dependencies.map((dependency) => ({ title: dependency.title })),
      retrievedChunks: buildRetrievedChunks({
        chunks: retrievedChunks,
        currentLessonId: input.lessonId,
        dependencyLessonIds,
        maxCharacters: this.config.maxKnowledgeContextChars,
      }),
    };

    return { context, contextHash: hashGradingContext(context) };
  }

  private async loadLesson(lessonId: string): Promise<LessonRow | undefined> {
    const result = await this.database.pool.query<LessonRow>(
      `SELECT id, title, summary, learning_objectives, grading_criteria, common_mistakes
       FROM lessons
       WHERE id = $1::uuid`,
      [lessonId],
    );
    return result.rows[0];
  }

  private async loadDirectDependencies(lessonId: string): Promise<DependencyRow[]> {
    const result = await this.database.pool.query<DependencyRow>(
      `SELECT lessons.id, lessons.title
       FROM lesson_dependencies
       INNER JOIN lessons ON lessons.id = lesson_dependencies.depends_on_lesson_id
       WHERE lesson_dependencies.lesson_id = $1::uuid
       ORDER BY lessons.order_index ASC, lessons.id ASC`,
      [lessonId],
    );
    return result.rows;
  }
}

export function buildGradingQuery(input: Pick<BuildGradingContextInput, 'assignmentText' | 'answerText'>): string {
  return `${input.assignmentText}${GRADING_QUERY_SEPARATOR}${input.answerText}`;
}

export function hashGradingContext(context: GradingContext): string {
  return createHash('sha256').update(canonicalJson(context), 'utf8').digest('hex');
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  throw new TypeError('Grading context must contain JSON-compatible values.');
}

function buildRetrievedChunks(input: {
  chunks: RetrievedKnowledgeChunk[];
  currentLessonId: string;
  dependencyLessonIds: string[];
  maxCharacters: number;
}): GradingContextChunk[] {
  const dependencyIds = new Set(input.dependencyLessonIds);
  const scopedChunks = [
    ...input.chunks.filter((chunk) => chunk.lessonId === input.currentLessonId),
    ...input.chunks.filter(
      (chunk) => chunk.lessonId !== input.currentLessonId && dependencyIds.has(chunk.lessonId),
    ),
  ];
  const seenContentHashes = new Set<string>();
  const selected: GradingContextChunk[] = [];
  let totalCharacters = 0;

  for (const chunk of scopedChunks) {
    if (seenContentHashes.has(chunk.contentHash)) continue;
    seenContentHashes.add(chunk.contentHash);

    const previousContent = selected.at(-1)?.content;
    const content = previousContent === undefined ? chunk.content : removeBoundaryOverlap(previousContent, chunk.content);
    if (content.length === 0 || totalCharacters + content.length > input.maxCharacters) continue;

    selected.push({
      chunkId: chunk.chunkId,
      documentId: chunk.documentId,
      lessonId: chunk.lessonId,
      lessonTitle: chunk.lessonTitle,
      kind: chunk.documentKind as GradingContextChunk['kind'],
      sourcePath: chunk.sourcePath,
      chunkIndex: chunk.chunkIndex,
      content,
      contentHash: chunk.contentHash,
      distance: chunk.distance,
    });
    totalCharacters += content.length;
  }

  return selected;
}

function removeBoundaryOverlap(previous: string, next: string): string {
  const maximumLength = Math.min(previous.length, next.length);
  for (let length = maximumLength; length > 0; length -= 1) {
    if (previous.endsWith(next.slice(0, length))) return next.slice(length);
  }
  return next;
}
