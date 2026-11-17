/**
 * Tests for the step the SSO callback routes share: which kind of login a
 * session is handled as, and which sessions are refused.
 *
 * @see {@link file://./sso-callback.server.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as SsoModule from "~/utils/sso.server";

// why: importing the module pulls the Prisma client transitively; every
// lookup is behind the mocked functions below.
vi.mock("~/database/db.server", () => ({ db: {} }));

// why: the two SSO methods are switched per test, independent of DISABLE_SSO
// and OIDC_PROVIDER in the local environment.
const ssoConfig = vi.hoisted(() => ({
  disableSSO: false,
  oidc: { enabled: true, buttonLabel: "Log in with Acme" },
}));
vi.mock("~/config/shelf.config", () => ({ config: ssoConfig }));

// why: revokeSession ends a refused session through Supabase Auth.
vi.mock("./service.server", () => ({ revokeSession: vi.fn() }));

// why: the OIDC lookups read auth.identities and provision users; they are
// covered by oidc.server.test.ts. Here we verify when they are used.
vi.mock("./oidc.server", () => ({
  isOidcAuthenticatedSession: vi.fn(),
  getOidcClaimsForAuthUser: vi.fn(),
  resolveUserAndOrgForOidcCallback: vi.fn(),
}));

// why: the SAML resolver and claims lookup are covered by sso.server.test.ts.
// The real assertSsoAuthenticatedSession stays: which sessions are refused is
// what these tests pin.
vi.mock("~/utils/sso.server", async (importOriginal) => ({
  ...(await importOriginal<typeof SsoModule>()),
  getSsoClaimsForAuthUser: vi.fn(),
  resolveUserAndOrgForSsoCallback: vi.fn(),
}));

const { revokeSession } = await import("./service.server");
const {
  getOidcClaimsForAuthUser,
  isOidcAuthenticatedSession,
  resolveUserAndOrgForOidcCallback,
} = await import("./oidc.server");
const { getSsoClaimsForAuthUser, resolveUserAndOrgForSsoCallback } =
  await import("~/utils/sso.server");
const { completeSsoCallback, isAnySsoEnabled } = await import(
  "./sso-callback.server"
);

/**
 * A session whose access token records a sign-in by `method`. Only the token
 * payload is read, so the header and signature are placeholders.
 */
function sessionSignedInBy(method: string) {
  const claims = { amr: [{ method, timestamp: 1 }] };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return {
    userId: "auth-user",
    email: "jane@example.com",
    accessToken: `header.${payload}.signature`,
    refreshToken: "refresh-token",
    expiresIn: 3600,
    expiresAt: 0,
  };
}

const oidcResult = { user: { id: "auth-user" }, org: { id: "org-oidc" } };
const samlResult = { user: { id: "auth-user" }, org: { id: "org-saml" } };

beforeEach(() => {
  vi.resetAllMocks();
  ssoConfig.disableSSO = false;
  ssoConfig.oidc.enabled = true;
  vi.mocked(isOidcAuthenticatedSession).mockResolvedValue(false);
  vi.mocked(getOidcClaimsForAuthUser).mockResolvedValue({
    groups: ["staff"],
    firstName: "Jane",
    lastName: "Doe",
  });
  vi.mocked(resolveUserAndOrgForOidcCallback).mockResolvedValue(
    oidcResult as never
  );
  vi.mocked(getSsoClaimsForAuthUser).mockResolvedValue({
    groups: ["idp-staff"],
    firstName: "Jane",
    lastName: "Doe",
  });
  vi.mocked(resolveUserAndOrgForSsoCallback).mockResolvedValue(
    samlResult as never
  );
});

describe("completeSsoCallback", () => {
  it("completes an OIDC session with the claims of the stored identity", async () => {
    const authSession = sessionSignedInBy("oauth");
    vi.mocked(isOidcAuthenticatedSession).mockResolvedValue(true);

    await expect(completeSsoCallback({ authSession })).resolves.toBe(
      oidcResult
    );

    expect(resolveUserAndOrgForOidcCallback).toHaveBeenCalledWith({
      authSession,
      firstName: "Jane",
      lastName: "Doe",
      groups: ["staff"],
      formatPrefs: undefined,
    });
    expect(resolveUserAndOrgForSsoCallback).not.toHaveBeenCalled();
  });

  it("completes a SAML session through the SAML resolver", async () => {
    const authSession = sessionSignedInBy("sso/saml");

    await expect(completeSsoCallback({ authSession })).resolves.toBe(
      samlResult
    );

    expect(resolveUserAndOrgForSsoCallback).toHaveBeenCalledWith(
      expect.objectContaining({ authSession, groups: ["idp-staff"] })
    );
    expect(resolveUserAndOrgForOidcCallback).not.toHaveBeenCalled();
  });

  it.each(["password", "otp", "magiclink", "oauth"])(
    "refuses and revokes a %s session that is not an OIDC sign-in",
    async (method) => {
      const authSession = sessionSignedInBy(method);

      await expect(completeSsoCallback({ authSession })).rejects.toMatchObject({
        status: 403,
      });

      expect(revokeSession).toHaveBeenCalledWith(authSession.accessToken);
      expect(resolveUserAndOrgForOidcCallback).not.toHaveBeenCalled();
      expect(resolveUserAndOrgForSsoCallback).not.toHaveBeenCalled();
    }
  );

  it("does not ask about OIDC while the custom OIDC login is off", async () => {
    ssoConfig.oidc.enabled = false;

    await completeSsoCallback({ authSession: sessionSignedInBy("sso/saml") });

    expect(isOidcAuthenticatedSession).not.toHaveBeenCalled();
  });

  it("refuses and revokes a SAML session while SAML SSO is disabled", async () => {
    ssoConfig.disableSSO = true;
    const authSession = sessionSignedInBy("sso/saml");

    await expect(completeSsoCallback({ authSession })).rejects.toMatchObject({
      status: 403,
      title: "SSO is disabled",
    });

    expect(revokeSession).toHaveBeenCalledWith(authSession.accessToken);
    expect(resolveUserAndOrgForSsoCallback).not.toHaveBeenCalled();
  });
});

describe("isAnySsoEnabled", () => {
  it("is true while either method is on, false when both are off", () => {
    expect(isAnySsoEnabled()).toBe(true);

    ssoConfig.disableSSO = true;
    expect(isAnySsoEnabled()).toBe(true);

    ssoConfig.oidc.enabled = false;
    expect(isAnySsoEnabled()).toBe(false);

    ssoConfig.disableSSO = false;
    expect(isAnySsoEnabled()).toBe(true);
  });
});
