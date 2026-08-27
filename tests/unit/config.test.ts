import { describe, expect, test } from 'vitest';
import {
  ConfigurationError,
  isSameDatabaseTarget,
  loadConfig,
} from '../../src/config.js';

const requiredDatabaseUrl =
  'postgresql://postgres:postgres@localhost:5432/getcourse_ai';

describe('loadConfig', () => {
  test('applies safe defaults to a minimal database configuration', () => {
    const config = loadConfig({ DATABASE_URL: requiredDatabaseUrl });

    expect(config).toMatchObject({
      nodeEnv: 'development',
      port: 3000,
      logLevel: 'info',
      databaseUrl: requiredDatabaseUrl,
      embeddingDimensions: 768,
      autoApplyResults: false,
      getcoursePollIntervalMs: 60_000,
    });
  });

  test.each([
    ['DATABASE_URL', 'not a url'],
    ['AUTO_APPLY_RESULTS', 'yes'],
    ['PORT', '0'],
    ['EMBEDDING_DIMENSIONS', '1536'],
  ])('rejects invalid %s values', (key, value) => {
    expect(() =>
      loadConfig({ DATABASE_URL: requiredDatabaseUrl, [key]: value }),
    ).toThrow(ConfigurationError);
  });
});
test.each([
  ['DATABASE_URL', 'https://example.com/database'],
  ['TEST_DATABASE_URL', 'mysql://localhost/getcourse_ai_test'],
])('rejects a non-PostgreSQL URL for %s', (key, value) => {
  expect(() =>
    loadConfig({ DATABASE_URL: requiredDatabaseUrl, [key]: value }),
  ).toThrow(ConfigurationError);
});

test('identifies PostgreSQL scheme aliases and default ports as the same database target', () => {
  expect(
    isSameDatabaseTarget(
      'postgres://postgres:postgres@localhost/getcourse_ai_test',
      'postgresql://another-user:another-password@LOCALHOST:5432/getcourse_ai_test',
    ),
  ).toBe(true);
  expect(
    isSameDatabaseTarget(
      'postgresql://postgres:postgres@localhost:5432/getcourse_ai',
      'postgresql://postgres:postgres@localhost:5432/getcourse_ai_test',
    ),
  ).toBe(false);
});