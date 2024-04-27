import { vitePlugin as remix } from "@remix-run/dev";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import devServer, { defaultOptions } from "@hono/vite-dev-server";
import esbuild from "esbuild";
import { flatRoutes } from "remix-flat-routes";
import { cjsInterop } from "vite-plugin-cjs-interop";

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
    hmr: {
      overlay: false,
    },
  },
  // https://github.com/remix-run/remix/discussions/8917#discussioncomment-8640023
  optimizeDeps: {
    include: ["./app/routes/**/*"],
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
    devServer({
      injectClientScript: false,
      entry: "server/index.ts", // The file path of your server.
      exclude: [/^\/(app)\/.+/, /^\/@.+$/, /^\/node_modules\/.*/],
    }),
    remix({
      serverBuildFile: "remix.js",
      ignoredRouteFiles: ["**/.*"],
      routes: async (defineRoutes) => {
        return flatRoutes("routes", defineRoutes);
      },
      buildEnd: async () => {
        await esbuild
          .build({
            alias: { "~": "./app" },
            // The final file name
            outfile: "build/server/index.js",
            // Our server entry point
            entryPoints: ["server/index.ts"],
            // Dependencies that should not be bundled
            // We import the remix build from "../build/server/remix.js", so no need to bundle it again
            external: ["./build/server/*"],
            platform: "node",
            format: "esm",
            // Don't include node_modules in the bundle
            packages: "external",
            bundle: true,
            logLevel: "info",
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
