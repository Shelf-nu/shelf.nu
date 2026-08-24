// Re-export the database client factory and types
export { createDatabaseClient } from "./client";
export type { ExtendedPrismaClient } from "./client";

// Re-export the transient-error retry wrapper so consumers can extend retry to
// the raw escapes (`$queryRaw` / `$executeRaw`) that the auto-applied client
// extension does not cover. See `withPrismaRetry` in ./client.
export { withPrismaRetry } from "./client";

// Re-export all Prisma types and enums so consumers don't need @prisma/client directly
export { Prisma, PrismaClient } from "@prisma/client";
export type * from "@prisma/client";
