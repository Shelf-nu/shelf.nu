import type { Config } from "@react-router/dev/config";
import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";

export default {
  ssr: true,
  future: {
    v8_viteEnvironmentApi: true,
    // Explicitly opt out of the remaining pre-v8 future flags so the 7.16+
    // build/typegen don't emit "unadopted future flag" console warnings.
    // `v8_middleware` and `v8_splitRouteModules` are the two that currently
    // warn; the other two are set for completeness. Flip any of these to
    // `true` deliberately as part of the eventual v8 migration.
    v8_middleware: false,
    v8_splitRouteModules: false,
    // The `unstable_trailingSlashAwareDataRequests` flag stabilized
    // as `v8_trailingSlashAwareDataRequests` in @react-router/dev
    // 7.16's later patches — the runtime config loader throws when
    // it sees the `unstable_` name now. `v8_passThroughRequests`
    // stayed dropped from `FutureConfig`, so only this one remains.
    v8_trailingSlashAwareDataRequests: false,
  },
  buildEnd: async ({ reactRouterConfig }) => {
    const sentryInstrument = `instrument.server`;
    await esbuild
      .build({
        alias: {
          "~": `./app`,
        },
        outdir: `${reactRouterConfig.buildDirectory}/server`,
        entryPoints: [`./server/${sentryInstrument}.ts`],
        platform: "node",
        format: "esm",
        // Don't include node_modules in the bundle
        packages: "external",
        bundle: true,
        logLevel: "info",
      })
      .then(() => {
        const serverBuildPath = `${reactRouterConfig.buildDirectory}/server/${reactRouterConfig.serverBuildFile}`;
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
} satisfies Config;
