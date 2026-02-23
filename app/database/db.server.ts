import { Prisma, PrismaClient } from "@prisma/client";

import { delay } from "../utils/delay";
import { NODE_ENV } from "../utils/env";
import { isPrismaTransientError } from "../utils/error";
import { Logger } from "../utils/logger";

export type ExtendedPrismaClient = ReturnType<typeof getNewPrismaClient>;

let db: ExtendedPrismaClient;

declare global {
  // eslint-disable-next-line no-var
  var __db__: ExtendedPrismaClient;
}

const MAX_RETRIES = 2;
const BASE_DELAY_MS = 500;

/** Extending prisma client for dynamic findMany and transient error retry */
function getNewPrismaClient() {
  return new PrismaClient()
    .$extends({
      model: {
        $allModels: {
          dynamicFindMany<T>(this: T, options: Prisma.Args<T, "findMany">) {
            const ctx = Prisma.getExtensionContext(this) as any;
            return ctx.findMany(options);
          },
        },
      },
    })
    .$extends({
      query: {
        $allModels: {
          async $allOperations({ args, query }) {
            for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
              try {
                return await query(args);
              } catch (error) {
                if (isPrismaTransientError(error) && attempt <= MAX_RETRIES) {
                  const delayMs = BASE_DELAY_MS * attempt;
                  Logger.warn(
                    `Prisma transient error [${
                      (error as { code: string }).code
                    }] (attempt ${attempt}/${
                      MAX_RETRIES + 1
                    }), retrying in ${delayMs}ms: ${
                      error instanceof Error ? error.message : "unknown"
                    }`
                  );
                  await delay(delayMs);
                  continue;
                }
                throw error;
              }
            }
            // TypeScript: unreachable, but satisfies return type
            throw new Error("Retry loop exited unexpectedly");
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
