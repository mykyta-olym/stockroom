import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseCatalogParams, type RawParams } from '@/domain/catalog-params';
import {
  getCategory,
  getFacets,
  getProductBySlug,
  listCategories,
  resolveSearchMode,
  searchCatalog,
} from '@/server/catalog';
import { products } from '@/server/db/schema';
import { seedCatalog } from '@/server/seed';
import { emptyDatabase, openDb } from './helpers';

const handle = openDb(5);
const db = handle.db;

beforeAll(async () => {
  await emptyDatabase(db);
  await seedCatalog(db);
});

afterAll(async () => {
  await handle.pool.end();
});

function search(raw: RawParams) {
  return searchCatalog(db, parseCatalogParams(raw));
}

describe('search', () => {
  it('finds parts by shorthand value and package', async () => {
    const result = await search({ q: '10k 0603' });

    expect(result.mode).toBe('exact');
    expect(result.total).toBeGreaterThan(0);
    for (const item of result.items) {
      expect(item.package).toBe('0603');
      expect(item.name).toContain('10 kOhm');
    }
  });

  it('treats 100nf and "100 nF" alike', async () => {
    const compact = await search({ q: '100nf' });
    const spaced = await search({ q: '100 nF' });

    expect(compact.total).toBeGreaterThan(0);
    expect(compact.items.map((item) => item.id).sort()).toEqual(
      spaced.items.map((item) => item.id).sort(),
    );
  });

  it('handles a decimal value', async () => {
    const result = await search({ q: '4.7k' });
    expect(result.total).toBeGreaterThan(0);
    for (const item of result.items) expect(item.name).toContain('4.7 kOhm');
  });

  it('matches a package with or without its hyphen', async () => {
    const hyphen = await search({ q: 'SOT-223' });
    const plain = await search({ q: 'sot223' });
    expect(hyphen.total).toBeGreaterThan(0);
    expect(plain.total).toBe(hyphen.total);
  });

  it('finds a part by the start of its part number', async () => {
    const result = await search({ q: 'OPD-LDO3' });
    expect(result.items.map((item) => item.mpn)).toContain('OPD-LDO33');
  });

  it('finds parts by maker name', async () => {
    const result = await search({ q: 'lumenfold' });
    expect(result.total).toBeGreaterThan(0);
    for (const item of result.items) expect(item.manufacturer).toBe('Lumenfold Opto');
  });

  it('puts an exact part number first', async () => {
    const result = await search({ q: 'OPD-LDO33' });
    expect(result.items[0]?.mpn).toBe('OPD-LDO33');
  });

  it('falls back to close part numbers when a typo finds nothing', async () => {
    const result = await search({ q: 'OPD-LD033' });
    expect(result.mode).toBe('fuzzy');
    expect(result.items.map((item) => item.mpn)).toContain('OPD-LDO33');
  });

  it('returns nothing for nonsense rather than unrelated parts', async () => {
    const result = await search({ q: 'zzzzqqqq' });
    expect(result.total).toBe(0);
    expect(result.items).toEqual([]);
  });

  it.each([
    "'; drop table products; --",
    "' or 1=1 --",
    "a' & 'b",
    '!!! &&& |||',
    '(((',
    ':*',
    '\\',
    '%%%',
    '+',
    '.',
    'a'.repeat(5000),
    '\u0000',
  ])('survives hostile input %j', async (q) => {
    await expect(search({ q })).resolves.toBeDefined();
    const [row] = await db.select({ id: products.id }).from(products).limit(1);
    expect(row).toBeDefined();
  });
});

describe('filters', () => {
  it('filters by category', async () => {
    const result = await search({ category: 'sensors' });
    expect(result.total).toBeGreaterThan(0);
    for (const item of result.items) expect(item.category).toBe('Sensors');
  });

  it('combines values inside a filter with OR and filters with AND', async () => {
    const result = await search({
      category: 'resistors',
      package: ['0402', '1206'],
      'spec.Tolerance': '5%',
    });
    expect(result.total).toBeGreaterThan(0);
    for (const item of result.items) expect(['0402', '1206']).toContain(item.package);

    const detail = await getProductBySlug(db, result.items[0]?.slug ?? '');
    expect(detail?.specs).toContainEqual({ name: 'Tolerance', value: '5%' });
  });

  it('hides sold out parts on request', async () => {
    const all = await search({ category: 'resistors' });
    const inStock = await search({ category: 'resistors', inStock: '1' });
    expect(inStock.total).toBeLessThan(all.total);
    for (const item of inStock.items) expect(item.stock).toBeGreaterThan(0);
  });

  it('filters by the price of a single unit', async () => {
    const result = await search({ minPrice: '1.00', maxPrice: '2.00' });
    expect(result.total).toBeGreaterThan(0);
    for (const item of result.items) {
      expect(item.unitPriceCents).toBeGreaterThanOrEqual(100);
      expect(item.unitPriceCents).toBeLessThanOrEqual(200);
    }
  });

  it('never shows archived parts', async () => {
    const before = await search({ q: 'OPD-LDO33' });
    await db.update(products).set({ status: 'archived' }).where(eq(products.mpn, 'OPD-LDO33'));
    try {
      const after = await search({ q: 'OPD-LDO33' });
      expect(after.items.map((item) => item.mpn)).not.toContain('OPD-LDO33');
      expect(before.items.map((item) => item.mpn)).toContain('OPD-LDO33');
      expect(await getProductBySlug(db, 'opd-ldo33')).toBeNull();
    } finally {
      await db.update(products).set({ status: 'active' }).where(eq(products.mpn, 'OPD-LDO33'));
    }
  });
});

describe('sorting and paging', () => {
  it('sorts by the price of a single unit', async () => {
    const result = await search({ category: 'microcontrollers', sort: 'price_desc' });
    const prices = result.items.map((item) => item.unitPriceCents);
    expect(prices).toEqual([...prices].sort((a, b) => b - a));
  });

  it('splits results into pages without overlap', async () => {
    const first = await search({ category: 'resistors' });
    const second = await search({ category: 'resistors', page: '2' });

    expect(first.pageCount).toBeGreaterThan(1);
    expect(first.items).toHaveLength(25);
    const firstIds = new Set(first.items.map((item) => item.id));
    for (const item of second.items) expect(firstIds.has(item.id)).toBe(false);
  });

  it('moves a page number past the end back to the last page', async () => {
    const result = await search({ category: 'sensors', page: '9999' });
    expect(result.page).toBe(result.pageCount);
    expect(result.items.length).toBeGreaterThan(0);
  });
});

describe('facets', () => {
  async function facetsFor(raw: RawParams) {
    const params = parseCatalogParams(raw);
    const [{ mode }, category] = await Promise.all([
      resolveSearchMode(db, params),
      params.category ? getCategory(db, params.category) : Promise.resolve(null),
    ]);
    return getFacets(db, params, mode, category);
  }

  it('sorts spec values by magnitude, not alphabetically', async () => {
    const facets = await facetsFor({ category: 'resistors' });
    const values = facets.specs
      .find((spec) => spec.name === 'Resistance')
      ?.values.map((v) => v.value);
    expect(values?.slice(0, 3)).toEqual(['10 Ohm', '47 Ohm', '100 Ohm']);
    expect(values?.at(-1)).toBe('1 MOhm');
  });

  it('keeps the other options of a group countable after one is ticked', async () => {
    const before = await facetsFor({ category: 'resistors' });
    const after = await facetsFor({ category: 'resistors', package: '0603' });
    expect(after.packages).toEqual(before.packages);
  });

  it('narrows the counts of other groups', async () => {
    const all = await facetsFor({ category: 'resistors' });
    const narrow = await facetsFor({ category: 'resistors', package: '0603' });
    const total = (facets: typeof all) =>
      facets.specs
        .find((spec) => spec.name === 'Tolerance')
        ?.values.reduce((sum, value) => sum + value.count, 0);
    expect(total(narrow)).toBeLessThan(total(all) ?? 0);
  });

  it('counts match the results they lead to', async () => {
    const facets = await facetsFor({ category: 'leds' });
    const facet = facets.manufacturers[0];
    if (!facet) throw new Error('Expected at least one maker.');
    const result = await search({ category: 'leds', manufacturer: facet.value });
    expect(result.total).toBe(facet.count);
  });
});

describe('category summaries', () => {
  it('reports real counts', async () => {
    const summaries = await listCategories(db);
    expect(summaries).toHaveLength(10);
    const resistors = summaries.find((category) => category.slug === 'resistors');
    const result = await search({ category: 'resistors' });
    expect(resistors?.parts).toBe(result.total);
    expect(resistors?.fromCents).toBeGreaterThan(0);
    expect(resistors?.inStock).toBeLessThan(resistors?.parts ?? 0);
  });
});
