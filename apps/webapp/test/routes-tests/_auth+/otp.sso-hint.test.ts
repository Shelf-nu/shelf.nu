// @vitest-environment node
/**
 * The code entry page: the "use Login with SSO" hint.
 *
 * An address that must use SSO is sent no code, and the send answers as if it
 * were. The page tells everyone on an SSO domain where to go instead. The hint
 * depends only on the domain of the address in the URL, never on an account.
 *
 * @see {@link file://./../../../app/routes/_auth+/otp.tsx}
 * @see {@link file://./../../../app/modules/auth/sso-enforcement.server.ts} isSsoDomainEmail
 */
import type { LoaderFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "~/database/db.server";
import { loader } from "~/routes/_auth+/otp";
import type * as EnvModule from "~/utils/env";
import { checkDomainSSOStatus } from "~/utils/sso.server";

// why: the domain check reads auth.sso_domains; each test sets whether the
// domain is configured for SSO.
vi.mock("~/utils/sso.server", () => ({
  checkDomainSSOStatus: vi.fn(),
}));

// why: importing the route loads ~/database/db.server, whose module-level
// connect rejects in a DB-less env. The account lookup is a spy so the tests
// can prove the hint never reads the account.
vi.mock("~/database/db.server", () => ({
  db: { user: { findMany: vi.fn() } },
}));

// why: code verification is a Supabase call the loader never makes.
vi.mock("~/modules/auth/service.server", () => ({
  verifyOtpAndSignin: vi.fn(),
}));

// why: the action's account creation and workspace selection reach the
// database; the loader uses neither.
vi.mock("~/modules/user/service.server", () => ({
  createUser: vi.fn(),
  findUserById: vi.fn(),
}));
vi.mock("~/modules/user/utils.server", () => ({
  generateUniqueUsername: vi.fn(),
}));
vi.mock("~/modules/organization/context.server", () => ({
  getSelectedOrganization: vi.fn(),
  setSelectedOrganizationIdCookie: vi.fn(),
}));

// why: DISABLE_SSO is read from the environment at import time; pinned so the
// result does not depend on the machine running the tests.
vi.mock("~/utils/env", async (importOriginal) => {
  const actual = await importOriginal<typeof EnvModule>();
  return { ...actual, DISABLE_SSO: false };
});

/** Loads the code page for `email`. */
async function load(email: string | null) {
  const query = email
    ? `?email=${encodeURIComponent(email)}&mode=login`
    : "?mode=login";
  return (await loader({
    request: new Request(`http://localhost:3000/otp${query}`),
    context: { isAuthenticated: false },
    params: {},
  } as unknown as LoaderFunctionArgs)) as { ssoDomainHint: boolean };
}

/** Sets whether the address's domain is configured for SSO. */
function givenDomainIsSso(isConfiguredForSSO: boolean) {
  vi.mocked(checkDomainSSOStatus).mockResolvedValue({
    isConfiguredForSSO,
    linkedOrganizations: [],
    ssoProviderId: isConfiguredForSSO ? "provider-1" : null,
  });
}

describe("otp loader: SSO domain hint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    givenDomainIsSso(false);
  });

  it("is true for an address on an SSO domain", async () => {
    givenDomainIsSso(true);

    const result = await load("member@sso-corp.com");

    expect(result.ssoDomainHint).toBe(true);
    expect(db.user.findMany).not.toHaveBeenCalled();
  });

  it("is false for an address on any other domain", async () => {
    const result = await load("someone@example.com");

    expect(result.ssoDomainHint).toBe(false);
  });

  it("is false without a lookup when the URL carries no valid address", async () => {
    const result = await load(null);

    expect(result.ssoDomainHint).toBe(false);
    expect(checkDomainSSOStatus).not.toHaveBeenCalled();
  });

  it("is false when the domain lookup fails", async () => {
    vi.mocked(checkDomainSSOStatus).mockRejectedValue(
      new Error("database unavailable")
    );

    const result = await load("member@sso-corp.com");

    expect(result.ssoDomainHint).toBe(false);
  });
});
