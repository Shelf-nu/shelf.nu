import { Prisma, PrismaClient } from "@prisma/client";

import { delay } from "../utils/delay";
import { NODE_ENV } from "../utils/env";
import { Logger } from "../utils/logger";

export type ExtendedPrismaClient = ReturnType<typeof getNewPrismaClient>;

let db: ExtendedPrismaClient;

declare global {
  // eslint-disable-next-line no-var
  var __db__: ExtendedPrismaClient;
}

const PRISMA_TRANSIENT_CODES = new Set([
  "P2024", // Timed out fetching a new connection from the connection pool
  "P1001", // Can't reach database server
  "P1002", // The database server was reached but timed out
  "P1008", // Operations timed out
  "P1017", // Server has closed the connection
]);

function isPrismaRetryableError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string" &&
    PRISMA_TRANSIENT_CODES.has((error as { code: string }).code)
  );
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
                if (isPrismaRetryableError(error) && attempt <= MAX_RETRIES) {
                  const delayMs = BASE_DELAY_MS * attempt;
                  Logger.warn(
                    `Prisma transient error (attempt ${attempt}/${
                      MAX_RETRIES + 1
                    }), retrying in ${delayMs}ms...`
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
