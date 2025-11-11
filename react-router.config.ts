import type { Config } from "@react-router/dev/config";
import { flatRoutes } from "remix-flat-routes";
import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";

export default {
  async routes(defineRoutes) {
    return flatRoutes("routes", defineRoutes, {
      ignoredRouteFiles: ["**/.*", "**/*.test.server.ts"],
    });
  },

  async buildEnd({ buildManifest }) {
    if (!buildManifest) {
      console.warn(
        "No build manifest available, skipping Sentry instrumentation"
      );
      return;
    }

    const sentryInstrument = `instrument.server`;
    const buildDir = path.dirname(
      buildManifest.serverBundles?.[Object.keys(buildManifest.serverBundles)[0]]
        ?.file || "build/server"
    );

    await esbuild
      .build({
        alias: {
          "~": `./app`,
        },
        outdir: buildDir,
        entryPoints: [`./server/${sentryInstrument}.ts`],
        platform: "node",
        format: "esm",
        packages: "external",
        bundle: true,
        logLevel: "info",
      })
      .then(() => {
        // Get the main server bundle file
        const serverBundles = buildManifest.serverBundles || {};
        const mainBundleId = Object.keys(serverBundles)[0];
        if (!mainBundleId) {
          console.warn("No server bundle found, skipping Sentry injection");
          return;
        }

        const serverBuildPath = path.join(
          process.cwd(),
          serverBundles[mainBundleId].file
        );
        const serverBuildContent = fs.readFileSync(serverBuildPath);

        fs.writeFileSync(
          serverBuildPath,
          Buffer.concat([
            Buffer.from(`import "./${sentryInstrument}.js"\n`),
            serverBuildContent,
          ])
        );
      })
      .catch((error: unknown) => {
        console.error("Failed to build Sentry instrumentation:", error);
        process.exit(1);
      });
  },
} satisfies Config;
