import { describe, expect, test } from 'vitest';
import { formatImportSummary, getImportRootPath } from '../../src/knowledge/import-cli.js';

describe('getImportRootPath', () => {
  test('requires exactly one course directory argument', () => {
    expect(() => getImportRootPath([])).toThrow('Usage: knowledge:import -- <path>');
    expect(() => getImportRootPath(['first', 'second'])).toThrow('Usage: knowledge:import -- <path>');
    expect(getImportRootPath(['./knowledge/example-course'])).toBe('./knowledge/example-course');
  });
});

test('formatImportSummary includes counters and individual errors', () => {
  expect(
    formatImportSummary({
      courseSlug: 'example-course',
      lessons: 2,
      documentsNew: 1,
      documentsChanged: 1,
      documentsUnchanged: 2,
      chunksEmbedded: 3,
      errors: [{ sourcePath: 'lessons/002/notes.md', message: 'Gemini unavailable' }],
    }),
  ).toBe(
    [
      'Course: example-course',
      'Lessons: 2',
      'Documents new: 1',
      'Documents changed: 1',
      'Documents unchanged: 2',
      'Chunks embedded: 3',
      'Errors: 1',
      'Error: lessons/002/notes.md — Gemini unavailable',
    ].join('\n'),
  );
});
