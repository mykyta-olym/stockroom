import { describe, expect, it } from 'vitest';
import { packageInfo } from '@/domain/packages';
import { productInputSchema } from '@/domain/validation';
import { slugify } from '@/server/admin';
import { buildSeedProducts, CATEGORIES, MANUFACTURERS } from '@/server/seed/catalog-data';
import { priceBreaksFor } from '@/server/seed';

const products = buildSeedProducts();

describe('seed catalog', () => {
  it('has a usable number of parts in every category', () => {
    expect(products.length).toBeGreaterThanOrEqual(150);
    for (const category of CATEGORIES) {
      const parts = products.filter((product) => product.category === category.slug);
      expect(parts.length, category.slug).toBeGreaterThanOrEqual(10);
    }
  });

  it('uses unique part numbers and slugs', () => {
    const mpns = products.map((product) => product.mpn);
    expect(new Set(mpns).size).toBe(mpns.length);
    const slugs = mpns.map(slugify);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('refers only to makers and categories that exist', () => {
    const prefixes = new Set(MANUFACTURERS.map((maker) => maker.prefix));
    const slugs = new Set(CATEGORIES.map((category) => category.slug));
    for (const product of products) {
      expect(prefixes.has(product.manufacturer), product.mpn).toBe(true);
      expect(slugs.has(product.category), product.mpn).toBe(true);
    }
  });

  it('gives every product the specs its category filters on', () => {
    for (const product of products) {
      const category = CATEGORIES.find((candidate) => candidate.slug === product.category);
      const names = product.specs.map(([name]) => name);
      for (const required of category?.filterSpecs ?? []) {
        expect(names, product.mpn).toContain(required);
      }
    }
  });

  it('draws every package', () => {
    for (const product of products) {
      expect(packageInfo(product.package).shape.kind, product.package).not.toBe('generic');
    }
  });

  it('passes the same validation as the admin form', () => {
    const uuid = '3f2c1f0e-6a55-4b2e-9c1d-0b9a7e5d2c11';
    for (const product of products) {
      const result = productInputSchema.safeParse({
        sku: 'SR-100001',
        mpn: product.mpn,
        name: product.name,
        description: product.description,
        categoryId: uuid,
        manufacturerId: uuid,
        package: product.package,
        status: 'active',
        priceBreaks: priceBreaksFor(product.basePriceCents),
        specs: product.specs.map(([name, value]) => ({ name, value })),
      });
      expect(result.success, `${product.mpn}: ${result.error?.message}`).toBe(true);
    }
  });

  it('is plain ASCII', () => {
    expect(JSON.stringify(products)).toMatch(/^[\x20-\x7e]*$/);
  });
});

describe('priceBreaksFor', () => {
  it('falls with quantity', () => {
    expect(priceBreaksFor(100)).toEqual([
      { minQuantity: 1, unitPriceCents: 100 },
      { minQuantity: 10, unitPriceCents: 85 },
      { minQuantity: 100, unitPriceCents: 65 },
      { minQuantity: 1000, unitPriceCents: 50 },
    ]);
  });

  it('never goes below one cent or repeats a price', () => {
    const breaks = priceBreaksFor(2);
    const prices = breaks.map((row) => row.unitPriceCents);
    expect(new Set(prices).size).toBe(prices.length);
    expect(Math.min(...prices)).toBeGreaterThanOrEqual(1);
  });
});

describe('packageInfo', () => {
  it('reads header sizes from the name', () => {
    expect(packageInfo('Header 2x10').shape).toEqual({ kind: 'header', rows: 2, columns: 10 });
  });

  it('copes with a package it does not know', () => {
    expect(packageInfo('Mystery-99').shape.kind).toBe('generic');
  });
});
