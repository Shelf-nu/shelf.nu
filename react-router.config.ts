import type { Config } from "@react-router/dev/config";
import { flatRoutes } from "remix-flat-routes";
import esbuild from "esbuild";
import fs from "node:fs";

export default {
  ignoredRouteFiles: ["**/.*", "**/*.test.server.ts"],

  async routes(defineRoutes) {
    return flatRoutes("routes", defineRoutes);
  },

  async buildEnd({ buildManifest }) {
    const sentryInstrument = `instrument.server`;
    await esbuild
      .build({
        alias: {
          "~": `./app`,
        },
        outdir: `${buildManifest.serverBundles.serverBundlePath}/..`,
        entryPoints: [`./server/${sentryInstrument}.ts`],
        platform: "node",
        format: "esm",
        packages: "external",
        bundle: true,
        logLevel: "info",
      })
      .then(() => {
        const serverBuildPath = buildManifest.serverBundles.serverBundlePath;
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
