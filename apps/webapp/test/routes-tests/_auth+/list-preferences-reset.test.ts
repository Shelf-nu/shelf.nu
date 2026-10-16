// @vitest-environment node
/**
 * Signing out and signing in both forget the list settings this browser kept.
 *
 * The assets, bookings and kits lists remember their filters per workspace in
 * cookies, and `user-prefs` remembers the page size and a few other per-person
 * choices. None of these cookies is tied to an account, so a browser handed to
 * a different person would open their lists with the previous person's
 * filters. Sign-out expires them, and so does every sign-in, which covers a
 * session that ended without a sign-out. A sign-in keeps the person's other UI
 * choices in `user-prefs` and forgets only the page size.
 *
 * @see {@link file://./../../../app/routes/_auth+/logout.tsx}
 * @see {@link file://./../../../app/routes/_auth+/login.tsx}
 * @see {@link file://./../../../app/routes/_auth+/oauth.callback.tsx}
 * @see {@link file://./../../../app/utils/cookies.server.ts} expireListPreferenceCookies
 */
import { createActionArgs } from "@mocks/remix";
import { beforeEach, describe, expect, it, vi } from "vitest";

// why: importing the routes pulls the Prisma client transitively; every
// database read the actions depend on is behind the mocked services below.
vi.mock("~/database/db.server", () => ({ db: {} }));

// why: pin the SSO kill-switch so the callback runs whatever DISABLE_SSO is
// set to locally.
vi.mock("~/config/shelf.config", () => ({
  config: { disableSSO: false, disableSignup: false },
}));

// why: signing in and refreshing a session are Supabase calls.
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
// auth.identities; both are covered by sso.server.test.ts.
vi.mock("~/utils/sso.server", async () => ({
  ...(await vi.importActual<typeof import("~/utils/sso.server")>(
    "~/utils/sso.server"
  )),
  resolveUserAndOrgForSsoCallback: vi.fn(),
  getSsoClaimsForAuthUser: vi.fn(),
}));

// why: the selected workspace is read from the session cookie and the
// database; its own cookie is not what these tests pin.
vi.mock("~/modules/organization/context.server", () => ({
  getSelectedOrganization: vi.fn(),
  setSelectedOrganizationIdCookie: vi.fn(),
}));

// why: an SSO sign-in without a provisioned workspace reads the person's
// memberships to pick the landing page; the tests pick each answer.
vi.mock("~/modules/organization/service.server", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("~/modules/organization/service.server")
  >()),
  getUserOrganizations: vi.fn(),
  isSsoUser: vi.fn(),
}));

const logout = await import("~/routes/_auth+/logout");
const login = await import("~/routes/_auth+/login");
const oauthCallback = await import("~/routes/_auth+/oauth.callback");
const { signInWithEmail, refreshAccessToken } = await import(
  "~/modules/auth/service.server"
);
const { getSsoClaimsForAuthUser, resolveUserAndOrgForSsoCallback } =
  await import("~/utils/sso.server");
const { getSelectedOrganization, setSelectedOrganizationIdCookie } =
  await import("~/modules/organization/context.server");
const { getUserOrganizations, isSsoUser } = await import(
  "~/modules/organization/service.server"
);

/** What the previous person's browser still carries. */
const LEFTOVER_COOKIES = [
  "org-1_assetFilter_v2=cz1sYXB0b3A%3D",
  "org-1_advancedAssetFilter_v2=cz1sYXB0b3A%3D",
  "org-2_bookingFilter_v2=cz1aWiUyMFRlc3Q%3D",
  "org-2_kitFilter_v2=cz1jYXNl",
  "user-prefs=eyJwZXJQYWdlIjoyfQ%3D%3D",
].join("; ");

/** Cookies that must expire for the next person to start clean. */
const EXPECTED_EXPIRED = [
  "org-1_assetFilter_v2",
  "org-1_advancedAssetFilter_v2",
  "org-2_bookingFilter_v2",
  "org-2_kitFilter_v2",
  "user-prefs",
];

/** An unsigned access token whose `amr` claim records an SSO sign-in. */
const SSO_ACCESS_TOKEN = `header.${Buffer.from(
  JSON.stringify({ amr: [{ method: "sso/saml", timestamp: 1 }] })
).toString("base64url")}.signature`;

/** The session Supabase hands back for a successful sign-in. */
const authSession = {
  userId: "user-1",
  email: "member@example.com",
  accessToken: SSO_ACCESS_TOKEN,
  refreshToken: "refresh-token",
  expiresIn: 3600,
  expiresAt: 0,
};

/**
 * Builds a form POST that carries the leftover cookies.
 *
 * @param url - The auth route to post to
 * @param fields - The form fields
 */
function postWithLeftovers(url: string, fields: Record<string, string>) {
  return new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: LEFTOVER_COOKIES,
    },
    body: new URLSearchParams(fields),
  });
}

/**
 * Lists the cookie names a response expires.
 *
 * @param result - What the action returned
 */
function expiredCookieNames(result: unknown) {
  return (result as Response).headers
    .getSetCookie()
    .filter((value) => /Max-Age=0/i.test(value))
    .map((value) => value.split("=")[0]);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(setSelectedOrganizationIdCookie).mockResolvedValue(
    "selected-organization-id=org-1; Path=/"
  );
  vi.mocked(getSelectedOrganization).mockResolvedValue({
    organizationId: "org-1",
  } as never);
});

describe("signing out", () => {
  it("expires every list filter cookie and the user prefs", async () => {
    const destroySession = vi.fn();

    const result = await logout.action(
      createActionArgs({
        request: postWithLeftovers("http://localhost/logout", {}),
        context: { destroySession } as never,
      })
    );

    expect(destroySession).toHaveBeenCalled();
    expect((result as Response).headers.get("Location")).toBe("/login");
    expect(expiredCookieNames(result)).toEqual(
      expect.arrayContaining(EXPECTED_EXPIRED)
    );
  });
});

describe("signing in", () => {
  it("with a password expires the previous person's list settings", async () => {
    vi.mocked(signInWithEmail).mockResolvedValue(authSession as never);

    const result = await login.action(
      createActionArgs({
        request: postWithLeftovers("http://localhost/login", {
          email: "member@example.com",
          password: "correct-password",
        }),
        context: { isAuthenticated: false, setSession: vi.fn() } as never,
      })
    );

    expect(expiredCookieNames(result)).toEqual(
      expect.arrayContaining(EXPECTED_EXPIRED)
    );
    // The workspace cookie the sign-in sets is still there.
    expect((result as Response).headers.getSetCookie()).toContain(
      "selected-organization-id=org-1; Path=/"
    );
  });

  it("with SSO expires the previous person's list settings", async () => {
    mockSsoClaims();
    vi.mocked(resolveUserAndOrgForSsoCallback).mockResolvedValue({
      org: { id: "org-1" },
    } as never);

    const result = await ssoCallback();

    expect(expiredCookieNames(result)).toEqual(
      expect.arrayContaining(EXPECTED_EXPIRED)
    );
  });

  it("with SSO and no team workspace yet expires them on the way to the pending page", async () => {
    mockSsoClaims();
    vi.mocked(resolveUserAndOrgForSsoCallback).mockResolvedValue({
      org: null,
    } as never);
    vi.mocked(getUserOrganizations).mockResolvedValue([
      { organization: { type: "PERSONAL" } },
    ] as never);
    vi.mocked(isSsoUser).mockResolvedValue(true);

    const result = await ssoCallback();

    expect((result as Response).headers.get("Location")).toBe(
      "/sso-pending-assignment"
    );
    expect(expiredCookieNames(result)).toEqual(
      expect.arrayContaining(EXPECTED_EXPIRED)
    );
  });

  it("with SSO and an existing team workspace expires them on the default landing", async () => {
    mockSsoClaims();
    vi.mocked(resolveUserAndOrgForSsoCallback).mockResolvedValue({
      org: null,
    } as never);
    vi.mocked(getUserOrganizations).mockResolvedValue([
      { organization: { type: "TEAM" } },
    ] as never);
    vi.mocked(isSsoUser).mockResolvedValue(true);

    const result = await ssoCallback();

    expect((result as Response).headers.get("Location")).toBe("/");
    expect(expiredCookieNames(result)).toEqual(
      expect.arrayContaining(EXPECTED_EXPIRED)
    );
  });
});

/** Makes the SSO callback's Supabase refresh and claims lookup succeed. */
function mockSsoClaims() {
  vi.mocked(refreshAccessToken).mockResolvedValue(authSession);
  vi.mocked(getSsoClaimsForAuthUser).mockResolvedValue({
    groups: [],
    firstName: "Sam",
    lastName: "Member",
    contactInfo: {
      phone: "",
      street: "",
      city: "",
      stateProvince: "",
      zipPostalCode: "",
      countryRegion: "",
    },
  });
}

/** Posts the SSO callback from a browser carrying the leftover cookies. */
function ssoCallback() {
  return oauthCallback.action(
    createActionArgs({
      request: postWithLeftovers("http://localhost/oauth/callback", {
        refreshToken: "client-refresh-token",
      }),
      context: { setSession: vi.fn() } as never,
    })
  );
}
