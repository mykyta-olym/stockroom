import { centsToInput, parseCents } from './money';

export const CATALOG_SORTS = [
  'relevance',
  'part',
  'price_asc',
  'price_desc',
  'stock_desc',
] as const;
export type CatalogSort = (typeof CATALOG_SORTS)[number];

export const CATALOG_PAGE_SIZE = 25;

const MAX_VALUES_PER_FILTER = 20;
const MAX_VALUE_LENGTH = 80;
const MAX_PAGE = 100_000;
const SPEC_PREFIX = 'spec.';

export type CatalogParams = {
  q: string;
  category: string | null;
  manufacturers: string[];
  packages: string[];
  specs: Record<string, string[]>;
  inStock: boolean;
  minPriceCents: number | null;
  maxPriceCents: number | null;
  sort: CatalogSort;
  page: number;
};

export type RawParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  const single = Array.isArray(value) ? value[0] : value;
  return (single ?? '').slice(0, MAX_VALUE_LENGTH * 2).trim();
}

function many(value: string | string[] | undefined): string[] {
  const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
  const cleaned = values
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item.length <= MAX_VALUE_LENGTH);
  return [...new Set(cleaned)].slice(0, MAX_VALUES_PER_FILTER);
}

function isSort(value: string): value is CatalogSort {
  return (CATALOG_SORTS as readonly string[]).includes(value);
}

// URLs are user input, and shared links outlive the catalog. Anything malformed
// is dropped rather than rejected, so an old link still shows a useful page.
export function parseCatalogParams(raw: RawParams): CatalogParams {
  const q = first(raw.q);
  const sortInput = first(raw.sort);
  const pageInput = Number(first(raw.page));
  const specs: Record<string, string[]> = {};

  for (const [key, value] of Object.entries(raw)) {
    if (!key.startsWith(SPEC_PREFIX)) continue;
    const name = key.slice(SPEC_PREFIX.length);
    const values = many(value);
    if (name.length > 0 && name.length <= MAX_VALUE_LENGTH && values.length > 0) {
      specs[name] = values;
    }
  }

  const category = first(raw.category);

  return {
    q,
    category: category.length > 0 ? category : null,
    manufacturers: many(raw.manufacturer),
    packages: many(raw.package),
    specs,
    inStock: first(raw.inStock) === '1',
    minPriceCents: parseCents(first(raw.minPrice)),
    maxPriceCents: parseCents(first(raw.maxPrice)),
    sort: isSort(sortInput) ? sortInput : q ? 'relevance' : 'part',
    page: Number.isInteger(pageInput) && pageInput >= 1 && pageInput <= MAX_PAGE ? pageInput : 1,
  };
}

export function catalogSearchParams(params: CatalogParams): URLSearchParams {
  const search = new URLSearchParams();
  if (params.q) search.set('q', params.q);
  if (params.category) search.set('category', params.category);
  for (const value of params.manufacturers) search.append('manufacturer', value);
  for (const value of params.packages) search.append('package', value);
  for (const [name, values] of Object.entries(params.specs)) {
    for (const value of values) search.append(`${SPEC_PREFIX}${name}`, value);
  }
  if (params.inStock) search.set('inStock', '1');
  if (params.minPriceCents !== null) search.set('minPrice', centsToInput(params.minPriceCents));
  if (params.maxPriceCents !== null) search.set('maxPrice', centsToInput(params.maxPriceCents));
  if (params.sort !== (params.q ? 'relevance' : 'part')) search.set('sort', params.sort);
  if (params.page > 1) search.set('page', String(params.page));
  return search;
}

export function catalogHref(params: CatalogParams, overrides: Partial<CatalogParams> = {}): string {
  const query = catalogSearchParams({ ...params, ...overrides }).toString();
  return query ? `/products?${query}` : '/products';
}

export function hasActiveFilters(params: CatalogParams): boolean {
  return (
    params.manufacturers.length > 0 ||
    params.packages.length > 0 ||
    Object.keys(params.specs).length > 0 ||
    params.inStock ||
    params.minPriceCents !== null ||
    params.maxPriceCents !== null
  );
}

export function specFieldName(specName: string): string {
  return `${SPEC_PREFIX}${specName}`;
}
