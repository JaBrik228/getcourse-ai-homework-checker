import { describe, expect, test, vi } from 'vitest';
import {
  EmbeddingResponseError,
  GeminiEmbeddingProvider,
  type GeminiEmbeddingClient,
} from '../../src/integrations/gemini/gemini-embeddings.js';

const vector = (value: number, dimensions = 768): number[] => Array.from({ length: dimensions }, () => value);

describe('GeminiEmbeddingProvider', () => {
  test('embeds every document with the Embeddings 2 retrieval document prompt format', async () => {
    const embedContent = vi.fn().mockResolvedValue({
      embeddings: [{ values: vector(0.1) }, { values: vector(0.2) }],
    });
    const provider = new GeminiEmbeddingProvider({
      client: createClient(embedContent),
      model: 'gemini-embedding-2',
      maxAttempts: 3,
      sleep: async () => undefined,
    });

    await expect(provider.embedDocuments({ texts: ['first', 'second'], dimensions: 768 })).resolves.toEqual([
      vector(0.1),
      vector(0.2),
    ]);
    expect(embedContent).toHaveBeenCalledWith({
      model: 'gemini-embedding-2',
      contents: ['title: none | text: first', 'title: none | text: second'],
      config: { outputDimensionality: 768 },
    });
  });

  test('embeds one retrieval query with the Embeddings 2 search query prompt format', async () => {
    const embedContent = vi.fn().mockResolvedValue({ embeddings: [{ values: vector(0.3) }] });
    const provider = new GeminiEmbeddingProvider({
      client: createClient(embedContent),
      model: 'gemini-embedding-2',
      maxAttempts: 3,
      sleep: async () => undefined,
    });

    await expect(provider.embedQuery({ text: 'What is the task?', dimensions: 768 })).resolves.toEqual(vector(0.3));
    expect(embedContent).toHaveBeenCalledWith({
      model: 'gemini-embedding-2',
      contents: ['task: search result | query: What is the task?'],
      config: { outputDimensionality: 768 },
    });
  });

  test('retries a transient rate-limit response before returning embeddings', async () => {
    const embedContent = vi
      .fn()
      .mockRejectedValueOnce({ status: 429 })
      .mockResolvedValueOnce({ embeddings: [{ values: vector(0.1) }] });
    const sleep = vi.fn().mockResolvedValue(undefined);
    const provider = new GeminiEmbeddingProvider({
      client: createClient(embedContent),
      model: 'gemini-embedding-2',
      maxAttempts: 2,
      sleep,
    });

    await expect(provider.embedDocuments({ texts: ['retry'], dimensions: 768 })).resolves.toEqual([
      vector(0.1),
    ]);
    expect(sleep).toHaveBeenCalledWith(100);
  });

  test('rejects a response with a vector that does not have the requested dimension', async () => {
    const provider = new GeminiEmbeddingProvider({
      client: createClient(vi.fn().mockResolvedValue({ embeddings: [{ values: vector(0.1, 767) }] })),
      model: 'gemini-embedding-2',
      maxAttempts: 1,
      sleep: async () => undefined,
    });

    await expect(provider.embedDocuments({ texts: ['invalid'], dimensions: 768 })).rejects.toBeInstanceOf(
      EmbeddingResponseError,
    );
  });
});

function createClient(embedContent: unknown): GeminiEmbeddingClient {
  return {
    models: {
      embedContent: embedContent as GeminiEmbeddingClient['models']['embedContent'],
    },
  };
}
