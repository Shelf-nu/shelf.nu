import { Prisma, PrismaClient } from "@prisma/client";

export type ExtendedPrismaClient = ReturnType<typeof createDatabaseClient>;

/**
 * Creates a new PrismaClient instance with custom extensions.
 * Each app should create its own singleton using this factory.
 */
export function createDatabaseClient(url?: string) {
  const client = new PrismaClient(
    url ? { datasourceUrl: url } : undefined
  ).$extends({
    model: {
      $allModels: {
        dynamicFindMany<T>(this: T, options: Prisma.Args<T, "findMany">) {
          const ctx = Prisma.getExtensionContext(this) as any;
          return ctx.findMany(options);
        },
      },
    },
  });

  return client;
}
