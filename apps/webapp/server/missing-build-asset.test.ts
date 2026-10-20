/**
 * Tests for the missing build asset handler.
 *
 * @see {@link file://./missing-build-asset.ts}
 */
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { BUILD_ASSETS_PATH, missingBuildAsset } from "./missing-build-asset";

/** Mirrors `server/index.ts`: the handler sits in front of a catch-all that redirects to login. */
function createApp() {
  const app = new Hono();
  app.use(BUILD_ASSETS_PATH, missingBuildAsset());
  app.use("*", async (c) => c.redirect("/login"));
  return app;
}

describe("missingBuildAsset", () => {
  it("answers a missing build file with an uncacheable 404 instead of the login redirect", async () => {
    const response = await createApp().request(
      "/file-assets/abc123/chunk-DOESNOTEXIST.js"
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("location")).toBeNull();
  });

  it("leaves every other path to the rest of the app", async () => {
    const response = await createApp().request("/assets");

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/login");
  });
});
