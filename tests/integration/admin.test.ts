import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { parseCatalogParams } from '@/domain/catalog-params';
import { productInputSchema, type ProductInput } from '@/domain/validation';
import {
  adjustStock,
  changeOrderStatus,
  createProduct as adminCreateProduct,
  getAdminProduct,
  getAdminSummary,
  getOrderEvents,
  listAdminOrders,
  listAdminProducts,
  updateProduct,
} from '@/server/admin';
import { searchCatalog } from '@/server/catalog';
import { placeOrder } from '@/server/checkout';
import { orders } from '@/server/db/schema';
import { FakePaymentAdapter } from '@/server/payments/fake';
import {
  checkoutInput,
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

function productInput(overrides: Partial<ProductInput> = {}): ProductInput {
  return productInputSchema.parse({
    sku: 'SR-999001',
    mpn: 'NEW-PART-1',
    name: 'New test part',
    description: 'A part added through the admin area.',
    categoryId: fixtures.categoryId,
    manufacturerId: fixtures.manufacturerId,
    package: '0805',
    status: 'active',
    priceBreaks: [
      { minQuantity: 1, unitPriceCents: 250 },
      { minQuantity: 10, unitPriceCents: 200 },
    ],
    specs: [{ name: 'Capacitance', value: '47 nF' }],
    ...overrides,
  });
}

async function paidOrder(stock = 10, quantity = 3) {
  const productId = await createProduct(db, fixtures, { stock });
  const cartId = await createCartWith(db, [{ productId, quantity }]);
  const result = await placeOrder(db, await checkoutInput(db, cartId), payment);
  if (result.kind !== 'paid') throw new Error(`Expected paid, got ${result.kind}.`);
  return { productId, orderId: result.orderId };
}

describe('products', () => {
  it('creates a product that the store can find', async () => {
    const result = await adminCreateProduct(db, productInput(), 40, 'admin:test');

    expect(result.ok).toBe(true);
    const found = await searchCatalog(db, parseCatalogParams({ q: '47nf' }));
    expect(found.items.map((item) => item.mpn)).toEqual(['NEW-PART-1']);
    expect(found.items[0]?.stock).toBe(40);
    expect(found.items[0]?.unitPriceCents).toBe(250);
  });

  it('records initial stock in the ledger', async () => {
    const result = await adminCreateProduct(db, productInput(), 40, 'admin:test');
    if (!result.ok) throw new Error('Expected a product.');
    expect(await ledgerTotal(db, result.id)).toBe(40);
  });

  it('refuses a duplicate SKU', async () => {
    await adminCreateProduct(db, productInput(), 0, 'admin:test');
    const second = await adminCreateProduct(
      db,
      productInput({ mpn: 'OTHER-PART' }),
      0,
      'admin:test',
    );
    expect(second).toEqual({ ok: false, reason: 'duplicate' });
  });

  it('updates details, prices and search text in one go', async () => {
    const created = await adminCreateProduct(db, productInput(), 5, 'admin:test');
    if (!created.ok) throw new Error('Expected a product.');

    const updated = await updateProduct(
      db,
      created.id,
      productInput({
        name: 'Renamed part',
        priceBreaks: [{ minQuantity: 1, unitPriceCents: 300 }],
        specs: [{ name: 'Capacitance', value: '68 nF' }],
      }),
    );

    expect(updated.ok).toBe(true);
    const detail = await getAdminProduct(db, created.id);
    expect(detail?.product.name).toBe('Renamed part');
    expect(detail?.breaks).toEqual([{ minQuantity: 1, unitPriceCents: 300 }]);
    expect((await searchCatalog(db, parseCatalogParams({ q: '68nf' }))).total).toBe(1);
    expect((await searchCatalog(db, parseCatalogParams({ q: '47nf' }))).total).toBe(0);
  });

  it('cannot change stock by saving the form', async () => {
    const created = await adminCreateProduct(db, productInput(), 5, 'admin:test');
    if (!created.ok) throw new Error('Expected a product.');
    await adjustStock(db, created.id, 3, 'Delivery', 'admin:test');

    await updateProduct(db, created.id, productInput({ name: 'Renamed' }));

    expect(await stockOf(db, created.id)).toBe(8);
  });

  it('reports an update of a product that does not exist', async () => {
    const result = await updateProduct(db, '00000000-0000-4000-8000-000000000000', productInput());
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it('hides archived products from the store but keeps them for admins', async () => {
    const created = await adminCreateProduct(db, productInput(), 5, 'admin:test');
    if (!created.ok) throw new Error('Expected a product.');

    await updateProduct(db, created.id, productInput({ status: 'archived' }));

    expect((await searchCatalog(db, parseCatalogParams({}))).total).toBe(0);
    const archived = await listAdminProducts(db, { q: '', view: 'archived', page: 1 });
    expect(archived.rows.map((row) => row.mpn)).toEqual(['NEW-PART-1']);
  });

  it('searches and filters the admin list', async () => {
    await createProduct(db, fixtures, { stock: 1000 });
    const low = await createProduct(db, fixtures, { stock: 3 });

    const lowStock = await listAdminProducts(db, { q: '', view: 'low', page: 1 });
    expect(lowStock.rows.map((row) => row.id)).toEqual([low]);

    const none = await listAdminProducts(db, { q: 'no-such-part', view: 'all', page: 1 });
    expect(none.total).toBe(0);

    const literal = await listAdminProducts(db, { q: '%', view: 'all', page: 1 });
    expect(literal.total).toBe(0);
  });
});

describe('stock adjustment', () => {
  it('adds and removes units and records why', async () => {
    const productId = await createProduct(db, fixtures, { stock: 10 });

    expect(await adjustStock(db, productId, 5, 'Delivery', 'admin:test')).toEqual({
      ok: true,
      stock: 15,
    });
    expect(await adjustStock(db, productId, -3, 'Damaged', 'admin:test')).toEqual({
      ok: true,
      stock: 12,
    });

    expect(await ledgerTotal(db, productId)).toBe(12);
    const detail = await getAdminProduct(db, productId);
    expect(detail?.movements.map((movement) => movement.note)).toContain('Damaged');
  });

  it('refuses to go below zero', async () => {
    const productId = await createProduct(db, fixtures, { stock: 2 });

    expect(await adjustStock(db, productId, -3, 'Count', 'admin:test')).toEqual({
      ok: false,
      reason: 'would_go_negative',
    });
    expect(await stockOf(db, productId)).toBe(2);
    expect(await ledgerTotal(db, productId)).toBe(2);
  });
});

describe('order status', () => {
  it('walks an order through shipping and delivery', async () => {
    const { orderId } = await paidOrder();

    expect((await changeOrderStatus(db, orderId, 'shipped', 'admin:test')).ok).toBe(true);
    expect((await changeOrderStatus(db, orderId, 'delivered', 'admin:test')).ok).toBe(true);

    const events = await getOrderEvents(db, orderId);
    expect(events.at(-1)).toMatchObject({
      fromStatus: 'shipped',
      toStatus: 'delivered',
      actor: 'admin:test',
    });
  });

  it('refuses a step the order cannot take', async () => {
    const { orderId } = await paidOrder();

    const result = await changeOrderStatus(db, orderId, 'delivered', 'admin:test');

    expect(result).toEqual({ ok: false, reason: 'invalid_transition', from: 'paid' });
  });

  it('does not let an admin mark an order as paid', async () => {
    const productId = await createProduct(db, fixtures);
    const cartId = await createCartWith(db, [{ productId, quantity: 1 }]);
    const result = await placeOrder(
      db,
      await checkoutInput(db, cartId, { paymentToken: 'fake_decline' }),
      payment,
    );
    if (result.kind !== 'payment_failed') throw new Error(`Got ${result.kind}.`);

    expect((await changeOrderStatus(db, result.orderId, 'paid', 'admin:test')).ok).toBe(false);
  });

  it('returns stock on cancellation', async () => {
    const { productId, orderId } = await paidOrder(10, 3);
    expect(await stockOf(db, productId)).toBe(7);

    await changeOrderStatus(db, orderId, 'cancelled', 'admin:test');

    expect(await stockOf(db, productId)).toBe(10);
    expect(await ledgerTotal(db, productId)).toBe(10);
  });

  it('cannot cancel an order that has shipped', async () => {
    const { productId, orderId } = await paidOrder(10, 3);
    await changeOrderStatus(db, orderId, 'shipped', 'admin:test');

    const result = await changeOrderStatus(db, orderId, 'cancelled', 'admin:test');

    expect(result.ok).toBe(false);
    expect(await stockOf(db, productId)).toBe(7);
  });

  it('reports an order that does not exist', async () => {
    const result = await changeOrderStatus(
      db,
      '00000000-0000-4000-8000-000000000000',
      'shipped',
      'admin:test',
    );
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });
});

describe('order lists', () => {
  it('filters by status and shows the newest first', async () => {
    const { orderId: first } = await paidOrder();
    const { orderId: second } = await paidOrder();
    await changeOrderStatus(db, first, 'shipped', 'admin:test');

    const paid = await listAdminOrders(db, 'paid', 1);
    const all = await listAdminOrders(db, null, 1);

    expect(paid.rows.map((row) => row.id)).toEqual([second]);
    expect(all.rows.map((row) => row.id)).toEqual([second, first]);
  });

  it('summarises what needs attention', async () => {
    await paidOrder(10, 9);
    await createProduct(db, fixtures, { stock: 0 });
    await db.update(orders).set({ updatedAt: new Date() }).where(eq(orders.status, 'paid'));

    const summary = await getAdminSummary(db);

    expect(summary.toShip).toBe(1);
    expect(summary.lowStock).toBe(2);
    expect(summary.outOfStock).toBe(1);
  });
});
