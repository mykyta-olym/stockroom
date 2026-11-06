import { sql } from 'drizzle-orm';
import { parseEngineeringValue } from '@/domain/engineering';
import { buildSearchText } from '@/domain/search';
import { adminPasswordSchema } from '@/domain/validation';
import { slugify } from '../admin';
import { createAdminUser } from '../auth/sessions';
import type { Db } from '../db/client';
import {
  adminUsers,
  categories,
  manufacturers,
  priceBreaks,
  productSpecs,
  products,
  stockMovements,
} from '../db/schema';
import { buildSeedProducts, CATEGORIES, MANUFACTURERS, type SeedProduct } from './catalog-data';

const BATCH_SIZE = 200;

// A small seeded generator, so that every run produces the same stock levels and
// tests and screenshots can rely on them.
function createRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function stockFor(random: () => number): number {
  const roll = random();
  if (roll < 0.08) return 0;
  if (roll < 0.2) return 1 + Math.floor(random() * 25);
  return 100 + Math.floor(random() * 49) * 100;
}

export function priceBreaksFor(basePriceCents: number) {
  const steps: [number, number][] = [
    [1, 1],
    [10, 0.85],
    [100, 0.65],
    [1000, 0.5],
  ];
  const breaks: { minQuantity: number; unitPriceCents: number }[] = [];
  for (const [minQuantity, factor] of steps) {
    const unitPriceCents = Math.max(1, Math.round(basePriceCents * factor));
    const previous = breaks.at(-1);
    // A break that saves nothing would only be noise in the table.
    if (!previous || unitPriceCents < previous.unitPriceCents) {
      breaks.push({ minQuantity, unitPriceCents });
    }
  }
  return breaks;
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    result.push(items.slice(start, start + size));
  }
  return result;
}

export async function isSeeded(db: Db): Promise<boolean> {
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(products);
  return (row?.count ?? 0) > 0;
}

export async function resetDatabase(db: Db): Promise<void> {
  await db.execute(sql`
    truncate table
      order_events, order_items, orders, cart_items, carts, stock_movements,
      product_specs, price_breaks, products, categories, manufacturers,
      sessions, login_attempts, admin_users
    restart identity cascade
  `);
}

export async function seedCatalog(db: Db): Promise<{ products: number }> {
  const seedProducts = buildSeedProducts();
  const random = createRandom(20261104);

  await db.transaction(async (tx) => {
    const insertedManufacturers = await tx
      .insert(manufacturers)
      .values(MANUFACTURERS.map(({ slug, name }) => ({ slug, name })))
      .returning();
    const insertedCategories = await tx
      .insert(categories)
      .values(CATEGORIES.map((category, position) => ({ ...category, position })))
      .returning();

    const makerByPrefix = new Map(
      MANUFACTURERS.map((maker) => {
        const row = insertedManufacturers.find((candidate) => candidate.slug === maker.slug);
        if (!row) throw new Error(`Manufacturer ${maker.slug} was not inserted.`);
        return [maker.prefix, row];
      }),
    );
    const categoryBySlug = new Map(insertedCategories.map((row) => [row.slug, row]));

    const rows = seedProducts.map((product: SeedProduct, index) => {
      const maker = makerByPrefix.get(product.manufacturer);
      const category = categoryBySlug.get(product.category);
      if (!maker || !category) {
        throw new Error(`Seed row ${product.mpn} has an unknown maker or category.`);
      }
      const sku = `SR-${String(100001 + index)}`;
      return {
        source: product,
        values: {
          sku,
          mpn: product.mpn,
          slug: slugify(product.mpn),
          name: product.name,
          description: product.description,
          categoryId: category.id,
          manufacturerId: maker.id,
          package: product.package,
          stock: stockFor(random),
          searchText: buildSearchText({
            sku,
            mpn: product.mpn,
            name: product.name,
            description: product.description,
            package: product.package,
            manufacturer: maker.name,
            category: category.name,
            specs: product.specs.map(([name, value]) => ({ name, value })),
          }),
        },
      };
    });

    for (const batch of chunks(rows, BATCH_SIZE)) {
      const inserted = await tx
        .insert(products)
        .values(batch.map((row) => row.values))
        .returning({ id: products.id, sku: products.sku, stock: products.stock });
      const bySku = new Map(inserted.map((row) => [row.sku, row]));

      const breakRows: (typeof priceBreaks.$inferInsert)[] = [];
      const specRows: (typeof productSpecs.$inferInsert)[] = [];
      const movementRows: (typeof stockMovements.$inferInsert)[] = [];
      for (const row of batch) {
        const product = bySku.get(row.values.sku);
        if (!product) throw new Error(`Product ${row.values.sku} was not inserted.`);
        for (const entry of priceBreaksFor(row.source.basePriceCents)) {
          breakRows.push({ productId: product.id, ...entry });
        }
        row.source.specs.forEach(([name, value], position) => {
          specRows.push({
            productId: product.id,
            name,
            value,
            sortValue: parseEngineeringValue(value),
            position,
          });
        });
        if (product.stock > 0) {
          movementRows.push({
            productId: product.id,
            delta: product.stock,
            reason: 'initial',
            actor: 'seed',
          });
        }
      }
      await tx.insert(priceBreaks).values(breakRows);
      await tx.insert(productSpecs).values(specRows);
      await tx.insert(stockMovements).values(movementRows);
    }
  });

  return { products: seedProducts.length };
}

export async function seedAdmin(db: Db, email: string, password: string): Promise<boolean> {
  const [existing] = await db.select({ count: sql<number>`count(*)::int` }).from(adminUsers);
  if ((existing?.count ?? 0) > 0) return false;
  await createAdminUser(db, email, adminPasswordSchema.parse(password));
  return true;
}
