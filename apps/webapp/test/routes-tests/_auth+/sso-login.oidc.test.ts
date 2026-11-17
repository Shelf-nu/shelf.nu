/**
 * Route tests for the SSO login page on a deployment whose only single
 * sign-on method is the custom OIDC login (`DISABLE_SSO` set, `OIDC_PROVIDER`
 * configured): the page stays open for the native-app flow, the web flow skips
 * it, and the SAML domain form is refused.
 *
 * @see apps/webapp/app/routes/_auth+/sso-login.tsx
 * @see apps/webapp/app/routes/_auth+/oidc-login.tsx
 */
import { assertIsDataWithResponseInit } from "@helpers/assertions";
import { createActionArgs, createLoaderArgs } from "@mocks/remix";
import { beforeEach, describe, expect, it, vi } from "vitest";

// why: importing the route pulls the Prisma client transitively; neither the
// loader nor the refused action reads a database.
vi.mock("~/database/db.server", () => ({ db: {} }));

// why: the two SSO methods are switched per test, independent of DISABLE_SSO
// and OIDC_PROVIDER in the local environment.
const ssoConfig = vi.hoisted(() => ({
  disableSSO: true,
  oidc: { enabled: true, buttonLabel: "Log in with Acme" },
}));
vi.mock("~/config/shelf.config", () => ({ config: ssoConfig }));

// why: signInWithSSO asks Supabase for the SAML redirect; a refused form must
// never reach it.
vi.mock("~/modules/auth/service.server", () => ({ signInWithSSO: vi.fn() }));

const { action, loader } = await import("~/routes/_auth+/sso-login");
const { signInWithSSO } = await import("~/modules/auth/service.server");

/** A well-formed S256 challenge: 43 chars of base64url. */
const VALID_CHALLENGE = "a".repeat(43);

/** Invokes the loader for a given query string. */
function invokeLoader(query: string) {
  return loader(
    createLoaderArgs({
      request: new Request(`http://localhost/sso-login${query}`),
      context: { isAuthenticated: false } as never,
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  ssoConfig.disableSSO = true;
  ssoConfig.oidc.enabled = true;
});

describe("GET /sso-login with only the custom OIDC login", () => {
  it("sends the web flow straight to the identity provider", async () => {
    const response = await invokeLoader("");

    expect(response).toBeInstanceOf(Response);
    expect((response as Response).headers.get("Location")).toBe("/oidc-login");
  });

  it("renders the page for the native-app flow, with its PKCE cookie", async () => {
    const result = await invokeLoader(
      `?platform=mobile&code_challenge=${VALID_CHALLENGE}`
    );

    assertIsDataWithResponseInit(result);
    expect(new Headers(result.init?.headers).get("set-cookie")).toContain(
      "mobile_pkce_challenge="
    );
    expect(result.data).toMatchObject({
      disableSSO: true,
      oidc: { enabled: true, buttonLabel: "Log in with Acme" },
    });
  });

  it("is closed when no single sign-on method is on", async () => {
    ssoConfig.oidc.enabled = false;

    try {
      await invokeLoader("");
    } catch (thrown) {
      assertIsDataWithResponseInit(thrown);
      expect(thrown.init?.status).toBe(403);
      return;
    }
    throw new Error("Expected the loader to refuse");
  });
});

describe("POST /sso-login with only the custom OIDC login", () => {
  it("refuses the SAML domain form", async () => {
    const result = await action(
      createActionArgs({
        request: new Request("http://localhost/sso-login", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ domain: "acme.com" }),
        }),
      })
    );

    assertIsDataWithResponseInit(result);
    expect(result.init?.status).toBe(403);
    expect(signInWithSSO).not.toHaveBeenCalled();
  });
});
