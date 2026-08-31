import { describe, expect, test, vi } from 'vitest';
import type { DatabaseClient } from '../../src/db/client.js';
import { PgVectorKnowledgeRetriever } from '../../src/knowledge/pgvector-retriever.js';

describe('PgVectorKnowledgeRetriever', () => {
  test('does not execute a dependency search when no dependency lesson IDs are supplied', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          chunk_id: 'chunk-1',
          document_id: 'document-1',
          lesson_id: 'current-lesson',
          lesson_title: 'Current lesson',
          document_kind: 'criteria',
          source_path: 'lessons/current/criteria.md',
          chunk_index: 0,
          content: 'Current lesson guidance.',
          content_hash: 'content-hash',
          distance: 0.25,
        },
      ],
    });
    const retriever = new PgVectorKnowledgeRetriever({
      database: { pool: { query } } as unknown as DatabaseClient,
      config: { retrievalCurrentLessonTopK: 6, retrievalDependenciesTopK: 3 },
    });

    await expect(
      retriever.retrieve({
        queryVector: [1, 0],
        currentLessonId: 'current-lesson',
        dependencyLessonIds: [],
      }),
    ).resolves.toEqual([
      {
        chunkId: 'chunk-1',
        documentId: 'document-1',
        lessonId: 'current-lesson',
        lessonTitle: 'Current lesson',
        documentKind: 'criteria',
        sourcePath: 'lessons/current/criteria.md',
        chunkIndex: 0,
        content: 'Current lesson guidance.',
        contentHash: 'content-hash',
        distance: 0.25,
      },
    ]);
    expect(query).toHaveBeenCalledTimes(1);
  });
});