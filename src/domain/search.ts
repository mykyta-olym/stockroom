const MAX_QUERY_LENGTH = 100;
const MAX_TOKENS = 8;

// A search box takes anything. Only these characters reach PostgreSQL, and every
// token must hold at least one letter or digit, because to_tsquery treats a bare
// "+" or "." as an empty query.
export function tokenizeQuery(raw: string): string[] {
  return raw
    .slice(0, MAX_QUERY_LENGTH)
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.replace(/[^a-z0-9.+%_-]/g, ''))
    .filter((token) => /[a-z0-9]/.test(token))
    .slice(0, MAX_TOKENS);
}

// Each token is quoted and marked as a prefix, and all tokens must match, so
// "10k 0603" finds every 0603 part with a value starting with 10k.
export function toPrefixTsQuery(tokens: readonly string[]): string {
  return tokens.map((token) => `'${token}':*`).join(' & ');
}

export type SearchableProduct = {
  sku: string;
  mpn: string;
  name: string;
  description: string;
  package: string;
  manufacturer: string;
  category: string;
  specs: readonly { name: string; value: string }[];
};

function compact(value: string): string {
  return value.replace(/[\s_-]+/g, '').toLowerCase();
}

// The text behind the tsvector column. Compact forms are added next to the
// originals, because people type "sot23" and "100nf" as often as "SOT-23" and
// "100 nF", and the two do not produce the same lexemes.
export function buildSearchText(product: SearchableProduct): string {
  const values = product.specs.map((spec) => spec.value);
  return [
    product.sku,
    product.mpn,
    compact(product.mpn),
    product.manufacturer,
    product.category,
    product.package,
    compact(product.package),
    product.name,
    ...values,
    ...values.map(compact),
    product.description,
  ].join(' ');
}
