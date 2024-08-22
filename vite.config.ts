import { vitePlugin as remix } from "@remix-run/dev";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
// import devServer, { defaultOptions } from "@hono/vite-dev-server";
import { devServer } from "react-router-hono-server/dev";
import esbuild from "esbuild";
import { flatRoutes } from "remix-flat-routes";
import { cjsInterop } from "vite-plugin-cjs-interop";
import { init } from "@paralleldrive/cuid2";

const createHash = init({
  length: 8,
});

const buildHash = process.env.BUILD_HASH || createHash();

export default defineConfig({
  server: {
    port: 3000,
    // https: {
    //   key: "./server/dev/key.pem",
    //   cert: "./server/dev/cert.pem",
    // },
    // https://github.com/remix-run/remix/discussions/8917#discussioncomment-8640023
    warmup: {
      clientFiles: [
        "./app/entry.client.tsx",
        "./app/root.tsx",
        "./app/routes/**/*",
      ],
    },
  },
  // https://github.com/remix-run/remix/discussions/8917#discussioncomment-8640023
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
  plugins: [
    cjsInterop({
      // List of CJS dependencies that require interop
      dependencies: [
        "react-microsoft-clarity",
        "@markdoc/markdoc",
        "react-to-print",
      ],
    }),
    devServer(),
    //   {
    //   injectClientScript: false,
    //   entry: "server/index.ts", // The file path of your server.
    //   exclude: [/^\/(app)\/.+/, /^\/@.+$/, /^\/node_modules\/.*/],
    // }
    remix({
      ignoredRouteFiles: ["**/.*"],
      future: {
        // unstable_fogOfWar: true,
        // unstable_singleFetch: true,
      },
      routes: async (defineRoutes) => {
        return flatRoutes("routes", defineRoutes);
      },
      // buildEnd: async () => {
      //   await esbuild
      //     .build({
      //       alias: {
      //         "~": "./app",
      //       },
      //       // The final file name
      //       outdir: "build/server",
      //       // Our server entry point
      //       entryPoints: ["./app/instrument.server.ts"],
      //       // Dependencies that should not be bundled
      //       // We import the remix build from "../build/server/remix.js", and the sentry build from "../build/server/instrument.server.js", so no need to bundle it again
      //       external: ["./instrument.server.js"],
      //       platform: "node",
      //       format: "esm",
      //       // Don't include node_modules in the bundle
      //       packages: "external",
      //       bundle: true,
      //       logLevel: "info",
      //     })
      //     .catch((error: unknown) => {
      //       console.error(error);
      //       process.exit(1);
      //     });
      // },
    }),
    tsconfigPaths(),
  ],
});
