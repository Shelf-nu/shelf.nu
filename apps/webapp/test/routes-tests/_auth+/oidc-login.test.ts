/**
 * Route tests for the custom OIDC login start: where the loader sends the
 * browser, that it keeps the PKCE verifier for the callback, and that it is
 * closed while no provider is configured.
 *
 * The real `startOidcSignIn` runs: starting an OAuth sign-in makes no request
 * to Supabase.
 *
 * @see apps/webapp/app/routes/_auth+/oidc-login.tsx
 * @see apps/webapp/app/modules/auth/sso-pkce.server.ts startOidcSignIn
 */
// Node, not the default DOM environment: a DOM `Response` hides `Set-Cookie`,
// and these tests read the verifier cookie the loader sets.
// @vitest-environment node
import { createHash } from "node:crypto";
import { assertIsDataWithResponseInit } from "@helpers/assertions";
import { createLoaderArgs } from "@mocks/remix";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ssoCodeVerifierCookie } from "~/utils/cookies.server";

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
 * Invokes the loader and returns what it answered.
 *
 * @param query - query string appended to `/oidc-login`
 * @param isAuthenticated - whether the browser already holds a session
 */
async function invoke(query = "", isAuthenticated = false) {
  return (await loader(
    createLoaderArgs({
      request: new Request(`http://localhost/oidc-login${query}`),
      context: { isAuthenticated } as never,
    })
  )) as Response;
}

beforeEach(() => {
  oidcEnv.provider = "custom:acme";
});

describe("GET /oidc-login", () => {
  it("redirects to the provider through Supabase and keeps the verifier", async () => {
    const response = await invoke();

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("Location") ?? "");
    expect(location.origin + location.pathname).toBe(
      "https://auth.example.com/auth/v1/authorize"
    );
    expect(location.searchParams.get("provider")).toBe("custom:acme");
    expect(location.searchParams.get("redirect_to")).toBe(
      "https://shelf.example.com/oauth/callback"
    );

    // The callback can only exchange the code with this browser's verifier,
    // so the challenge sent to Supabase must be the S256 hash of the one kept.
    const verifier: unknown = await ssoCodeVerifierCookie.parse(
      response.headers.get("Set-Cookie")
    );
    expect(typeof verifier).toBe("string");
    expect(location.searchParams.get("code_challenge")).toBe(
      createHash("sha256")
        .update(verifier as string)
        .digest("base64url")
    );
    expect(location.searchParams.get("code_challenge_method")).toBe("s256");
  });

  it("sends a browser that is already signed in to the app", async () => {
    const response = await invoke("", true);

    expect(response.headers.get("Location")).toBe("/");
    expect(response.headers.get("Set-Cookie")).toBeNull();
  });

  it("still starts the native-app flow for a browser with a web session", async () => {
    const response = await invoke("?platform=mobile", true);

    const location = new URL(response.headers.get("Location") ?? "");
    expect(location.searchParams.get("redirect_to")).toBe(
      "https://shelf.example.com/oauth/callback/mobile"
    );
  });

  it("answers 404 while no provider is configured", async () => {
    oidcEnv.provider = "";

    const thrown = await invoke().then(
      () => {
        throw new Error("Expected the loader to refuse");
      },
      (cause: unknown) => cause
    );

    assertIsDataWithResponseInit(thrown);
    expect(thrown.init?.status).toBe(404);
  });
});
