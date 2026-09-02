import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import type { DatabaseClient } from '../../db/client.js';
import type { GradingContext } from '../../knowledge/grading-context-builder.js';

export const gradingResponseSchema = z.object({
  score: z.number().int().min(0).max(100),
  feedback: z.string().min(1),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  confidence: z.number().min(0).max(1),
}).strict();
export type GradingResponse = z.infer<typeof gradingResponseSchema>;

export type GeminiGraderClient = {
  models: { generateContent(input: {
    model: string;
    contents: string;
    config: { responseMimeType: string; responseJsonSchema: unknown; systemInstruction?: string; thinkingConfig?: { thinkingLevel: string } };
  }): Promise<{ text?: string; usageMetadata?: Record<string, unknown>; modelVersion?: string }> };
};

export type GradeInput = {
  submissionId: string;
  revisionHash?: string;
  answerText: string;
  assignmentText: string;
  context: GradingContext;
  contextHash: string;
  lessonTitle?: string;
};
type ExistingCheckRow = { id?: string; status: string; score: number; passed: boolean; feedback: string; strengths: string[] | null; weaknesses: string[] | null; confidence: number; prompt_hash: string; prompt_version: string | null; model: string; attempt_count: number; raw_output: unknown };


export type GradeResult = GradingResponse & {
  passed: boolean;
  status: 'completed' | 'failed';
  checkId?: string;
  promptHash: string;
  promptVersion: string;
  model: string;
  attemptCount: number;
  rawOutput?: unknown;
  error?: string;
};

const responseJsonSchema = {
  type: 'object', additionalProperties: false,
  required: ['score', 'feedback', 'strengths', 'weaknesses', 'confidence'],
  properties: {
    score: { type: 'integer', minimum: 0, maximum: 100 }, feedback: { type: 'string' },
    strengths: { type: 'array', items: { type: 'string' } }, weaknesses: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
} as const;

export class GeminiGrader {
  private readonly database: DatabaseClient;
  private readonly client: GeminiGraderClient;
  private readonly model: string;
  private readonly maxAttempts: number;
  private readonly passThreshold: number;
  private readonly promptPath: string;
  private readonly sleep: (ms: number) => Promise<void>;
  public constructor(input: { database: DatabaseClient; apiKey?: string; client?: GeminiGraderClient; model: string; maxAttempts: number; passThreshold: number; promptPath: string; sleep?: (ms: number) => Promise<void> }) {
    if (!Number.isInteger(input.maxAttempts) || input.maxAttempts < 1) throw new RangeError('maxAttempts must be positive.');
    if (input.client) this.client = input.client;
    else {
      if (!input.apiKey) throw new Error('GEMINI_API_KEY is required for grading.');
      this.client = new GoogleGenAI({ apiKey: input.apiKey }) as unknown as GeminiGraderClient;
    }
    this.database = input.database; this.model = input.model; this.maxAttempts = input.maxAttempts;
    this.passThreshold = input.passThreshold; this.promptPath = input.promptPath;
    this.sleep = input.sleep ?? ((ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms)));
  }

  public async grade(input: GradeInput): Promise<GradeResult> {
    const existing = await this.database.pool.query<ExistingCheckRow>('SELECT id, status, score, passed, feedback, strengths, weaknesses, confidence, prompt_hash, prompt_version, model, attempt_count, raw_output, last_error FROM checks WHERE submission_id = $1 ORDER BY created_at DESC LIMIT 1', [input.submissionId]);
    const row = existing.rows[0];
    if (row?.status === 'completed') {
      const result: GradeResult = { status: 'completed', score: row.score, passed: row.passed, feedback: row.feedback, strengths: row.strengths ?? [], weaknesses: row.weaknesses ?? [], confidence: row.confidence, promptHash: row.prompt_hash, promptVersion: row.prompt_version ?? '', model: row.model, attemptCount: row.attempt_count, rawOutput: row.raw_output };
      if (typeof row.id === 'string') result.checkId = row.id;
      return result;
    }

    const prompt = await readFile(resolve(this.promptPath), 'utf8');
    const promptHash = createHash('sha256').update(prompt).digest('hex');
    const started = Date.now(); let attemptCount = 0; let rawOutput: unknown;
    try {
      let response: { text?: string; usageMetadata?: Record<string, unknown>; modelVersion?: string } | undefined;
      for (attemptCount = 1; attemptCount <= this.maxAttempts; attemptCount += 1) {
        try { response = await this.client.models.generateContent({ model: this.model, contents: `${prompt}\n\nASSIGNMENT:\n${input.assignmentText}\n\nSTUDENT ANSWER:\n${input.answerText}\n\nCONTEXT:\n${JSON.stringify(input.context)}`, config: { responseMimeType: 'application/json', responseJsonSchema, thinkingConfig: { thinkingLevel: 'medium' } } }); break; }
        catch (error) { if (attemptCount >= this.maxAttempts || !isTransientError(error)) throw error; await this.sleep(100 * 2 ** (attemptCount - 1)); }
      }
      const text = response?.text; if (!text) throw new Error('Gemini returned an empty response.');
      rawOutput = JSON.parse(text);
      const parsed = gradingResponseSchema.parse(rawOutput);
      const passed = parsed.score >= this.passThreshold;
      const latencyMs = Date.now() - started;
      const saved = await this.database.pool.query<{ id: string }>(`INSERT INTO checks (submission_id,status,model,prompt_hash,prompt_version,context_hash,decision,confidence,feedback,score,passed,strengths,weaknesses,raw_output,attempt_count,latency_ms,usage_metadata,completed_at,updated_at) VALUES ($1,'completed',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,now(),now()) ON CONFLICT (submission_id) DO UPDATE SET status='completed',model=EXCLUDED.model,prompt_hash=EXCLUDED.prompt_hash,prompt_version=EXCLUDED.prompt_version,context_hash=EXCLUDED.context_hash,decision=EXCLUDED.decision,confidence=EXCLUDED.confidence,feedback=EXCLUDED.feedback,score=EXCLUDED.score,passed=EXCLUDED.passed,strengths=EXCLUDED.strengths,weaknesses=EXCLUDED.weaknesses,raw_output=EXCLUDED.raw_output,attempt_count=EXCLUDED.attempt_count,latency_ms=EXCLUDED.latency_ms,usage_metadata=EXCLUDED.usage_metadata,completed_at=now(),updated_at=now() RETURNING id`, [input.submissionId,this.model,promptHash,'v1',input.contextHash,passed?'accept':'reject',parsed.confidence,parsed.feedback,parsed.score,passed,JSON.stringify(parsed.strengths),JSON.stringify(parsed.weaknesses),JSON.stringify(rawOutput),attemptCount,latencyMs,JSON.stringify(response?.usageMetadata ?? null)]);
      const result: GradeResult = { ...parsed, passed, status: 'completed', promptHash, promptVersion: 'v1', model: this.model, attemptCount, rawOutput };
      const checkId = saved.rows[0]?.id;
      if (checkId !== undefined) result.checkId = checkId;
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.database.pool.query(`INSERT INTO checks (submission_id,status,model,prompt_hash,prompt_version,context_hash,attempt_count,last_error,raw_output,updated_at) VALUES ($1,'failed',$2,$3,$4,$5,$6,$7,$8,now()) ON CONFLICT (submission_id) DO UPDATE SET status='failed',attempt_count=EXCLUDED.attempt_count,last_error=EXCLUDED.last_error,raw_output=EXCLUDED.raw_output,updated_at=now()`, [input.submissionId,this.model,promptHash,'v1',input.contextHash,attemptCount,message,rawOutput == null ? null : JSON.stringify(rawOutput)]);
      return { status: 'failed', score: 0, passed: false, feedback: '', strengths: [], weaknesses: [], confidence: 0, promptHash, promptVersion: 'v1', model: this.model, attemptCount, rawOutput, error: message };
    }
  }
}

function isTransientError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { status?: unknown; code?: unknown };
  const status = typeof candidate.status === 'number' ? candidate.status : undefined;
  return status === 408 || status === 429 || (status !== undefined && status >= 500) || ['ECONNRESET','ENOTFOUND','ETIMEDOUT'].includes(String(candidate.code));
}

export { GeminiGrader as GraderService };
