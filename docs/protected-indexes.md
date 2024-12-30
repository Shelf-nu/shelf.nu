# Protected Database Indexes

## Overview

This project maintains certain critical indexes that Prisma attempts to drop during migrations. We have implemented an automated protection system to prevent this from happening.

## Protected Indexes

- `_AssetToBooking_Asset_idx`: Optimizes queries for checking booking availability
- `_AssetToTag_asset_idx`: Optimizes asset filtering by tags

## How It Works

1. When Prisma generates a new migration, our post-migration script automatically removes any DROP INDEX statements for these protected indexes
2. This ensures the indexes remain in place while allowing Prisma migrations to proceed normally

## Important Notes

- Never manually drop these indexes
- If you need to modify these indexes, update the PROTECTED_INDEXES array in `prisma/protected-indexes.ts`
- The protection script runs automatically after `prisma migrate dev` and `prisma migrate deploy`

## Verification

You can verify the indexes exist by running:

```typescript
import { verifyProtectedIndexes } from "./prisma/protected-indexes";
import { prisma } from "./db";

await verifyProtectedIndexes((sql) => prisma.$queryRaw(sql));
```
