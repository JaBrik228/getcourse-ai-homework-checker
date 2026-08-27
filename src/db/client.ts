import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';

export type Database = NodePgDatabase<typeof schema>;
export type DatabaseTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export type DatabaseClient = {
  pool: Pool;
  db: Database;
  close: () => Promise<void>;
  transaction: <T>(
    callback: (transaction: DatabaseTransaction) => Promise<T>,
  ) => Promise<T>;
};

export function createDatabaseClient(input: {
  databaseUrl: string;
  maxConnections?: number;
}): DatabaseClient {
  const pool = new Pool({
    connectionString: input.databaseUrl,
    max: input.maxConnections ?? 10,
  });
  const db = drizzle({ client: pool, schema });

  return {
    pool,
    db,
    close: () => pool.end(),
    transaction: (callback) => db.transaction(callback),
  };
}