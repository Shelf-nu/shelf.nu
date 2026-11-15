/**
 * Route tests for the custom OIDC login start: where the loader sends the
 * browser, and that it is closed while no provider is configured.
 *
 * @see apps/webapp/app/routes/_auth+/oidc-login.tsx
 * @see apps/webapp/app/modules/auth/oidc.server.ts getOidcAuthorizeUrl
 */
import { assertIsDataWithResponseInit } from "@helpers/assertions";
import { createLoaderArgs } from "@mocks/remix";
import { beforeEach, describe, expect, it, vi } from "vitest";

// why: importing the route pulls the Prisma client transitively; the loader
// reads no database.
vi.mock("~/database/db.server", () => ({ db: {} }));

// why: the provider is switched per test, independent of the OIDC_* variables
// of the local environment.
const oidcEnv = vi.hoisted(() => ({ provider: "custom:acme" }));
vi.mock("~/utils/env", async () => ({
  ...(await vi.importActual<typeof import("~/utils/env")>("~/utils/env")),
  get OIDC_PROVIDER() {
    return oidcEnv.provider;
  },
  OIDC_SCOPES: "",
  SERVER_URL: "https://shelf.example.com",
  SUPABASE_URL: "https://auth.example.com",
}));

const { loader } = await import("~/routes/_auth+/oidc-login");

/**
 * Invokes the loader.
 *
 * @param query - query string appended to `/oidc-login`
 * @param isAuthenticated - whether the browser already holds a session
 */
function invoke(query = "", isAuthenticated = false) {
  return loader(
    createLoaderArgs({
      request: new Request(`http://localhost/oidc-login${query}`),
      context: { isAuthenticated } as never,
    })
  );
}

beforeEach(() => {
  oidcEnv.provider = "custom:acme";
});

describe("GET /oidc-login", () => {
  it("redirects to the provider through Supabase", () => {
    const response = invoke();

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("Location") ?? "");
    expect(location.origin + location.pathname).toBe(
      "https://auth.example.com/auth/v1/authorize"
    );
    expect(location.searchParams.get("provider")).toBe("custom:acme");
    expect(location.searchParams.get("redirect_to")).toBe(
      "https://shelf.example.com/oauth/callback"
    );
    // No scopes configured: the ones stored on the provider apply.
    expect(location.searchParams.has("scopes")).toBe(false);
  });

  it("sends a browser that is already signed in to the app", () => {
    const response = invoke("", true);

    expect(response.headers.get("Location")).toBe("/");
  });

  it("still starts the native-app flow for a browser with a web session", () => {
    const response = invoke("?platform=mobile", true);

    const location = new URL(response.headers.get("Location") ?? "");
    expect(location.searchParams.get("redirect_to")).toBe(
      "https://shelf.example.com/oauth/callback/mobile"
    );
  });

  it("answers 404 while no provider is configured", () => {
    oidcEnv.provider = "";

    try {
      invoke();
    } catch (thrown) {
      assertIsDataWithResponseInit(thrown);
      expect(thrown.init?.status).toBe(404);
      return;
    }
    throw new Error("Expected the loader to refuse");
  });
});
