// Re-export the database client factory and types
export { createDatabaseClient } from "./client";
export type { ExtendedPrismaClient } from "./client";

// Re-export all Prisma types and enums so consumers don't need @prisma/client directly
export { Prisma, PrismaClient } from "@prisma/client";
export type * from "@prisma/client";

// Supabase client factory and types (new — used during incremental migration)
export { createSupabaseClient } from "./supabase-client";
export type {
  TypedSupabaseClient,
  CreateSupabaseClientOptions,
} from "./supabase-client";

// Supabase database types derived from the SQL schema.
// Namespaced to avoid conflicts with Prisma types during coexistence.
export type { Database } from "./types";
export * as Sb from "./types";
