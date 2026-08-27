import { createHash } from 'node:crypto';

export type KnowledgeChunk = {
  index: number;
  content: string;
  contentHash: string;
};

export function normalizeKnowledgeText(content: string): string {
  return content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

export function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export function chunkText(input: {
  content: string;
  targetChars: number;
  overlapChars: number;
}): KnowledgeChunk[] {
  const content = normalizeKnowledgeText(input.content);
  if (content === '') return [];
  if (!Number.isSafeInteger(input.targetChars) || input.targetChars <= 0) {
    throw new RangeError('targetChars must be a positive integer.');
  }
  if (!Number.isSafeInteger(input.overlapChars) || input.overlapChars < 0) {
    throw new RangeError('overlapChars must be a non-negative integer.');
  }
  if (input.overlapChars >= input.targetChars) {
    throw new RangeError('overlapChars must be smaller than targetChars.');
  }

  const chunks: string[] = [];
  let current = '';
  for (const paragraph of content.split(/\n{2,}/)) {
    if (paragraph.length > input.targetChars) {
      if (current !== '') {
        chunks.push(current);
        current = '';
      }
      appendLongParagraph(chunks, paragraph, input.targetChars, input.overlapChars);
      continue;
    }
    const candidate = current === '' ? paragraph : `${current}\n\n${paragraph}`;
    if (candidate.length <= input.targetChars) {
      current = candidate;
      continue;
    }
    chunks.push(current);
    const availableOverlap = Math.max(0, input.targetChars - paragraph.length - 2);
    const overlapLength = Math.min(input.overlapChars, availableOverlap);
    const overlap = overlapLength === 0 ? '' : current.slice(-overlapLength);
    current = overlap === '' ? paragraph : `${overlap}\n\n${paragraph}`;
  }
  if (current !== '') chunks.push(current);

  return chunks.map((chunk, index) => ({ index, content: chunk, contentHash: sha256(chunk) }));
}

function appendLongParagraph(
  chunks: string[],
  paragraph: string,
  targetChars: number,
  overlapChars: number,
): void {
  const step = targetChars - overlapChars;
  for (let start = 0; start < paragraph.length; start += step) {
    chunks.push(paragraph.slice(start, start + targetChars));
  }
}


