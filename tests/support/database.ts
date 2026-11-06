import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client, Pool } from 'pg';

function databaseName(url: URL): string {
  return url.pathname.slice(1);
}

// Tests own their database. This refuses to touch one whose name does not say it
// is a test database, so a wrong environment variable cannot wipe real data.
export async function recreateDatabase(connectionString: string): Promise<void> {
  const target = new URL(connectionString);
  const name = databaseName(target);
  if (!/^stockroom_(test|e2e)$/.test(name)) {
    throw new Error(`Refusing to recreate a database named "${name}".`);
  }

  const maintenance = new URL(connectionString);
  maintenance.pathname = '/postgres';
  const client = new Client({ connectionString: maintenance.toString() });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await client.query(`CREATE DATABASE "${name}"`);
  } finally {
    await client.end();
  }

  const pool = new Pool({ connectionString, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: 'drizzle' });
  } finally {
    await pool.end();
  }
}
