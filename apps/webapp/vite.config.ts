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

export default defineConfig({
  envDir: "../..",
  ssr: {
    noExternal: ["@shelf/database"],
  },
  server: {
    port: 3000,
    https: {
      key: "./.cert/key.pem",
      cert: "./.cert/cert.pem",
    },
    warmup: {
      clientFiles: [
        "./app/entry.client.tsx",
        "./app/root.tsx",
        "./app/routes/**/*.tsx",
        "./app/routes/**/*.ts",
        "!./app/routes/**/*.test.server.ts",
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
