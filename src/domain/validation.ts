import { z } from 'zod';
import { parseCents } from './money';
import { ORDER_STATUSES } from './order-status';

export const MAX_LINE_QUANTITY = 100_000;
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PRICE_BREAKS = 5;

export const SHIPPING_COUNTRIES = [
  { code: 'AT', name: 'Austria' },
  { code: 'CZ', name: 'Czechia' },
  { code: 'DE', name: 'Germany' },
  { code: 'HU', name: 'Hungary' },
  { code: 'PL', name: 'Poland' },
  { code: 'SK', name: 'Slovakia' },
  { code: 'UA', name: 'Ukraine' },
] as const;

const countryCodes = SHIPPING_COUNTRIES.map((country) => country.code) as [string, ...string[]];

// Stands in for the token a real payment form would return. It is never card data.
export const FAKE_PAYMENT_TOKENS = ['fake_approve', 'fake_decline', 'fake_error'] as const;

const quantity = z.coerce
  .number({ error: 'Enter a whole number.' })
  .int('Enter a whole number.')
  .min(1, 'Enter at least 1.')
  .max(MAX_LINE_QUANTITY, `Enter ${MAX_LINE_QUANTITY} or less.`);

export const addToCartSchema = z.object({
  productId: z.uuid('Unknown product.'),
  quantity,
});

export const setQuantitySchema = z.object({
  productId: z.uuid('Unknown product.'),
  quantity: z.coerce
    .number({ error: 'Enter a whole number.' })
    .int('Enter a whole number.')
    .min(0, 'Enter 0 or more.')
    .max(MAX_LINE_QUANTITY, `Enter ${MAX_LINE_QUANTITY} or less.`),
});

export const checkoutSchema = z.object({
  customerName: z
    .string()
    .trim()
    .min(2, 'Enter your full name.')
    .max(120, 'Use 120 characters or less.'),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254, 'Use 254 characters or less.')
    .pipe(z.email('Enter a valid email address.')),
  addressLine: z
    .string()
    .trim()
    .min(3, 'Enter your street and number.')
    .max(160, 'Use 160 characters or less.'),
  city: z.string().trim().min(2, 'Enter your city.').max(80, 'Use 80 characters or less.'),
  postalCode: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9 -]{2,10}$/, 'Enter a valid postal code.'),
  country: z.enum(countryCodes, { error: 'Choose a country.' }),
  paymentToken: z.enum(FAKE_PAYMENT_TOKENS, { error: 'Choose a payment outcome.' }),
  idempotencyKey: z.uuid('Reload the page and try again.'),
  expectedTotalCents: z.coerce.number().int().min(0),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;

export const signInSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email('Enter a valid email address.')),
  password: z.string().min(1, 'Enter your password.').max(200, 'Use 200 characters or less.'),
});

export const adminPasswordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters.`)
  .max(200);

const priceBreakSchema = z.object({
  minQuantity: z.number().int().min(1).max(MAX_LINE_QUANTITY),
  unitPriceCents: z.number().int().min(1).max(100_000_00),
});

const specSchema = z.object({
  name: z.string().trim().min(1).max(60),
  value: z.string().trim().min(1).max(80),
});

export const productInputSchema = z.object({
  sku: z
    .string()
    .trim()
    .regex(/^[A-Z0-9-]{3,32}$/, 'Use 3 to 32 capital letters, digits or hyphens.'),
  mpn: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9.+/_-]{2,40}$/, 'Use 2 to 40 letters, digits or . + / _ -'),
  name: z.string().trim().min(3, 'Enter a name.').max(140, 'Use 140 characters or less.'),
  description: z
    .string()
    .trim()
    .min(10, 'Write at least 10 characters.')
    .max(2000, 'Use 2000 characters or less.'),
  categoryId: z.uuid('Choose a category.'),
  manufacturerId: z.uuid('Choose a manufacturer.'),
  package: z.string().trim().min(1, 'Enter a package.').max(24, 'Use 24 characters or less.'),
  status: z.enum(['active', 'archived']),
  priceBreaks: z
    .array(priceBreakSchema)
    .min(1, 'Add at least one price.')
    .max(MAX_PRICE_BREAKS)
    .superRefine((breaks, context) => {
      if (breaks[0]?.minQuantity !== 1) {
        context.addIssue({ code: 'custom', message: 'The first price must start at quantity 1.' });
      }
      for (let index = 1; index < breaks.length; index += 1) {
        const previous = breaks[index - 1];
        const current = breaks[index];
        if (!previous || !current) continue;
        if (current.minQuantity <= previous.minQuantity) {
          context.addIssue({
            code: 'custom',
            message: 'Quantities must increase from row to row.',
          });
        }
        if (current.unitPriceCents > previous.unitPriceCents) {
          context.addIssue({
            code: 'custom',
            message: 'A higher quantity cannot cost more per unit.',
          });
        }
      }
    }),
  specs: z
    .array(specSchema)
    .max(20, 'Use 20 specs or fewer.')
    .superRefine((specs, context) => {
      const names = specs.map((spec) => spec.name.toLowerCase());
      if (new Set(names).size !== names.length) {
        context.addIssue({ code: 'custom', message: 'Each spec name can appear only once.' });
      }
    }),
});

export type ProductInput = z.infer<typeof productInputSchema>;

type FormValues = Record<string, FormDataEntryValue | undefined>;

function text(values: FormValues, key: string): string {
  const value = values[key];
  return typeof value === 'string' ? value : '';
}

// Reads "Name: value" lines. A line with no colon stays visible to the schema as
// an empty value, so the person gets an error instead of silent data loss.
export function parseSpecLines(input: string): { name: string; value: string }[] {
  return input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const colon = line.indexOf(':');
      if (colon === -1) return { name: line, value: '' };
      return { name: line.slice(0, colon), value: line.slice(colon + 1) };
    });
}

export function formatSpecLines(specs: readonly { name: string; value: string }[]): string {
  return specs.map((spec) => `${spec.name}: ${spec.value}`).join('\n');
}

// Empty price rows are skipped. A row with something in it must be complete, and
// a value that cannot be read becomes 0, which the schema then rejects.
export function readPriceBreaks(
  values: FormValues,
): { minQuantity: number; unitPriceCents: number }[] {
  const breaks: { minQuantity: number; unitPriceCents: number }[] = [];
  for (let index = 0; index < MAX_PRICE_BREAKS; index += 1) {
    const quantityText = text(values, `breakQuantity${index}`).trim();
    const priceText = text(values, `breakPrice${index}`).trim();
    if (!quantityText && !priceText) continue;
    const parsedQuantity = Number(quantityText);
    breaks.push({
      minQuantity: Number.isInteger(parsedQuantity) ? parsedQuantity : 0,
      unitPriceCents: parseCents(priceText) ?? 0,
    });
  }
  return breaks;
}

export function productFormToInput(values: FormValues): unknown {
  return {
    sku: text(values, 'sku'),
    mpn: text(values, 'mpn'),
    name: text(values, 'name'),
    description: text(values, 'description'),
    categoryId: text(values, 'categoryId'),
    manufacturerId: text(values, 'manufacturerId'),
    package: text(values, 'package'),
    status: text(values, 'status'),
    priceBreaks: readPriceBreaks(values),
    specs: parseSpecLines(text(values, 'specs')),
  };
}

export const initialStockSchema = z.coerce
  .number({ error: 'Enter a whole number.' })
  .int('Enter a whole number.')
  .min(0, 'Enter 0 or more.')
  .max(10_000_000);

export const stockAdjustmentSchema = z.object({
  productId: z.uuid(),
  delta: z.coerce
    .number({ error: 'Enter a whole number.' })
    .int('Enter a whole number.')
    .min(-10_000_000)
    .max(10_000_000)
    .refine((value) => value !== 0, 'Enter a change other than 0.'),
  note: z
    .string()
    .trim()
    .min(3, 'Say why the stock changed.')
    .max(200, 'Use 200 characters or less.'),
});

export const orderStatusChangeSchema = z.object({
  orderId: z.uuid(),
  status: z.enum(ORDER_STATUSES),
});

export type FieldErrors = Record<string, string[] | undefined>;
