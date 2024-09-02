import { Prisma, PrismaClient } from "@prisma/client";

import { NODE_ENV } from "../utils/env";

export type ExtendedPrismaClient = ReturnType<typeof getNewPrismaClient>;

let db: ExtendedPrismaClient;

declare global {
  // eslint-disable-next-line no-var
  var __db__: ExtendedPrismaClient;
}

/** Extending prisma client for dynamic findMany */
function getNewPrismaClient() {
  return new PrismaClient().$extends({
    model: {
      $allModels: {
        dynamicFindMany<T>(this: T, options: Prisma.Args<T, "findMany">) {
          const ctx = Prisma.getExtensionContext(this) as any;
          return ctx.findMany(options);
        },
      },
    },
  });
}

// this is needed because in development we don't want to restart
// the server with every change, but we want to make sure we don't
// create a new connection to the DB with every change either.
// in production, we'll have a single connection to the DB.
if (NODE_ENV === "production") {
  db = getNewPrismaClient();
} else {
  if (!global.__db__) {
    global.__db__ = getNewPrismaClient();
  }
  db = global.__db__;
  void db.$connect();
}

export { db };
