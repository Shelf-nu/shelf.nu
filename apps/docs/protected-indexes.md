# Protected Indexes and Foreign Keys

## Overview

Some indexes and foreign keys exist only in hand-written migration SQL, not in
`schema.prisma`. `prisma migrate dev` diffs the schema against the database, sees
those objects as drift, and writes a `DROP` for them into the next generated
migration. Committed as it is, that migration would remove them in production.

`pnpm db:prepare-migration` runs a post-migration script right after Prisma
generates a migration. It strips the drops of every protected object from the
newest migration and prints what it kept.

## Protected indexes

- `_AssetToTag_asset_idx`: optimizes asset filtering by tags

## Protected foreign keys

These columns deliberately have no Prisma `@relation`: adding one pushes the
extended client's generics past TypeScript's instantiation limit (TS2321). The
migration that adds each column creates its foreign key by hand, so the database
keeps the `ON DELETE` behaviour while Prisma does not know the key exists.

| Foreign key                                       | On delete of the target                     |
| ------------------------------------------------- | ------------------------------------------- |
| `AssetModelCustomFieldDefault_customFieldId_fkey` | `CASCADE`: the model's default goes with it |
| `BookingAsset_assetKitId_fkey`                    | `SET NULL`                                  |
| `BookingAsset_bookingModelRequestId_fkey`         | `SET NULL`                                  |
| `BookingAsset_sourceKitId_fkey`                   | `SET NULL`                                  |
| `BookingAsset_sourceLocationId_fkey`              | `SET NULL`                                  |
| `ConsumptionLog_bookingAssetId_fkey`              | `SET NULL`                                  |

## Adding a new one

When a migration creates an index or a foreign key that the schema cannot
describe, add its name to `PROTECTED_INDEXES` or `PROTECTED_FOREIGN_KEYS` in
`packages/database/src/protected-indexes.ts` in the same PR.

For foreign keys this is enforced: `protected-indexes.test.ts` replays the
committed migrations and fails when one leaves a foreign key in the database
that is neither described by `schema.prisma` nor in the list. It also fails when
a listed key no longer exists, or has since been added to the schema.

## Important notes

- The script runs only after `db:prepare-migration` (and its staging variant).
  It does not run on `prisma migrate deploy`, and it only edits the newest
  migration.
- Still read every generated migration before committing it. The script only
  knows the names in its lists.
- Never drop a protected object by hand. To change one, write the migration
  yourself and update the list in the same PR.

The protection was introduced in
[#1546](https://github.com/Shelf-nu/shelf.nu/pull/1546).
