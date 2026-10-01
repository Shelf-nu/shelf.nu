// @vitest-environment node
/**
 * Tests for the legacy sign-in decision (`getLegacyLoginDecision`), the error a
 * refusal is shown with (`createSsoRequiredError`), and the domain-level hint
 * (`isSsoDomainEmail`): which addresses may use password login, email OTP and
 * password reset, and which must use SSO.
 *
 * @see {@link file://./sso-enforcement.server.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// why: DISABLE_SSO is read from the environment once at import time; the
// getter lets each test switch it without re-importing the module.
const env = vi.hoisted(() => ({ disableSso: false }));
vi.mock("~/utils/env", async (importOriginal) => {
  const actual = await importOriginal<typeof EnvModule>();
  return {
    ...actual,
    get DISABLE_SSO() {
      return env.disableSso;
    },
  };
});

// why: the user lookup and the ownership counts need a database; each test
// sets the rows they return.
vi.mock("~/database/db.server", () => ({
  db: {
    user: { findMany: vi.fn() },
    organization: { count: vi.fn() },
    userOrganization: { count: vi.fn() },
  },
}));

// why: the domain check reads auth.sso_domains; each test sets whether the
// domain is configured for SSO.
vi.mock("~/utils/sso.server", () => ({
  checkDomainSSOStatus: vi.fn(),
}));

import { db } from "~/database/db.server";
import type * as EnvModule from "~/utils/env";
import { ShelfError } from "~/utils/error";
import { checkDomainSSOStatus } from "~/utils/sso.server";
import {
  createSsoRequiredError,
  getLegacyLoginDecision,
  isSsoDomainEmail,
} from "./sso-enforcement.server";

const EMAIL = "jane@acme.com";

/** The account row shape the decision reads. */
type AccountRow = { id: string; email: string; sso: boolean };

const standardUser: AccountRow = { id: "user-1", email: EMAIL, sso: false };

/** Sets the rows the case-insensitive user lookup returns. */
function givenUsers(rows: AccountRow[]) {
  // The mocked client is typed with Prisma's full row payload; the module only
  // selects these three fields.
  vi.mocked(db.user.findMany).mockResolvedValue(
    rows as unknown as Awaited<ReturnType<typeof db.user.findMany>>
  );
}

/** Sets whether the address's domain is configured for SSO. */
function givenDomainIsSso(isConfiguredForSSO: boolean) {
  vi.mocked(checkDomainSSOStatus).mockResolvedValue({
    isConfiguredForSSO,
    linkedOrganizations: [],
    ssoProviderId: isConfiguredForSSO ? "provider-1" : null,
  });
}

/** Sets the two ownership counts behind `userOwnsTeamOrg`. */
function givenOwnership({
  ownedOrgs,
  ownerMemberships,
}: {
  ownedOrgs: number;
  ownerMemberships: number;
}) {
  vi.mocked(db.organization.count).mockResolvedValue(ownedOrgs);
  vi.mocked(db.userOrganization.count).mockResolvedValue(ownerMemberships);
}

beforeEach(() => {
  vi.resetAllMocks();
  env.disableSso = false;
  givenUsers([]);
  givenDomainIsSso(false);
  givenOwnership({ ownedOrgs: 0, ownerMemberships: 0 });
});

describe("getLegacyLoginDecision", () => {
  it("allows everything without any lookup when SSO is disabled", async () => {
    env.disableSso = true;
    givenUsers([{ ...standardUser, sso: true }]);
    givenDomainIsSso(true);

    await expect(getLegacyLoginDecision(EMAIL)).resolves.toEqual({
      allowed: true,
    });
    expect(db.user.findMany).not.toHaveBeenCalled();
    expect(checkDomainSSOStatus).not.toHaveBeenCalled();
  });

  it("refuses a converted SSO account even on a domain without SSO", async () => {
    givenUsers([{ ...standardUser, sso: true }]);
    givenDomainIsSso(false);

    await expect(getLegacyLoginDecision(EMAIL)).resolves.toEqual({
      allowed: false,
      reason: "sso_account",
    });
  });

  it("allows a standard account on a domain without SSO", async () => {
    givenUsers([standardUser]);
    givenDomainIsSso(false);

    await expect(getLegacyLoginDecision(EMAIL)).resolves.toEqual({
      allowed: true,
    });
  });

  it("allows an unknown address on a domain without SSO", async () => {
    givenDomainIsSso(false);

    await expect(getLegacyLoginDecision(EMAIL)).resolves.toEqual({
      allowed: true,
    });
  });

  it("skips the ownership queries when the domain is not configured for SSO", async () => {
    givenUsers([standardUser]);
    givenDomainIsSso(false);

    await getLegacyLoginDecision(EMAIL);

    expect(db.organization.count).not.toHaveBeenCalled();
    expect(db.userOrganization.count).not.toHaveBeenCalled();
  });

  it("refuses an address with no account on an SSO domain", async () => {
    givenDomainIsSso(true);

    await expect(getLegacyLoginDecision(EMAIL)).resolves.toEqual({
      allowed: false,
      reason: "sso_domain",
    });
    expect(db.organization.count).not.toHaveBeenCalled();
  });

  it("allows the owner of a TEAM workspace on an SSO domain", async () => {
    givenUsers([standardUser]);
    givenDomainIsSso(true);
    givenOwnership({ ownedOrgs: 1, ownerMemberships: 0 });

    await expect(getLegacyLoginDecision(EMAIL)).resolves.toEqual({
      allowed: true,
    });
  });

  it("allows a user holding the OWNER role on a TEAM workspace", async () => {
    givenUsers([standardUser]);
    givenDomainIsSso(true);
    givenOwnership({ ownedOrgs: 0, ownerMemberships: 1 });

    await expect(getLegacyLoginDecision(EMAIL)).resolves.toEqual({
      allowed: true,
    });
  });

  it("refuses a standard account that owns no TEAM workspace on an SSO domain", async () => {
    givenUsers([standardUser]);
    givenDomainIsSso(true);
    givenOwnership({ ownedOrgs: 0, ownerMemberships: 0 });

    await expect(getLegacyLoginDecision(EMAIL)).resolves.toEqual({
      allowed: false,
      reason: "sso_domain",
    });
    expect(db.organization.count).toHaveBeenCalledWith({
      where: expect.objectContaining({ userId: standardUser.id }),
    });
  });

  it("finds an account stored with capitals for a lowercase address", async () => {
    givenUsers([{ id: "user-caps", email: "Jane@Acme.com", sso: true }]);

    await expect(getLegacyLoginDecision("jane@acme.com")).resolves.toEqual({
      allowed: false,
      reason: "sso_account",
    });
    expect(db.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: { in: ["jane@acme.com"], mode: "insensitive" } },
      })
    );
  });

  it("prefers the lowercase row when two accounts differ only by case", async () => {
    givenUsers([
      { id: "user-caps", email: "Jane@Acme.com", sso: false },
      { id: "user-lower", email: "jane@acme.com", sso: true },
    ]);

    await expect(getLegacyLoginDecision("JANE@acme.com")).resolves.toEqual({
      allowed: false,
      reason: "sso_account",
    });
  });
});

describe("createSsoRequiredError", () => {
  it("is an uncaptured 403 telling the person to use SSO", () => {
    const error = createSsoRequiredError("sso_domain");

    expect(error).toBeInstanceOf(ShelfError);
    expect(error).toMatchObject({
      status: 403,
      title: "Single sign-on required",
      message:
        "This email address signs in with single sign-on. Please use Login with SSO.",
      shouldBeCaptured: false,
      additionalData: { reason: "sso_domain" },
    });
  });
});

describe("isSsoDomainEmail", () => {
  it("is true for an address on a domain configured for SSO", async () => {
    givenDomainIsSso(true);

    await expect(isSsoDomainEmail(EMAIL)).resolves.toBe(true);
  });

  it("is false for an address on any other domain", async () => {
    givenDomainIsSso(false);

    await expect(isSsoDomainEmail(EMAIL)).resolves.toBe(false);
  });

  it("is false without a lookup when SSO is disabled", async () => {
    env.disableSso = true;
    givenDomainIsSso(true);

    await expect(isSsoDomainEmail(EMAIL)).resolves.toBe(false);
    expect(checkDomainSSOStatus).not.toHaveBeenCalled();
  });

  it("never reads the account behind the address", async () => {
    givenDomainIsSso(true);

    await isSsoDomainEmail(EMAIL);

    expect(db.user.findMany).not.toHaveBeenCalled();
  });
});
