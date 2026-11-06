import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getOrderEvents, getOrderLines } from '@/server/admin';
import { loadCart } from '@/server/cart';
import { placeOrder, releaseStaleOrders } from '@/server/checkout';
import { orders, priceBreaks, products } from '@/server/db/schema';
import { FakePaymentAdapter } from '@/server/payments/fake';
import {
  checkoutInput,
  countRows,
  createCartWith,
  createFixtures,
  createProduct,
  emptyDatabase,
  type Fixtures,
  ledgerTotal,
  openDb,
  stockOf,
} from './helpers';

const handle = openDb(5);
const db = handle.db;
const payment = new FakePaymentAdapter();

let fixtures: Fixtures;

beforeEach(async () => {
  await emptyDatabase(db);
  fixtures = await createFixtures(db);
});

afterAll(async () => {
  await handle.pool.end();
});

async function orderRow(orderId: string) {
  const [row] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!row) throw new Error('Order not found.');
  return row;
}

describe('placeOrder', () => {
  it('creates a paid order, takes stock, empties the cart and writes the ledger', async () => {
    const productId = await createProduct(db, fixtures, { stock: 10 });
    const cartId = await createCartWith(db, [{ productId, quantity: 3 }]);

    const result = await placeOrder(db, await checkoutInput(db, cartId), payment);

    expect(result.kind).toBe('paid');
    if (result.kind !== 'paid') return;
    const order = await orderRow(result.orderId);
    expect(order.status).toBe('paid');
    expect(order.subtotalCents).toBe(3000);
    expect(order.shippingCents).toBe(490);
    expect(order.totalCents).toBe(3490);
    expect(order.paymentProvider).toBe('fake');
    expect(order.paymentReference).toMatch(/^FAKE-[0-9A-F]{16}$/);
    expect(await stockOf(db, productId)).toBe(7);
    expect(await ledgerTotal(db, productId)).toBe(7);
    expect((await loadCart(db, cartId)).lines).toEqual([]);

    const events = await getOrderEvents(db, result.orderId);
    expect(events.map((event) => event.toStatus)).toEqual(['pending_payment', 'paid']);
  });

  it('prices each line by its quantity break and copies the price into the order', async () => {
    const productId = await createProduct(db, fixtures, {
      stock: 500,
      breaks: [
        { minQuantity: 1, unitPriceCents: 100 },
        { minQuantity: 100, unitPriceCents: 60 },
      ],
    });
    const cartId = await createCartWith(db, [{ productId, quantity: 100 }]);

    const result = await placeOrder(db, await checkoutInput(db, cartId), payment);
    if (result.kind !== 'paid') throw new Error(`Expected paid, got ${result.kind}.`);

    const [line] = await getOrderLines(db, result.orderId);
    expect(line?.unitPriceCents).toBe(60);
    expect(line?.lineTotalCents).toBe(6000);
    expect((await orderRow(result.orderId)).shippingCents).toBe(0);
  });

  it('keeps the order as it was when the catalog changes later', async () => {
    const productId = await createProduct(db, fixtures, { stock: 10 });
    const cartId = await createCartWith(db, [{ productId, quantity: 1 }]);
    const result = await placeOrder(db, await checkoutInput(db, cartId), payment);
    if (result.kind !== 'paid') throw new Error(`Expected paid, got ${result.kind}.`);

    const [before] = await getOrderLines(db, result.orderId);
    await db.update(products).set({ name: 'Renamed' }).where(eq(products.id, productId));
    await db
      .update(priceBreaks)
      .set({ unitPriceCents: 1 })
      .where(eq(priceBreaks.productId, productId));
    const [after] = await getOrderLines(db, result.orderId);

    expect(after).toEqual(before);
  });

  it('refuses an empty cart', async () => {
    const cartId = await createCartWith(db, []);
    const result = await placeOrder(db, await checkoutInput(db, cartId), payment);
    expect(result).toEqual({ kind: 'cart_empty' });
    expect(await countRows(db, 'orders')).toBe(0);
  });

  it('refuses a cart that does not exist', async () => {
    const cartId = await createCartWith(db, []);
    const input = await checkoutInput(db, cartId);
    const result = await placeOrder(
      db,
      { ...input, cartId: '00000000-0000-4000-8000-000000000000' },
      payment,
    );
    expect(result).toEqual({ kind: 'cart_empty' });
  });

  it('reports every short line and changes nothing', async () => {
    const short = await createProduct(db, fixtures, { stock: 5 });
    const fine = await createProduct(db, fixtures, { stock: 5 });
    const cartId = await createCartWith(db, [
      { productId: short, quantity: 4 },
      { productId: fine, quantity: 2 },
    ]);
    const input = await checkoutInput(db, cartId);
    await db.update(products).set({ stock: 1 }).where(eq(products.id, short));

    const result = await placeOrder(db, input, payment);

    expect(result.kind).toBe('insufficient_stock');
    if (result.kind !== 'insufficient_stock') return;
    expect(result.shortages).toHaveLength(1);
    expect(result.shortages[0]).toMatchObject({ productId: short, requested: 4, available: 1 });
    expect(await stockOf(db, fine)).toBe(5);
    expect(await countRows(db, 'orders')).toBe(0);
    expect((await loadCart(db, cartId)).lines).toHaveLength(2);
  });

  it('treats an archived product as unavailable', async () => {
    const productId = await createProduct(db, fixtures, { stock: 5 });
    const cartId = await createCartWith(db, [{ productId, quantity: 1 }]);
    const input = await checkoutInput(db, cartId);
    await db.update(products).set({ status: 'archived' }).where(eq(products.id, productId));

    const result = await placeOrder(db, input, payment);

    expect(result.kind).toBe('insufficient_stock');
    expect(await stockOf(db, productId)).toBe(5);
  });

  it('stops when the price moved after the customer saw the total', async () => {
    const productId = await createProduct(db, fixtures, { stock: 5 });
    const cartId = await createCartWith(db, [{ productId, quantity: 1 }]);
    const input = await checkoutInput(db, cartId);
    await db
      .update(priceBreaks)
      .set({ unitPriceCents: 2000 })
      .where(eq(priceBreaks.productId, productId));

    const result = await placeOrder(db, input, payment);

    expect(result).toEqual({ kind: 'price_changed', totalCents: 2490 });
    expect(await stockOf(db, productId)).toBe(5);
    expect(await countRows(db, 'orders')).toBe(0);
  });

  it('returns the existing order when a form is sent again', async () => {
    const productId = await createProduct(db, fixtures, { stock: 5 });
    const cartId = await createCartWith(db, [{ productId, quantity: 1 }]);
    const input = await checkoutInput(db, cartId);

    const first = await placeOrder(db, input, payment);
    const second = await placeOrder(db, input, payment);

    if (first.kind !== 'paid') throw new Error(`Expected paid, got ${first.kind}.`);
    expect(second).toMatchObject({
      kind: 'already_placed',
      publicToken: first.publicToken,
      status: 'paid',
    });
    expect(await stockOf(db, productId)).toBe(4);
  });

  it('does not reveal an order to a different cart that sends the same key', async () => {
    const productId = await createProduct(db, fixtures, { stock: 5 });
    const firstCart = await createCartWith(db, [{ productId, quantity: 1 }]);
    const input = await checkoutInput(db, firstCart);
    await placeOrder(db, input, payment);

    const secondCart = await createCartWith(db, [{ productId, quantity: 1 }]);
    const stolen = await checkoutInput(db, secondCart, { idempotencyKey: input.idempotencyKey });

    await expect(placeOrder(db, stolen, payment)).rejects.toThrow();
    expect(await stockOf(db, productId)).toBe(4);
  });
});

describe('payment failure', () => {
  it.each([
    ['declined', 'fake_decline'],
    ['unavailable', 'fake_error'],
  ])('gives stock back and restores the cart when the provider is %s', async (_, paymentToken) => {
    const productId = await createProduct(db, fixtures, { stock: 5 });
    const cartId = await createCartWith(db, [{ productId, quantity: 2 }]);

    const result = await placeOrder(db, await checkoutInput(db, cartId, { paymentToken }), payment);

    expect(result.kind).toBe('payment_failed');
    if (result.kind !== 'payment_failed') return;
    const order = await orderRow(result.orderId);
    expect(order.status).toBe('payment_failed');
    expect(order.paymentFailure).toBeTruthy();
    expect(await stockOf(db, productId)).toBe(5);
    expect(await ledgerTotal(db, productId)).toBe(5);

    const cart = await loadCart(db, cartId);
    expect(cart.lines.map((line) => line.quantity)).toEqual([2]);

    const retry = await placeOrder(db, await checkoutInput(db, cartId), payment);
    expect(retry.kind).toBe('paid');
    expect(await stockOf(db, productId)).toBe(3);
  });

  it('holds no database locks while the provider is working', async () => {
    const productId = await createProduct(db, fixtures, { stock: 5 });
    const cartId = await createCartWith(db, [{ productId, quantity: 1 }]);

    let stockSeenDuringCharge: number | null = null;
    const observing = {
      name: 'observing',
      charge: async () => {
        // A locked row would make this update hang until the test timed out.
        await db.update(products).set({ updatedAt: new Date() }).where(eq(products.id, productId));
        stockSeenDuringCharge = await stockOf(db, productId);
        return { status: 'approved' as const, reference: 'SEEN' };
      },
    };

    await placeOrder(db, await checkoutInput(db, cartId), observing);

    expect(stockSeenDuringCharge).toBe(4);
  });
});

describe('transaction rollback', () => {
  it('leaves no trace when a write fails halfway through the transaction', async () => {
    const productId = await createProduct(db, fixtures, { stock: 5 });
    const cartId = await createCartWith(db, [{ productId, quantity: 2 }]);
    const input = await checkoutInput(db, cartId);

    // A real database error, raised after stock and the order are already written.
    await db.execute(sql`
      create function fail_insert() returns trigger language plpgsql as
      $$ begin raise exception 'forced failure'; end $$
    `);
    await db.execute(sql`
      create trigger fail_order_events before insert on order_events
      for each row execute function fail_insert()
    `);

    try {
      await expect(placeOrder(db, input, payment)).rejects.toThrow();

      expect(await stockOf(db, productId)).toBe(5);
      expect(await countRows(db, 'orders')).toBe(0);
      expect(await countRows(db, 'order_items')).toBe(0);
      expect(await ledgerTotal(db, productId)).toBe(5);
      expect((await loadCart(db, cartId)).lines).toHaveLength(1);
    } finally {
      await db.execute(sql`drop trigger fail_order_events on order_events`);
      await db.execute(sql`drop function fail_insert`);
    }
  });
});

describe('releaseStaleOrders', () => {
  async function stuckOrder(stock: number, quantity: number) {
    const productId = await createProduct(db, fixtures, { stock });
    const cartId = await createCartWith(db, [{ productId, quantity }]);
    const crashing = {
      name: 'crashing',
      charge: () => new Promise<never>(() => undefined),
    };
    // Never resolves, like a process that died between reservation and charge.
    void placeOrder(db, await checkoutInput(db, cartId), crashing);
    await expect.poll(() => countRows(db, 'orders')).toBeGreaterThan(0);
    await expect.poll(() => stockOf(db, productId)).toBe(stock - quantity);
    return productId;
  }

  it('returns stock from orders that were never paid', async () => {
    const productId = await stuckOrder(10, 3);
    const later = new Date(Date.now() + 16 * 60_000);

    const released = await releaseStaleOrders(db, 'system', later);

    expect(released).toBe(1);
    expect(await stockOf(db, productId)).toBe(10);
    const [order] = await db.select().from(orders);
    expect(order?.status).toBe('cancelled');
  });

  it('leaves recent orders alone', async () => {
    const productId = await stuckOrder(10, 3);

    const released = await releaseStaleOrders(db, 'system');

    expect(released).toBe(0);
    expect(await stockOf(db, productId)).toBe(7);
  });
});

describe('database constraints', () => {
  it('rejects negative stock even if the application tried to write it', async () => {
    const productId = await createProduct(db, fixtures, { stock: 1 });

    await expect(
      db.update(products).set({ stock: -1 }).where(eq(products.id, productId)),
    ).rejects.toThrow();

    expect(await stockOf(db, productId)).toBe(1);
  });
});
