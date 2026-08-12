import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { createRequire } from "module";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { reactRouterHonoServer } from "react-router-hono-server/dev";
import { cjsInterop } from "vite-plugin-cjs-interop";
import { init } from "@paralleldrive/cuid2";

const require = createRequire(import.meta.url);

const createHash = init({
  length: 8,
});

const buildHash = process.env.BUILD_HASH || createHash();

// Resolve the generated Prisma browser entry that contains enum runtime values.
// In pnpm, .prisma/client lives inside the @prisma/client store directory,
// not at the project root, so we resolve the path dynamically.
const prismaClientDir = dirname(require.resolve("@prisma/client/package.json"));
const prismaClientIndexBrowser = resolve(
  prismaClientDir,
  "../../.prisma/client/index-browser.js"
);

// Fail fast if the Prisma browser bundle is missing. Without it, enums like
// OrganizationRoles silently resolve to `undefined` in the browser at runtime.
if (!existsSync(prismaClientIndexBrowser)) {
  throw new Error(
    `Prisma browser bundle not found at ${prismaClientIndexBrowser}. ` +
      `Run "prisma generate" or check that the .prisma/client path is correct.`
  );
}

// Fail fast when a `workspace:*` dependency has no node_modules link — i.e.
// `pnpm install` has not been run since that package was added. Without this
// check the only symptom is a wall of repeated, easily-missed
// `Failed to resolve import "@shelf/<pkg>"` pre-transform errors that look
// like a Vite/config bug rather than a stale install. Common in long-lived
// git worktrees, which each carry their own node_modules.
const webappPkg = require("./package.json") as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const missingWorkspaceLinks = Object.entries({
  ...webappPkg.dependencies,
  ...webappPkg.devDependencies,
})
  .filter(([, version]) => version.startsWith("workspace:"))
  .map(([name]) => name)
  .filter((name) => !existsSync(resolve(__dirname, "node_modules", name)));

if (missingWorkspaceLinks.length > 0) {
  throw new Error(
    `Missing node_modules link for workspace package(s): ` +
      `${missingWorkspaceLinks.join(", ")}.\n` +
      `Run "pnpm install" from the monorepo root — this checkout was installed ` +
      `before those packages existed.`
  );
}

// Use HTTPS when cert files are present (mkcert / local dev).
// Skip HTTPS with DISABLE_HTTPS=true (e.g. mobile companion testing over LAN).
const certKeyPath = resolve(__dirname, ".cert/key.pem");
const certPath = resolve(__dirname, ".cert/cert.pem");
const httpsConfig =
  process.env.DISABLE_HTTPS !== "true" &&
  existsSync(certKeyPath) &&
  existsSync(certPath)
    ? { key: certKeyPath, cert: certPath }
    : undefined;

export default defineConfig({
  envDir: "../..",
  ssr: {
    noExternal: [
      "@shelf/database",
      "@shelf/datetime",
      "@shelf/labels",
      "@shelf/permissions",
      "@shelf/quantity-control",
    ],
  },
  server: {
    port: 3000,
    https: httpsConfig,
    warmup: {
      // These globs pull files into the CLIENT module graph. Anything under
      // `app/routes/` that is not a route (a test, a fixture) gets warmed too,
      // and if it imports a `*.server` module React Router rejects it with
      // "Server-only module referenced by client" — breaking the dev server
      // even though the file is excluded from the route tree.
      //
      // The negation MUST stay a superset of `ignoredRouteFiles` in
      // `app/routes.ts`. It is defense in depth only: test files are barred
      // from `app/routes/` outright by `local-rules/no-test-files-in-routes`.
      clientFiles: [
        "./app/entry.client.tsx",
        "./app/root.tsx",
        "./app/routes/**/*.tsx",
        "./app/routes/**/*.ts",
        "!./app/routes/**/*.test.*",
        "!./app/routes/**/*.spec.*",
      ],
    },
  },
  optimizeDeps: {
    include: ["./app/routes/**/*.tsx", "./app/routes/**/*.ts"],
  },
  build: {
    target: "ES2022",
    assetsDir: `file-assets`,
    rollupOptions: {
      output: {
        entryFileNames: `file-assets/${buildHash}/[name]-[hash].js`,
        chunkFileNames() {
          return `file-assets/${buildHash}/[name]-[hash].js`;
        },
        assetFileNames() {
          return `file-assets/${buildHash}/[name][extname]`;
        },
      },
    },
  },
  resolve: {
    alias: {
      ".prisma/client/index-browser": prismaClientIndexBrowser,
      // Use lottie_light version to avoid eval warnings
      "lottie-web": "lottie-web/build/player/lottie_light.js",
    },
  },
  plugins: [
    cjsInterop({
      // List of CJS dependencies that require interop
      dependencies: ["react-microsoft-clarity", "@markdoc/markdoc"],
    }),
    reactRouterHonoServer({
      serverEntryPoint: "./server/index.ts",
    }),
    reactRouter(),
    tsconfigPaths(),
  ],
});
