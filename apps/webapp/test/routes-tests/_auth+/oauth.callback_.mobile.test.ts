/**
 * Route tests for how the mobile SSO callback action reports a login that
 * moved the account onto SSO.
 *
 * When an SSO login is merged onto an existing account, the session Supabase
 * issued belongs to a deleted duplicate. No code may be minted for it: the
 * user signs in once more, so the action reports a success notice, not an
 * error.
 *
 * The action trades Supabase's code for the session with this browser's PKCE
 * verifier cookie and accepts nothing else: tokens in the URL fragment (a
 * sign-in the app did not start) are never taken. It also refuses a session
 * not obtained through SSO before anything is resolved, takes the IdP groups,
 * names and contact info from the server-side identity lookup, never from the
 * posted form, and binds the exchanged SSO session to the code it mints.
 *
 * @see apps/webapp/app/routes/_auth+/oauth.callback_.mobile.tsx
 * @see apps/webapp/app/utils/sso.server.ts resolveUserAndOrgForSsoCallback
 */
// @vitest-environment node
import { assertIsDataWithResponseInit } from "@helpers/assertions";
import { createActionArgs } from "@mocks/remix";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ShelfError } from "~/utils/error";

// why: importing the route pulls the Prisma client transitively; the action's
// database work is behind the mocked services below.
vi.mock("~/database/db.server", () => ({ db: {} }));

// why: pin the SSO kill-switch so the assertions do not depend on DISABLE_SSO
// in the local environment.
vi.mock("~/config/shelf.config", () => ({
  config: { disableSSO: false },
}));

// why: revokeSession ends a refused session through Supabase Auth.
vi.mock("~/modules/auth/service.server", () => ({
  refreshAccessToken: vi.fn(),
  revokeSession: vi.fn(),
}));

// why: the code exchange calls Supabase Auth; its wire format is covered by
// sso-pkce.server.test.ts.
vi.mock("~/modules/auth/sso-pkce.server", () => ({
  exchangeSsoCode: vi.fn(),
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

// why: the code is persisted in the database; here only whether one is
// minted, and with which session, matters (its hashing, encryption and PKCE
// binding are covered by mobile-sso.server.test.ts).
vi.mock("~/modules/auth/mobile-sso.server", () => ({
  createMobileAuthCode: vi.fn(),
  deleteExpiredMobileAuthCodes: vi.fn().mockResolvedValue(0),
}));

const { action } = await import("~/routes/_auth+/oauth.callback_.mobile");
const { refreshAccessToken, revokeSession } = await import(
  "~/modules/auth/service.server"
);
const { exchangeSsoCode } = await import("~/modules/auth/sso-pkce.server");
const { ssoCodeVerifierCookie } = await import("~/utils/cookies.server");
const { getSsoClaimsForAuthUser, resolveUserAndOrgForSsoCallback } =
  await import("~/utils/sso.server");
const { createMobileAuthCode } = await import(
  "~/modules/auth/mobile-sso.server"
);

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
 * Posts the callback form, from a browser holding the verifier, and runs the
 * action.
 *
 * @param fields - the form fields; Supabase's code unless given
 */
async function postCallback(
  fields: Record<string, string> = { code: "auth-code" }
) {
  const cookie = (await ssoCodeVerifierCookie.serialize(VERIFIER)).split(
    ";"
  )[0];
  const request = new Request("http://localhost/oauth/callback/mobile", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookie,
    },
    body: new URLSearchParams(fields),
  });
  return action(createActionArgs({ request }));
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
  vi.mocked(exchangeSsoCode).mockResolvedValue(callbackSession);
  vi.mocked(getSsoClaimsForAuthUser).mockResolvedValue(identityClaims);
  vi.mocked(createMobileAuthCode).mockResolvedValue("plain-code");
});

describe("POST /oauth/callback/mobile", () => {
  it("trades Supabase's code with this browser's verifier", async () => {
    vi.mocked(resolveUserAndOrgForSsoCallback).mockResolvedValue({
      user: { id: callbackSession.userId },
    } as Awaited<ReturnType<typeof resolveUserAndOrgForSsoCallback>>);

    const result = await postCallback();

    expect(exchangeSsoCode).toHaveBeenCalledWith({
      code: "auth-code",
      codeVerifier: VERIFIER,
    });
    // Both one-shot cookies are cleared once the code is minted.
    assertIsDataWithResponseInit(result);
    const cleared = new Headers(result.init?.headers).getSetCookie().join("\n");
    expect(cleared).toMatch(/sso_code_verifier=;/);
    expect(cleared).toMatch(/mobile_pkce_challenge=;/);
  });

  it("refuses tokens posted in place of a code", async () => {
    const result = await postCallback({ refreshToken: "client-refresh-token" });

    expect(exchangeSsoCode).not.toHaveBeenCalled();
    expect(refreshAccessToken).not.toHaveBeenCalled();
    expect(createMobileAuthCode).not.toHaveBeenCalled();
    assertIsDataWithResponseInit(result);
    expect(result.init?.status).toBe(400);
  });

  it("binds the exchanged SSO session to the code and returns the deeplink", async () => {
    vi.mocked(resolveUserAndOrgForSsoCallback).mockResolvedValue({
      user: { id: callbackSession.userId },
    } as Awaited<ReturnType<typeof resolveUserAndOrgForSsoCallback>>);

    const result = await postCallback();

    expect(createMobileAuthCode).toHaveBeenCalledWith({
      userId: callbackSession.userId,
      refreshToken: callbackSession.refreshToken,
      codeChallenge: undefined,
    });
    assertIsDataWithResponseInit(result);
    expect(result.data).toMatchObject({
      deeplink: "shelf://auth-callback?code=plain-code",
    });
  });

  it("refuses to mint a code when the sign-in resolved to an account with another id", async () => {
    vi.mocked(resolveUserAndOrgForSsoCallback).mockResolvedValue({
      user: { id: "other-shelf-user" },
    } as Awaited<ReturnType<typeof resolveUserAndOrgForSsoCallback>>);

    const result = await postCallback();

    expect(createMobileAuthCode).not.toHaveBeenCalled();
    assertIsDataWithResponseInit(result);
    expect(result.init?.status).toBe(409);
  });

  it("reports a linked account as a success notice and mints no code", async () => {
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

    const result = await postCallback();

    expect(createMobileAuthCode).not.toHaveBeenCalled();
    assertIsDataWithResponseInit(result);
    expect(result.init?.status ?? 200).toBe(200);
    expect(result.data).toEqual({
      error: null,
      ssoAccountLinked: true,
      message:
        "Your account is now on single sign-on. Sign in again to continue.",
    });
    // Both one-shot cookies are cleared on this exit too.
    const cleared = new Headers(result.init?.headers).getSetCookie().join("\n");
    expect(cleared).toMatch(/mobile_pkce_challenge=;/);
    expect(cleared).toMatch(/sso_code_verifier=;/);
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

    const result = await postCallback();

    assertIsDataWithResponseInit(result);
    expect(result.init?.status).toBe(409);
    expect(result.data).toEqual({
      error: {
        message: "More than one Shelf account uses this email address.",
      },
    });
    const cleared = new Headers(result.init?.headers).getSetCookie().join("\n");
    expect(cleared).toMatch(/mobile_pkce_challenge=;/);
    expect(cleared).toMatch(/sso_code_verifier=;/);
  });

  it.each(["password", "otp", "magiclink"])(
    "refuses a session signed in by %s before resolving the user",
    async (method) => {
      vi.mocked(exchangeSsoCode).mockResolvedValue({
        ...callbackSession,
        accessToken: accessTokenSignedInBy(method),
      });

      const result = await postCallback();

      expect(createMobileAuthCode).not.toHaveBeenCalled();
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
      code: "auth-code",
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
