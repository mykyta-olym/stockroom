import { describe, expect, it } from 'vitest';
import {
  addToCartSchema,
  adminPasswordSchema,
  checkoutSchema,
  formatSpecLines,
  orderStatusChangeSchema,
  parseSpecLines,
  productFormToInput,
  productInputSchema,
  readPriceBreaks,
  setQuantitySchema,
  signInSchema,
  stockAdjustmentSchema,
} from '@/domain/validation';

const uuid = '3f2c1f0e-6a55-4b2e-9c1d-0b9a7e5d2c11';

const checkout = {
  customerName: 'Ada Example',
  email: 'ada@example.test',
  addressLine: 'Main Street 1',
  city: 'Kosice',
  postalCode: '040 01',
  country: 'SK',
  paymentToken: 'fake_approve',
  idempotencyKey: uuid,
  expectedTotalCents: '1490',
};

describe('checkoutSchema', () => {
  it('accepts a complete form and normalises it', () => {
    const parsed = checkoutSchema.parse({
      ...checkout,
      customerName: '  Ada Example ',
      email: ' ADA@Example.TEST ',
    });
    expect(parsed.customerName).toBe('Ada Example');
    expect(parsed.email).toBe('ada@example.test');
    expect(parsed.expectedTotalCents).toBe(1490);
  });

  it.each([
    ['customerName', 'A'],
    ['email', 'not-an-email'],
    ['addressLine', ''],
    ['city', ' '],
    ['postalCode', '!!'],
    ['country', 'XX'],
    ['paymentToken', 'tok_real_card'],
    ['idempotencyKey', 'not-a-uuid'],
    ['expectedTotalCents', 'abc'],
    ['expectedTotalCents', '-1'],
  ])('rejects a bad %s', (field, value) => {
    const result = checkoutSchema.safeParse({ ...checkout, [field]: value });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual([field]);
  });

  it('rejects values that are too long', () => {
    expect(checkoutSchema.safeParse({ ...checkout, city: 'x'.repeat(81) }).success).toBe(false);
  });
});

describe('addToCartSchema', () => {
  it('reads a quantity from form text', () => {
    expect(addToCartSchema.parse({ productId: uuid, quantity: '12' }).quantity).toBe(12);
  });

  it.each(['0', '-1', '1.5', 'abc', '100001', 'Infinity'])(
    'rejects a quantity of %j',
    (quantity) => {
      expect(addToCartSchema.safeParse({ productId: uuid, quantity }).success).toBe(false);
    },
  );

  it('rejects a product id that is not a UUID', () => {
    expect(addToCartSchema.safeParse({ productId: '1', quantity: 1 }).success).toBe(false);
  });
});

describe('setQuantitySchema', () => {
  it('allows 0, which removes the line', () => {
    expect(setQuantitySchema.parse({ productId: uuid, quantity: '0' }).quantity).toBe(0);
  });
});

describe('signInSchema', () => {
  it('normalises the email and keeps the password exactly', () => {
    const parsed = signInSchema.parse({ email: ' A@Example.test ', password: ' spaced ' });
    expect(parsed).toEqual({ email: 'a@example.test', password: ' spaced ' });
  });

  it('rejects an empty password', () => {
    expect(signInSchema.safeParse({ email: 'a@example.test', password: '' }).success).toBe(false);
  });
});

describe('adminPasswordSchema', () => {
  it('needs at least 12 characters', () => {
    expect(adminPasswordSchema.safeParse('short').success).toBe(false);
    expect(adminPasswordSchema.safeParse('twelve chars').success).toBe(true);
  });
});

const product = {
  sku: 'SR-100001',
  mpn: 'ABC-123',
  name: 'A part',
  description: 'A long enough description.',
  categoryId: uuid,
  manufacturerId: uuid,
  package: '0603',
  status: 'active',
  priceBreaks: [
    { minQuantity: 1, unitPriceCents: 100 },
    { minQuantity: 10, unitPriceCents: 80 },
  ],
  specs: [{ name: 'Resistance', value: '10 kOhm' }],
};

describe('productInputSchema', () => {
  it('accepts a valid product', () => {
    expect(productInputSchema.safeParse(product).success).toBe(true);
  });

  it.each([
    ['no prices', { priceBreaks: [] }],
    ['a first price above quantity 1', { priceBreaks: [{ minQuantity: 5, unitPriceCents: 100 }] }],
    [
      'quantities out of order',
      {
        priceBreaks: [
          { minQuantity: 1, unitPriceCents: 100 },
          { minQuantity: 1, unitPriceCents: 90 },
        ],
      },
    ],
    [
      'a higher quantity costing more',
      {
        priceBreaks: [
          { minQuantity: 1, unitPriceCents: 100 },
          { minQuantity: 10, unitPriceCents: 110 },
        ],
      },
    ],
    ['a free part', { priceBreaks: [{ minQuantity: 1, unitPriceCents: 0 }] }],
    ['a lower case SKU', { sku: 'sr-1' }],
    ['spaces in a part number', { mpn: 'ABC 123' }],
    [
      'a repeated spec',
      {
        specs: [
          { name: 'Power', value: '1 W' },
          { name: 'power', value: '2 W' },
        ],
      },
    ],
    ['an empty spec value', { specs: [{ name: 'Power', value: '' }] }],
    ['an unknown status', { status: 'deleted' }],
  ])('rejects %s', (_, change) => {
    expect(productInputSchema.safeParse({ ...product, ...change }).success).toBe(false);
  });
});

describe('spec lines', () => {
  it('reads name and value pairs', () => {
    expect(parseSpecLines('Resistance: 10 kOhm\r\n\r\nTolerance: 1%')).toEqual([
      { name: 'Resistance', value: ' 10 kOhm' },
      { name: 'Tolerance', value: ' 1%' },
    ]);
  });

  it('keeps colons inside a value', () => {
    expect(parseSpecLines('Ratio: 1:2')[0]?.value).toBe(' 1:2');
  });

  it('turns a line with no colon into an empty value that validation rejects', () => {
    const specs = parseSpecLines('Just a word');
    expect(specs).toEqual([{ name: 'Just a word', value: '' }]);
    expect(productInputSchema.safeParse({ ...product, specs }).success).toBe(false);
  });

  it('writes back what it read', () => {
    const lines = 'Resistance: 10 kOhm\nTolerance: 1%';
    const parsed = productInputSchema.shape.specs.parse(parseSpecLines(lines));
    expect(formatSpecLines(parsed)).toBe(lines);
  });
});

describe('readPriceBreaks', () => {
  it('reads filled rows and skips empty ones', () => {
    expect(
      readPriceBreaks({
        breakQuantity0: '1',
        breakPrice0: '1.20',
        breakQuantity1: '',
        breakPrice1: '',
        breakQuantity2: '100',
        breakPrice2: '0.80',
      }),
    ).toEqual([
      { minQuantity: 1, unitPriceCents: 120 },
      { minQuantity: 100, unitPriceCents: 80 },
    ]);
  });

  it('keeps a half-filled row, so validation can reject it', () => {
    const breaks = readPriceBreaks({ breakQuantity0: '1', breakPrice0: 'free' });
    expect(breaks).toEqual([{ minQuantity: 1, unitPriceCents: 0 }]);
  });
});

describe('productFormToInput', () => {
  it('produces input the schema accepts', () => {
    const input = productFormToInput({
      sku: 'SR-1000',
      mpn: 'ABC-123',
      name: 'A part',
      description: 'A long enough description.',
      categoryId: uuid,
      manufacturerId: uuid,
      package: '0603',
      status: 'active',
      breakQuantity0: '1',
      breakPrice0: '1.00',
      specs: 'Resistance: 10 kOhm',
    });
    expect(productInputSchema.safeParse(input).success).toBe(true);
  });
});

describe('stockAdjustmentSchema', () => {
  it('accepts negative changes', () => {
    const parsed = stockAdjustmentSchema.parse({ productId: uuid, delta: '-3', note: 'Damaged' });
    expect(parsed.delta).toBe(-3);
  });

  it('refuses a change of 0 and a missing reason', () => {
    expect(
      stockAdjustmentSchema.safeParse({ productId: uuid, delta: '0', note: 'Count' }).success,
    ).toBe(false);
    expect(stockAdjustmentSchema.safeParse({ productId: uuid, delta: '1', note: '' }).success).toBe(
      false,
    );
  });
});

describe('orderStatusChangeSchema', () => {
  it('accepts known statuses only', () => {
    expect(orderStatusChangeSchema.safeParse({ orderId: uuid, status: 'shipped' }).success).toBe(
      true,
    );
    expect(orderStatusChangeSchema.safeParse({ orderId: uuid, status: 'refunded' }).success).toBe(
      false,
    );
  });
});
