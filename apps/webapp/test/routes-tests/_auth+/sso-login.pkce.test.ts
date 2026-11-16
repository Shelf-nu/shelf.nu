/**
 * Route tests for PKCE on the SSO start.
 *
 * Every sign-in started here keeps its Supabase code verifier in this
 * browser's `sso_code_verifier` cookie, so only this browser can finish it.
 *
 * The native callback hands the authorization code back over the `shelf://`
 * custom scheme, which any app on the device may claim. PKCE is the only thing
 * that makes an intercepted code useless, so a mobile start without a
 * well-formed challenge must be refused rather than allowed to proceed unbound.
 *
 * @see apps/webapp/app/routes/_auth+/sso-login.tsx
 * @see apps/webapp/app/modules/auth/mobile-sso.server.ts — the redemption half
 */
// @vitest-environment node
import { assertIsDataWithResponseInit } from "@helpers/assertions";
import { createActionArgs, createLoaderArgs } from "@mocks/remix";
import { Browser } from "happy-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mobilePkceChallengeCookie,
  ssoCodeVerifierCookie,
} from "~/utils/cookies.server";

// why: importing the route pulls the Prisma client transitively; without this
// the suite emits an unhandled P1001 trying to reach a database it never uses.
vi.mock("~/database/db.server", () => ({ db: {} }));

// why: the loader reads shelf.config for the SSO kill-switch; pinning it keeps
// these assertions independent of DISABLE_SSO in the local environment.
vi.mock("~/config/shelf.config", () => ({
  config: { disableSSO: false },
}));

/** The default SSO domain the loader reads; empty unless a case sets one. */
const ssoEnv = vi.hoisted(() => ({ defaultDomain: "" }));

// why: a default SSO domain short-circuits the web branch to the identity
// provider; each case picks whether the instance has one.
vi.mock("~/utils/env", async () => ({
  ...(await vi.importActual<typeof import("~/utils/env")>("~/utils/env")),
  get DEFAULT_SSO_DOMAIN() {
    return ssoEnv.defaultDomain;
  },
}));

// why: starting a sign-in calls Supabase Auth; its wire format is covered by
// sso-pkce.server.test.ts.
vi.mock("~/modules/auth/sso-pkce.server", () => ({
  startSsoSignIn: vi.fn().mockResolvedValue({
    url: "https://idp.example.com/saml",
    codeVerifier: "v".repeat(56),
  }),
}));

const { action, loader } = await import("~/routes/_auth+/sso-login");
const { startSsoSignIn } = await import("~/modules/auth/sso-pkce.server");

afterEach(() => {
  ssoEnv.defaultDomain = "";
  vi.mocked(startSsoSignIn).mockClear();
});

/**
 * Which of the given URLs a browser holding this `Set-Cookie` sends the
 * verifier to, using a real browser cookie jar rather than a hand-set header.
 *
 * @param setCookie - The `Set-Cookie` value the response carried
 * @param urls - The URLs to check
 * @returns The URLs the verifier is sent to
 */
async function urlsCarryingVerifier(setCookie: string, urls: string[]) {
  // document.cookie cannot write HttpOnly; path matching is the same without it.
  const browserCookie = setCookie
    .split(";")
    .filter((part) => !/httponly/i.test(part))
    .join(";");
  const browser = new Browser();
  try {
    const page = browser.newPage();
    page.url = "http://localhost/sso-login";
    page.mainFrame.document.cookie = browserCookie;
    return urls.filter((url) =>
      browser.defaultContext.cookieContainer
        .getCookies(new URL(url), false)
        .some((cookie) => cookie.key === "sso_code_verifier")
    );
  } finally {
    await browser.close();
  }
}

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

/**
 * Invokes the loader for a query expected to be refused, and returns what it
 * threw so the caller can assert on the status.
 *
 * @param query - The query string to append to `/sso-login`
 * @returns The thrown value
 * @throws If the loader resolved instead of refusing
 */
async function invokeExpectingRefusal(query: string) {
  try {
    await invoke(query);
  } catch (thrown) {
    return thrown;
  }
  throw new Error(`Expected "${query}" to be refused`);
}

describe("GET /sso-login — PKCE requirement", () => {
  it("refuses a mobile start with no challenge", async () => {
    const thrown = await invokeExpectingRefusal("?platform=mobile");
    // The loader converts its ShelfError through `data()`, so the status lives
    // on `init` — the thrown value is a DataWithResponseInit, not a Response.
    // Asserting it pins the refusal to PKCE rather than to any stray failure.
    assertIsDataWithResponseInit(thrown);
    expect(thrown.init?.status).toBe(400);
  });

  it("refuses a mobile start with a malformed challenge", async () => {
    for (const bad of [
      "short",
      "a".repeat(42),
      "a".repeat(44),
      "!".repeat(43),
    ]) {
      const thrown = await invokeExpectingRefusal(
        `?platform=mobile&code_challenge=${bad}`
      );
      assertIsDataWithResponseInit(thrown);
      expect(thrown.init?.status).toBe(400);
    }
  });

  it("accepts a mobile start carrying a well-formed challenge", async () => {
    const result = await invoke(
      `?platform=mobile&code_challenge=${VALID_CHALLENGE}`
    );
    assertIsDataWithResponseInit(result);

    const setCookie = new Headers(result.init?.headers).get("set-cookie");
    expect(setCookie).toContain("mobile_pkce_challenge=");
    // `createCookie` stores base64-encoded JSON, so the challenge is never
    // literal in the header — read it back through the cookie's own decoder.
    await expect(mobilePkceChallengeCookie.parse(setCookie)).resolves.toBe(
      VALID_CHALLENGE
    );
  });

  it("leaves the web flow untouched — no challenge required", async () => {
    // Only the native custom-scheme callback needs PKCE; the web flow returns
    // its session over a cookie and must keep working without one.
    const result = await invoke("");
    expect(result).toBeDefined();
  });
});

describe("POST /sso-login", () => {
  it.each(["web", "mobile"] as const)(
    "sends a %s sign-in to the identity provider and keeps the verifier in this browser",
    async (platform) => {
      const request = new Request("http://localhost/sso-login", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ domain: "acme.com", platform }),
      });

      const result = await action(createActionArgs({ request }));

      expect(startSsoSignIn).toHaveBeenCalledWith("acme.com", { platform });
      expect(result).toBeInstanceOf(Response);
      const response = result as Response;
      expect(response.headers.get("Location")).toBe(
        "https://idp.example.com/saml"
      );
      const setCookie = response.headers.get("set-cookie");
      expect(setCookie).toContain("HttpOnly");
      await expect(ssoCodeVerifierCookie.parse(setCookie)).resolves.toBe(
        "v".repeat(56)
      );
    }
  );
});

describe("the verifier cookie", () => {
  it("reaches the URLs the callback pages post to, and stays off the rest of the app", async () => {
    const setCookie = await ssoCodeVerifierCookie.serialize("v".repeat(56));

    // The callback pages post through React Router, to `<path>.data`.
    await expect(
      urlsCarryingVerifier(setCookie, [
        "http://localhost/oauth/callback.data",
        "http://localhost/oauth/callback/mobile.data",
        "http://localhost/oauth/callback",
        "http://localhost/assets",
        "http://localhost/sso-login",
      ])
    ).resolves.toEqual([
      "http://localhost/oauth/callback.data",
      "http://localhost/oauth/callback/mobile.data",
      "http://localhost/oauth/callback",
    ]);
  });
});

describe("GET /sso-login with a default SSO domain", () => {
  it("sends the browser to the identity provider and keeps the verifier", async () => {
    ssoEnv.defaultDomain = "acme.com";

    const result = await invoke("");

    expect(startSsoSignIn).toHaveBeenCalledWith("acme.com");
    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.headers.get("Location")).toBe(
      "https://idp.example.com/saml"
    );
    await expect(
      ssoCodeVerifierCookie.parse(response.headers.get("set-cookie"))
    ).resolves.toBe("v".repeat(56));
  });

  it("still lets the companion app start its own sign-in", async () => {
    ssoEnv.defaultDomain = "acme.com";

    const result = await invoke(
      `?platform=mobile&code_challenge=${VALID_CHALLENGE}`
    );

    expect(startSsoSignIn).not.toHaveBeenCalled();
    assertIsDataWithResponseInit(result);
  });
});
