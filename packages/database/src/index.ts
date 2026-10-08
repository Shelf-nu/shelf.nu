// Re-export the database client factory and types
export { createDatabaseClient } from "./client";
export type { ExtendedPrismaClient } from "./client";

// Re-export the transient-error retry wrapper. The client extension already
// retries every operation, raw SQL included; this is for the caller that can
// claim MORE than the extension is able to infer — a raw statement it knows to
// be a pure read. See `withPrismaRetry` in ./client.
export { withPrismaRetry } from "./client";

// Re-export all Prisma types and enums so consumers don't need @prisma/client directly
export { Prisma, PrismaClient } from "@prisma/client";
export type * from "@prisma/client";
