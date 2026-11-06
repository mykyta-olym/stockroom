import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addItem,
  countCartItems,
  createCart,
  findCartId,
  loadCart,
  removeItem,
  setItemQuantity,
} from '@/server/cart';
import { products } from '@/server/db/schema';
import { createFixtures, createProduct, emptyDatabase, type Fixtures, openDb } from './helpers';

const handle = openDb(5);
const db = handle.db;

let fixtures: Fixtures;

beforeEach(async () => {
  await emptyDatabase(db);
  fixtures = await createFixtures(db);
});

afterAll(async () => {
  await handle.pool.end();
});

describe('cart', () => {
  it('is found again by the token in the cookie', async () => {
    const productId = await createProduct(db, fixtures);
    const { id, token } = await createCart(db);
    await addItem(db, id, productId, 2);

    const foundId = await findCartId(db, token);

    expect(foundId).toBe(id);
    expect(await countCartItems(db, id)).toBe(2);
  });

  it('does not find a cart with an unknown token', async () => {
    expect(await findCartId(db, 'not-a-real-token')).toBeNull();
  });

  it('adds up repeated additions of one product', async () => {
    const productId = await createProduct(db, fixtures, { stock: 50 });
    const { id } = await createCart(db);

    await addItem(db, id, productId, 2);
    const result = await addItem(db, id, productId, 3);

    expect(result).toEqual({ ok: true, quantity: 5, limited: false });
    expect((await loadCart(db, id)).lines).toHaveLength(1);
  });

  it('stops at the stock level and says so', async () => {
    const productId = await createProduct(db, fixtures, { stock: 4 });
    const { id } = await createCart(db);

    const result = await addItem(db, id, productId, 9);

    expect(result).toEqual({ ok: true, quantity: 4, limited: true });
  });

  it('refuses sold out and archived products', async () => {
    const soldOut = await createProduct(db, fixtures, { stock: 0 });
    const archived = await createProduct(db, fixtures, { status: 'archived' });
    const { id } = await createCart(db);

    expect(await addItem(db, id, soldOut, 1)).toEqual({ ok: false, reason: 'unavailable' });
    expect(await addItem(db, id, archived, 1)).toEqual({ ok: false, reason: 'unavailable' });
    expect((await loadCart(db, id)).lines).toEqual([]);
  });

  it('refuses a product that does not exist', async () => {
    const { id } = await createCart(db);
    const result = await addItem(db, id, '00000000-0000-4000-8000-000000000000', 1);
    expect(result).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('applies the price break the quantity reaches and points to the next one', async () => {
    const productId = await createProduct(db, fixtures, {
      stock: 500,
      breaks: [
        { minQuantity: 1, unitPriceCents: 100 },
        { minQuantity: 10, unitPriceCents: 80 },
        { minQuantity: 100, unitPriceCents: 50 },
      ],
    });
    const { id } = await createCart(db);
    await addItem(db, id, productId, 12);

    const cart = await loadCart(db, id);

    expect(cart.lines[0]?.unitPriceCents).toBe(80);
    expect(cart.lines[0]?.lineTotalCents).toBe(960);
    expect(cart.lines[0]?.nextBreak).toEqual(
      expect.objectContaining({ minQuantity: 100, unitPriceCents: 50 }),
    );
    expect(cart.totals).toEqual({ subtotalCents: 960, shippingCents: 490, totalCents: 1450 });
  });

  it('sets, then removes, a line', async () => {
    const productId = await createProduct(db, fixtures);
    const { id } = await createCart(db);
    await addItem(db, id, productId, 2);

    await setItemQuantity(db, id, productId, 5);
    expect((await loadCart(db, id)).itemCount).toBe(5);

    await removeItem(db, id, productId);
    expect((await loadCart(db, id)).lines).toEqual([]);
  });

  it('treats quantity 0 as removal', async () => {
    const productId = await createProduct(db, fixtures);
    const { id } = await createCart(db);
    await addItem(db, id, productId, 2);

    await setItemQuantity(db, id, productId, 0);

    expect((await loadCart(db, id)).lines).toEqual([]);
  });

  it('flags a line when stock drops below it', async () => {
    const productId = await createProduct(db, fixtures, { stock: 10 });
    const { id } = await createCart(db);
    await addItem(db, id, productId, 6);
    expect((await loadCart(db, id)).ready).toBe(true);

    await db.update(products).set({ stock: 2 }).where(eq(products.id, productId));

    const cart = await loadCart(db, id);
    expect(cart.ready).toBe(false);
    expect(cart.lines[0]?.available).toBe(false);
  });

  it('is not ready when empty', async () => {
    const { id } = await createCart(db);
    expect((await loadCart(db, id)).ready).toBe(false);
  });
});
