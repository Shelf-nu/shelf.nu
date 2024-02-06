import esbuild from "esbuild";

esbuild
  .build({
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
