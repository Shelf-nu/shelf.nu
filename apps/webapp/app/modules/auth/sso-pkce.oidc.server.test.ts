/**
 * Starting a custom OIDC sign-in with PKCE: the URL Shelf sends the browser to
 * and the verifier it keeps for the callback.
 *
 * The real Supabase client builds the URL; starting an OAuth sign-in makes no
 * request, so nothing needs answering. Only the provider configuration is
 * pinned.
 *
 * @see {@link file://./sso-pkce.server.ts} startOidcSignIn
 */
// @vitest-environment node
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as EnvModule from "~/utils/env";
import { SERVER_URL, SUPABASE_URL } from "~/utils/env";
import { isCodeVerifier, startOidcSignIn } from "./sso-pkce.server";

// why: the provider is switched per test, independent of the OIDC_* variables
// of the local environment; every other value stays real.
const oidcEnv = vi.hoisted(() => ({ provider: "custom:acme", scopes: "" }));
vi.mock("~/utils/env", async (importOriginal) => ({
  ...(await importOriginal<typeof EnvModule>()),
  get OIDC_PROVIDER() {
    return oidcEnv.provider;
  },
  get OIDC_SCOPES() {
    return oidcEnv.scopes;
  },
}));

/** S256 as RFC 7636 defines it: base64url(SHA-256(verifier)). */
function s256(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

beforeEach(() => {
  oidcEnv.provider = "custom:acme";
  oidcEnv.scopes = "";
});

describe("startOidcSignIn", () => {
  it("sends the browser to the provider with a S256 challenge of the verifier it hands back", async () => {
    const { url, codeVerifier } = await startOidcSignIn();

    expect(isCodeVerifier(codeVerifier)).toBe(true);
    const location = new URL(url);
    expect(location.origin + location.pathname).toBe(
      `${SUPABASE_URL.replace(/\/+$/, "")}/auth/v1/authorize`
    );
    expect(location.searchParams.get("provider")).toBe("custom:acme");
    expect(location.searchParams.get("redirect_to")).toBe(
      `${SERVER_URL}/oauth/callback`
    );
    expect(location.searchParams.get("code_challenge")).toBe(
      s256(codeVerifier)
    );
    expect(location.searchParams.get("code_challenge_method")).toBe("s256");
    // No scopes configured: the ones stored on the provider apply.
    expect(location.searchParams.has("scopes")).toBe(false);
  });

  it("requests the configured scopes", async () => {
    oidcEnv.scopes = "openid profile email groups";

    const { url } = await startOidcSignIn();

    expect(new URL(url).searchParams.get("scopes")).toBe(
      "openid profile email groups"
    );
  });

  it("lands a mobile sign-in on the native-app callback", async () => {
    const { url } = await startOidcSignIn({ platform: "mobile" });

    expect(new URL(url).searchParams.get("redirect_to")).toBe(
      `${SERVER_URL}/oauth/callback/mobile`
    );
  });

  it("starts every sign-in with a fresh verifier", async () => {
    const first = await startOidcSignIn();
    const second = await startOidcSignIn();

    expect(first.codeVerifier).not.toBe(second.codeVerifier);
  });

  it("answers 404 while no provider is configured", async () => {
    oidcEnv.provider = "";

    await expect(startOidcSignIn()).rejects.toMatchObject({
      status: 404,
      shouldBeCaptured: false,
    });
  });
});
