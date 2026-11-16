// @vitest-environment node
/**
 * Where the sign-in routes send a member who did not ask for a page.
 *
 * Password login, the SSO callback and the SSO start page all fall back to
 * `/`, never to a fixed page. `/` picks the landing page from the member's
 * role (`/bookings` for a Manager, `/assets` for an Owner or Administrator),
 * so a fixed fallback here would land every role on the same page. An
 * explicit `redirectTo` still wins.
 *
 * @see {@link file://./../../../app/routes/_auth+/login.tsx}
 * @see {@link file://./../../../app/routes/_auth+/oauth.callback.tsx}
 * @see {@link file://./../../../app/routes/_auth+/sso-login.tsx}
 * @see {@link file://./../../../app/routes/_index.tsx} the per-role landing
 */
import { createActionArgs, createLoaderArgs } from "@mocks/remix";
import { beforeEach, describe, expect, it, vi } from "vitest";

// why: importing the routes pulls the Prisma client transitively; every
// database read the redirects depend on is behind the mocked services below.
vi.mock("~/database/db.server", () => ({ db: {} }));

// why: pin the SSO kill-switch so the assertions do not depend on DISABLE_SSO
// in the local environment.
vi.mock("~/config/shelf.config", () => ({
  config: { disableSSO: false, disableSignup: false },
}));

// why: a default SSO domain would short-circuit the SSO start page before the
// signed-in check these tests exercise.
vi.mock("~/utils/env", async () => ({
  ...(await vi.importActual<typeof import("~/utils/env")>("~/utils/env")),
  DEFAULT_SSO_DOMAIN: "",
  DISABLE_SSO: false,
}));

// why: signing in and refreshing a session are Supabase calls. The message
// constant stays real so the login route matches what the service throws.
vi.mock("~/modules/auth/service.server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/modules/auth/service.server")>();
  return {
    INVALID_CREDENTIALS_MESSAGE: actual.INVALID_CREDENTIALS_MESSAGE,
    signInWithEmail: vi.fn(),
    refreshAccessToken: vi.fn(),
    revokeSession: vi.fn(),
  };
});

// why: the resolver provisions users and the claims lookup reads
// auth.identities; both are covered by sso.server.test.ts. The real
// assertSsoAuthenticatedSession stays, so the callback still only accepts an
// SSO session.
vi.mock("~/utils/sso.server", async () => ({
  ...(await vi.importActual<typeof import("~/utils/sso.server")>(
    "~/utils/sso.server"
  )),
  resolveUserAndOrgForSsoCallback: vi.fn(),
  getSsoClaimsForAuthUser: vi.fn(),
}));

// why: the selected workspace is read from the session cookie and the
// database; the cookie it sets is not what these tests pin.
vi.mock("~/modules/organization/context.server", () => ({
  getSelectedOrganization: vi.fn(),
  setSelectedOrganizationIdCookie: vi.fn(),
}));

const login = await import("~/routes/_auth+/login");
const oauthCallback = await import("~/routes/_auth+/oauth.callback");
const ssoLogin = await import("~/routes/_auth+/sso-login");
const { signInWithEmail, refreshAccessToken } = await import(
  "~/modules/auth/service.server"
);
const { getSsoClaimsForAuthUser, resolveUserAndOrgForSsoCallback } =
  await import("~/utils/sso.server");
const { getSelectedOrganization, setSelectedOrganizationIdCookie } =
  await import("~/modules/organization/context.server");

/**
 * An unsigned access token whose `amr` claim records an SSO sign-in. The
 * callback reads only the payload, so the header and signature are
 * placeholders.
 */
const SSO_ACCESS_TOKEN = `header.${Buffer.from(
  JSON.stringify({ amr: [{ method: "sso/saml", timestamp: 1 }] })
).toString("base64url")}.signature`;

/** The session Supabase hands back for a successful sign-in. */
const authSession = {
  userId: "user-1",
  email: "manager@acme.com",
  accessToken: SSO_ACCESS_TOKEN,
  refreshToken: "refresh-token",
  expiresIn: 3600,
  expiresAt: 0,
};

/** A signed-in browser that is not the mobile app. */
const signedIn = { isAuthenticated: true } as never;

/**
 * Reads where a redirect response points.
 *
 * @param result - What the loader or action returned
 * @returns The `Location` header
 */
function locationOf(result: unknown) {
  return (result as Response).headers.get("Location");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(setSelectedOrganizationIdCookie).mockResolvedValue(
    "selected-organization-id=org-1; Path=/"
  );
});

describe("already signed in", () => {
  it("the login page sends the member to /", () => {
    const result = login.loader(
      createLoaderArgs({
        request: new Request("http://localhost/login"),
        context: signedIn,
      })
    );

    expect(locationOf(result)).toBe("/");
  });

  it("the SSO callback page sends the member to /", () => {
    const result = oauthCallback.loader(
      createLoaderArgs({
        request: new Request("http://localhost/oauth/callback"),
        context: signedIn,
      })
    );

    expect(locationOf(result)).toBe("/");
  });

  it("the SSO start page sends the member to /", async () => {
    const result = await ssoLogin.loader(
      createLoaderArgs({
        request: new Request("http://localhost/sso-login"),
        context: signedIn,
      })
    );

    expect(locationOf(result)).toBe("/");
  });
});

describe("password login", () => {
  /**
   * Posts the login form with a correct password.
   *
   * @param redirectTo - The page the sign-in link asked for, if any
   */
  async function postLogin(redirectTo?: string) {
    vi.mocked(signInWithEmail).mockResolvedValue(authSession as never);
    vi.mocked(getSelectedOrganization).mockResolvedValue({
      organizationId: "org-1",
    } as never);

    return login.action(
      createActionArgs({
        request: new Request("http://localhost/login", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            email: "manager@acme.com",
            password: "correct-password",
            ...(redirectTo ? { redirectTo } : {}),
          }),
        }),
        context: { isAuthenticated: false, setSession: vi.fn() } as never,
      })
    );
  }

  it("sends the member to / when the link asked for no page", async () => {
    expect(locationOf(await postLogin())).toBe("/");
  });

  it("keeps the page the link asked for", async () => {
    expect(locationOf(await postLogin("/bookings/booking-1"))).toBe(
      "/bookings/booking-1"
    );
  });
});

describe("SSO callback", () => {
  /**
   * Posts the callback form for a member the resolver placed in a workspace.
   *
   * @param redirectTo - The page the sign-in link asked for, if any
   */
  async function postCallback(redirectTo?: string) {
    vi.mocked(refreshAccessToken).mockResolvedValue(authSession);
    vi.mocked(getSsoClaimsForAuthUser).mockResolvedValue({
      groups: ["idp-managers"],
      firstName: "Mia",
      lastName: "Manager",
      contactInfo: {
        phone: "",
        street: "",
        city: "",
        stateProvince: "",
        zipPostalCode: "",
        countryRegion: "",
      },
    });
    vi.mocked(resolveUserAndOrgForSsoCallback).mockResolvedValue({
      org: { id: "org-1" },
    } as never);

    return oauthCallback.action(
      createActionArgs({
        request: new Request("http://localhost/oauth/callback", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            refreshToken: "client-refresh-token",
            ...(redirectTo ? { redirectTo } : {}),
          }),
        }),
        context: { setSession: vi.fn() } as never,
      })
    );
  }

  it("sends the member to / when the link asked for no page", async () => {
    expect(locationOf(await postCallback())).toBe("/");
  });

  it("keeps the page the link asked for", async () => {
    expect(locationOf(await postCallback("/audits"))).toBe("/audits");
  });
});
