import { createDatabaseClient } from "@shelf/database";
import type { ExtendedPrismaClient } from "@shelf/database";

import { NODE_ENV } from "../utils/env";

export type { ExtendedPrismaClient };

let db: ExtendedPrismaClient;

declare global {
  // eslint-disable-next-line no-var
  var __db__: ExtendedPrismaClient;
}

// this is needed because in development we don't want to restart
// the server with every change, but we want to make sure we don't
// create a new connection to the DB with every change either.
// in production, we'll have a single connection to the DB.
if (NODE_ENV === "production") {
  db = createDatabaseClient();
} else {
  if (!global.__db__) {
    global.__db__ = createDatabaseClient();
  }
  db = global.__db__;
  void db.$connect();
}

export { db };
