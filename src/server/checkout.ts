import { randomBytes } from 'node:crypto';
import { and, asc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { CURRENCY } from '@/domain/money';
import { canTransition, type OrderStatus, releasesStock } from '@/domain/order-status';
import { type PriceBreak, totalsFor, unitPriceCents } from '@/domain/pricing';
import type { Db, Tx } from './db/client';
import {
  cartItems,
  carts,
  orderEvents,
  orderItems,
  orders,
  priceBreaks,
  products,
  stockMovements,
} from './db/schema';
import type { PaymentAdapter } from './payments/types';

export type Customer = {
  customerName: string;
  email: string;
  addressLine: string;
  city: string;
  postalCode: string;
  country: string;
};

export type PlaceOrderInput = {
  cartId: string;
  customer: Customer;
  idempotencyKey: string;
  // The total the customer saw. Checkout stops if it no longer matches.
  expectedTotalCents: number;
  paymentToken: string;
};

export type Shortage = {
  productId: string;
  sku: string;
  mpn: string;
  requested: number;
  available: number;
};

export type PlaceOrderResult =
  | { kind: 'paid'; orderId: string; publicToken: string }
  | { kind: 'already_placed'; orderId: string; publicToken: string; status: OrderStatus }
  | { kind: 'payment_failed'; orderId: string; reason: string }
  | { kind: 'cart_empty' }
  | { kind: 'price_changed'; totalCents: number }
  | { kind: 'insufficient_stock'; shortages: Shortage[] };

type Reservation = {
  kind: 'reserved';
  orderId: string;
  publicToken: string;
  totalCents: number;
};

// The first of the three steps below. Stock is taken, and the order written, in
// one transaction. The lock order is fixed everywhere in this file: the cart row
// first, then product rows in id order. Two orders that share products always
// queue for them in the same sequence, so they cannot deadlock.
async function reserveOrder(
  db: Db,
  input: PlaceOrderInput,
  paymentProvider: string,
): Promise<Reservation | Exclude<PlaceOrderResult, { kind: 'paid' | 'payment_failed' }>> {
  return db.transaction(async (tx) => {
    const [cart] = await tx
      .select({ id: carts.id })
      .from(carts)
      .where(eq(carts.id, input.cartId))
      .for('update');
    if (!cart) return { kind: 'cart_empty' };

    // Checked after taking the cart lock: a double submit waits here and then
    // finds the order that the first request created.
    const [existing] = await tx
      .select({ id: orders.id, publicToken: orders.publicToken, status: orders.status })
      .from(orders)
      .where(and(eq(orders.idempotencyKey, input.idempotencyKey), eq(orders.cartId, cart.id)));
    if (existing) {
      return {
        kind: 'already_placed',
        orderId: existing.id,
        publicToken: existing.publicToken,
        status: existing.status,
      };
    }

    const lines = await tx
      .select({ productId: cartItems.productId, quantity: cartItems.quantity })
      .from(cartItems)
      .where(eq(cartItems.cartId, cart.id));
    if (lines.length === 0) return { kind: 'cart_empty' };

    const productIds = lines.map((line) => line.productId);
    const locked = await tx
      .select({
        id: products.id,
        sku: products.sku,
        mpn: products.mpn,
        name: products.name,
        stock: products.stock,
        status: products.status,
      })
      .from(products)
      .where(inArray(products.id, productIds))
      .orderBy(asc(products.id))
      .for('update');

    const breakRows = await tx
      .select({
        productId: priceBreaks.productId,
        minQuantity: priceBreaks.minQuantity,
        unitPriceCents: priceBreaks.unitPriceCents,
      })
      .from(priceBreaks)
      .where(inArray(priceBreaks.productId, productIds));

    const breaksByProduct = new Map<string, PriceBreak[]>();
    for (const row of breakRows) {
      const breaks = breaksByProduct.get(row.productId) ?? [];
      breaks.push(row);
      breaksByProduct.set(row.productId, breaks);
    }

    const quantities = new Map(lines.map((line) => [line.productId, line.quantity]));

    const shortages: Shortage[] = [];
    for (const product of locked) {
      const requested = quantities.get(product.id) ?? 0;
      const available = product.status === 'active' ? product.stock : 0;
      if (requested > available) {
        shortages.push({
          productId: product.id,
          sku: product.sku,
          mpn: product.mpn,
          requested,
          available,
        });
      }
    }
    if (shortages.length > 0) return { kind: 'insufficient_stock', shortages };

    const priced = locked.map((product) => {
      const quantity = quantities.get(product.id) ?? 0;
      const unit = unitPriceCents(breaksByProduct.get(product.id) ?? [], quantity);
      return { product, quantity, unit, lineTotal: unit * quantity };
    });

    const totals = totalsFor(priced.map((line) => line.lineTotal));
    if (totals.totalCents !== input.expectedTotalCents) {
      return { kind: 'price_changed', totalCents: totals.totalCents };
    }

    const [order] = await tx
      .insert(orders)
      .values({
        publicToken: randomBytes(24).toString('base64url'),
        idempotencyKey: input.idempotencyKey,
        cartId: cart.id,
        status: 'pending_payment',
        ...input.customer,
        ...totals,
        paymentProvider,
      })
      .returning({ id: orders.id, publicToken: orders.publicToken });
    if (!order) throw new Error('Inserting the order returned no row.');

    for (const line of priced) {
      // The rows are locked and checked above. The guard stays anyway: the
      // decrement must be safe on its own, not only because of its neighbours.
      const updated = await tx
        .update(products)
        .set({ stock: sql`${products.stock} - ${line.quantity}`, updatedAt: new Date() })
        .where(and(eq(products.id, line.product.id), gte(products.stock, line.quantity)))
        .returning({ id: products.id });
      if (updated.length !== 1) {
        throw new Error(`Stock guard failed for ${line.product.sku}.`);
      }
    }

    await tx.insert(orderItems).values(
      priced.map((line) => ({
        orderId: order.id,
        productId: line.product.id,
        sku: line.product.sku,
        mpn: line.product.mpn,
        name: line.product.name,
        quantity: line.quantity,
        unitPriceCents: line.unit,
        lineTotalCents: line.lineTotal,
      })),
    );

    await tx.insert(stockMovements).values(
      priced.map((line) => ({
        productId: line.product.id,
        delta: -line.quantity,
        reason: 'order_placed' as const,
        orderId: order.id,
        actor: 'customer',
      })),
    );

    await tx.insert(orderEvents).values({
      orderId: order.id,
      toStatus: 'pending_payment',
      actor: 'customer',
      note: 'Order placed and stock reserved.',
    });

    await tx.delete(cartItems).where(eq(cartItems.cartId, cart.id));

    return {
      kind: 'reserved',
      orderId: order.id,
      publicToken: order.publicToken,
      totalCents: totals.totalCents,
    };
  });
}

async function returnStock(tx: Tx, orderId: string, actor: string): Promise<void> {
  const items = await tx
    .select({ productId: orderItems.productId, quantity: orderItems.quantity })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId))
    .orderBy(asc(orderItems.productId));

  for (const item of items) {
    await tx
      .update(products)
      .set({ stock: sql`${products.stock} + ${item.quantity}`, updatedAt: new Date() })
      .where(eq(products.id, item.productId));
  }

  await tx.insert(stockMovements).values(
    items.map((item) => ({
      productId: item.productId,
      delta: item.quantity,
      reason: 'order_released' as const,
      orderId,
      actor,
    })),
  );
}

// Puts a failed order's lines back, so the customer can try again. Runs before
// stock is returned, to keep the cart-then-products lock order.
async function restoreCart(tx: Tx, orderId: string, cartId: string): Promise<void> {
  const items = await tx
    .select({ productId: orderItems.productId, quantity: orderItems.quantity })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));

  await tx
    .insert(cartItems)
    .values(items.map((item) => ({ cartId, ...item })))
    .onConflictDoUpdate({
      target: [cartItems.cartId, cartItems.productId],
      set: { quantity: sql`${cartItems.quantity} + excluded.quantity` },
    });
}

type TransitionOptions = {
  actor: string;
  note?: string;
  payment?: { reference?: string; failure?: string };
  // Runs inside the same transaction, before any stock moves.
  beforeStock?: (tx: Tx, order: { id: string; cartId: string | null }) => Promise<void>;
};

export type TransitionResult =
  | { ok: true; from: OrderStatus; to: OrderStatus }
  | { ok: false; reason: 'not_found' | 'invalid_transition'; from?: OrderStatus };

// The single place where an order changes state. The row lock makes the status
// check and the stock return one step, so two cancellations cannot both refund.
export async function transitionOrder(
  db: Db,
  orderId: string,
  to: OrderStatus,
  options: TransitionOptions,
): Promise<TransitionResult> {
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select({ id: orders.id, status: orders.status, cartId: orders.cartId })
      .from(orders)
      .where(eq(orders.id, orderId))
      .for('update');
    if (!order) return { ok: false, reason: 'not_found' };
    if (!canTransition(order.status, to)) {
      return { ok: false, reason: 'invalid_transition', from: order.status };
    }

    await options.beforeStock?.(tx, order);
    if (releasesStock(to)) await returnStock(tx, order.id, options.actor);

    await tx
      .update(orders)
      .set({
        status: to,
        updatedAt: new Date(),
        ...(options.payment?.reference ? { paymentReference: options.payment.reference } : {}),
        ...(options.payment?.failure ? { paymentFailure: options.payment.failure } : {}),
      })
      .where(eq(orders.id, order.id));

    await tx.insert(orderEvents).values({
      orderId: order.id,
      fromStatus: order.status,
      toStatus: to,
      actor: options.actor,
      note: options.note,
    });

    return { ok: true, from: order.status, to };
  });
}

// Reserve, charge, settle. The charge runs between two transactions on purpose:
// a slow provider must not hold row locks and block everyone buying the same part.
// If the process dies in between, the order stays pending, its stock stays held,
// and releaseStaleOrders gives it back.
export async function placeOrder(
  db: Db,
  input: PlaceOrderInput,
  payment: PaymentAdapter,
): Promise<PlaceOrderResult> {
  const reservation = await reserveOrder(db, input, payment.name);
  if (reservation.kind !== 'reserved') return reservation;

  let failure: string | null = null;
  let reference: string | null = null;
  try {
    const charge = await payment.charge({
      orderId: reservation.orderId,
      amountCents: reservation.totalCents,
      currency: CURRENCY,
      idempotencyKey: input.idempotencyKey,
      paymentToken: input.paymentToken,
    });
    if (charge.status === 'approved') reference = charge.reference;
    else failure = charge.reason;
  } catch (error) {
    failure = error instanceof Error ? error.message : 'The payment provider failed.';
  }

  if (reference !== null) {
    const paid = await transitionOrder(db, reservation.orderId, 'paid', {
      actor: 'payment',
      note: `Payment approved by the ${payment.name} adapter.`,
      payment: { reference },
    });
    if (paid.ok) {
      return {
        kind: 'paid',
        orderId: reservation.orderId,
        publicToken: reservation.publicToken,
      };
    }
    // Only reachable if the order was released while the charge was running.
    // A real adapter would refund here. The fake one has nothing to give back.
    return {
      kind: 'payment_failed',
      orderId: reservation.orderId,
      reason: 'The order expired before the payment finished.',
    };
  }

  const reason = failure ?? 'The payment failed.';
  await transitionOrder(db, reservation.orderId, 'payment_failed', {
    actor: 'payment',
    note: reason,
    payment: { failure: reason },
    beforeStock: async (tx, order) => {
      if (order.cartId) await restoreCart(tx, order.id, order.cartId);
    },
  });
  return { kind: 'payment_failed', orderId: reservation.orderId, reason };
}

export const STALE_ORDER_MINUTES = 15;

// Cancels orders stuck in pending_payment, for example after a crash between the
// reservation and the charge. Returns how many orders it released.
export async function releaseStaleOrders(
  db: Db,
  actor: string,
  now = new Date(),
  olderThanMinutes = STALE_ORDER_MINUTES,
): Promise<number> {
  const cutoff = new Date(now.getTime() - olderThanMinutes * 60_000);
  const stale = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.status, 'pending_payment'), lt(orders.createdAt, cutoff)));

  let released = 0;
  for (const order of stale) {
    const result = await transitionOrder(db, order.id, 'cancelled', {
      actor,
      note: `Not paid within ${olderThanMinutes} minutes.`,
    });
    if (result.ok) released += 1;
  }
  return released;
}
