import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export type DbHandle = {
  db: Db;
  pool: Pool;
};

export function createDb(connectionString: string, maxConnections = 10): DbHandle {
  const pool = new Pool({ connectionString, max: maxConnections });
  return { db: drizzle(pool, { schema }), pool };
}

export function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env and start PostgreSQL.');
  }
  return url;
}

// The dev server reloads modules on every edit. Keeping the handle on
// globalThis stops each reload from opening a new pool.
const holder = globalThis as typeof globalThis & { stockroomDb?: DbHandle };

export function getDb(): Db {
  holder.stockroomDb ??= createDb(requireDatabaseUrl());
  return holder.stockroomDb.db;
}
