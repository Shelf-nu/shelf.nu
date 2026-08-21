/**
 * Route tests for the PKCE requirement on the native SSO start.
 *
 * The native callback hands the authorization code back over the `shelf://`
 * custom scheme, which any app on the device may claim. PKCE is the only thing
 * that makes an intercepted code useless, so a mobile start without a
 * well-formed challenge must be refused rather than allowed to proceed unbound.
 *
 * @see apps/webapp/app/routes/_auth+/sso-login.tsx
 * @see apps/webapp/app/modules/auth/mobile-sso.server.ts — the redemption half
 */
import { createLoaderArgs } from "@mocks/remix";
import { describe, expect, it, vi } from "vitest";

// why: importing the route pulls the Prisma client transitively; without this
// the suite emits an unhandled P1001 trying to reach a database it never uses.
vi.mock("~/database/db.server", () => ({ db: {} }));

// why: the loader reads shelf.config for the SSO kill-switch; pinning it keeps
// these assertions independent of DISABLE_SSO in the local environment.
vi.mock("~/config/shelf.config", () => ({
  config: { disableSSO: false },
}));

// why: a default SSO domain would short-circuit the web branch and change what
// the non-mobile assertions exercise.
vi.mock("~/utils/env", async () => ({
  ...(await vi.importActual<typeof import("~/utils/env")>("~/utils/env")),
  DEFAULT_SSO_DOMAIN: "",
}));

const { loader } = await import("~/routes/_auth+/sso-login");

/** A well-formed S256 challenge: 43 chars of base64url. */
const VALID_CHALLENGE = "a".repeat(43);

/** Invokes the loader for a given query string. */
function invoke(query: string) {
  return loader(
    createLoaderArgs({
      request: new Request(`http://localhost/sso-login${query}`),
      context: { isAuthenticated: false } as never,
    })
  );
}

describe("GET /sso-login — PKCE requirement", () => {
  it("refuses a mobile start with no challenge", async () => {
    await expect(invoke("?platform=mobile")).rejects.toBeDefined();
  });

  it("refuses a mobile start with a malformed challenge", async () => {
    for (const bad of [
      "short",
      "a".repeat(42),
      "a".repeat(44),
      "!".repeat(43),
    ]) {
      await expect(
        invoke(`?platform=mobile&code_challenge=${bad}`)
      ).rejects.toBeDefined();
    }
  });

  it("accepts a mobile start carrying a well-formed challenge", async () => {
    const result = await invoke(
      `?platform=mobile&code_challenge=${VALID_CHALLENGE}`
    );
    expect(result).toBeDefined();
  });

  it("leaves the web flow untouched — no challenge required", async () => {
    // Only the native custom-scheme callback needs PKCE; the web flow returns
    // its session over a cookie and must keep working without one.
    const result = await invoke("");
    expect(result).toBeDefined();
  });
});
