// Applies migrations, then seeds an empty database. Safe to run on every start.
// With --reset it wipes the store first, including orders.
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb, requireDatabaseUrl } from '@/server/db/client';
import { isSeeded, resetDatabase, seedAdmin, seedCatalog } from '@/server/seed';

const { db, pool } = createDb(requireDatabaseUrl(), 2);

try {
  await migrate(db, { migrationsFolder: 'drizzle' });
  console.log('Migrations applied.');

  if (process.argv.includes('--reset')) {
    await resetDatabase(db);
    console.log('Store data removed.');
  }

  if (await isSeeded(db)) {
    console.log('Catalog already has products. Seed skipped.');
  } else {
    const { products } = await seedCatalog(db);
    console.log(`Seeded ${products} invented products.`);
  }

  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (email && password) {
    const created = await seedAdmin(db, email, password);
    console.log(created ? `Created admin ${email}.` : 'Admin already exists.');
  } else {
    console.log('ADMIN_EMAIL or ADMIN_PASSWORD is not set. No admin created.');
  }
} finally {
  await pool.end();
}
