# stockroom

A full-stack store and inventory engine for electronic components built with Next.js 16, Drizzle ORM, and PostgreSQL.

## Overview

`stockroom` models the domain and backend services of an electronic components distributor: parametric part catalog search, engineering unit parsing (`4.7kΩ`, `100nF`, `3.3V`), volume-tiered pricing in integer cents, shopping cart synchronization, concurrency-safe checkout with row-level inventory reservations, order state transitions, and admin fulfillment workflows.

## Architecture

- **`src/domain/`** — Pure domain logic with zero database or framework dependencies:
  - `engineering.ts`: Parses and formats SI-prefixed engineering values (`p`, `n`, `u`, `m`, `k`, `M`, `G`) for parametric filtering.
  - `money.ts` & `pricing.ts`: Exact integer-cent arithmetic and quantity break tier pricing evaluation.
  - `order-status.ts`: Explicit state machine for order lifecycle transitions (`pending` → `paid` → `packed` → `shipped` / `cancelled`).
  - `catalog-params.ts`, `packages.ts`, `search.ts`, `validation.ts`: Query normalization, component package footprints (`0402`, `0603`, `SOIC-8`, `QFN-32`), and Zod schemas.
- **`src/server/`** — PostgreSQL-backed data access and transactional workflows using Drizzle ORM:
  - `catalog.ts`: Faceted parametric search, category trees, and part detail lookups.
  - `cart.ts`: Session-bound and user-bound cart persistence with automatic tier price recalculation.
  - `checkout.ts`: Transactional checkout with `SELECT ... FOR UPDATE` stock locking to prevent overselling under concurrent requests.
  - `admin.ts`: Stock adjustments, order status transitions, and inventory auditing.
  - `auth/`: Scrypt password hashing and database-backed session tokens.
  - `payments/`: Pluggable payment gateway interface with a deterministic fake adapter (`fake.ts`) for integration testing.
- **`drizzle/`** — SQL schema migrations (`0000_extensions.sql`, `0001_core_schema.sql`).
- **`tests/`** — Unit tests (`tests/unit/`) for domain rules and integration tests (`tests/integration/`) exercising real PostgreSQL transactions, including concurrent checkout race conditions (`concurrency.test.ts`).

## Tech Stack

- **Runtime & Framework**: Node.js 24, Next.js 16, React 19, TypeScript 6
- **Database & ORM**: PostgreSQL, Drizzle ORM, `pg`
- **Validation & Testing**: Zod, Vitest, Playwright

## Getting Started

### Prerequisites

- Node.js `>=24` and `pnpm`
- PostgreSQL (via Docker Compose or local instance)

### Setup & Run

```sh
# 1. Start PostgreSQL
docker compose up -d db

# 2. Install dependencies
pnpm install

# 3. Run migrations and seed the component catalog
pnpm db:setup

# 4. Run unit and integration test suites
pnpm test:unit
pnpm test:integration
```

## License

[MIT](LICENSE)
