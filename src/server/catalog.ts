import { and, asc, desc, eq, exists, gt, gte, inArray, lte, type SQL, sql } from 'drizzle-orm';
import { CATALOG_PAGE_SIZE, type CatalogParams } from '@/domain/catalog-params';
import { compareSpecValues } from '@/domain/engineering';
import { toPrefixTsQuery, tokenizeQuery } from '@/domain/search';
import type { Db } from './db/client';
import { categories, manufacturers, priceBreaks, productSpecs, products } from './db/schema';

const FUZZY_THRESHOLD = 0.35;

export type SearchMode = 'all' | 'exact' | 'fuzzy';

export type CatalogItem = {
  id: string;
  sku: string;
  mpn: string;
  slug: string;
  name: string;
  package: string;
  stock: number;
  manufacturer: string;
  category: string;
  unitPriceCents: number;
  lowestPriceCents: number;
  specs: Record<string, string>;
};

export type CatalogPage = {
  items: CatalogItem[];
  total: number;
  page: number;
  pageCount: number;
  mode: SearchMode;
  category: CategoryInfo | null;
  specColumns: string[];
};

export type CategoryInfo = {
  id: string;
  slug: string;
  name: string;
  description: string;
  filterSpecs: string[];
};

export type Facet = { value: string; label: string; count: number };

export type Facets = {
  manufacturers: Facet[];
  packages: Facet[];
  specs: { name: string; values: Facet[] }[];
};

type FilterGroup = 'manufacturers' | 'packages' | `spec:${string}`;

const basePrice = sql<number>`(
  select ${priceBreaks.unitPriceCents} from ${priceBreaks}
  where ${priceBreaks.productId} = ${products.id} and ${priceBreaks.minQuantity} = 1
)`;

const lowestPrice = sql<number>`(
  select min(${priceBreaks.unitPriceCents}) from ${priceBreaks}
  where ${priceBreaks.productId} = ${products.id}
)`;

function searchPredicate(params: CatalogParams, mode: SearchMode): SQL | undefined {
  const tokens = tokenizeQuery(params.q);
  if (tokens.length === 0 || mode === 'all') return undefined;
  if (mode === 'fuzzy') {
    return sql`word_similarity(${params.q}, ${products.mpn}) > ${FUZZY_THRESHOLD}`;
  }
  return sql`${products.search} @@ to_tsquery('simple', ${toPrefixTsQuery(tokens)})`;
}

function specPredicate(db: Db, name: string, values: string[]): SQL {
  return exists(
    db
      .select({ one: sql`1` })
      .from(productSpecs)
      .where(
        and(
          eq(productSpecs.productId, products.id),
          eq(productSpecs.name, name),
          inArray(productSpecs.value, values),
        ),
      ),
  );
}

// A facet leaves out its own group, so ticking one package still shows how many
// parts the other packages would add.
function buildConditions(
  db: Db,
  params: CatalogParams,
  mode: SearchMode,
  except?: FilterGroup,
): SQL[] {
  const conditions: (SQL | undefined)[] = [
    eq(products.status, 'active'),
    searchPredicate(params, mode),
  ];

  if (params.category) conditions.push(eq(categories.slug, params.category));
  if (params.manufacturers.length > 0 && except !== 'manufacturers') {
    conditions.push(inArray(manufacturers.slug, params.manufacturers));
  }
  if (params.packages.length > 0 && except !== 'packages') {
    conditions.push(inArray(products.package, params.packages));
  }
  for (const [name, values] of Object.entries(params.specs)) {
    if (except !== `spec:${name}`) conditions.push(specPredicate(db, name, values));
  }
  if (params.inStock) conditions.push(gt(products.stock, 0));
  if (params.minPriceCents !== null) conditions.push(gte(basePrice, params.minPriceCents));
  if (params.maxPriceCents !== null) conditions.push(lte(basePrice, params.maxPriceCents));

  return conditions.filter((condition) => condition !== undefined);
}

function orderFor(params: CatalogParams, mode: SearchMode): SQL[] {
  const byPart = asc(products.mpn);
  switch (params.sort) {
    case 'price_asc':
      return [asc(basePrice), byPart];
    case 'price_desc':
      return [desc(basePrice), byPart];
    case 'stock_desc':
      return [desc(products.stock), byPart];
    case 'relevance': {
      const tokens = tokenizeQuery(params.q);
      if (mode === 'fuzzy') {
        return [sql`word_similarity(${params.q}, ${products.mpn}) desc`, byPart];
      }
      if (mode === 'exact' && tokens.length > 0) {
        const rank = sql`ts_rank_cd(${products.search}, to_tsquery('simple', ${toPrefixTsQuery(tokens)}))`;
        return [
          sql`(lower(${products.mpn}) = ${params.q.toLowerCase()}) desc`,
          sql`${rank} desc`,
          byPart,
        ];
      }
      return [byPart];
    }
    default:
      return [byPart];
  }
}

async function countMatches(db: Db, params: CatalogParams, mode: SearchMode): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(products)
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .innerJoin(manufacturers, eq(manufacturers.id, products.manufacturerId))
    .where(and(...buildConditions(db, params, mode)));
  return row?.count ?? 0;
}

// Exact matches come first. Only a query that finds nothing falls back to fuzzy
// matching on part numbers, which catches typos such as "QLN-LD033" for "QLN-LDO33".
export async function resolveSearchMode(
  db: Db,
  params: CatalogParams,
): Promise<{ mode: SearchMode; total: number }> {
  if (tokenizeQuery(params.q).length === 0) {
    return { mode: 'all', total: await countMatches(db, params, 'all') };
  }
  const total = await countMatches(db, params, 'exact');
  if (total > 0) return { mode: 'exact', total };
  return { mode: 'fuzzy', total: await countMatches(db, params, 'fuzzy') };
}

export async function getCategory(db: Db, slug: string): Promise<CategoryInfo | null> {
  const [category] = await db
    .select({
      id: categories.id,
      slug: categories.slug,
      name: categories.name,
      description: categories.description,
      filterSpecs: categories.filterSpecs,
    })
    .from(categories)
    .where(eq(categories.slug, slug));
  return category ?? null;
}

export async function searchCatalog(db: Db, params: CatalogParams): Promise<CatalogPage> {
  const [{ mode, total }, category] = await Promise.all([
    resolveSearchMode(db, params),
    params.category ? getCategory(db, params.category) : Promise.resolve(null),
  ]);

  const pageCount = Math.max(1, Math.ceil(total / CATALOG_PAGE_SIZE));
  const page = Math.min(params.page, pageCount);
  const specColumns = category?.filterSpecs.slice(0, 2) ?? [];

  const rows = await db
    .select({
      id: products.id,
      sku: products.sku,
      mpn: products.mpn,
      slug: products.slug,
      name: products.name,
      package: products.package,
      stock: products.stock,
      manufacturer: manufacturers.name,
      category: categories.name,
      unitPriceCents: basePrice.mapWith(Number),
      lowestPriceCents: lowestPrice.mapWith(Number),
    })
    .from(products)
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .innerJoin(manufacturers, eq(manufacturers.id, products.manufacturerId))
    .where(and(...buildConditions(db, params, mode)))
    .orderBy(...orderFor(params, mode))
    .limit(CATALOG_PAGE_SIZE)
    .offset((page - 1) * CATALOG_PAGE_SIZE);

  const specRows =
    rows.length > 0 && specColumns.length > 0
      ? await db
          .select({
            productId: productSpecs.productId,
            name: productSpecs.name,
            value: productSpecs.value,
          })
          .from(productSpecs)
          .where(
            and(
              inArray(
                productSpecs.productId,
                rows.map((row) => row.id),
              ),
              inArray(productSpecs.name, specColumns),
            ),
          )
      : [];

  const items = rows.map((row) => ({
    ...row,
    specs: Object.fromEntries(
      specRows.filter((spec) => spec.productId === row.id).map((spec) => [spec.name, spec.value]),
    ),
  }));

  return { items, total, page, pageCount, mode, category, specColumns };
}

export async function getFacets(
  db: Db,
  params: CatalogParams,
  mode: SearchMode,
  category: CategoryInfo | null,
): Promise<Facets> {
  const scoped = (group: FilterGroup) => and(...buildConditions(db, params, mode, group));

  const manufacturerRows = db
    .select({
      value: manufacturers.slug,
      label: manufacturers.name,
      count: sql<number>`count(*)::int`,
    })
    .from(products)
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .innerJoin(manufacturers, eq(manufacturers.id, products.manufacturerId))
    .where(scoped('manufacturers'))
    .groupBy(manufacturers.slug, manufacturers.name)
    .orderBy(asc(manufacturers.name));

  const packageRows = db
    .select({ value: products.package, count: sql<number>`count(*)::int` })
    .from(products)
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .innerJoin(manufacturers, eq(manufacturers.id, products.manufacturerId))
    .where(scoped('packages'))
    .groupBy(products.package)
    .orderBy(asc(products.package));

  const specQueries = (category?.filterSpecs ?? []).map(async (name) => {
    const rows = await db
      .select({
        value: productSpecs.value,
        sortValue: sql<number | null>`min(${productSpecs.sortValue})`.mapWith((value) =>
          value === null ? null : Number(value),
        ),
        count: sql<number>`count(*)::int`,
      })
      .from(productSpecs)
      .innerJoin(products, eq(products.id, productSpecs.productId))
      .innerJoin(categories, eq(categories.id, products.categoryId))
      .innerJoin(manufacturers, eq(manufacturers.id, products.manufacturerId))
      .where(and(eq(productSpecs.name, name), scoped(`spec:${name}`)))
      .groupBy(productSpecs.value);

    const values = rows
      .sort(compareSpecValues)
      .map((row) => ({ value: row.value, label: row.value, count: row.count }));
    return { name, values };
  });

  const [manufacturerFacets, packageFacets, specs] = await Promise.all([
    manufacturerRows,
    packageRows,
    Promise.all(specQueries),
  ]);

  return {
    manufacturers: manufacturerFacets,
    packages: packageFacets.map((row) => ({ ...row, label: row.value })),
    specs,
  };
}

export type ProductDetail = {
  id: string;
  sku: string;
  mpn: string;
  slug: string;
  name: string;
  description: string;
  package: string;
  stock: number;
  manufacturer: string;
  manufacturerSlug: string;
  category: string;
  categorySlug: string;
  priceBreaks: { minQuantity: number; unitPriceCents: number }[];
  specs: { name: string; value: string }[];
};

export async function getProductBySlug(db: Db, slug: string): Promise<ProductDetail | null> {
  const [product] = await db
    .select({
      id: products.id,
      sku: products.sku,
      mpn: products.mpn,
      slug: products.slug,
      name: products.name,
      description: products.description,
      package: products.package,
      stock: products.stock,
      manufacturer: manufacturers.name,
      manufacturerSlug: manufacturers.slug,
      category: categories.name,
      categorySlug: categories.slug,
    })
    .from(products)
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .innerJoin(manufacturers, eq(manufacturers.id, products.manufacturerId))
    .where(and(eq(products.slug, slug), eq(products.status, 'active')));
  if (!product) return null;

  const [breaks, specs] = await Promise.all([
    db
      .select({
        minQuantity: priceBreaks.minQuantity,
        unitPriceCents: priceBreaks.unitPriceCents,
      })
      .from(priceBreaks)
      .where(eq(priceBreaks.productId, product.id))
      .orderBy(asc(priceBreaks.minQuantity)),
    db
      .select({ name: productSpecs.name, value: productSpecs.value })
      .from(productSpecs)
      .where(eq(productSpecs.productId, product.id))
      .orderBy(asc(productSpecs.position)),
  ]);

  return { ...product, priceBreaks: breaks, specs };
}

export type CategorySummary = {
  slug: string;
  name: string;
  description: string;
  parts: number;
  inStock: number;
  fromCents: number | null;
};

export async function listCategories(db: Db): Promise<CategorySummary[]> {
  return db
    .select({
      slug: categories.slug,
      name: categories.name,
      description: categories.description,
      parts: sql<number>`count(${products.id})::int`,
      inStock: sql<number>`(count(${products.id}) filter (where ${products.stock} > 0))::int`,
      fromCents: sql<number | null>`min(${basePrice})::int`,
    })
    .from(categories)
    .leftJoin(products, and(eq(products.categoryId, categories.id), eq(products.status, 'active')))
    .groupBy(categories.id)
    .orderBy(asc(categories.position));
}

export async function listLowStock(db: Db, limit: number): Promise<CatalogItem[]> {
  const rows = await db
    .select({
      id: products.id,
      sku: products.sku,
      mpn: products.mpn,
      slug: products.slug,
      name: products.name,
      package: products.package,
      stock: products.stock,
      manufacturer: manufacturers.name,
      category: categories.name,
      unitPriceCents: basePrice.mapWith(Number),
      lowestPriceCents: lowestPrice.mapWith(Number),
    })
    .from(products)
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .innerJoin(manufacturers, eq(manufacturers.id, products.manufacturerId))
    .where(and(eq(products.status, 'active'), gt(products.stock, 0), lte(products.stock, 25)))
    .orderBy(asc(products.stock), asc(products.mpn))
    .limit(limit);
  return rows.map((row) => ({ ...row, specs: {} }));
}
