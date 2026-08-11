/// <reference types="vitest" />
/// <reference types="vite/client" />

import { defineConfig } from "vite";
import type { UserConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    globals: true,
    environment: "happy-dom",
    setupFiles: ["./test/setup-test-env.ts"],
    // Route tests live in `test/routes-tests/`, NEVER under `app/routes/` —
    // the dev server warms every file under `app/routes/` as a client module,
    // so a co-located route test importing a `*.server` module breaks
    // `pnpm webapp:dev`. Enforced by `local-rules/no-test-files-in-routes`.
    // A `**/*.test.server.[jt]s` pattern used to sit alongside this one for
    // the co-located variant. No `.test.server.*` file remains — route ones
    // moved to `test/routes-tests/`, the single module one was renamed to
    // `.test.ts` — so it is gone. Do NOT reintroduce the spelling: it is not
    // matched by the pattern below, so such a file is silently never run.
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
