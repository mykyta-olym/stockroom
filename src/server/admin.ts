import { and, asc, desc, eq, gte, ilike, lte, ne, or, type SQL, sql } from 'drizzle-orm';
import { parseEngineeringValue } from '@/domain/engineering';
import type { OrderStatus } from '@/domain/order-status';
import { buildSearchText } from '@/domain/search';
import type { ProductInput } from '@/domain/validation';
import { transitionOrder, type TransitionResult } from './checkout';
import type { Db, Tx } from './db/client';
import {
  categories,
  manufacturers,
  orderEvents,
  orderItems,
  orders,
  priceBreaks,
  productSpecs,
  products,
  stockMovements,
} from './db/schema';

export const ADMIN_PAGE_SIZE = 50;
export const LOW_STOCK_LEVEL = 25;

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  while (current instanceof Error) {
    if ((current as { code?: string }).code === '23505') return true;
    current = current.cause;
  }
  return false;
}

async function writeProductDetails(tx: Tx, productId: string, input: ProductInput): Promise<void> {
  await tx.delete(priceBreaks).where(eq(priceBreaks.productId, productId));
  await tx.insert(priceBreaks).values(input.priceBreaks.map((row) => ({ productId, ...row })));

  await tx.delete(productSpecs).where(eq(productSpecs.productId, productId));
  if (input.specs.length > 0) {
    await tx.insert(productSpecs).values(
      input.specs.map((spec, position) => ({
        productId,
        name: spec.name,
        value: spec.value,
        sortValue: parseEngineeringValue(spec.value),
        position,
      })),
    );
  }
}

async function searchTextFor(tx: Tx, input: ProductInput): Promise<string> {
  const [category] = await tx
    .select({ name: categories.name })
    .from(categories)
    .where(eq(categories.id, input.categoryId));
  const [manufacturer] = await tx
    .select({ name: manufacturers.name })
    .from(manufacturers)
    .where(eq(manufacturers.id, input.manufacturerId));
  if (!category || !manufacturer) {
    throw new Error('Category or manufacturer does not exist.');
  }
  return buildSearchText({
    ...input,
    category: category.name,
    manufacturer: manufacturer.name,
  });
}

export type SaveProductResult =
  { ok: true; id: string } | { ok: false; reason: 'duplicate' | 'not_found' };

export async function createProduct(
  db: Db,
  input: ProductInput,
  initialStock: number,
  actor: string,
): Promise<SaveProductResult> {
  try {
    return await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(products)
        .values({
          sku: input.sku,
          mpn: input.mpn,
          slug: slugify(input.mpn),
          name: input.name,
          description: input.description,
          categoryId: input.categoryId,
          manufacturerId: input.manufacturerId,
          package: input.package,
          status: input.status,
          stock: initialStock,
          searchText: await searchTextFor(tx, input),
        })
        .returning({ id: products.id });
      if (!created) throw new Error('Inserting the product returned no row.');

      await writeProductDetails(tx, created.id, input);
      if (initialStock > 0) {
        await tx.insert(stockMovements).values({
          productId: created.id,
          delta: initialStock,
          reason: 'initial',
          actor,
        });
      }
      return { ok: true, id: created.id };
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, reason: 'duplicate' };
    throw error;
  }
}

// Stock is deliberately absent. It only changes through adjustStock and checkout,
// so saving a form that was opened ten minutes ago cannot undo a sale.
export async function updateProduct(
  db: Db,
  productId: string,
  input: ProductInput,
): Promise<SaveProductResult> {
  try {
    return await db.transaction(async (tx) => {
      const updated = await tx
        .update(products)
        .set({
          sku: input.sku,
          mpn: input.mpn,
          name: input.name,
          description: input.description,
          categoryId: input.categoryId,
          manufacturerId: input.manufacturerId,
          package: input.package,
          status: input.status,
          searchText: await searchTextFor(tx, input),
          updatedAt: new Date(),
        })
        .where(eq(products.id, productId))
        .returning({ id: products.id });
      if (updated.length === 0) return { ok: false, reason: 'not_found' };

      await writeProductDetails(tx, productId, input);
      return { ok: true, id: productId };
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, reason: 'duplicate' };
    throw error;
  }
}

export async function setProductStatus(
  db: Db,
  productId: string,
  status: 'active' | 'archived',
): Promise<void> {
  await db
    .update(products)
    .set({ status, updatedAt: new Date() })
    .where(eq(products.id, productId));
}

export type AdjustStockResult =
  { ok: true; stock: number } | { ok: false; reason: 'would_go_negative' };

// Applied as a change rather than a new total, so that it composes with orders
// arriving at the same moment.
export async function adjustStock(
  db: Db,
  productId: string,
  delta: number,
  note: string,
  actor: string,
): Promise<AdjustStockResult> {
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(products)
      .set({ stock: sql`${products.stock} + ${delta}`, updatedAt: new Date() })
      .where(and(eq(products.id, productId), gte(products.stock, -delta)))
      .returning({ stock: products.stock });
    const row = updated[0];
    if (!row) return { ok: false, reason: 'would_go_negative' };

    await tx.insert(stockMovements).values({
      productId,
      delta,
      reason: 'adjustment',
      actor,
      note,
    });
    return { ok: true, stock: row.stock };
  });
}

export type AdminProductFilter = {
  q: string;
  view: 'all' | 'low' | 'archived';
  page: number;
};

export async function listAdminProducts(db: Db, filter: AdminProductFilter) {
  const conditions: (SQL | undefined)[] = [];
  const q = filter.q.trim();
  if (q) {
    const pattern = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    conditions.push(
      or(ilike(products.mpn, pattern), ilike(products.sku, pattern), ilike(products.name, pattern)),
    );
  }
  if (filter.view === 'low') {
    conditions.push(eq(products.status, 'active'), lte(products.stock, LOW_STOCK_LEVEL));
  } else if (filter.view === 'archived') {
    conditions.push(eq(products.status, 'archived'));
  } else {
    conditions.push(ne(products.status, 'archived'));
  }

  const where = and(...conditions);
  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(products)
    .where(where);
  const total = countRow?.count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));
  const page = Math.min(Math.max(1, filter.page), pageCount);

  const rows = await db
    .select({
      id: products.id,
      sku: products.sku,
      mpn: products.mpn,
      name: products.name,
      stock: products.stock,
      status: products.status,
      category: categories.name,
      unitPriceCents: sql<number>`(
        select ${priceBreaks.unitPriceCents} from ${priceBreaks}
        where ${priceBreaks.productId} = ${products.id} and ${priceBreaks.minQuantity} = 1
      )`.mapWith(Number),
    })
    .from(products)
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .where(where)
    .orderBy(asc(products.mpn))
    .limit(ADMIN_PAGE_SIZE)
    .offset((page - 1) * ADMIN_PAGE_SIZE);

  return { rows, total, page, pageCount };
}

export async function getAdminProduct(db: Db, id: string) {
  const [product] = await db.select().from(products).where(eq(products.id, id));
  if (!product) return null;

  const [breaks, specs, movements] = await Promise.all([
    db
      .select({
        minQuantity: priceBreaks.minQuantity,
        unitPriceCents: priceBreaks.unitPriceCents,
      })
      .from(priceBreaks)
      .where(eq(priceBreaks.productId, id))
      .orderBy(asc(priceBreaks.minQuantity)),
    db
      .select({ name: productSpecs.name, value: productSpecs.value })
      .from(productSpecs)
      .where(eq(productSpecs.productId, id))
      .orderBy(asc(productSpecs.position)),
    db
      .select({
        id: stockMovements.id,
        delta: stockMovements.delta,
        reason: stockMovements.reason,
        actor: stockMovements.actor,
        note: stockMovements.note,
        createdAt: stockMovements.createdAt,
        orderId: stockMovements.orderId,
      })
      .from(stockMovements)
      .where(eq(stockMovements.productId, id))
      .orderBy(desc(stockMovements.createdAt))
      .limit(20),
  ]);

  return { product, breaks, specs, movements };
}

export async function listProductOptions(db: Db) {
  const [categoryRows, manufacturerRows] = await Promise.all([
    db
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .orderBy(asc(categories.position)),
    db
      .select({ id: manufacturers.id, name: manufacturers.name })
      .from(manufacturers)
      .orderBy(asc(manufacturers.name)),
  ]);
  return { categories: categoryRows, manufacturers: manufacturerRows };
}

export async function listAdminOrders(db: Db, status: OrderStatus | null, page: number) {
  const where = status ? eq(orders.status, status) : undefined;
  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(orders)
    .where(where);
  const total = countRow?.count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pageCount);

  const rows = await db
    .select({
      id: orders.id,
      number: orders.number,
      status: orders.status,
      customerName: orders.customerName,
      email: orders.email,
      totalCents: orders.totalCents,
      createdAt: orders.createdAt,
    })
    .from(orders)
    .where(where)
    .orderBy(desc(orders.number))
    .limit(ADMIN_PAGE_SIZE)
    .offset((current - 1) * ADMIN_PAGE_SIZE);

  return { rows, total, page: current, pageCount };
}

export async function getOrderLines(db: Db, orderId: string) {
  return db
    .select({
      id: orderItems.id,
      sku: orderItems.sku,
      mpn: orderItems.mpn,
      name: orderItems.name,
      quantity: orderItems.quantity,
      unitPriceCents: orderItems.unitPriceCents,
      lineTotalCents: orderItems.lineTotalCents,
    })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId))
    .orderBy(asc(orderItems.mpn));
}

export async function getOrderEvents(db: Db, orderId: string) {
  return db
    .select({
      id: orderEvents.id,
      fromStatus: orderEvents.fromStatus,
      toStatus: orderEvents.toStatus,
      actor: orderEvents.actor,
      note: orderEvents.note,
      createdAt: orderEvents.createdAt,
    })
    .from(orderEvents)
    .where(eq(orderEvents.orderId, orderId))
    .orderBy(asc(orderEvents.createdAt));
}

export async function getOrderById(db: Db, id: string) {
  const [order] = await db.select().from(orders).where(eq(orders.id, id));
  return order ?? null;
}

export async function getOrderByToken(db: Db, token: string) {
  const [order] = await db.select().from(orders).where(eq(orders.publicToken, token));
  return order ?? null;
}

export async function getAdminSummary(db: Db) {
  const [statusRows, lowRows] = await Promise.all([
    db
      .select({ status: orders.status, count: sql<number>`count(*)::int` })
      .from(orders)
      .groupBy(orders.status),
    db
      .select({
        total: sql<number>`count(*)::int`,
        empty: sql<number>`(count(*) filter (where ${products.stock} = 0))::int`,
      })
      .from(products)
      .where(and(eq(products.status, 'active'), lte(products.stock, LOW_STOCK_LEVEL))),
  ]);
  const byStatus = new Map(statusRows.map((row) => [row.status, row.count]));
  return {
    toShip: byStatus.get('paid') ?? 0,
    awaitingPayment: byStatus.get('pending_payment') ?? 0,
    lowStock: lowRows[0]?.total ?? 0,
    outOfStock: lowRows[0]?.empty ?? 0,
  };
}

export async function changeOrderStatus(
  db: Db,
  orderId: string,
  to: OrderStatus,
  actor: string,
): Promise<TransitionResult> {
  if (to === 'paid' || to === 'payment_failed') {
    return { ok: false, reason: 'invalid_transition' };
  }
  return transitionOrder(db, orderId, to, { actor });
}
