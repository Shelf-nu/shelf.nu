/**
 * Real-database test global setup
 *
 * Runs once before the `*.db.test.ts` suite (see `vitest.db.config.ts`):
 *
 * 1. Refuses to continue unless the database named in `TEST_DATABASE_URL`
 *    ends in `_test`, so the suite can never migrate or write to a dev or
 *    production database.
 * 2. Creates the `anon` and `authenticated` roles when missing. Supabase
 *    provides them; plain Postgres does not. Migrations grant and revoke on
 *    these roles, which fails when a role is absent, so the setup creates
 *    them first.
 * 3. Applies every migration with `prisma migrate deploy`, using the
 *    `@shelf/database` package's Prisma binary and schema. `DATABASE_URL`
 *    and `DIRECT_URL` point at the test database for that child process
 *    only.
 *
 * @see {@link file://./client.ts} `readTestDatabaseUrl` holds the name guard.
 */

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { PrismaClient } from "@shelf/database";

import { readTestDatabaseUrl } from "./client";

/** `packages/database`, resolved from this file's location in the repo. */
const DATABASE_PACKAGE_DIR = fileURLToPath(
  new URL("../../../../packages/database/", import.meta.url)
);

/**
 * Creates the Supabase API roles when the database does not have them.
 *
 * @param url - Validated test database URL.
 */
async function ensureSupabaseRoles(url: string): Promise<void> {
  const client = new PrismaClient({ datasourceUrl: url });
  try {
    await client.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
          CREATE ROLE anon NOLOGIN;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
          CREATE ROLE authenticated NOLOGIN;
        END IF;
      END
      $$;
    `);
  } finally {
    await client.$disconnect();
  }
}

/**
 * Applies all migrations to the test database.
 *
 * Runs from `packages/database` so its `prisma.config.ts` is used. That config
 * loads the root `.env` through dotenv, which never overrides a variable that
 * is already set, so the URLs passed here win.
 *
 * @param url - Validated test database URL.
 */
function migrate(url: string): void {
  const prismaBin = `${DATABASE_PACKAGE_DIR}node_modules/.bin/prisma`;
  const schemaPath = `${DATABASE_PACKAGE_DIR}prisma/schema.prisma`;
  execFileSync(prismaBin, ["migrate", "deploy", "--schema", schemaPath], {
    cwd: DATABASE_PACKAGE_DIR,
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
  });
}

/**
 * Vitest global setup entry point.
 *
 * @throws {Error} When `TEST_DATABASE_URL` is missing or does not name a
 *   `*_test` database, or when role creation or migration fails.
 */
export default async function setup(): Promise<void> {
  const url = readTestDatabaseUrl();
  await ensureSupabaseRoles(url);
  migrate(url);
}
