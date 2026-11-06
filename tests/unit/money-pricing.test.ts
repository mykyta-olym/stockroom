import { describe, expect, it } from 'vitest';
import { centsToInput, formatCents, parseCents } from '@/domain/money';
import {
  findPriceBreak,
  FREE_SHIPPING_FROM_CENTS,
  lineTotalCents,
  SHIPPING_FLAT_CENTS,
  shippingCents,
  totalsFor,
  unitPriceCents,
} from '@/domain/pricing';

describe('formatCents', () => {
  it.each([
    [0, 'EUR 0.00'],
    [5, 'EUR 0.05'],
    [120, 'EUR 1.20'],
    [123456, 'EUR 1234.56'],
    [-250, 'EUR -2.50'],
  ])('formats %i', (cents, expected) => {
    expect(formatCents(cents)).toBe(expected);
  });
});

describe('parseCents', () => {
  it.each([
    ['0.29', 29],
    ['1', 100],
    ['1.5', 150],
    ['1,50', 150],
    [' 12.34 ', 1234],
    ['0', 0],
  ])('reads %s', (input, expected) => {
    expect(parseCents(input)).toBe(expected);
  });

  it('does not lose cents to floating point', () => {
    for (let cents = 0; cents < 1000; cents += 1) {
      expect(parseCents(centsToInput(cents))).toBe(cents);
    }
  });

  it.each(['', 'abc', '1.234', '-1', '1e3', '1.2.3', '.5', '12345678'])('rejects %j', (input) => {
    expect(parseCents(input)).toBeNull();
  });
});

describe('price breaks', () => {
  const breaks = [
    { minQuantity: 1, unitPriceCents: 100 },
    { minQuantity: 10, unitPriceCents: 80 },
    { minQuantity: 100, unitPriceCents: 50 },
  ];

  it.each([
    [1, 100],
    [9, 100],
    [10, 80],
    [99, 80],
    [100, 50],
    [5000, 50],
  ])('prices a quantity of %i at %i cents', (quantity, expected) => {
    expect(unitPriceCents(breaks, quantity)).toBe(expected);
  });

  it('does not depend on the order of the rows', () => {
    expect(unitPriceCents([...breaks].reverse(), 50)).toBe(80);
  });

  it('multiplies the unit price by the quantity', () => {
    expect(lineTotalCents(breaks, 12)).toBe(960);
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects a quantity of %d', (quantity) => {
    expect(() => findPriceBreak(breaks, quantity)).toThrow(RangeError);
  });

  it('fails loudly when no row covers the quantity', () => {
    expect(() => unitPriceCents([{ minQuantity: 10, unitPriceCents: 80 }], 5)).toThrow(RangeError);
    expect(() => unitPriceCents([], 1)).toThrow(RangeError);
  });
});

describe('shipping', () => {
  it('charges nothing for an empty order', () => {
    expect(shippingCents(0)).toBe(0);
  });

  it('charges the flat rate below the threshold', () => {
    expect(shippingCents(1)).toBe(SHIPPING_FLAT_CENTS);
    expect(shippingCents(FREE_SHIPPING_FROM_CENTS - 1)).toBe(SHIPPING_FLAT_CENTS);
  });

  it('is free from the threshold upwards', () => {
    expect(shippingCents(FREE_SHIPPING_FROM_CENTS)).toBe(0);
  });
});

describe('totalsFor', () => {
  it('adds lines and shipping', () => {
    expect(totalsFor([1000, 250])).toEqual({
      subtotalCents: 1250,
      shippingCents: SHIPPING_FLAT_CENTS,
      totalCents: 1250 + SHIPPING_FLAT_CENTS,
    });
  });

  it('handles no lines', () => {
    expect(totalsFor([])).toEqual({ subtotalCents: 0, shippingCents: 0, totalCents: 0 });
  });
});
