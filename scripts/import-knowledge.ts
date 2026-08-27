import { loadConfig } from '../src/config.js';
import { createDatabaseClient } from '../src/db/client.js';
import { GeminiEmbeddingProvider } from '../src/integrations/gemini/gemini-embeddings.js';
import { formatImportSummary, getImportRootPath } from '../src/knowledge/import-cli.js';
import { importKnowledge } from '../src/knowledge/importer.js';

async function main(): Promise<void> {
  const rootPath = getImportRootPath(process.argv.slice(2));
  const config = loadConfig();
  const database = createDatabaseClient({ databaseUrl: config.databaseUrl });
  try {
    const embeddings = new GeminiEmbeddingProvider({
      apiKey: config.geminiApiKey,
      model: config.geminiEmbeddingModel,
      maxAttempts: config.aiMaxAttempts,
    });
    const summary = await importKnowledge({ rootPath, database, embeddings, config });
    console.log(formatImportSummary(summary));
    if (summary.errors.length > 0) process.exitCode = 1;
  } finally {
    await database.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
