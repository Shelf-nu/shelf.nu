import type { Config } from "@react-router/dev/config";
import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";

export default {
  ssr: true,
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
