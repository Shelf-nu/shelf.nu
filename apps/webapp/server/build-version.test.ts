/**
 * Tests for the build version endpoint.
 *
 * @see {@link file://./build-version.ts}
 */
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { BUILD_VERSION_PATH, buildVersion } from "./build-version";

/** Mirrors `server/index.ts`: the endpoint sits in front of a catch-all that redirects to login. */
function createApp() {
  const app = new Hono();
  app.get(BUILD_VERSION_PATH, buildVersion());
  app.use("*", (c) => Promise.resolve(c.redirect("/login")));
  return app;
}

describe("buildVersion", () => {
  it("answers with this build's id as uncacheable JSON, without reaching auth", async () => {
    const response = await createApp().request(BUILD_VERSION_PATH);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toContain("application/json");
    // `vitest.config.ts` injects "test" as the build id.
    await expect(response.json()).resolves.toEqual({ buildId: "test" });
  });

  it("leaves every other path to the rest of the app", async () => {
    const response = await createApp().request("/assets");

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/login");
  });
});
