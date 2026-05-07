import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// @vitest-environment node

/**
 * Contract test: every route under app/routes/api+/mobile+/ must call
 * requireMobileAuth.
 *
 * The mobile prefix (`/api/mobile/:path*`) is in publicPaths in server/index.ts,
 * so cookie-auth is skipped for these routes — `requireMobileAuth` is the only
 * thing standing between an unauthenticated request and a route handler. This
 * test fails fast if a future contributor adds a mobile route without it.
 */
const MOBILE_DIR = path.resolve(__dirname, "../../../app/routes/api+/mobile+");

const ROUTE_FILES = readdirSync(MOBILE_DIR).filter((f) => f.endsWith(".ts"));

describe("mobile route auth contract", () => {
  it("the directory is non-empty (sanity)", () => {
    expect(ROUTE_FILES.length).toBeGreaterThan(0);
  });

  it.each(ROUTE_FILES)(
    "%s imports requireMobileAuth from mobile-auth.server",
    (file) => {
      const src = readFileSync(path.join(MOBILE_DIR, file), "utf8");

      expect(
        src,
        `${file} should import from ~/modules/api/mobile-auth.server`
      ).toMatch(/from ["']~\/modules\/api\/mobile-auth\.server["']/);
      expect(src, `${file} should reference requireMobileAuth`).toMatch(
        /\brequireMobileAuth\b/
      );
    }
  );
});
