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

/**
 * Routes intentionally exempt from `requireMobileAuth`. These authenticate by a
 * different mechanism and MUST be reviewed individually before being added here.
 *
 * - `exchange.ts`: the mobile SSO token exchange. It is pre-session by design —
 *   the caller has no token yet; the single-use, short-TTL authorization code
 *   from the SSO deeplink IS the credential (see `modules/auth/mobile-sso.server`).
 * - `resolve-server.ts`: multi-server discovery. Pre-session by definition — it
 *   answers "which server should I authenticate against?", so requiring a token
 *   would be circular. Reads nothing per-user: the only input is a domain the
 *   user typed and the only output is a public base URL from a static registry.
 * - `config.ts`: the instance's own self-description (name, public Supabase URL
 *   + anon key, API version). Pre-session for the same reason, and every field
 *   it returns already ships publicly in the web client's `window.env`.
 *
 * All three are read-only, take no user-identifying input, and are covered by
 * the per-IP rate limit on `/api/mobile/*` in `server/index.ts`.
 */
const AUTH_EXEMPT = new Set<string>([
  "exchange.ts",
  "resolve-server.ts",
  "config.ts",
]);

/**
 * Every route file under the mobile directory, at any depth and either
 * extension.
 *
 * Recursive and `.tsx`-inclusive on purpose: a flat `.ts`-only listing makes
 * the exemption set below stop being the only way out of this contract, since
 * a route in a subdirectory or written as `.tsx` would simply not be
 * enumerated — unguarded and unreported. Excludes `.test.` files, which are
 * not routes.
 */
const ROUTE_FILES = readdirSync(MOBILE_DIR, { recursive: true })
  .map((entry) => String(entry))
  .filter(
    (f) =>
      (f.endsWith(".ts") || f.endsWith(".tsx")) &&
      !f.includes(".test.") &&
      !f.includes(".spec.")
  );
const GUARDED_FILES = ROUTE_FILES.filter((f) => !AUTH_EXEMPT.has(f));

describe("mobile route auth contract", () => {
  it("the directory is non-empty (sanity)", () => {
    expect(ROUTE_FILES.length).toBeGreaterThan(0);
  });

  it("exempt routes still exist (catch stale exemptions)", () => {
    for (const exempt of AUTH_EXEMPT) {
      expect(ROUTE_FILES, `${exempt} is exempt but no longer exists`).toContain(
        exempt
      );
    }
  });

  it.each(GUARDED_FILES)(
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
