import esbuild from "esbuild";

esbuild
  .build({
    entryPoints: ["./server/instrument.sentry.server.ts"],
    outfile: "./build/server/instrument.server.mjs",
    platform: "node",
    format: "esm",
    target: "es2022",
    bundle: true,
    minify: true,
    logLevel: "info",
  })
  .catch(() => process.exit(1));
