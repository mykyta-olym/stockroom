import { describe, expect, it } from 'vitest';
import {
  catalogHref,
  catalogSearchParams,
  hasActiveFilters,
  parseCatalogParams,
  type RawParams,
} from '@/domain/catalog-params';

function roundTrip(raw: RawParams) {
  const parsed = parseCatalogParams(raw);
  const next: RawParams = {};
  const search = catalogSearchParams(parsed);
  for (const key of new Set(search.keys())) next[key] = search.getAll(key);
  return { parsed, again: parseCatalogParams(next) };
}

describe('parseCatalogParams', () => {
  it('has sensible defaults', () => {
    expect(parseCatalogParams({})).toEqual({
      q: '',
      category: null,
      manufacturers: [],
      packages: [],
      specs: {},
      inStock: false,
      minPriceCents: null,
      maxPriceCents: null,
      sort: 'part',
      page: 1,
    });
  });

  it('reads every filter', () => {
    const params = parseCatalogParams({
      q: ' 10k ',
      category: 'resistors',
      manufacturer: ['a', 'b'],
      package: '0603',
      'spec.Tolerance': ['1%', '5%'],
      inStock: '1',
      minPrice: '0.10',
      maxPrice: '2',
      sort: 'price_asc',
      page: '3',
    });

    expect(params).toEqual({
      q: '10k',
      category: 'resistors',
      manufacturers: ['a', 'b'],
      packages: ['0603'],
      specs: { Tolerance: ['1%', '5%'] },
      inStock: true,
      minPriceCents: 10,
      maxPriceCents: 200,
      sort: 'price_asc',
      page: 3,
    });
  });

  it('sorts by relevance when there is a query', () => {
    expect(parseCatalogParams({ q: 'led' }).sort).toBe('relevance');
  });

  it.each(['0', '-1', '1.5', 'abc', '', '999999999'])('falls back to page 1 for %j', (page) => {
    expect(parseCatalogParams({ page }).page).toBe(1);
  });

  it('ignores an unknown sort', () => {
    expect(parseCatalogParams({ sort: 'drop table' }).sort).toBe('part');
  });

  it('ignores prices it cannot read', () => {
    const params = parseCatalogParams({ minPrice: 'free', maxPrice: '-1' });
    expect(params.minPriceCents).toBeNull();
    expect(params.maxPriceCents).toBeNull();
  });

  it('takes the first value of a parameter given twice', () => {
    expect(parseCatalogParams({ q: ['first', 'second'] }).q).toBe('first');
  });

  it('removes blanks and duplicates', () => {
    expect(parseCatalogParams({ package: ['0603', ' ', '0603'] }).packages).toEqual(['0603']);
  });

  it('caps oversized input', () => {
    const many = Array.from({ length: 100 }, (_, index) => `v${index}`);
    expect(parseCatalogParams({ package: many }).packages).toHaveLength(20);
    expect(parseCatalogParams({ package: 'x'.repeat(500) }).packages).toEqual([]);
    expect(parseCatalogParams({ q: 'x'.repeat(5000) }).q.length).toBeLessThanOrEqual(160);
  });

  it('ignores a spec filter with no name', () => {
    expect(parseCatalogParams({ 'spec.': 'x' }).specs).toEqual({});
  });
});

describe('catalogSearchParams', () => {
  it('leaves out defaults, so plain URLs stay plain', () => {
    expect(catalogSearchParams(parseCatalogParams({})).toString()).toBe('');
  });

  it('survives a round trip', () => {
    const { parsed, again } = roundTrip({
      q: '10k 0603',
      category: 'resistors',
      manufacturer: ['orrin-passives'],
      package: ['0603', '0805'],
      'spec.Tolerance': ['1%'],
      inStock: '1',
      minPrice: '0.10',
      maxPrice: '2.50',
      sort: 'stock_desc',
      page: '2',
    });
    expect(again).toEqual(parsed);
  });

  it('escapes values for use in a URL', () => {
    const href = catalogHref(parseCatalogParams({ 'spec.Tolerance': '1%', q: 'a&b' }));
    expect(href).toContain('spec.Tolerance=1%25');
    expect(href).toContain('q=a%26b');
  });
});

describe('catalogHref', () => {
  it('applies overrides', () => {
    const params = parseCatalogParams({ category: 'leds', page: '4' });
    expect(catalogHref(params, { page: 5 })).toBe('/products?category=leds&page=5');
    expect(catalogHref(params, { page: 1 })).toBe('/products?category=leds');
  });

  it('returns the bare path with nothing set', () => {
    expect(catalogHref(parseCatalogParams({}))).toBe('/products');
  });
});

describe('hasActiveFilters', () => {
  it('ignores query and category, which have their own controls', () => {
    expect(hasActiveFilters(parseCatalogParams({ q: 'led', category: 'leds' }))).toBe(false);
  });

  it.each([
    [{ package: '0603' }],
    [{ manufacturer: 'x' }],
    [{ inStock: '1' }],
    [{ minPrice: '1' }],
    [{ 'spec.Colour': 'Red' }],
  ])('sees %j', (raw) => {
    expect(hasActiveFilters(parseCatalogParams(raw))).toBe(true);
  });
});
