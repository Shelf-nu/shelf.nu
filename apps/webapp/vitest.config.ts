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
