import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { adjustStock, changeOrderStatus } from '@/server/admin';
import { placeOrder, type PlaceOrderResult } from '@/server/checkout';
import type { Db } from '@/server/db/client';
import { orderItems, orders, products } from '@/server/db/schema';
import { FakePaymentAdapter } from '@/server/payments/fake';
import {
  checkoutInput,
  countRows,
  createCartWith,
  createFixtures,
  createProduct,
  customer,
  emptyDatabase,
  type Fixtures,
  ledgerTotal,
  openDb,
  stockOf,
} from './helpers';

const handle = openDb(30);
const db = handle.db;
// A delay in the charge keeps orders in flight at the same time.
const payment = new FakePaymentAdapter(5);

let fixtures: Fixtures;

beforeEach(async () => {
  await emptyDatabase(db);
  fixtures = await createFixtures(db);
});

afterAll(async () => {
  await handle.pool.end();
});

async function buyers(
  count: number,
  lines: (index: number) => { productId: string; quantity: number }[],
): Promise<PlaceOrderResult[]> {
  const inputs = [];
  for (let index = 0; index < count; index += 1) {
    const cartId = await createCartWith(db, lines(index));
    inputs.push(await checkoutInput(db, cartId));
  }
  return Promise.all(inputs.map((input) => placeOrder(db, input, payment)));
}

function countKinds(results: PlaceOrderResult[]): Record<string, number> {
  const kinds: Record<string, number> = {};
  for (const result of results) kinds[result.kind] = (kinds[result.kind] ?? 0) + 1;
  return kinds;
}

async function unitsSold(database: Db, productId: string): Promise<number> {
  const [row] = await database
    .select({ total: sql<number>`coalesce(sum(${orderItems.quantity}), 0)::int` })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(eq(orderItems.productId, productId));
  return row?.total ?? 0;
}

describe('concurrent checkout', () => {
  it('sells exactly the stock when 40 buyers race for 7 units', async () => {
    const productId = await createProduct(db, fixtures, { stock: 7 });
    // Each cart is filled before the race, while stock is still available.
    const results = await buyers(40, () => [{ productId, quantity: 1 }]);

    expect(countKinds(results)).toEqual({ paid: 7, insufficient_stock: 33 });
    expect(await stockOf(db, productId)).toBe(0);
    expect(await unitsSold(db, productId)).toBe(7);
    expect(await countRows(db, 'orders')).toBe(7);
    expect(await ledgerTotal(db, productId)).toBe(0);
  });

  it('never oversells with mixed quantities', async () => {
    const productId = await createProduct(db, fixtures, { stock: 50 });
    const quantities = [7, 3, 11, 2, 5];
    const results = await buyers(30, (index) => [
      { productId, quantity: quantities[index % quantities.length] ?? 1 },
    ]);

    const stock = await stockOf(db, productId);
    const sold = await unitsSold(db, productId);

    expect(stock).toBeGreaterThanOrEqual(0);
    expect(sold + stock).toBe(50);
    expect(sold).toBeGreaterThan(0);
    expect(await ledgerTotal(db, productId)).toBe(stock);
    expect(countKinds(results).paid).toBe(await countRows(db, 'orders'));
  });

  it('does not deadlock when carts hold the same products in opposite orders', async () => {
    const first = await createProduct(db, fixtures, { stock: 100 });
    const second = await createProduct(db, fixtures, { stock: 100 });
    const third = await createProduct(db, fixtures, { stock: 100 });
    const forward = [first, second, third];
    const backward = [third, second, first];

    const results = await buyers(40, (index) =>
      (index % 2 === 0 ? forward : backward).map((productId) => ({ productId, quantity: 1 })),
    );

    expect(countKinds(results)).toEqual({ paid: 40 });
    for (const productId of forward) {
      expect(await stockOf(db, productId)).toBe(60);
      expect(await ledgerTotal(db, productId)).toBe(60);
    }
  });

  it('fails a whole order when one of its lines runs out', async () => {
    const plenty = await createProduct(db, fixtures, { stock: 100 });
    const scarce = await createProduct(db, fixtures, { stock: 3 });

    const results = await buyers(20, () => [
      { productId: plenty, quantity: 1 },
      { productId: scarce, quantity: 1 },
    ]);

    expect(countKinds(results)).toEqual({ paid: 3, insufficient_stock: 17 });
    expect(await stockOf(db, scarce)).toBe(0);
    // The plentiful part must only lose the units of the three complete orders.
    expect(await stockOf(db, plenty)).toBe(97);
  });

  it('keeps stock and ledger equal when admin adjustments land during checkout', async () => {
    const productId = await createProduct(db, fixtures, { stock: 20 });
    const inputs = [];
    for (let index = 0; index < 15; index += 1) {
      const cartId = await createCartWith(db, [{ productId, quantity: 1 }]);
      inputs.push(await checkoutInput(db, cartId));
    }

    await Promise.all([
      ...inputs.map((input) => placeOrder(db, input, payment)),
      ...Array.from({ length: 10 }, () => adjustStock(db, productId, 1, 'Restock', 'admin:test')),
    ]);

    expect(await stockOf(db, productId)).toBe(15);
    expect(await ledgerTotal(db, productId)).toBe(15);
  });

  it('creates one order when the same form is submitted twice at once', async () => {
    const productId = await createProduct(db, fixtures, { stock: 10 });
    const cartId = await createCartWith(db, [{ productId, quantity: 2 }]);
    const input = await checkoutInput(db, cartId);

    const results = await Promise.all(
      Array.from({ length: 5 }, () => placeOrder(db, input, payment)),
    );

    expect(await countRows(db, 'orders')).toBe(1);
    expect(await stockOf(db, productId)).toBe(8);
    expect(results.filter((result) => result.kind === 'paid')).toHaveLength(1);
    expect(results.filter((result) => result.kind === 'already_placed')).toHaveLength(4);
  });

  it('returns stock once when an order is cancelled twice at the same moment', async () => {
    const productId = await createProduct(db, fixtures, { stock: 10 });
    const cartId = await createCartWith(db, [{ productId, quantity: 4 }]);
    const placed = await placeOrder(db, await checkoutInput(db, cartId), payment);
    if (placed.kind !== 'paid') throw new Error(`Expected a paid order, got ${placed.kind}.`);

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        changeOrderStatus(db, placed.orderId, 'cancelled', 'admin:test'),
      ),
    );

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(await stockOf(db, productId)).toBe(10);
    expect(await ledgerTotal(db, productId)).toBe(10);
  });
});

// A safety test only means something if the unsafe version fails under it. This
// runs the textbook mistake, read then write, under the same kind of load.
describe('control: checkout without row locks', () => {
  async function naiveCheckout(productId: string, quantity: number, gate: Promise<void>) {
    const [row] = await db
      .select({ stock: products.stock })
      .from(products)
      .where(eq(products.id, productId));
    if (!row || row.stock < quantity) return false;

    // Every buyer reads before any buyer writes, as happens under real load.
    await gate;

    await db
      .update(products)
      .set({ stock: row.stock - quantity })
      .where(eq(products.id, productId));
    await db.insert(orders).values({
      publicToken: randomUUID(),
      idempotencyKey: randomUUID(),
      ...customer,
      subtotalCents: 100,
      shippingCents: 0,
      totalCents: 100,
      paymentProvider: 'none',
    });
    return true;
  }

  it('oversells, which proves the race in the tests above is real', async () => {
    const productId = await createProduct(db, fixtures, { stock: 7 });

    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });

    const attempts = Array.from({ length: 40 }, () => naiveCheckout(productId, 1, gate));
    await new Promise((resolve) => setTimeout(resolve, 200));
    open();
    const sold = (await Promise.all(attempts)).filter(Boolean).length;

    expect(sold).toBeGreaterThan(7);
    // Stock looks healthy even though 40 orders exist for 7 units: a lost update.
    expect(await stockOf(db, productId)).toBe(6);
    expect(await countRows(db, 'orders')).toBe(sold);
  });
});
