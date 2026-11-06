import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type { PriceBreak } from '@/domain/pricing';
import { addItem, createCart, loadCart } from '@/server/cart';
import { type Customer, type PlaceOrderInput } from '@/server/checkout';
import { createDb, type Db, type DbHandle } from '@/server/db/client';
import {
  categories,
  manufacturers,
  priceBreaks,
  products,
  stockMovements,
} from '@/server/db/schema';
import { resetDatabase } from '@/server/seed';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://stockroom:stockroom@127.0.0.1:5433/stockroom_test';

export function openDb(maxConnections = 20): DbHandle {
  return createDb(TEST_DATABASE_URL, maxConnections);
}

export const customer: Customer = {
  customerName: 'Test Buyer',
  email: 'buyer@example.test',
  addressLine: 'Testing Street 1',
  city: 'Testville',
  postalCode: '04001',
  country: 'SK',
};

export async function emptyDatabase(db: Db): Promise<void> {
  await resetDatabase(db);
}

export type Fixtures = {
  categoryId: string;
  manufacturerId: string;
};

export async function createFixtures(db: Db): Promise<Fixtures> {
  const [category] = await db
    .insert(categories)
    .values({ slug: 'test-parts', name: 'Test parts', description: 'Fixture category.' })
    .returning({ id: categories.id });
  const [manufacturer] = await db
    .insert(manufacturers)
    .values({ slug: 'test-maker', name: 'Test Maker' })
    .returning({ id: manufacturers.id });
  if (!category || !manufacturer) throw new Error('Fixture insert returned no row.');
  return { categoryId: category.id, manufacturerId: manufacturer.id };
}

let nextPart = 1;

export type ProductOptions = {
  stock?: number;
  breaks?: PriceBreak[];
  status?: 'active' | 'archived';
};

export async function createProduct(
  db: Db,
  fixtures: Fixtures,
  { stock = 10, breaks, status = 'active' }: ProductOptions = {},
): Promise<string> {
  const part = nextPart;
  nextPart += 1;
  const [product] = await db
    .insert(products)
    .values({
      sku: `TEST-${part}`,
      mpn: `TST-${part}`,
      slug: `tst-${part}`,
      name: `Test part ${part}`,
      description: 'A part that exists only in tests.',
      categoryId: fixtures.categoryId,
      manufacturerId: fixtures.manufacturerId,
      package: '0603',
      stock,
      status,
      searchText: `TST-${part}`,
    })
    .returning({ id: products.id });
  if (!product) throw new Error('Product insert returned no row.');

  await db.insert(priceBreaks).values(
    (breaks ?? [{ minQuantity: 1, unitPriceCents: 1000 }]).map((row) => ({
      productId: product.id,
      ...row,
    })),
  );
  if (stock > 0) {
    await db
      .insert(stockMovements)
      .values({ productId: product.id, delta: stock, reason: 'initial', actor: 'test' });
  }
  return product.id;
}

export async function createCartWith(
  db: Db,
  lines: { productId: string; quantity: number }[],
): Promise<string> {
  const { id } = await createCart(db);
  for (const line of lines) {
    await addItem(db, id, line.productId, line.quantity);
  }
  return id;
}

export async function checkoutInput(
  db: Db,
  cartId: string,
  overrides: Partial<PlaceOrderInput> = {},
): Promise<PlaceOrderInput> {
  const cart = await loadCart(db, cartId);
  return {
    cartId,
    customer,
    idempotencyKey: randomUUID(),
    expectedTotalCents: cart.totals.totalCents,
    paymentToken: 'fake_approve',
    ...overrides,
  };
}

export async function stockOf(db: Db, productId: string): Promise<number> {
  const [row] = await db
    .select({ stock: products.stock })
    .from(products)
    .where(eq(products.id, productId));
  if (!row) throw new Error(`Product ${productId} does not exist.`);
  return row.stock;
}

export async function ledgerTotal(db: Db, productId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${stockMovements.delta}), 0)::int` })
    .from(stockMovements)
    .where(eq(stockMovements.productId, productId));
  return row?.total ?? 0;
}

export async function countRows(db: Db, table: string): Promise<number> {
  const result = await db.execute<{ count: number }>(
    sql`select count(*)::int as count from ${sql.identifier(table)}`,
  );
  return result.rows[0]?.count ?? 0;
}
