# Asset Mesh Migration Review

## Prisma-to-Supabase Migration — Technical Review

**Reviewer:** Claude Code
**Date:** 2026-03-15
**Branch:** `claude/review-mesh-migration-docs-SdmVz`
**Commits reviewed:** `690f929..7d5e630` (5 commits, ~418 files changed)

---

## Executive Summary

The migration attempts to convert Shelf.nu from Prisma ORM to raw
Supabase SQL + supabase-js client. The **SQL migrations (001-009) are
well-structured and largely correct**. However, the **application code
conversion is fundamentally incomplete** — the vast majority of
business logic still uses Prisma Client API calls (`db.asset.findUnique`,
`db.$transaction`, etc.) against a `db` object that is now a Supabase
client. This means the application **will not compile or run** in its
current state.

### Severity Ratings

- **CRITICAL** — Blocks compilation/runtime. Must fix before any testing.
- **HIGH** — Will cause data corruption, security holes, or silent
  failures in production.
- **MEDIUM** — Incorrect behavior in edge cases or deviates from spec.
- **LOW** — Best-practice deviation, cleanup needed, or cosmetic.

---

## 1. SQL Migrations Review

### 1.1 Migration 001 — Base Schema (MEDIUM)

**ID type mismatch with existing data:**
The migration plan (Section 3.1) explicitly recommends: _"use uuid type
for new tables, keep text for ported tables to avoid FK cascade
headaches."_ However, the base schema converts **all 48 tables** from
`text` (cuid) primary keys to `uuid PRIMARY KEY DEFAULT
gen_random_uuid()`. This contradicts the plan and creates two problems:

1. **Existing data incompatibility** — Shelf.nu's production data uses
   25-character cuid strings (e.g., `clq1abc2d0000ef3gh4ij5klm`).
   These cannot be inserted into a `uuid` column. Any data migration
   from an existing Shelf.nu instance will fail.
2. **Application code still generates cuids** — The asset service
   (`apps/webapp/app/modules/asset/service.server.ts:2417`) still
   explicitly generates CUID-format IDs:
   ```typescript
   const assetId = id(LEGACY_CUID_LENGTH);
   // "generates our standard CUID format"
   ```
   These will fail uuid column validation.

**Recommendation:** For ported tables, use `text PRIMARY KEY` with
`DEFAULT gen_random_uuid()::text` to maintain backward compatibility.
Use native `uuid` only for the 8 new MSP tables.

**Column naming is correct:** The schema correctly preserves Shelf's
camelCase column names in double quotes (e.g., `"organizationId"`,
`"userId"`) for existing tables, and uses snake_case for new MSP tables.
This is the right approach for backward compatibility.

**All 48 models and 20 enums are present** — verified by cross-referencing
against the Prisma schema.

### 1.2 Migration 002 — Strip Billing/Auth (OK)

Well-structured. Correctly:

- Drops indexes before FK constraints before columns before tables
- Uses `IF EXISTS` for safety
- Drops the orphaned `tier_id` enum
- Handles the `_RoleToUser` join table

No issues found.

### 1.3 Migration 003 — Modify for MSP (MEDIUM)

**`person_id` type mismatch on Asset/TeamMember:**
`ALTER TABLE "Asset" ADD COLUMN IF NOT EXISTS person_id uuid` — but if
existing tables keep `text` PKs (per recommendation above), then the
`person` table's `uuid` PK won't match the FK. This is internally
consistent with migration 001's choice to use uuid everywhere, but
becomes a problem if 001 is corrected.

**Missing `CREATE INDEX IF NOT EXISTS`:**
The indexes use `CREATE INDEX` without `IF NOT EXISTS`, which will fail
if the migration is re-run. Not critical for single-run migrations but
worth noting for idempotency.

### 1.4 Migration 004 — New MSP Tables (OK)

Well-designed. Notable positives:

- Properly defers FKs from migration 003 (person_id on Asset/TeamMember)
- Good use of `UNIQUE (asset_id, source_system)` on `asset_sync_source`
- `UNIQUE (organization_id, name)` on `asset_status_config` prevents
  duplicate status names
- Comprehensive indexes including GIN trigram for person name search
- `activity_log` is correctly append-only (no `updated_at`)

**Minor:** `vendor.total_hardware_spend` etc. are stored as columns with
`DEFAULT 0` rather than computed. The spec says "(computed)" — consider
whether these should be materialized views or trigger-maintained to
avoid stale data.

### 1.5 Migration 005 — RLS Policies (HIGH)

**Several security concerns:**

1. **T1 policies are too broad for "FOR ALL":** The policies use
   `FOR ALL USING (...)` which applies the same check to SELECT, INSERT,
   UPDATE, and DELETE. For INSERT, the `USING` clause acts as
   `WITH CHECK`, meaning a T1 user could insert rows with a _different_
   `organization_id` than their tenant — the `USING` clause only checks
   the row _after_ insert against the predicate, but for INSERT, you
   need `WITH CHECK` to validate the _incoming_ data. Example:

   ```sql
   CREATE POLICY "t1_asset_all" ON "Asset"
     FOR ALL USING ("organizationId"::text = auth.tenant_id());
   ```

   PostgreSQL docs state that for INSERT with `FOR ALL`, `USING` is used
   as `WITH CHECK` if no explicit `WITH CHECK` is provided. So this
   _does_ work correctly — but it's implicit and fragile. Explicit
   `WITH CHECK` clauses would be clearer and safer.

2. **Join tables are fully open:** Policies like `t1_asset_to_tag_all`
   and `t1_asset_to_booking_all` use `FOR ALL USING (true)`, granting
   unrestricted access to all join table rows. This means:
   - A T1 user from Tenant A can see/modify join rows belonging to
     Tenant B
   - T2 users inherit no restrictions on join tables
     These should be scoped via subqueries to the parent table's org.

3. **`User` and `UserContact` are fully open:**
   `FOR ALL USING (true)` on the `User` table means any authenticated
   user can read _all_ users across all tenants (including email,
   name, profile). This is a data leak. Users should be scoped by
   `UserOrganization` membership.

4. **T2 `Scan` policy is SELECT-only but spec allows QR flows:**
   T2 users can SELECT scans but cannot INSERT. If T2 users need to
   perform QR scans (which creates Scan records), they need INSERT
   permission too.

5. **Service role key bypasses RLS:** The application uses
   `SUPABASE_SERVICE_ROLE_KEY` for the data client
   (`packages/database/src/client.ts:16`), which **bypasses all RLS
   policies**. This means the RLS policies are effectively unused by
   the application server. RLS only applies to direct Supabase client
   connections (e.g., from a browser). If the intent is server-side
   enforcement, the application must use `anon` key + user JWT, not
   the service role key.

### 1.6 Migration 006 — Triggers (OK)

Well-implemented:

- `set_updated_at()` trigger applied to all relevant tables
- `log_activity()` handles both naming conventions (`organizationId`
  and `organization_id`) via COALESCE
- Field-level change tracking for UPDATEs with metadata column exclusion
- `SECURITY DEFINER` on `log_activity()` allows it to bypass RLS
  (correct for audit logging)
- `activity_log` correctly excluded from `updated_at` triggers

**Minor concern:** The `log_activity()` trigger on UPDATE iterates all
JSON keys and inserts a row per changed field. For tables with many
columns (e.g., Asset with 15+ columns), a single UPDATE could generate
15+ `activity_log` rows. Consider batching or limiting tracked fields.

### 1.7 Migration 007 — Supabase Features (LOW)

- Realtime publication setup is correct
- Storage bucket configuration is reasonable
- `pgcrypto` extension is redundant on modern Postgres (14+) where
  `gen_random_uuid()` is built-in, but harmless

**Minor:** T2 storage policy allows reading ALL images in the bucket,
not just their company's. Should filter by path prefix or metadata.

### 1.8 Migration 008 — Seed Data (OK)

Clean approach using a `seed_default_asset_statuses()` function rather
than inserting with a sentinel org ID. `ON CONFLICT DO NOTHING` for
idempotency.

**Note:** The `Role` seed inserts `('USER'), ('ADMIN')` but the `Role`
table has `name` as a regular column, not a unique constraint. The
`ON CONFLICT (name) DO NOTHING` will fail unless there's a unique
index on `Role.name`. Need to verify the base schema includes this
constraint.

### 1.9 Migration 009 — RPC Functions (MEDIUM)

Functions are well-structured and cover the key transactional operations.
Issues:

1. **`booking_checkout` sets status to `'CHECKED_OUT'` string** but the
   column type is `asset_status` enum — this works because Postgres
   will cast the string to the enum, but explicit casting
   (`'CHECKED_OUT'::asset_status`) would be safer.

2. **`transfer_org_ownership` manipulates roles as `text[]`** but the
   column type is `organization_roles[]` (enum array). The
   `ARRAY['ADMIN']::text[]` cast may fail — should be
   `ARRAY['ADMIN']::organization_roles[]`.

3. **All functions use `SECURITY DEFINER`** which bypasses RLS. This is
   intentional for server-side use but means any user who can call
   these functions can operate on any organization's data. Ensure
   these are not exposed via PostgREST/Supabase client directly, or
   add organization validation within each function.

---

## 2. Application Code Review

### 2.1 CRITICAL: Prisma API Still Used Everywhere

**The single biggest issue.** The application's business logic
(~400+ files) still uses Prisma Client API methods against a `db`
object that is now a Supabase client:

| Pattern                   | Occurrences | Example                                |
| ------------------------- | ----------- | -------------------------------------- |
| `db.<model>.findUnique()` | 50+         | `db.asset.findUnique({...})`           |
| `db.<model>.findMany()`   | 80+         | `db.tag.findMany({...})`               |
| `db.<model>.create()`     | 40+         | `db.category.create({...})`            |
| `db.<model>.update()`     | 60+         | `db.asset.update({...})`               |
| `db.<model>.delete()`     | 20+         | `db.asset.delete({...})`               |
| `db.<model>.count()`      | 15+         | `db.asset.count({ where })`            |
| `db.$transaction()`       | 10+         | `db.$transaction(async (tx) => {...})` |
| `Prisma.*` namespace      | 311         | `Prisma.AssetWhereInput`               |

The Supabase client has **none** of these methods. It uses:

```typescript
// Supabase pattern
const { data, error } = await db.from("Asset").select("*").eq("id", id);

// vs Prisma pattern (currently in code)
const asset = await db.asset.findUnique({ where: { id } });
```

**Impact:** The application will throw runtime errors on every single
database query. Zero functionality works.

**Files with highest Prisma usage (must convert first):**

- `apps/webapp/app/modules/asset/query.server.ts` — 221 `Prisma.*` refs
- `apps/webapp/app/modules/kit/service.server.ts` — 30 `Prisma.*` refs
- `apps/webapp/app/modules/booking/service.server.ts` — 25 `Prisma.*`
- `apps/webapp/app/modules/asset/service.server.ts` — 21 `Prisma.*`

### 2.2 CRITICAL: `Prisma` Namespace Import Is Broken

23 files import `Prisma` from `@shelf/database`:

```typescript
import { Prisma } from "@shelf/database";
```

But `@shelf/database` no longer exports a `Prisma` namespace (it was
removed when Prisma was replaced). This causes a compile-time error.
The `Prisma` namespace was used for:

- `Prisma.AssetWhereInput` (type-safe where clauses)
- `Prisma.AssetInclude` (relation includes)
- `Prisma.AssetSelect` (field selection)
- `Prisma.SortOrder` (ordering)
- `Prisma.sql`, `Prisma.join` (raw SQL template literals)

These need Supabase equivalents or custom type definitions.

### 2.3 HIGH: Error Handling Pattern Mismatch

Prisma throws exceptions on errors. Supabase returns `{ data, error }`
objects. The codebase uses try/catch extensively with Prisma error
detection:

```typescript
// Current pattern (broken with Supabase)
const prismaError = cause as any;
const target = prismaError.meta?.target;
```

Found in 5+ files (`barcode/service.server.ts`,
`asset/service.server.ts`, `kit/service.server.ts`). These error
handlers will never trigger because Supabase doesn't throw — it
returns error objects.

### 2.4 HIGH: `$transaction` Calls Not Converted

6 `db.$transaction()` calls remain in `kit/service.server.ts` (lines
788, 1010, 1123, 1262, 2274, 2408). While migration 009 provides
RPC functions for booking transactions, the kit module's transaction
patterns were not addressed. These need to be either:

- Converted to Supabase RPC functions (preferred)
- Rewritten as sequential operations (if atomicity isn't critical)

### 2.5 HIGH: Query Helpers Exist But Are Unused

A comprehensive 546-line query helper layer was created at
`apps/webapp/app/database/query-helpers.server.ts` that maps
Prisma-style operations (`findMany`, `findFirst`, `create`, `update`,
`delete`) to Supabase PostgREST queries. It includes `throwIfError()`,
`throwIfNotFound()`, filter translation (contains, in, notIn, gte,
lte, etc.), and ordering.

**However, none of the service files use it.** They still call
`db.asset.findMany()` instead of `findMany(db, "Asset", ...)`. This
helper is the intended bridge but was never wired up. The conversion
work should use this abstraction as the starting point.

### 2.6 MEDIUM: Types Are Hand-Crafted, Not Generated

`packages/database/src/types.ts` is described as "hand-crafted from SQL
migrations to match supabase gen types output." The migration plan
(Section 6.3) specifies:

```bash
npx supabase gen types typescript --project-id <project-id> > types/database.ts
```

Hand-crafted types risk drift from the actual schema. When the Supabase
project is set up, these should be replaced with generated types.

### 2.7 MEDIUM: Database Client Uses Service Role Key

`apps/webapp/app/database/db.server.ts` creates the Supabase client
with `SUPABASE_SERVICE_ROLE_KEY`. This key bypasses all RLS policies,
making the 55 RLS policies in migration 005 irrelevant for
server-side operations. If RLS enforcement is desired at the
application level, the client should use per-request JWT tokens.

### 2.8 LOW: Enum Re-exports Have Duplicate `export` Statements

`packages/database/src/index.ts` exports enums as both values and types
with identical names:

```typescript
export { AssetStatus } from "./enums"; // value
export type { AssetStatus } from "./enums"; // type
```

TypeScript allows this (value + type with same name), but the duplicate
`export type` is redundant when the const + type pattern is already
used in `enums.ts`. Not harmful but unnecessary.

---

## 3. Documentation Review

### 3.1 Migration Plan (`docs/asset_mesh_migration_plan.docx`)

The plan is thorough and well-reasoned. Key strengths:

- Clear rationale for clean-state DDL vs replaying 218 migrations
- Comprehensive model inventory with retain/modify/strip assessment
- Detailed type mapping guidance
- Good RLS strategy with T1/T2 patterns

**Gap:** No rollback strategy documented. What happens if the migration
partially fails? Consider adding rollback procedures or checkpoints.

### 3.2 Spec (`docs/asset_mesh_spec.docx`)

Comprehensive product specification covering architecture, features,
integrations, and visibility model. Well-aligned with the actual
migration work.

**Gap:** No mention of testing strategy for the migration. How will
data integrity be verified? What about the 135+ existing `~/database/
db.server` imports — how will they be validated after conversion?

---

## 4. Summary of Action Items

### Must Fix (Blocks Progress)

| #   | Severity | Issue                                                      | Effort     |
| --- | -------- | ---------------------------------------------------------- | ---------- |
| 1   | CRITICAL | Convert all Prisma API calls to Supabase                   | Very Large |
| 2   | CRITICAL | Remove/replace `Prisma` namespace imports                  | Large      |
| 3   | CRITICAL | Convert error handling from try/catch to `{ data, error }` | Large      |
| 4   | HIGH     | Convert `db.$transaction()` calls to RPC functions         | Medium     |
| 5   | HIGH     | Fix RLS policies for join tables (remove `USING (true)`)   | Small      |
| 6   | HIGH     | Scope `User` table RLS to tenant membership                | Small      |

### Should Fix (Before Production)

| #   | Severity | Issue                                                | Effort          |
| --- | -------- | ---------------------------------------------------- | --------------- |
| 7   | MEDIUM   | Decide on uuid vs text PKs for ported tables         | Medium          |
| 8   | MEDIUM   | Add explicit `WITH CHECK` to INSERT policies         | Small           |
| 9   | MEDIUM   | Replace hand-crafted types with `supabase gen types` | Small           |
| 10  | MEDIUM   | Add T2 INSERT policy for `Scan` table                | Small           |
| 11  | MEDIUM   | Fix `transfer_org_ownership` enum array casting      | Small           |
| 12  | MEDIUM   | Clarify service role vs user JWT for RLS             | Design Decision |

### Nice to Have

| #   | Severity | Issue                                        | Effort  |
| --- | -------- | -------------------------------------------- | ------- |
| 13  | LOW      | Add `IF NOT EXISTS` to index creation in 003 | Small   |
| 14  | LOW      | Scope T2 storage policy by path prefix       | Small   |
| 15  | LOW      | Document rollback strategy                   | Small   |
| 16  | LOW      | Remove redundant enum type re-exports        | Trivial |

---

## 5. Recommended Next Steps

1. **Do not attempt to run/build the application** until items 1-4
   are resolved. The Prisma-to-Supabase query conversion is the
   critical path.

2. **Prioritize the query conversion** by module, starting with the
   most heavily used:
   - `asset/query.server.ts` (221 Prisma refs — the query builder)
   - `booking/service.server.ts` (25 Prisma refs)
   - `kit/service.server.ts` (30 Prisma refs + 6 transactions)
   - `asset/service.server.ts` (21 Prisma refs)

3. **Set up the Supabase project** and run `supabase gen types` to
   get proper type definitions before converting queries.

4. **Fix RLS policies** before any client-facing deployment. The
   join table and User table policies are security holes.

5. **Consider a phased approach**: Convert one module at a time,
   validate with tests, then move to the next. The current big-bang
   approach left the codebase in a non-functional state.
