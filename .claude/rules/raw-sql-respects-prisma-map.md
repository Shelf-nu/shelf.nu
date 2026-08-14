Prisma's `@map` decouples the schema field name from the actual DB column.
`Asset.valuation` is `@map("value")`, so `value` is what Postgres knows.
**Typecheck cannot validate raw SQL** — `Prisma.sql\`...\``is just a string
to TS, and the`<{...}[]>` return type is a user-supplied cast, not a
contract. The first signal of a wrong column name is a 500 in production
(`column "valuation" does not exist`).

When you write `$queryRaw` / `Prisma.sql` against any model:

1. Open `packages/database/prisma/schema.prisma` and grep every referenced
   field for `@map(`. Use the mapped column name in SQL, not the Prisma
   field name. Currently known traps on `Asset`: `valuation → value`.
2. Drop any `::bigint` cast on `SUM(float × int)` — Postgres returns
   `double precision` and the cast silently truncates fractional values.
3. Wrap nullable columns in `COALESCE(col, default)` so a missing value
   doesn't poison the whole aggregate to `NULL`.
4. **Add a hitting-real-DB integration test** for any new raw query, or at
   minimum a unit test asserting the SQL string contains the mapped column
   name (cheap regression guard against future refactors).

```typescript
// ❌ Bad — uses Prisma field name; crashes at runtime
db.$queryRaw<{ total: bigint }[]>(Prisma.sql`
  SELECT COALESCE(SUM(valuation * quantity), 0)::bigint AS total
  FROM "Asset" WHERE "organizationId" = ${orgId}
`);

// ✅ Good — uses @map column; null-safe; preserves fractional totals
db.$queryRaw<{ total: number | null }[]>(Prisma.sql`
  SELECT COALESCE(SUM(COALESCE(value, 0) * COALESCE(quantity, 1)), 0) AS total
  FROM "Asset" WHERE "organizationId" = ${orgId}
`);
```

When the aggregate is expressible in Prisma's typed API (`groupBy`,
`findMany` + JS reduce), prefer that — you get the schema-awareness back
and trade only a small amount of round-trip weight.
