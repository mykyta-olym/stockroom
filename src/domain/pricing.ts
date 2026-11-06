export type PriceBreak = {
  minQuantity: number;
  unitPriceCents: number;
};

export const SHIPPING_FLAT_CENTS = 490;
export const FREE_SHIPPING_FROM_CENTS = 5000;

// Component prices fall with quantity. The price for an order line is the break
// with the highest minimum quantity that the line still reaches.
export function findPriceBreak(breaks: readonly PriceBreak[], quantity: number): PriceBreak {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new RangeError(`Quantity must be a positive integer, got ${quantity}`);
  }
  let best: PriceBreak | undefined;
  for (const candidate of breaks) {
    if (candidate.minQuantity > quantity) continue;
    if (!best || candidate.minQuantity > best.minQuantity) best = candidate;
  }
  if (!best) {
    throw new RangeError(`No price break covers a quantity of ${quantity}`);
  }
  return best;
}

export function unitPriceCents(breaks: readonly PriceBreak[], quantity: number): number {
  return findPriceBreak(breaks, quantity).unitPriceCents;
}

export function lineTotalCents(breaks: readonly PriceBreak[], quantity: number): number {
  return unitPriceCents(breaks, quantity) * quantity;
}

export function shippingCents(subtotalCents: number): number {
  if (subtotalCents <= 0 || subtotalCents >= FREE_SHIPPING_FROM_CENTS) return 0;
  return SHIPPING_FLAT_CENTS;
}

export type Totals = {
  subtotalCents: number;
  shippingCents: number;
  totalCents: number;
};

export function totalsFor(lineTotals: readonly number[]): Totals {
  const subtotalCents = lineTotals.reduce((sum, line) => sum + line, 0);
  const shipping = shippingCents(subtotalCents);
  return {
    subtotalCents,
    shippingCents: shipping,
    totalCents: subtotalCents + shipping,
  };
}
