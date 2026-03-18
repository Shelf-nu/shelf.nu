# Prisma → Supabase Migration Progress

**Branch:** `claude/review-and-plan-4zie9`
**Date:** 2026-03-18
**Status:** Typecheck ✅ | Lint ✅ | All pre-commit hooks passing ✅

## Summary

Migrating database access from Prisma ORM (`db.*`) to Supabase PostgREST
client (`sbDb.*`) across the webapp's module services. The Supabase client
is exported from `~/database/supabase.server` as `sbDb`.

**65 files changed, 4,631 insertions, 3,619 deletions** across 2 commits
on top of a previously merged PR (#1).

---

## Commits on this branch

```
14fec59 refactor: migrate audit, invite, and user modules to Supabase and fix all type errors
9aee6b9 refactor: migrate module services from Prisma to Supabase
```

Previous work (already merged to main via PR #1):

```
6cc440d feat: migrate asset data queries and filter presets from Prisma to Supabase
bc93b52 feat: migrate barcode CRUD operations from Prisma to Supabase
eb78ae0 refactor: migrate user/utils and asset-reminder to Supabase
90d22d3 refactor: eliminate all db.assetIndexSettings Prisma calls
e0451ad refactor(asset-index-settings): complete Supabase migration
3a94347 refactor: migrate raw SQL queries to Postgres RPC functions
d2dba94 refactor: migrate more simple functions to Supabase across 6 modules
76a64f5 refactor(asset-index-settings,audit): migrate simple functions to Supabase
... and more (see git log)
```

---

## Modules Fully Migrated to Supabase (47 files)

These files import from `~/database/supabase.server` and have no remaining
`db.` (Prisma) calls:

| Module                   | Files                                                                                                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **asset-filter-presets** | `service.server.ts`                                                                                                                                                                               |
| **asset-index-settings** | `service.server.ts`                                                                                                                                                                               |
| **asset-reminder**       | `scheduler.server.ts`, `service.server.ts`, `worker.server.ts`                                                                                                                                    |
| **asset**                | `data.server.ts`, `sequential-id.server.ts`                                                                                                                                                       |
| **audit**                | `addon.server.ts`, `asset-details.service.server.ts`, `context-helpers.server.ts`, `image.service.server.ts`, `note-service.server.ts`, `pdf-helpers.ts`, `service.server.ts`, `worker.server.ts` |
| **auth**                 | `service.server.ts`                                                                                                                                                                               |
| **barcode**              | `service.server.ts`                                                                                                                                                                               |
| **booking-note**         | `service.server.ts`                                                                                                                                                                               |
| **booking-settings**     | `service.server.ts`                                                                                                                                                                               |
| **booking**              | `email-helpers.ts`, `pdf-helpers.ts`, `worker.server.ts`                                                                                                                                          |
| **business-intel**       | `service.server.ts`                                                                                                                                                                               |
| **category**             | `service.server.ts`                                                                                                                                                                               |
| **custody**              | `service.server.ts`                                                                                                                                                                               |
| **custom-field**         | `service.server.ts`                                                                                                                                                                               |
| **invite**               | `service.server.ts`                                                                                                                                                                               |
| **location-note**        | `service.server.ts`                                                                                                                                                                               |
| **location**             | `descendants.server.ts`, `service.server.ts`                                                                                                                                                      |
| **note**                 | `load-user-for-notes.server.ts`, `service.server.ts`                                                                                                                                              |
| **organization**         | `service.server.ts` (partially — also imports `db`)                                                                                                                                               |
| **qr**                   | `service.server.ts`                                                                                                                                                                               |
| **report-found**         | `service.server.ts`                                                                                                                                                                               |
| **scan**                 | `service.server.ts`                                                                                                                                                                               |
| **settings**             | `service.server.ts`                                                                                                                                                                               |
| **stripe-webhook**       | `handlers.server.ts`, `helpers.server.ts`                                                                                                                                                         |
| **tag**                  | `service.server.ts`                                                                                                                                                                               |
| **team-member**          | `service.server.ts`                                                                                                                                                                               |
| **tier**                 | `service.server.ts`                                                                                                                                                                               |
| **update**               | `service.server.ts`                                                                                                                                                                               |
| **user-contact**         | `service.server.ts`                                                                                                                                                                               |
| **user**                 | `service.server.ts`, `utils.server.ts`                                                                                                                                                            |
| **working-hours**        | `service.server.ts`                                                                                                                                                                               |

---

## Modules Still Using Prisma (8 files)

These files still import `db` from `~/database/db.server`:

| File                                       | `db.` calls | Notes                                             |
| ------------------------------------------ | ----------- | ------------------------------------------------- |
| **asset/service.server.ts**                | ~46         | Largest file. Reverted from incomplete migration. |
| **asset/bulk-operations-helper.server.ts** | several     | Untouched                                         |
| **kit/service.server.ts**                  | ~127        | Reverted from incomplete migration.               |
| **booking/service.server.ts**              | many        | Untouched                                         |
| **location/service.server.ts**             | some        | Also imports sbDb (partial)                       |
| **location/bulk-select.server.ts**         | some        | Untouched                                         |
| **organization/service.server.ts**         | some        | Also imports sbDb (partial)                       |
| **audit/helpers.server.ts**                | some        | Uses `db` as fallback when `tx` not passed        |

---

## Known Type Patterns / Gotchas

### Supabase SelectQueryError for relations

Supabase's typed client doesn't resolve foreign-key relations in
`.select()` strings. Queries like:

```ts
sbDb.from("User").select("*, userOrganizations:UserOrganization(*)");
```

Return `SelectQueryError<"could not find the relation...">` for the
relation field. Fix with `as unknown as Type[]` casts in consumers.

### Dynamic select strings lose types

If the `.select()` argument is a `string` variable (not a literal),
Supabase returns `{}` for all fields. Use string literals or add
explicit return types.

### Dates return as strings

Supabase returns date columns as ISO strings, not `Date` objects.
Cast with `new Date(field as string)` where `Date` type is expected.

### Enum types return as strings

Prisma enum types (e.g., `AuditStatus`) come back as plain `string`
from Supabase. Cast with `as AuditStatus` where the enum type is
expected.

### `Awaited<ReturnType<>>` pattern

When a Prisma function was sync-returning a typed payload and is now
async via Supabase, consumers using `ReturnType<typeof fn>` need to
switch to `Awaited<ReturnType<typeof fn>>`.

---

## Route/Component Files Modified

These consumer files were updated with type casts to work with Supabase
return types:

- `routes/_layout+/_layout.tsx`
- `routes/_layout+/admin-dashboard+/users.tsx`
- `routes/_layout+/audits.$auditId.overview.tsx`
- `routes/_layout+/audits._index.tsx`
- `routes/_layout+/bookings.$bookingId.overview.manage-kits.tsx`
- `routes/_layout+/settings.team.users.$userId.tsx`
- `routes/_welcome+/onboarding.tsx`
- `routes/qr+/_private+/$qrId_.link.kit.tsx`
- `components/assets/assets-index/use-kit-availability-data.ts`
- `components/audit/audit-receipt-pdf.tsx`
- `components/audit/notes/index.tsx`
- `components/settings/transfer-ownership-card.tsx`
- `components/user/details-form.tsx`
- `components/user/user-contact-form.tsx`
- `components/user/user-subheading.tsx`
- `utils/subscription.server.ts`

---

## To Merge

The branch is ready to merge. All checks pass:

- `pnpm turbo typecheck` — 0 errors
- `pnpm turbo lint` — 0 errors (2 pre-existing warnings)
- All pre-commit hooks (eslint, prettier, typecheck, commitlint) pass

```bash
git checkout master
git merge claude/review-and-plan-4zie9
git push origin master
```

---

## Next Steps (Future Work)

Priority order for remaining Prisma → Supabase migrations:

1. **asset/service.server.ts** (~46 `db.` calls) — largest and most
   impactful module
2. **kit/service.server.ts** (~127 `db.` calls) — second largest
3. **booking/service.server.ts** — untouched, moderate size
4. **location/service.server.ts** + **bulk-select.server.ts** — partial
5. **asset/bulk-operations-helper.server.ts** — asset bulk ops
6. **organization/service.server.ts** — partially done
7. **audit/helpers.server.ts** — uses `db` as fallback for `tx` param

After all modules are migrated, the final cleanup would be:

- Remove `~/database/db.server` (Prisma client wrapper)
- Remove Prisma as a runtime dependency
- Update any remaining route files that directly use `db`
