export const CURRENCY = 'EUR';

export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(cents);
  const whole = Math.floor(absolute / 100);
  const fraction = String(absolute % 100).padStart(2, '0');
  return `${CURRENCY} ${sign}${whole}.${fraction}`;
}

// Parses a price typed by a person. Works on the digits rather than on a float,
// so that 0.29 cannot turn into 28.999999 cents.
export function parseCents(input: string): number | null {
  const match = /^(\d{1,7})(?:[.,](\d{1,2}))?$/.exec(input.trim());
  if (!match) return null;
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? '').padEnd(2, '0'));
  return whole * 100 + fraction;
}

export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2);
}
