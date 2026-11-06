const PREFIXES: Record<string, number> = {
  p: 1e-12,
  n: 1e-9,
  u: 1e-6,
  m: 1e-3,
  k: 1e3,
  K: 1e3,
  M: 1e6,
  G: 1e9,
};

const BASE_UNITS = new Set(['Ohm', 'F', 'H', 'V', 'A', 'W', 'Hz', 'm', 'B', 's']);

// Turns a value such as "4.7 kOhm" into a number, so that facets and columns can
// sort by magnitude instead of alphabetically. Returns null for plain words.
export function parseEngineeringValue(input: string): number | null {
  const match = /^\s*([+-]?\d+(?:\.\d+)?)\s*([A-Za-z]*)/.exec(input);
  if (!match) return null;
  const magnitude = Number(match[1]);
  const unit = match[2] ?? '';
  const prefix = PREFIXES[unit.charAt(0)];
  if (prefix !== undefined && BASE_UNITS.has(unit.slice(1))) {
    return magnitude * prefix;
  }
  return magnitude;
}

export function compareSpecValues(
  a: { value: string; sortValue: number | null },
  b: { value: string; sortValue: number | null },
): number {
  if (a.sortValue !== null && b.sortValue !== null && a.sortValue !== b.sortValue) {
    return a.sortValue - b.sortValue;
  }
  if (a.sortValue !== null && b.sortValue === null) return -1;
  if (a.sortValue === null && b.sortValue !== null) return 1;
  return a.value.localeCompare(b.value);
}
