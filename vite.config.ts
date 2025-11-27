import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { reactRouterHonoServer } from "react-router-hono-server/dev";
import { cjsInterop } from "vite-plugin-cjs-interop";
import { init } from "@paralleldrive/cuid2";

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
      ".prisma/client/index-browser":
        "./node_modules/.prisma/client/index-browser.js",
      // Use lottie_light version to avoid eval warnings
      "lottie-web": "lottie-web/build/player/lottie_light.js",
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
    reactRouterHonoServer({
      serverEntryPoint: "./server/index.ts",
    }),
    reactRouter(),
    tsconfigPaths(),
  ],
});
