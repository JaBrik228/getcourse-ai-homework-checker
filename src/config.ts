import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv({ quiet: true });

const optionalString = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().trim().min(1).optional(),
);

const postgresUrl = z.string().url().refine(
  (value) => {
    try {
      const protocol = new URL(value).protocol;
      return protocol === 'postgres:' || protocol === 'postgresql:';
    } catch {
      return false;
    }
  },
  { message: 'Expected a PostgreSQL connection URL.' },
);

const optionalPostgresUrl = z.preprocess(
  (value) => (value === '' ? undefined : value),
  postgresUrl.optional(),
);

const optionalUrl = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().url().optional(),
);

const strictBoolean = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const positiveInteger = (defaultValue: number) =>
  z.coerce.number().int().positive().default(defaultValue);

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: positiveInteger(3000),
  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
    .default('info'),

  DATABASE_URL: postgresUrl,
  TEST_DATABASE_URL: optionalPostgresUrl,

  GEMINI_API_KEY: optionalString,
  GEMINI_MODEL: z.string().trim().min(1).default('gemini-3.7-flash'),
  GEMINI_THINKING_LEVEL: z
    .enum(['minimal', 'low', 'medium', 'high'])
    .default('medium'),
  GEMINI_EMBEDDING_MODEL: z
    .string()
    .trim()
    .min(1)
    .default('gemini-embedding-2'),
  EMBEDDING_DIMENSIONS: positiveInteger(768).refine((value) => value === 768, {
    message: 'EMBEDDING_DIMENSIONS must be 768 for the current database schema.',
  }),

  GETCOURSE_BASE_URL: optionalUrl,
  GETCOURSE_ANSWER_FEED_URL: optionalUrl,
  GETCOURSE_AUTH_STATE_PATH: z
    .string()
    .trim()
    .min(1)
    .default('./playwright/.auth/getcourse.json'),
  GETCOURSE_POLL_INTERVAL_MS: positiveInteger(60_000),

  AUTO_APPLY_RESULTS: strictBoolean,

  KNOWLEDGE_CHUNK_TARGET_CHARS: positiveInteger(4000),
  KNOWLEDGE_CHUNK_OVERLAP_CHARS: positiveInteger(400),
  RETRIEVAL_CURRENT_LESSON_TOP_K: positiveInteger(6),
  RETRIEVAL_DEPENDENCIES_TOP_K: positiveInteger(3),
  MAX_KNOWLEDGE_CONTEXT_CHARS: positiveInteger(30_000),

  AI_MAX_ATTEMPTS: positiveInteger(3),
  CHECK_WORKER_IDLE_MS: positiveInteger(2000),
  CHECK_RUNNING_STALE_AFTER_MS: positiveInteger(900_000),
});

export type AppConfig = {
  nodeEnv: z.infer<typeof environmentSchema>['NODE_ENV'];
  port: number;
  logLevel: z.infer<typeof environmentSchema>['LOG_LEVEL'];
  databaseUrl: string;
  testDatabaseUrl: string | undefined;
  geminiApiKey: string | undefined;
  geminiModel: string;
  geminiThinkingLevel: z.infer<typeof environmentSchema>['GEMINI_THINKING_LEVEL'];
  geminiEmbeddingModel: string;
  embeddingDimensions: 768;
  getcourseBaseUrl: string | undefined;
  getcourseAnswerFeedUrl: string | undefined;
  getcourseAuthStatePath: string;
  getcoursePollIntervalMs: number;
  autoApplyResults: boolean;
  knowledgeChunkTargetChars: number;
  knowledgeChunkOverlapChars: number;
  retrievalCurrentLessonTopK: number;
  retrievalDependenciesTopK: number;
  maxKnowledgeContextChars: number;
  aiMaxAttempts: number;
  checkWorkerIdleMs: number;
  checkRunningStaleAfterMs: number;
};

export class ConfigurationError extends Error {
  public constructor(issues: z.core.$ZodIssue[]) {
    super(`Invalid configuration: ${issues.map((issue) => issue.message).join('; ')}`);
    this.name = 'ConfigurationError';
  }
}

export function isSameDatabaseTarget(
  firstDatabaseUrl: string,
  secondDatabaseUrl: string,
): boolean {
  const toTarget = (databaseUrl: string) => {
    const url = new URL(databaseUrl);
    return {
      hostname: url.hostname.toLowerCase(),
      port: url.port === '' ? '5432' : url.port,
      database: decodeURIComponent(url.pathname).replace(/^\/+|\/+$/g, ''),
    };
  };
  const first = toTarget(firstDatabaseUrl);
  const second = toTarget(secondDatabaseUrl);

  return (
    first.hostname === second.hostname &&
    first.port === second.port &&
    first.database === second.database
  );
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = environmentSchema.safeParse(environment);

  if (!result.success) {
    throw new ConfigurationError(result.error.issues);
  }

  const env = result.data;

  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    databaseUrl: env.DATABASE_URL,
    testDatabaseUrl: env.TEST_DATABASE_URL,
    geminiApiKey: env.GEMINI_API_KEY,
    geminiModel: env.GEMINI_MODEL,
    geminiThinkingLevel: env.GEMINI_THINKING_LEVEL,
    geminiEmbeddingModel: env.GEMINI_EMBEDDING_MODEL,
    embeddingDimensions: env.EMBEDDING_DIMENSIONS,
    getcourseBaseUrl: env.GETCOURSE_BASE_URL,
    getcourseAnswerFeedUrl: env.GETCOURSE_ANSWER_FEED_URL,
    getcourseAuthStatePath: env.GETCOURSE_AUTH_STATE_PATH,
    getcoursePollIntervalMs: env.GETCOURSE_POLL_INTERVAL_MS,
    autoApplyResults: env.AUTO_APPLY_RESULTS,
    knowledgeChunkTargetChars: env.KNOWLEDGE_CHUNK_TARGET_CHARS,
    knowledgeChunkOverlapChars: env.KNOWLEDGE_CHUNK_OVERLAP_CHARS,
    retrievalCurrentLessonTopK: env.RETRIEVAL_CURRENT_LESSON_TOP_K,
    retrievalDependenciesTopK: env.RETRIEVAL_DEPENDENCIES_TOP_K,
    maxKnowledgeContextChars: env.MAX_KNOWLEDGE_CONTEXT_CHARS,
    aiMaxAttempts: env.AI_MAX_ATTEMPTS,
    checkWorkerIdleMs: env.CHECK_WORKER_IDLE_MS,
    checkRunningStaleAfterMs: env.CHECK_RUNNING_STALE_AFTER_MS,
  };
}