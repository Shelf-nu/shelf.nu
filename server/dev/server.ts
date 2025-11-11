// This server is only used to load the dev server build
const viteDevServer =
  process.env.NODE_ENV === "production"
    ? undefined
    : await import("vite").then((vite) =>
        vite.createServer({
          server: { middlewareMode: true },
          appType: "custom",
        })
      );

/**
 * Load the dev server build and force reload it
 * @returns An up to date server build
 */
export async function importDevBuild() {
  return viteDevServer?.ssrLoadModule('virtual:react-router/server-build');
}
