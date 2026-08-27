import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  chunkText,
  normalizeKnowledgeText,
  sha256,
} from '../../src/knowledge/chunker.js';
import { KnowledgeValidationError, loadCourseFromDirectory } from '../../src/knowledge/course-loader.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('chunkText', () => {
  test('preserves paragraph boundaries when paragraphs fit the target', () => {
    expect(
      chunkText({ content: 'alpha\n\nbeta\n\ngamma', targetChars: 11, overlapChars: 0 }),
    ).toEqual([
      { index: 0, content: 'alpha\n\nbeta', contentHash: sha256('alpha\n\nbeta') },
      { index: 1, content: 'gamma', contentHash: sha256('gamma') },
    ]);
  });


  test('limits overlap when keeping it would exceed the chunk target', () => {
    expect(
      chunkText({ content: 'aaaaaa\n\nbbbbbbbbbb', targetChars: 10, overlapChars: 3 }),
    ).toEqual([
      { index: 0, content: 'aaaaaa', contentHash: sha256('aaaaaa') },
      { index: 1, content: 'bbbbbbbbbb', contentHash: sha256('bbbbbbbbbb') },
    ]);
  });
  test('normalizes Windows line endings before producing a stable hash', () => {
    expect(normalizeKnowledgeText('\uFEFFalpha\r\n\r\nbeta\r')).toBe('alpha\n\nbeta\n');
    expect(sha256(normalizeKnowledgeText('alpha\r\n\r\nbeta\r'))).toBe(
      '0e937c34625ef864d694878f01fd96318893d29014a51536006dacd150d809ec',
    );
  });
});

describe('loadCourseFromDirectory', () => {
  test('loads a course with an optional notes document and resolved prerequisite', async () => {
    const rootPath = await createCourse({ includeNotes: true });

    await expect(loadCourseFromDirectory(rootPath)).resolves.toMatchObject({
      course: { slug: 'example-course', title: 'Example course' },
      lessons: [
        {
          slug: 'intro',
          documents: [
            { kind: 'transcript', sourcePath: 'lessons/001-intro/transcript.md', content: 'Intro text.\n' },
          ],
        },
        {
          slug: 'practice',
          dependsOn: ['intro'],
          documents: [
            { kind: 'transcript', sourcePath: 'lessons/002-practice/transcript.md', content: 'Practice text.\n' },
            { kind: 'notes', sourcePath: 'lessons/002-practice/notes.md', content: 'Practice notes.\n' },
          ],
        },
      ],
    });
  });

  test('rejects unknown lesson fields before import can mutate the database', async () => {
    const rootPath = await createCourse({ extraLessonField: 'unexpected: true\n' });

    await expect(loadCourseFromDirectory(rootPath)).rejects.toBeInstanceOf(KnowledgeValidationError);
  });
});

async function createCourse(input: { includeNotes?: boolean; extraLessonField?: string } = {}): Promise<string> {
  const rootPath = await mkdtemp(join(tmpdir(), 'knowledge-loader-'));
  temporaryDirectories.push(rootPath);
  await mkdir(join(rootPath, 'lessons', '001-intro'), { recursive: true });
  await mkdir(join(rootPath, 'lessons', '002-practice'), { recursive: true });

  await writeFile(join(rootPath, 'course.yaml'), 'slug: example-course\ntitle: Example course\n');
  await writeFile(
    join(rootPath, 'lessons', '001-intro', 'lesson.yaml'),
    'slug: intro\ntitle: Introduction\norder: 1\n',
  );
  await writeFile(join(rootPath, 'lessons', '001-intro', 'transcript.md'), 'Intro text.\n');
  await writeFile(
    join(rootPath, 'lessons', '002-practice', 'lesson.yaml'),
    [
      'slug: practice',
      'title: Practice',
      'order: 2',
      'depends_on:',
      '  - intro',
      input.extraLessonField?.trimEnd() ?? '',
      '',
    ].join('\n'),
  );
  await writeFile(join(rootPath, 'lessons', '002-practice', 'transcript.md'), 'Practice text.\n');
  if (input.includeNotes === true) {
    await writeFile(join(rootPath, 'lessons', '002-practice', 'notes.md'), 'Practice notes.\n');
  }

  return rootPath;
}


