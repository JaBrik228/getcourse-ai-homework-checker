import type { ImportSummary } from './importer.js';

export function getImportRootPath(arguments_: string[]): string {
  if (arguments_.length !== 1 || arguments_[0] === undefined || arguments_[0].trim() === '') {
    throw new Error('Usage: knowledge:import -- <path>');
  }
  return arguments_[0];
}

export function formatImportSummary(summary: ImportSummary): string {
  const lines = [
    `Course: ${summary.courseSlug}`,
    `Lessons: ${summary.lessons}`,
    `Documents new: ${summary.documentsNew}`,
    `Documents changed: ${summary.documentsChanged}`,
    `Documents unchanged: ${summary.documentsUnchanged}`,
    `Chunks embedded: ${summary.chunksEmbedded}`,
    `Errors: ${summary.errors.length}`,
  ];
  for (const error of summary.errors) {
    lines.push(`Error: ${error.sourcePath} — ${error.message}`);
  }
  return lines.join('\n');
}
