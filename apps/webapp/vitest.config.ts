/// <reference types="vitest" />
/// <reference types="vite/client" />

import { defineConfig } from "vite";
import type { UserConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { configDefaults } from "vitest/config";

export default defineConfig({
  plugins: [
    react(),
    // Only the webapp's own tsconfig defines the aliases tests use (`~/*`,
    // `@factories`, `@mocks`). Pointing the plugin at it stops it crawling
    // every tsconfig in the monorepo.
    tsconfigPaths({ projects: ["./tsconfig.json"] }),
  ],
  test: {
    globals: true,
    environment: "happy-dom",
    setupFiles: ["./test/setup-test-env.ts"],
    // Route tests import whole route modules inside `beforeAll`, and
    // `pnpm webapp:validate` runs this suite beside lint and typecheck. Under
    // that load a cold route import can outlast Vitest's 10-second hook
    // default. Tests keep the default `testTimeout`, so a slow test body still
    // fails fast.
    hookTimeout: 30_000,
    // `vitest --changed` (behind `test:changed` and `validate`) picks tests
    // through the import graph. The CSV and mobile-auth contract tests find
    // their routes with `readdirSync` instead of importing them, so no graph
    // edge links a route edit to them. A change under these globs forces the
    // full suite so those contracts always run. Keep each glob in step with
    // the directory its contract test enumerates, and keep the defaults
    // (package.json, vite/vitest config) — setting this option replaces them.
    forceRerunTriggers: [
      ...configDefaults.forceRerunTriggers,
      // test/routes-tests/csv-download-contract.test.ts
      "**/app/routes/**/*\\[.csv\\].{ts,tsx}",
      // test/routes-tests/api+/mobile-auth-contract.test.ts
      "**/app/routes/api+/mobile+/**",
    ],
    // Route tests live in `test/routes-tests/`, NEVER under `app/routes/` —
    // the dev server warms every file under `app/routes/` as a client module,
    // so a co-located route test importing a `*.server` module breaks
    // `pnpm webapp:dev`. Enforced by `local-rules/no-test-files-in-routes`.
    // Do not name a test `*.test.server.ts`: the pattern below does not match
    // that spelling, so such a file would silently never run.
    include: ["**/*.{test,spec}.?(c|m)[jt]s?(x)"],
    includeSource: ["app/**/*.{js,ts}"],
    exclude: [
      "node_modules",
      "mocks/**/*.{js,ts}",
      "test/e2e/**/*",
      "test/setup-test-env.ts",
      // React Router's typegen mirrors route filenames under .react-router/types,
      // so a route test at `foo.test.ts` produces a generated file with the same
      // name that vitest would otherwise try to run as a test.
      ".react-router/**",
    ],
    coverage: {
      reporter: ["text", "json", "html"],
      include: ["app/**/*.{js,ts}"],
      all: true,
    },
  },
} as UserConfig);
