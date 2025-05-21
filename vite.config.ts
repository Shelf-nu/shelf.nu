import { paraglideVitePlugin } from '@inlang/paraglide-js'
import { vitePlugin as remix } from "@remix-run/dev";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { devServer } from "react-router-hono-server/dev";
import esbuild from "esbuild";
import { flatRoutes } from "remix-flat-routes";
import { cjsInterop } from "vite-plugin-cjs-interop";
import { init } from "@paralleldrive/cuid2";
import fs from "node:fs";

const createHash = init({
  length: 8,
});

const buildHash = process.env.BUILD_HASH || createHash();

export default defineConfig({
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
        "./app/routes/**/*",
      ],
    },
  },
  optimizeDeps: {
    include: ["./app/routes/**/*"],
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
      ".prisma/client/index-browser":
        "./node_modules/.prisma/client/index-browser.js",
    },
  },
  plugins: [paraglideVitePlugin({ project: './project.inlang', outdir: './app/paraglide', strategy: ["preferredLanguage", "cookie", "baseLocale"] }),
  cjsInterop({
    // List of CJS dependencies that require interop
    dependencies: [
      "react-microsoft-clarity",
      "@markdoc/markdoc",
      "react-to-print",
    ],
  }),
  devServer(),

  remix({
    ignoredRouteFiles: ["**/.*"],
    future: {
      // unstable_optimizeDeps: true,
    },
    routes: async (defineRoutes) => {
      return flatRoutes("routes", defineRoutes);
    },

    buildEnd: async ({ remixConfig }) => {
      const sentryInstrument = `instrument.server`;
      await esbuild
        .build({
          alias: {
            "~": `./app`,
          },
          outdir: `${remixConfig.buildDirectory}/server`,
          entryPoints: [`./server/${sentryInstrument}.ts`],
          platform: "node",
          format: "esm",
          // Don't include node_modules in the bundle
          packages: "external",
          bundle: true,
          logLevel: "info",
        })
        .then(() => {
          const serverBuildPath = `${remixConfig.buildDirectory}/server/${remixConfig.serverBuildFile}`;
          fs.writeFileSync(
            serverBuildPath,
            Buffer.concat([
              Buffer.from(`import "./${sentryInstrument}.js"\n`),
              Buffer.from(fs.readFileSync(serverBuildPath)),
            ])
          );
        })
        .catch((error: unknown) => {
          console.error(error);
          process.exit(1);
        });
    },
  }),
  tsconfigPaths(),
  ],
});
