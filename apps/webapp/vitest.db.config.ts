/**
 * Vitest config for real-database tests (`*.db.test.ts`).
 *
 * Kept separate from `vitest.config.ts`, which excludes these files: they need
 * a migrated PostgreSQL database named by `TEST_DATABASE_URL` (the name must
 * end in `_test`). Run with `pnpm webapp:test:db`. CI runs them in the
 * "Database tests" job of `.github/workflows/test.yml`.
 *
 * Files run one at a time because they share one database and some tests
 * commit rows.
 *
 * @see {@link file://./test/db/global-setup.ts} guard, roles and migrations.
 * @see {@link file://./test/db/client.ts} client and transaction helpers.
 */

import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

/** Test database URL, when set. The global setup rejects a missing one. */
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

export default defineConfig({
  plugins: [tsconfigPaths({ projects: ["./tsconfig.json"] })],
  test: {
    environment: "node",
    include: ["test/db/**/*.db.test.ts"],
    globalSetup: ["./test/db/global-setup.ts"],
    // Placeholder app env plus DATABASE_URL/DIRECT_URL set to the validated
    // TEST_DATABASE_URL, so app modules can be imported in every worker.
    setupFiles: ["./test/db/setup-env.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Any module that reaches the app's own `db` client connects to the test
    // database too, never to the developer's `.env` database.
    env: testDatabaseUrl
      ? { DATABASE_URL: testDatabaseUrl, DIRECT_URL: testDatabaseUrl }
      : {},
  },
});
