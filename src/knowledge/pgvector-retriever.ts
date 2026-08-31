import type { AppConfig } from '../config.js';
import type { DatabaseClient } from '../db/client.js';

export type RetrievedKnowledgeChunk = {
  chunkId: string;
  documentId: string;
  lessonId: string;
  lessonTitle: string;
  documentKind: string;
  sourcePath: string | null;
  chunkIndex: number;
  content: string;
  contentHash: string;
  distance: number;
};

export type RetrieveKnowledgeInput = {
  queryVector: number[];
  currentLessonId: string;
  dependencyLessonIds: string[];
};

type RetrievalConfig = Pick<
  AppConfig,
  'retrievalCurrentLessonTopK' | 'retrievalDependenciesTopK'
>;

type RetrievedKnowledgeRow = {
  chunk_id: string;
  document_id: string;
  lesson_id: string;
  lesson_title: string;
  document_kind: string;
  source_path: string | null;
  chunk_index: number;
  content: string;
  content_hash: string;
  distance: number;
};

export class PgVectorKnowledgeRetriever {
  private readonly database: DatabaseClient;
  private readonly config: RetrievalConfig;

  public constructor(input: { database: DatabaseClient; config: RetrievalConfig }) {
    this.database = input.database;
    this.config = input.config;
  }

  public async retrieve(input: RetrieveKnowledgeInput): Promise<RetrievedKnowledgeChunk[]> {
    const currentLessonChunks = await this.searchCurrentLesson(input);
    const dependencyLessonChunks =
      input.dependencyLessonIds.length === 0 ? [] : await this.searchDependencies(input);
    return [...currentLessonChunks, ...dependencyLessonChunks];
  }

  private async searchCurrentLesson(input: RetrieveKnowledgeInput): Promise<RetrievedKnowledgeChunk[]> {
    const result = await this.database.pool.query<RetrievedKnowledgeRow>(
      `SELECT
         knowledge_chunks.id AS chunk_id,
         knowledge_chunks.document_id,
         knowledge_chunks.lesson_id,
         lessons.title AS lesson_title,
         knowledge_documents.kind AS document_kind,
         knowledge_documents.source_path,
         knowledge_chunks.chunk_index,
         knowledge_chunks.content,
         knowledge_chunks.content_hash,
         knowledge_chunks.embedding <=> $1::vector AS distance
       FROM knowledge_chunks
       INNER JOIN knowledge_documents ON knowledge_documents.id = knowledge_chunks.document_id
       INNER JOIN lessons ON lessons.id = knowledge_chunks.lesson_id
       WHERE knowledge_chunks.lesson_id = $2::uuid
       ORDER BY
         knowledge_chunks.embedding <=> $1::vector ASC,
         knowledge_chunks.lesson_id ASC,
         knowledge_chunks.document_id ASC,
         knowledge_chunks.chunk_index ASC,
         knowledge_chunks.id ASC
       LIMIT $3`,
      [
        toVectorLiteral(input.queryVector),
        input.currentLessonId,
        this.config.retrievalCurrentLessonTopK,
      ],
    );
    return result.rows.map(toRetrievedKnowledgeChunk);
  }

  private async searchDependencies(input: RetrieveKnowledgeInput): Promise<RetrievedKnowledgeChunk[]> {
    const result = await this.database.pool.query<RetrievedKnowledgeRow>(
      `SELECT
         knowledge_chunks.id AS chunk_id,
         knowledge_chunks.document_id,
         knowledge_chunks.lesson_id,
         lessons.title AS lesson_title,
         knowledge_documents.kind AS document_kind,
         knowledge_documents.source_path,
         knowledge_chunks.chunk_index,
         knowledge_chunks.content,
         knowledge_chunks.content_hash,
         knowledge_chunks.embedding <=> $1::vector AS distance
       FROM knowledge_chunks
       INNER JOIN knowledge_documents ON knowledge_documents.id = knowledge_chunks.document_id
       INNER JOIN lessons ON lessons.id = knowledge_chunks.lesson_id
       WHERE knowledge_chunks.lesson_id = ANY($2::uuid[])
       ORDER BY
         knowledge_chunks.embedding <=> $1::vector ASC,
         knowledge_chunks.lesson_id ASC,
         knowledge_chunks.document_id ASC,
         knowledge_chunks.chunk_index ASC,
         knowledge_chunks.id ASC
       LIMIT $3`,
      [
        toVectorLiteral(input.queryVector),
        input.dependencyLessonIds,
        this.config.retrievalDependenciesTopK,
      ],
    );
    return result.rows.map(toRetrievedKnowledgeChunk);
  }
}

function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`;
}

function toRetrievedKnowledgeChunk(row: RetrievedKnowledgeRow): RetrievedKnowledgeChunk {
  return {
    chunkId: row.chunk_id,
    documentId: row.document_id,
    lessonId: row.lesson_id,
    lessonTitle: row.lesson_title,
    documentKind: row.document_kind,
    sourcePath: row.source_path,
    chunkIndex: row.chunk_index,
    content: row.content,
    contentHash: row.content_hash,
    distance: row.distance,
  };
}