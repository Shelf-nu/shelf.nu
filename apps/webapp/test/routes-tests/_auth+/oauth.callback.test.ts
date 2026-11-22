/**
 * Route tests for the web SSO callback action.
 *
 * A sign-in started at `/sso-login` arrives with a code, which the action
 * trades for the session with this browser's PKCE verifier cookie. A sign-in
 * started from the identity provider's dashboard arrives with tokens: the
 * action first names the account (`identify`), and signs in only once the
 * person confirms (`confirm`), with both tokens belonging to that account.
 *
 * It also reports a login that moved the account onto SSO.
 *
 * When an SSO login is merged onto an existing account, the session Supabase
 * issued belongs to a deleted duplicate and must not be issued. The user signs
 * in once more, so the action reports a success notice, not an error, and sets
 * no session.
 *
 * The action also refuses a session not obtained through SSO before anything
 * is resolved, and takes the IdP groups, names and contact info from the
 * server-side identity lookup, never from the posted form.
 *
 * @see apps/webapp/app/routes/_auth+/oauth.callback.tsx
 * @see apps/webapp/app/utils/sso.server.ts resolveUserAndOrgForSsoCallback
 */
// @vitest-environment node
import { assertIsDataWithResponseInit } from "@helpers/assertions";
import { createActionArgs } from "@mocks/remix";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShelfError } from "~/utils/error";

// why: importing the route pulls the Prisma client transitively; the action's
// database work is behind the mocked services below.
vi.mock("~/database/db.server", () => ({ db: {} }));

// why: pin the SSO kill-switch so the assertions do not depend on DISABLE_SSO
// in the local environment.
vi.mock("~/config/shelf.config", () => ({
  config: {
    disableSSO: false,
    oidc: { enabled: false, buttonLabel: "Log in with SSO" },
  },
}));

// why: refreshAccessToken exchanges the refresh token with Supabase, and
// revokeSession ends a refused session through Supabase Auth.
vi.mock("~/modules/auth/service.server", () => ({
  refreshAccessToken: vi.fn(),
  revokeSession: vi.fn(),
}));

// why: the code exchange and the token lookup call Supabase Auth; their wire
// format is covered by sso-pkce.server.test.ts. The real ssoSignInExpiredError
// stays, because the refusal the route returns is what these tests pin.
vi.mock("~/modules/auth/sso-pkce.server", async () => ({
  ...(await vi.importActual<typeof import("~/modules/auth/sso-pkce.server")>(
    "~/modules/auth/sso-pkce.server"
  )),
  exchangeSsoCode: vi.fn(),
  readTokenAccount: vi.fn(),
}));

// why: where a signed-in person lands depends on their workspaces in the
// database; the cases only need a member of a team workspace.
vi.mock("~/modules/organization/service.server", () => ({
  getUserOrganizations: vi.fn(),
  isSsoUser: vi.fn(),
}));

// why: the resolver provisions users and merges auth accounts, and the claims
// lookup reads auth.identities; both are covered by sso.server.test.ts. The
// real isSsoAccountLinkedError and assertSsoAuthenticatedSession stay, because
// which errors the route treats as a notice, and which sessions it refuses, is
// what these tests pin.
vi.mock("~/utils/sso.server", async () => ({
  ...(await vi.importActual<typeof import("~/utils/sso.server")>(
    "~/utils/sso.server"
  )),
  resolveUserAndOrgForSsoCallback: vi.fn(),
  getSsoClaimsForAuthUser: vi.fn(),
}));

const { action } = await import("~/routes/_auth+/oauth.callback");
const { refreshAccessToken, revokeSession } = await import(
  "~/modules/auth/service.server"
);
const { getSsoClaimsForAuthUser, resolveUserAndOrgForSsoCallback } =
  await import("~/utils/sso.server");
const { exchangeSsoCode, readTokenAccount } = await import(
  "~/modules/auth/sso-pkce.server"
);
const { getUserOrganizations, isSsoUser } = await import(
  "~/modules/organization/service.server"
);
const { ssoCodeVerifierCookie } = await import("~/utils/cookies.server");

/**
 * An unsigned access token whose `amr` claim records `method`. The route reads
 * only the payload, so the header and signature are placeholders.
 */
function accessTokenSignedInBy(method: string) {
  const claims = { amr: [{ method, timestamp: 1 }] };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `header.${payload}.signature`;
}

/** The session Supabase issued for this login. */
const callbackSession = {
  userId: "duplicate-sso-auth-user",
  email: "jane@acme.com",
  accessToken: accessTokenSignedInBy("sso/saml"),
  refreshToken: "callback-refresh",
  expiresIn: 3600,
  expiresAt: 0,
};

/** A well-formed PKCE verifier, as `/sso-login` stores it. */
const VERIFIER = "v".repeat(56);

/**
 * Posts the callback form and runs the action with a session spy.
 *
 * @param fields - the form fields
 * @param cookie - the request's Cookie header, if any
 * @param headers - any further request headers, such as X-Forwarded-For
 */
async function post(
  fields: Record<string, string>,
  cookie?: string,
  headers: Record<string, string> = {}
) {
  const setSession = vi.fn();
  const request = new Request("http://localhost/oauth/callback", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    body: new URLSearchParams(fields),
  });
  const result = await action(
    createActionArgs({ request, context: { setSession } as never })
  );
  return { result, setSession };
}

/**
 * Posts a confirmed dashboard sign-in.
 *
 * @param extraFields - additional form fields, such as a forged `groups`
 */
function postCallback(extraFields: Record<string, string> = {}) {
  return post({
    intent: "confirm",
    accessToken: "fragment-access-token",
    refreshToken: "client-refresh-token",
    redirectTo: "/assets",
    ...extraFields,
  });
}

/** The visitor's address as a self-hosted proxy reports it. */
const VISITOR_IP = "203.0.113.7";

/**
 * Trusts one proxy in front of a self-hosted instance, so the proxy's
 * X-Forwarded-For entry names the visitor. Undone in `afterEach`.
 */
function trustOneProxy() {
  vi.stubEnv("FLY_APP_NAME", "");
  vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
}

/** The Cookie header carrying this browser's verifier. */
async function verifierCookie() {
  const setCookie = await ssoCodeVerifierCookie.serialize(VERIFIER);
  return setCookie.split(";")[0];
}

/** The `Set-Cookie` values of an action result. */
function setCookies(result: unknown) {
  if (result instanceof Response) return result.headers.getSetCookie();
  assertIsDataWithResponseInit(result);
  return new Headers(result.init?.headers).getSetCookie();
}

/** What the SSO identity GoTrue wrote from the SAML assertion carries. */
const identityClaims = {
  groups: ["idp-staff"],
  firstName: "Jane",
  lastName: "Doe",
  contactInfo: {
    phone: "",
    street: "",
    city: "",
    stateProvince: "",
    zipPostalCode: "",
    countryRegion: "",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(refreshAccessToken).mockResolvedValue(callbackSession);
  vi.mocked(getSsoClaimsForAuthUser).mockResolvedValue(identityClaims);
  vi.mocked(exchangeSsoCode).mockResolvedValue(callbackSession);
  vi.mocked(readTokenAccount).mockResolvedValue({
    userId: callbackSession.userId,
    email: callbackSession.email,
  });
  vi.mocked(getUserOrganizations).mockResolvedValue([
    { organization: { type: "TEAM" } },
  ] as never);
  vi.mocked(isSsoUser).mockResolvedValue(true);
  vi.mocked(resolveUserAndOrgForSsoCallback).mockResolvedValue({
    org: null,
  } as never);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /oauth/callback, sign-in started at /sso-login", () => {
  it("trades the code with this browser's verifier, signs in and clears the verifier", async () => {
    const { result, setSession } = await post(
      { intent: "code", code: "auth-code", redirectTo: "/assets" },
      await verifierCookie()
    );

    expect(exchangeSsoCode).toHaveBeenCalledWith({
      code: "auth-code",
      codeVerifier: VERIFIER,
      clientIp: null,
    });
    expect(setSession).toHaveBeenCalledWith(callbackSession);
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).headers.get("Location")).toBe("/assets");
    expect(setCookies(result).join("\n")).toMatch(/sso_code_verifier=;/);
  });

  it("passes the visitor's address to Supabase with the code exchange", async () => {
    // why: a self-hosted instance whose single proxy names the visitor.
    trustOneProxy();

    await post(
      { intent: "code", code: "auth-code", redirectTo: "/assets" },
      await verifierCookie(),
      { "X-Forwarded-For": VISITOR_IP }
    );

    // Supabase counts its per-IP limits against the visitor, not this server.
    expect(exchangeSsoCode).toHaveBeenCalledWith({
      code: "auth-code",
      codeVerifier: VERIFIER,
      clientIp: VISITOR_IP,
    });
  });

  it("passes no verifier when the browser holds none, and signs nobody in", async () => {
    // The real exchange refuses a missing verifier with this error.
    const { ssoSignInExpiredError } = await import(
      "~/modules/auth/sso-pkce.server"
    );
    vi.mocked(exchangeSsoCode).mockRejectedValue(ssoSignInExpiredError());

    const { result, setSession } = await post({
      intent: "code",
      code: "forwarded-code",
    });

    expect(exchangeSsoCode).toHaveBeenCalledWith({
      code: "forwarded-code",
      codeVerifier: null,
      clientIp: null,
    });
    expect(setSession).not.toHaveBeenCalled();
    expect(resolveUserAndOrgForSsoCallback).not.toHaveBeenCalled();
    assertIsDataWithResponseInit(result);
    expect(result.init?.status).toBe(400);
    // A failed exchange spends the verifier too.
    expect(setCookies(result).join("\n")).toMatch(/sso_code_verifier=;/);
  });

  it("clears the verifier when the exchanged sign-in only links the account", async () => {
    vi.mocked(resolveUserAndOrgForSsoCallback).mockRejectedValue(
      new ShelfError({
        cause: null,
        status: 409,
        message: "Your account is now on single sign-on.",
        additionalData: { ssoAccountLinked: true },
        label: "Auth",
        shouldBeCaptured: false,
      })
    );

    const { result } = await post(
      { intent: "code", code: "auth-code" },
      await verifierCookie()
    );

    expect(setCookies(result).join("\n")).toMatch(/sso_code_verifier=;/);
  });

  it("refuses the token-only form a page without the confirmation step would post", async () => {
    const { result, setSession } = await post({
      refreshToken: "client-refresh-token",
      redirectTo: "/assets",
    });

    expect(refreshAccessToken).not.toHaveBeenCalled();
    expect(setSession).not.toHaveBeenCalled();
    assertIsDataWithResponseInit(result);
    expect(result.init?.status).toBe(400);
  });
});

describe("POST /oauth/callback, sign-in started from the identity provider", () => {
  it("names the account for the person to confirm, and signs nobody in yet", async () => {
    const { result, setSession } = await post({
      intent: "identify",
      accessToken: "fragment-access-token",
    });

    expect(readTokenAccount).toHaveBeenCalledWith("fragment-access-token");
    expect(refreshAccessToken).not.toHaveBeenCalled();
    expect(setSession).not.toHaveBeenCalled();
    assertIsDataWithResponseInit(result);
    expect(result.data).toEqual({
      error: null,
      confirmAccount: { email: "jane@acme.com" },
    });
    // A sign-in another tab started at /sso-login keeps its verifier.
    expect(setCookies(result).join("\n")).not.toMatch(/sso_code_verifier/);
  });

  it("signs in once confirmed, when both tokens belong to the named account", async () => {
    const { result, setSession } = await postCallback();

    expect(refreshAccessToken).toHaveBeenCalledWith("client-refresh-token", {
      clientIp: null,
    });
    expect(setSession).toHaveBeenCalledWith(callbackSession);
    expect((result as Response).headers.get("Location")).toBe("/assets");
    expect(setCookies(result).join("\n")).not.toMatch(/sso_code_verifier/);
  });

  it("passes the visitor's address to Supabase with the confirmed refresh", async () => {
    // why: a self-hosted instance whose single proxy names the visitor.
    trustOneProxy();

    await post(
      {
        intent: "confirm",
        accessToken: "fragment-access-token",
        refreshToken: "client-refresh-token",
        redirectTo: "/assets",
      },
      undefined,
      { "X-Forwarded-For": VISITOR_IP }
    );

    expect(refreshAccessToken).toHaveBeenCalledWith("client-refresh-token", {
      clientIp: VISITOR_IP,
    });
  });

  it("refuses a confirmation whose refresh token belongs to another account", async () => {
    vi.mocked(readTokenAccount).mockResolvedValue({
      userId: "someone-else",
      email: "it-support@acme.com",
    });

    const { result, setSession } = await postCallback();

    expect(setSession).not.toHaveBeenCalled();
    expect(resolveUserAndOrgForSsoCallback).not.toHaveBeenCalled();
    assertIsDataWithResponseInit(result);
    expect(result.init?.status).toBe(400);
  });
});

describe("POST /oauth/callback, outcomes", () => {
  it("reports a linked account as a success notice and issues no session", async () => {
    vi.mocked(resolveUserAndOrgForSsoCallback).mockRejectedValue(
      new ShelfError({
        cause: null,
        status: 409,
        message:
          "Your account is now on single sign-on. Sign in again to continue.",
        additionalData: { ssoAccountLinked: true },
        label: "Auth",
        shouldBeCaptured: false,
      })
    );

    const { result, setSession } = await postCallback();

    expect(setSession).not.toHaveBeenCalled();
    assertIsDataWithResponseInit(result);
    // A notice, not a failure: no error payload and no error status.
    expect(result.init?.status ?? 200).toBe(200);
    expect(result.data).toEqual({
      error: null,
      ssoAccountLinked: true,
      message:
        "Your account is now on single sign-on. Sign in again to continue.",
    });
  });

  it("still reports other resolver failures as errors", async () => {
    vi.mocked(resolveUserAndOrgForSsoCallback).mockRejectedValue(
      new ShelfError({
        cause: null,
        status: 409,
        message: "More than one Shelf account uses this email address.",
        label: "Auth",
        shouldBeCaptured: false,
      })
    );

    const { result, setSession } = await postCallback();

    expect(setSession).not.toHaveBeenCalled();
    assertIsDataWithResponseInit(result);
    expect(result.init?.status).toBe(409);
    expect(result.data).toMatchObject({
      error: {
        message: "More than one Shelf account uses this email address.",
      },
    });
    expect(result.data).not.toHaveProperty("ssoAccountLinked");
  });

  it.each(["password", "otp", "magiclink"])(
    "refuses a session signed in by %s before resolving the user",
    async (method) => {
      vi.mocked(refreshAccessToken).mockResolvedValue({
        ...callbackSession,
        accessToken: accessTokenSignedInBy(method),
      });

      const { result, setSession } = await postCallback();

      expect(setSession).not.toHaveBeenCalled();
      expect(resolveUserAndOrgForSsoCallback).not.toHaveBeenCalled();
      expect(getSsoClaimsForAuthUser).not.toHaveBeenCalled();
      expect(revokeSession).toHaveBeenCalledWith(accessTokenSignedInBy(method));
      assertIsDataWithResponseInit(result);
      expect(result.init?.status).toBe(403);
      expect(result.data).toMatchObject({
        error: {
          message: "Please sign in with your organization's single sign-on.",
        },
      });
    }
  );

  it("passes the claims read from the SSO identity, ignoring any posted ones", async () => {
    vi.mocked(resolveUserAndOrgForSsoCallback).mockRejectedValue(
      new ShelfError({
        cause: null,
        status: 409,
        message: "stop after the resolver call",
        label: "Auth",
        shouldBeCaptured: false,
      })
    );

    await postCallback({
      groups: JSON.stringify(["Shelf-Owners"]),
      firstName: "Mallory",
      lastName: "Forged",
      phone: "000",
    });

    expect(getSsoClaimsForAuthUser).toHaveBeenCalledWith({
      authUserId: callbackSession.userId,
      email: callbackSession.email,
    });
    expect(revokeSession).not.toHaveBeenCalled();
    expect(resolveUserAndOrgForSsoCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        groups: ["idp-staff"],
        firstName: "Jane",
        lastName: "Doe",
        contactInfo: identityClaims.contactInfo,
      })
    );
  });
});
