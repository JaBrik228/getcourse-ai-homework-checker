import { GoogleGenAI } from '@google/genai';

export type EmbeddingProvider = {
  embedDocuments(input: { texts: string[]; dimensions: 768 }): Promise<number[][]>;
};

export type GeminiEmbeddingClient = {
  models: {
    embedContent(input: {
      model: string;
      contents: string[];
      config: { taskType: 'RETRIEVAL_DOCUMENT'; outputDimensionality: number };
    }): Promise<{ embeddings?: Array<{ values?: number[] }> }>;
  };
};

export class EmbeddingResponseError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'EmbeddingResponseError';
  }
}

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  private readonly client: GeminiEmbeddingClient;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  public constructor(input: {
    apiKey?: string;
    client?: GeminiEmbeddingClient;
    model: string;
    maxAttempts: number;
    sleep?: (milliseconds: number) => Promise<void>;
  }) {
    if (!Number.isSafeInteger(input.maxAttempts) || input.maxAttempts <= 0) {
      throw new RangeError('maxAttempts must be a positive integer.');
    }
    if (input.client === undefined) {
      if (input.apiKey === undefined || input.apiKey === '') {
        throw new Error('GEMINI_API_KEY is required for Gemini embeddings.');
      }
      this.client = new GoogleGenAI({ apiKey: input.apiKey }) as unknown as GeminiEmbeddingClient;
    } else {
      this.client = input.client;
    }
    this.model = input.model;
    this.maxAttempts = input.maxAttempts;
    this.sleep = input.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  private readonly model: string;
  private readonly maxAttempts: number;

  public async embedDocuments(input: { texts: string[]; dimensions: 768 }): Promise<number[][]> {
    if (input.texts.length === 0) return [];
    const response = await this.embedWithRetry(input);
    const embeddings = response.embeddings;
    if (embeddings === undefined || embeddings.length !== input.texts.length) {
      throw new EmbeddingResponseError('Gemini returned a different number of embeddings than requested.');
    }
    return embeddings.map((embedding, index) => {
      const values = embedding.values;
      if (
        values === undefined ||
        values.length !== input.dimensions ||
        values.some((value) => !Number.isFinite(value))
      ) {
        throw new EmbeddingResponseError(`Gemini returned an invalid embedding at index ${index}.`);
      }
      return values;
    });
  }

  private async embedWithRetry(input: { texts: string[]; dimensions: 768 }): Promise<{ embeddings?: Array<{ values?: number[] }> }> {
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        return await this.client.models.embedContent({
          model: this.model,
          contents: input.texts,
          config: { taskType: 'RETRIEVAL_DOCUMENT', outputDimensionality: input.dimensions },
        });
      } catch (error: unknown) {
        if (attempt === this.maxAttempts || !isTransientError(error)) throw error;
        await this.sleep(100 * 2 ** (attempt - 1));
      }
    }
    throw new Error('Unreachable retry state.');
  }
}

function isTransientError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { status?: unknown; code?: unknown };
  const status = typeof candidate.status === 'number' ? candidate.status : undefined;
  if (status === 408 || status === 429 || (status !== undefined && status >= 500)) return true;
  return candidate.code === 'ECONNRESET' || candidate.code === 'ENOTFOUND' || candidate.code === 'ETIMEDOUT';
}

