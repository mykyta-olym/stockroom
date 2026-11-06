import { sql } from 'drizzle-orm';
import {
  check,
  customType,
  doublePrecision,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

const tsvector = customType<{ data: string }>({
  dataType: () => 'tsvector',
});

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const productStatus = pgEnum('product_status', ['active', 'archived']);

export const orderStatus = pgEnum('order_status', [
  'pending_payment',
  'paid',
  'shipped',
  'delivered',
  'cancelled',
  'payment_failed',
]);

export const stockReason = pgEnum('stock_reason', [
  'initial',
  'order_placed',
  'order_released',
  'adjustment',
]);

export const manufacturers = pgTable('manufacturers', {
  id: uuid().primaryKey().defaultRandom(),
  slug: text().notNull().unique(),
  name: text().notNull().unique(),
});

export const categories = pgTable('categories', {
  id: uuid().primaryKey().defaultRandom(),
  slug: text().notNull().unique(),
  name: text().notNull().unique(),
  description: text().notNull(),
  position: integer().notNull().default(0),
  // Spec names shown as filters for this category. The first two also become
  // columns in the parts table.
  filterSpecs: text('filter_specs')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
});

export const products = pgTable(
  'products',
  {
    id: uuid().primaryKey().defaultRandom(),
    sku: text().notNull().unique(),
    mpn: text().notNull(),
    slug: text().notNull().unique(),
    name: text().notNull(),
    description: text().notNull(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'restrict' }),
    manufacturerId: uuid('manufacturer_id')
      .notNull()
      .references(() => manufacturers.id, { onDelete: 'restrict' }),
    package: text().notNull(),
    stock: integer().notNull().default(0),
    status: productStatus().notNull().default('active'),
    // Written by the application from the product, its maker and its specs,
    // because a generated column cannot read other tables.
    searchText: text('search_text').notNull().default(''),
    search: tsvector().generatedAlwaysAs(sql`to_tsvector('simple', search_text)`),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The last line of defence: even a bug in the application cannot store a
    // negative stock level.
    check('products_stock_not_negative', sql`${table.stock} >= 0`),
    index('products_category_idx').on(table.categoryId, table.status),
    index('products_manufacturer_idx').on(table.manufacturerId),
    index('products_package_idx').on(table.package),
    index('products_search_idx').using('gin', table.search),
  ],
);

export const priceBreaks = pgTable(
  'price_breaks',
  {
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    minQuantity: integer('min_quantity').notNull(),
    unitPriceCents: integer('unit_price_cents').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.productId, table.minQuantity] }),
    check('price_breaks_min_quantity_positive', sql`${table.minQuantity} >= 1`),
    check('price_breaks_price_positive', sql`${table.unitPriceCents} >= 1`),
  ],
);

export const productSpecs = pgTable(
  'product_specs',
  {
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    value: text().notNull(),
    // Numeric form of the value, so that 4.7 kOhm sorts before 10 kOhm.
    sortValue: doublePrecision('sort_value'),
    position: integer().notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.productId, table.name] }),
    index('product_specs_name_value_idx').on(table.name, table.value),
  ],
);

export const carts = pgTable('carts', {
  id: uuid().primaryKey().defaultRandom(),
  token: text().notNull().unique(),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const cartItems = pgTable(
  'cart_items',
  {
    cartId: uuid('cart_id')
      .notNull()
      .references(() => carts.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    quantity: integer().notNull(),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.cartId, table.productId] }),
    check('cart_items_quantity_positive', sql`${table.quantity} >= 1`),
  ],
);

export const orders = pgTable(
  'orders',
  {
    id: uuid().primaryKey().defaultRandom(),
    number: integer().notNull().unique().generatedAlwaysAsIdentity({ startWith: 100001 }),
    // Unguessable reference used in the customer's order link.
    publicToken: text('public_token').notNull().unique(),
    // One value per rendered checkout form, so a resubmission cannot create a
    // second order.
    idempotencyKey: text('idempotency_key').notNull().unique(),
    cartId: uuid('cart_id').references(() => carts.id, { onDelete: 'set null' }),
    status: orderStatus().notNull().default('pending_payment'),
    customerName: text('customer_name').notNull(),
    email: text().notNull(),
    addressLine: text('address_line').notNull(),
    city: text().notNull(),
    postalCode: text('postal_code').notNull(),
    country: text().notNull(),
    subtotalCents: integer('subtotal_cents').notNull(),
    shippingCents: integer('shipping_cents').notNull(),
    totalCents: integer('total_cents').notNull(),
    paymentProvider: text('payment_provider').notNull(),
    paymentReference: text('payment_reference'),
    paymentFailure: text('payment_failure'),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'orders_total_adds_up',
      sql`${table.totalCents} = ${table.subtotalCents} + ${table.shippingCents}`,
    ),
    index('orders_status_created_idx').on(table.status, table.createdAt),
  ],
);

export const orderItems = pgTable(
  'order_items',
  {
    id: uuid().primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    // Copied at purchase time: later catalog edits must not rewrite an order.
    sku: text().notNull(),
    mpn: text().notNull(),
    name: text().notNull(),
    quantity: integer().notNull(),
    unitPriceCents: integer('unit_price_cents').notNull(),
    lineTotalCents: integer('line_total_cents').notNull(),
  },
  (table) => [
    check('order_items_quantity_positive', sql`${table.quantity} >= 1`),
    check(
      'order_items_total_adds_up',
      sql`${table.lineTotalCents} = ${table.quantity} * ${table.unitPriceCents}`,
    ),
    index('order_items_order_idx').on(table.orderId),
  ],
);

export const orderEvents = pgTable(
  'order_events',
  {
    id: uuid().primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    fromStatus: orderStatus('from_status'),
    toStatus: orderStatus('to_status').notNull(),
    actor: text().notNull(),
    note: text(),
    createdAt: createdAt(),
  },
  (table) => [index('order_events_order_idx').on(table.orderId, table.createdAt)],
);

// Every stock change leaves a row here, so the current level can always be
// explained, and tests can check it adds up.
export const stockMovements = pgTable(
  'stock_movements',
  {
    id: uuid().primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    delta: integer().notNull(),
    reason: stockReason().notNull(),
    orderId: uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),
    actor: text().notNull(),
    note: text(),
    createdAt: createdAt(),
  },
  (table) => [
    check('stock_movements_delta_not_zero', sql`${table.delta} <> 0`),
    index('stock_movements_product_idx').on(table.productId, table.createdAt),
  ],
);

export const adminUsers = pgTable('admin_users', {
  id: uuid().primaryKey().defaultRandom(),
  email: text().notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: createdAt(),
});

export const sessions = pgTable(
  'sessions',
  {
    id: uuid().primaryKey().defaultRandom(),
    // SHA-256 of the cookie value. A database leak does not expose live sessions.
    tokenHash: text('token_hash').notNull().unique(),
    userId: uuid('user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [index('sessions_expires_idx').on(table.expiresAt)],
);

// One row per sign-in attempt, removed again when the attempt succeeds.
export const loginAttempts = pgTable(
  'login_attempts',
  {
    id: uuid().primaryKey().defaultRandom(),
    email: text().notNull(),
    createdAt: createdAt(),
  },
  (table) => [index('login_attempts_email_idx').on(table.email, table.createdAt)],
);
