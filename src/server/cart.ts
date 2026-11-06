import { randomBytes } from 'node:crypto';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { MAX_LINE_QUANTITY } from '@/domain/validation';
import { findPriceBreak, type PriceBreak, type Totals, totalsFor } from '@/domain/pricing';
import type { Db } from './db/client';
import { cartItems, carts, manufacturers, priceBreaks, products } from './db/schema';

export type CartLine = {
  productId: string;
  sku: string;
  mpn: string;
  slug: string;
  name: string;
  package: string;
  manufacturer: string;
  quantity: number;
  stock: number;
  available: boolean;
  unitPriceCents: number;
  lineTotalCents: number;
  // Set when more units would reach the next price break.
  nextBreak: PriceBreak | null;
};

export type Cart = {
  id: string;
  lines: CartLine[];
  totals: Totals;
  itemCount: number;
  // True when every line can be bought in the quantity asked for.
  ready: boolean;
};

export async function createCart(db: Db): Promise<{ id: string; token: string }> {
  const token = randomBytes(24).toString('base64url');
  const [cart] = await db.insert(carts).values({ token }).returning({ id: carts.id });
  if (!cart) throw new Error('Inserting the cart returned no row.');
  return { id: cart.id, token };
}

export async function findCartId(db: Db, token: string): Promise<string | null> {
  const [cart] = await db.select({ id: carts.id }).from(carts).where(eq(carts.token, token));
  return cart?.id ?? null;
}

export async function loadCart(db: Db, cartId: string): Promise<Cart> {
  const rows = await db
    .select({
      productId: products.id,
      sku: products.sku,
      mpn: products.mpn,
      slug: products.slug,
      name: products.name,
      package: products.package,
      manufacturer: manufacturers.name,
      quantity: cartItems.quantity,
      stock: products.stock,
      status: products.status,
    })
    .from(cartItems)
    .innerJoin(products, eq(products.id, cartItems.productId))
    .innerJoin(manufacturers, eq(manufacturers.id, products.manufacturerId))
    .where(eq(cartItems.cartId, cartId))
    .orderBy(asc(cartItems.addedAt), asc(products.sku));

  const breakRows =
    rows.length === 0
      ? []
      : await db
          .select()
          .from(priceBreaks)
          .where(
            inArray(
              priceBreaks.productId,
              rows.map((row) => row.productId),
            ),
          );

  const lines = rows.map((row): CartLine => {
    const breaks = breakRows
      .filter((candidate) => candidate.productId === row.productId)
      .sort((a, b) => a.minQuantity - b.minQuantity);
    const current = findPriceBreak(breaks, row.quantity);
    return {
      productId: row.productId,
      sku: row.sku,
      mpn: row.mpn,
      slug: row.slug,
      name: row.name,
      package: row.package,
      manufacturer: row.manufacturer,
      quantity: row.quantity,
      stock: row.stock,
      available: row.status === 'active' && row.quantity <= row.stock,
      unitPriceCents: current.unitPriceCents,
      lineTotalCents: current.unitPriceCents * row.quantity,
      nextBreak: breaks.find((candidate) => candidate.minQuantity > row.quantity) ?? null,
    };
  });

  return {
    id: cartId,
    lines,
    totals: totalsFor(lines.map((line) => line.lineTotalCents)),
    itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
    ready: lines.length > 0 && lines.every((line) => line.available),
  };
}

export async function countCartItems(db: Db, cartId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`coalesce(sum(${cartItems.quantity}), 0)::int` })
    .from(cartItems)
    .where(eq(cartItems.cartId, cartId));
  return row?.count ?? 0;
}

export type AddResult =
  { ok: true; quantity: number; limited: boolean } | { ok: false; reason: 'unavailable' };

// Keeps the cart honest for the customer. It is not the safety check: stock can
// still run out before checkout, and only the checkout transaction decides.
export async function addItem(
  db: Db,
  cartId: string,
  productId: string,
  quantity: number,
): Promise<AddResult> {
  return db.transaction(async (tx) => {
    const [product] = await tx
      .select({ stock: products.stock, status: products.status })
      .from(products)
      .where(eq(products.id, productId));
    if (!product || product.status !== 'active' || product.stock < 1) {
      return { ok: false, reason: 'unavailable' };
    }

    const [existing] = await tx
      .select({ quantity: cartItems.quantity })
      .from(cartItems)
      .where(and(eq(cartItems.cartId, cartId), eq(cartItems.productId, productId)));

    const wanted = (existing?.quantity ?? 0) + quantity;
    const allowed = Math.min(wanted, product.stock, MAX_LINE_QUANTITY);

    await tx
      .insert(cartItems)
      .values({ cartId, productId, quantity: allowed })
      .onConflictDoUpdate({
        target: [cartItems.cartId, cartItems.productId],
        set: { quantity: allowed },
      });
    await tx.update(carts).set({ updatedAt: new Date() }).where(eq(carts.id, cartId));

    return { ok: true, quantity: allowed, limited: allowed < wanted };
  });
}

export async function setItemQuantity(
  db: Db,
  cartId: string,
  productId: string,
  quantity: number,
): Promise<void> {
  const line = and(eq(cartItems.cartId, cartId), eq(cartItems.productId, productId));
  if (quantity <= 0) {
    await db.delete(cartItems).where(line);
    return;
  }
  await db.update(cartItems).set({ quantity }).where(line);
}

export async function removeItem(db: Db, cartId: string, productId: string): Promise<void> {
  await setItemQuantity(db, cartId, productId, 0);
}
