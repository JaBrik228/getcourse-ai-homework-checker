import { describe, expect, test, vi } from 'vitest';
import type { AppConfig } from '../../src/config.js';
import type { DatabaseClient } from '../../src/db/client.js';
import type { EmbeddingProvider } from '../../src/integrations/gemini/gemini-embeddings.js';
import type { RetrievedKnowledgeChunk } from '../../src/knowledge/pgvector-retriever.js';
import {
  GradingContextBuilder,
  LessonNotFoundError,
  type KnowledgeRetriever,
} from '../../src/knowledge/grading-context-builder.js';

const config: Pick<AppConfig, 'embeddingDimensions' | 'maxKnowledgeContextChars'> = {
  embeddingDimensions: 768,
  maxKnowledgeContextChars: 100,
};

describe('GradingContextBuilder', () => {
  test('builds one query context in current-lesson then direct-dependency sequence', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [lessonRow()] })
      .mockResolvedValueOnce({ rows: [dependencyRow()] });
    const embeddings = embeddingProvider();
    const retrieve = vi.fn().mockResolvedValue([
      chunk({ chunkId: 'dependency-chunk', lessonId: 'dependency-lesson', lessonTitle: 'Dependency lesson', content: 'Dependency guidance.', contentHash: 'dependency-hash' }),
      chunk({ chunkId: 'future-chunk', lessonId: 'future-lesson', lessonTitle: 'Future lesson', content: 'Never include this.', contentHash: 'future-hash' }),
      chunk({ content: 'Current guidance.', contentHash: 'current-hash' }),
    ]);
    const builder = createBuilder({ query, embeddings, retrieve });

    await expect(
      builder.build({
        lessonId: 'current-lesson',
        assignmentText: 'Explain the exercise.',
        answerText: 'My answer.',
      }),
    ).resolves.toMatchObject({
      context: {
        lesson: {
          title: 'Current lesson',
          summary: 'Lesson summary',
          learningObjectives: ['Explain the exercise'],
          gradingCriteria: ['Name the key idea'],
          commonMistakes: ['Skipping the explanation'],
        },
        prerequisiteLessons: [{ title: 'Dependency lesson' }],
        retrievedChunks: [
          {
            chunkId: 'current-chunk',
            documentId: 'current-document',
            lessonId: 'current-lesson',
            lessonTitle: 'Current lesson',
            kind: 'criteria',
            sourcePath: 'lessons/current/criteria.md',
            chunkIndex: 0,
            content: 'Current guidance.',
            contentHash: 'current-hash',
            distance: 0.1,
          },
          {
            chunkId: 'dependency-chunk',
            documentId: 'current-document',
            lessonId: 'dependency-lesson',
            lessonTitle: 'Dependency lesson',
            kind: 'criteria',
            sourcePath: 'lessons/current/criteria.md',
            chunkIndex: 0,
            content: 'Dependency guidance.',
            contentHash: 'dependency-hash',
            distance: 0.1,
          },
        ],
      },
    });
    expect(embeddings.embedQuery).toHaveBeenCalledTimes(1);
    expect(embeddings.embedQuery).toHaveBeenCalledWith({
      text: 'Explain the exercise.\n\n--- STUDENT ANSWER ---\n\nMy answer.',
      dimensions: 768,
    });
    expect(retrieve).toHaveBeenCalledTimes(1);
    expect(retrieve).toHaveBeenCalledWith({
      queryVector: vector(),
      currentLessonId: 'current-lesson',
      dependencyLessonIds: ['dependency-lesson'],
    });
  });

  test('fails with an exported error before embedding when the lesson is missing', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const embeddings = embeddingProvider();
    const retrieve = vi.fn();
    const builder = createBuilder({ query, embeddings, retrieve });

    await expect(
      builder.build({ lessonId: 'missing-lesson', assignmentText: 'Assignment', answerText: 'Answer' }),
    ).rejects.toEqual(new LessonNotFoundError('missing-lesson'));
    expect(embeddings.embedQuery).not.toHaveBeenCalled();
    expect(retrieve).not.toHaveBeenCalled();
  });

  test('deduplicates content hashes, removes boundary overlap, and skips a whole excerpt over the cap', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [lessonRow()] })
      .mockResolvedValueOnce({ rows: [dependencyRow()] });
    const builder = createBuilder({
      query,
      embeddings: embeddingProvider(),
      retrieve: vi.fn().mockResolvedValue([
        chunk({ chunkId: 'first', content: 'abcdefghij', contentHash: 'first-hash' }),
        chunk({ chunkId: 'duplicate', content: 'different content', contentHash: 'first-hash' }),
        chunk({ chunkId: 'overlap-one', content: 'ijKLMN', contentHash: 'overlap-one-hash' }),
        chunk({ chunkId: 'overlap-two', content: 'KLMNop', contentHash: 'overlap-two-hash' }),
        chunk({ chunkId: 'over-cap', content: '123456', contentHash: 'over-cap-hash' }),
      ]),
      config: { ...config, maxKnowledgeContextChars: 16 },
    });

    const result = await builder.build({
      lessonId: 'current-lesson',
      assignmentText: 'Assignment',
      answerText: 'Answer',
    });

    expect(result.context.retrievedChunks).toEqual([
      expect.objectContaining({ chunkId: 'first', content: 'abcdefghij' }),
      expect.objectContaining({ chunkId: 'overlap-one', content: 'KLMN' }),
      expect.objectContaining({ chunkId: 'overlap-two', content: 'op' }),
    ]);
    expect(result.context.retrievedChunks.reduce((total, chunk) => total + chunk.content.length, 0)).toBe(16);
  });

  test('produces the same SHA-256 hash for repeated identical contexts and changes it with the context', async () => {
    const build = () =>
      createBuilder({
        query: vi
          .fn()
          .mockResolvedValueOnce({ rows: [lessonRow()] })
          .mockResolvedValueOnce({ rows: [dependencyRow()] }),
        embeddings: embeddingProvider(),
        retrieve: vi.fn().mockResolvedValue([chunk({ content: 'Stable excerpt.', contentHash: 'stable-hash' })]),
      }).build({ lessonId: 'current-lesson', assignmentText: 'Assignment', answerText: 'Answer' });

    const [first, second] = await Promise.all([build(), build()]);
    const changed = await createBuilder({
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [lessonRow()] })
        .mockResolvedValueOnce({ rows: [dependencyRow()] }),
      embeddings: embeddingProvider(),
      retrieve: vi.fn().mockResolvedValue([
        chunk({ content: 'Changed excerpt.', contentHash: 'changed-hash' }),
      ]),
    }).build({ lessonId: 'current-lesson', assignmentText: 'Assignment', answerText: 'Answer' });

    expect(first.contextHash).toBe(second.contextHash);
    expect(first.contextHash).toMatch(/^[a-f0-9]{64}$/);
    expect(changed.contextHash).not.toBe(first.contextHash);
  });
});

function createBuilder(input: {
  query: ReturnType<typeof vi.fn>;
  embeddings: EmbeddingProvider;
  retrieve: ReturnType<typeof vi.fn>;
  config?: Pick<AppConfig, 'embeddingDimensions' | 'maxKnowledgeContextChars'>;
}): GradingContextBuilder {
  return new GradingContextBuilder({
    database: { pool: { query: input.query } } as unknown as DatabaseClient,
    embeddings: input.embeddings,
    retriever: { retrieve: input.retrieve } as unknown as KnowledgeRetriever,
    config: input.config ?? config,
  });
}

function embeddingProvider(): EmbeddingProvider {
  return {
    embedDocuments: vi.fn(),
    embedQuery: vi.fn().mockResolvedValue(vector()),
  };
}

function lessonRow() {
  return {
    id: 'current-lesson',
    title: 'Current lesson',
    summary: 'Lesson summary',
    learning_objectives: ['Explain the exercise'],
    grading_criteria: ['Name the key idea'],
    common_mistakes: ['Skipping the explanation'],
  };
}

function dependencyRow() {
  return {
    id: 'dependency-lesson',
    title: 'Dependency lesson',
  };
}

function chunk(input: Partial<RetrievedKnowledgeChunk> = {}): RetrievedKnowledgeChunk {
  return {
    chunkId: input.chunkId ?? 'current-chunk',
    documentId: input.documentId ?? 'current-document',
    lessonId: input.lessonId ?? 'current-lesson',
    lessonTitle: input.lessonTitle ?? 'Current lesson',
    documentKind: input.documentKind ?? 'criteria',
    sourcePath: input.sourcePath ?? 'lessons/current/criteria.md',
    chunkIndex: input.chunkIndex ?? 0,
    content: input.content ?? 'Current guidance.',
    contentHash: input.contentHash ?? 'current-hash',
    distance: input.distance ?? 0.1,
  };
}

function vector(): number[] {
  return Array.from({ length: 768 }, () => 0.2);
}
