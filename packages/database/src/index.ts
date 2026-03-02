// Re-export the database client factory and types
export { createDatabaseClient } from "./client";
export type { ExtendedPrismaClient } from "./client";

// Re-export all Prisma types and enums so consumers don't need @prisma/client directly
export { Prisma, PrismaClient } from "@prisma/client";
export type * from "@prisma/client";
