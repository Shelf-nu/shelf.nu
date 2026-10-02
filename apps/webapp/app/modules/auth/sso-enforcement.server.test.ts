// @vitest-environment node
/**
 * Tests for the legacy sign-in decision (`getLegacyLoginDecision`, and
 * `getLegacyLoginDecisionForUser` for a known account), the error a refusal is
 * shown with (`createSsoRequiredError`), the email change guard
 * (`assertEmailChangeAllowed`) and the domain-level hint (`isSsoDomainEmail`):
 * which addresses may use password login, email OTP and password reset, and
 * which must use SSO.
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
    user: { findMany: vi.fn(), findUnique: vi.fn() },
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
  assertEmailChangeAllowed,
  createSsoRequiredError,
  getLegacyLoginDecision,
  getLegacyLoginDecisionForUser,
  isSsoDomainEmail,
  SSO_EMAIL_CHANGE_REFUSED_MESSAGE,
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

/** Sets the row the by-id user lookup returns. */
function givenUserById(row: Pick<AccountRow, "id" | "sso"> | null) {
  vi.mocked(db.user.findUnique).mockResolvedValue(
    row as unknown as Awaited<ReturnType<typeof db.user.findUnique>>
  );
}

/** The organizations `checkDomainSSOStatus` reports as linked to a domain. */
type LinkedOrganizations = Awaited<
  ReturnType<typeof checkDomainSSOStatus>
>["linkedOrganizations"];

/** The workspace whose SSO settings list the address's domain. */
const LINKED_ORG_ID = "org-sso";

/**
 * Sets whether the address's domain is configured for SSO, and which
 * workspaces are linked to it (by default, one: `LINKED_ORG_ID`).
 */
function givenDomainIsSso(
  isConfiguredForSSO: boolean,
  linkedOrgIds: string[] = isConfiguredForSSO ? [LINKED_ORG_ID] : []
) {
  vi.mocked(checkDomainSSOStatus).mockResolvedValue({
    isConfiguredForSSO,
    // Without `ssoDetails` a linked organization counts as requiring SSO
    // login, which is the default every setup starts with.
    linkedOrganizations: linkedOrgIds.map((id) => ({
      id,
    })) as unknown as LinkedOrganizations,
    ssoProviderId: isConfiguredForSSO ? "provider-1" : null,
  });
}

/**
 * Sets an SSO domain whose linked workspaces carry the given "Require SSO
 * login" switch states, one workspace per entry.
 */
function givenLinkedWorkspaces(
  workspaces: { id: string; requireSsoLogin: boolean }[]
) {
  vi.mocked(checkDomainSSOStatus).mockResolvedValue({
    isConfiguredForSSO: true,
    // The decision reads only the ids and the switch of the linked
    // organizations.
    linkedOrganizations: workspaces.map(({ id, requireSsoLogin }) => ({
      id,
      ssoDetails: { requireSsoLogin },
    })) as unknown as LinkedOrganizations,
    ssoProviderId: "provider-1",
  });
}

/**
 * Sets the two ownership counts behind `userOwnsLinkedSsoWorkspace`. The
 * counts stand for rows that match the query's filters, so a test about an
 * unlinked workspace sets them to 0: the scoped query would not find it.
 */
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
  givenUserById(null);
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

  it("allows the owner of the workspace linked to the SSO domain", async () => {
    givenUsers([standardUser]);
    givenDomainIsSso(true);
    givenOwnership({ ownedOrgs: 1, ownerMemberships: 0 });

    await expect(getLegacyLoginDecision(EMAIL)).resolves.toEqual({
      allowed: true,
    });
  });

  it("allows a user holding the OWNER role on the linked workspace", async () => {
    givenUsers([standardUser]);
    givenDomainIsSso(true);
    givenOwnership({ ownedOrgs: 0, ownerMemberships: 1 });

    await expect(getLegacyLoginDecision(EMAIL)).resolves.toEqual({
      allowed: true,
    });
  });

  it("refuses the owner of a workspace that is not linked to the SSO domain", async () => {
    givenUsers([standardUser]);
    givenDomainIsSso(true, [LINKED_ORG_ID]);
    // The user owns "org-own", a TEAM workspace they created themselves. The
    // ownership queries are scoped to the linked workspace, so they find
    // nothing.
    givenOwnership({ ownedOrgs: 0, ownerMemberships: 0 });

    await expect(getLegacyLoginDecision(EMAIL)).resolves.toEqual({
      allowed: false,
      reason: "sso_domain",
    });
  });

  it("scopes both ownership queries to the workspaces linked to the domain", async () => {
    givenUsers([standardUser]);
    givenDomainIsSso(true, ["org-a", "org-b"]);

    await getLegacyLoginDecision(EMAIL);

    expect(db.organization.count).toHaveBeenCalledWith({
      where: { userId: standardUser.id, id: { in: ["org-a", "org-b"] } },
    });
    expect(db.userOrganization.count).toHaveBeenCalledWith({
      where: {
        userId: standardUser.id,
        roles: { has: "OWNER" },
        organizationId: { in: ["org-a", "org-b"] },
      },
    });
  });

  it("refuses everyone on an SSO domain with no linked workspace, without an owner query", async () => {
    givenUsers([standardUser]);
    givenDomainIsSso(true, []);
    givenOwnership({ ownedOrgs: 1, ownerMemberships: 1 });

    await expect(getLegacyLoginDecision(EMAIL)).resolves.toEqual({
      allowed: false,
      reason: "sso_domain",
    });
    expect(db.organization.count).not.toHaveBeenCalled();
    expect(db.userOrganization.count).not.toHaveBeenCalled();
  });

  describe("with the Require SSO login switch", () => {
    it("allows an unconverted non-owner when every linked workspace has it off", async () => {
      givenUsers([standardUser]);
      givenLinkedWorkspaces([
        { id: "org-a", requireSsoLogin: false },
        { id: "org-b", requireSsoLogin: false },
      ]);

      await expect(getLegacyLoginDecision(EMAIL)).resolves.toEqual({
        allowed: true,
      });
      expect(db.organization.count).not.toHaveBeenCalled();
      expect(db.userOrganization.count).not.toHaveBeenCalled();
    });

    it("refuses an unconverted non-owner when one linked workspace still has it on", async () => {
      givenUsers([standardUser]);
      givenLinkedWorkspaces([
        { id: "org-a", requireSsoLogin: false },
        { id: "org-b", requireSsoLogin: true },
      ]);

      await expect(getLegacyLoginDecision(EMAIL)).resolves.toEqual({
        allowed: false,
        reason: "sso_domain",
      });
    });

    it("still refuses a converted account when the switch is off", async () => {
      givenUsers([{ ...standardUser, sso: true }]);
      givenLinkedWorkspaces([{ id: "org-a", requireSsoLogin: false }]);

      await expect(getLegacyLoginDecision(EMAIL)).resolves.toEqual({
        allowed: false,
        reason: "sso_account",
      });
    });

    it("still refuses an address with no account when the switch is off", async () => {
      givenLinkedWorkspaces([{ id: "org-a", requireSsoLogin: false }]);

      await expect(getLegacyLoginDecision(EMAIL)).resolves.toEqual({
        allowed: false,
        reason: "sso_domain",
      });
    });

    it("keeps the block on an SSO domain with no linked workspace", async () => {
      givenUsers([standardUser]);
      givenLinkedWorkspaces([]);

      await expect(getLegacyLoginDecision(EMAIL)).resolves.toEqual({
        allowed: false,
        reason: "sso_domain",
      });
    });

    it("still allows the owner when the switch is on", async () => {
      givenUsers([standardUser]);
      givenLinkedWorkspaces([{ id: "org-a", requireSsoLogin: true }]);
      givenOwnership({ ownedOrgs: 1, ownerMemberships: 0 });

      await expect(getLegacyLoginDecision(EMAIL)).resolves.toEqual({
        allowed: true,
      });
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

describe("getLegacyLoginDecisionForUser", () => {
  it("decides for the account with that id, not for the address", async () => {
    // Another account holds the address in different case; the decision must
    // still be about the signed-in one.
    givenUsers([{ id: "other", email: EMAIL, sso: true }]);
    givenUserById({ id: "user-1", sso: false });
    givenDomainIsSso(true);
    givenOwnership({ ownedOrgs: 1, ownerMemberships: 0 });

    await expect(
      getLegacyLoginDecisionForUser({ userId: "user-1", email: EMAIL })
    ).resolves.toEqual({ allowed: true });
    expect(db.user.findUnique).toHaveBeenCalledWith({
      where: { id: "user-1" },
      select: { id: true, sso: true },
    });
    expect(db.user.findMany).not.toHaveBeenCalled();
    expect(db.organization.count).toHaveBeenCalledWith({
      where: { userId: "user-1", id: { in: [LINKED_ORG_ID] } },
    });
  });

  it("refuses a converted account", async () => {
    givenUserById({ id: "user-1", sso: true });

    await expect(
      getLegacyLoginDecisionForUser({ userId: "user-1", email: EMAIL })
    ).resolves.toEqual({ allowed: false, reason: "sso_account" });
  });

  it("refuses a non-owner on an SSO domain", async () => {
    givenUserById({ id: "user-1", sso: false });
    givenDomainIsSso(true);

    await expect(
      getLegacyLoginDecisionForUser({ userId: "user-1", email: EMAIL })
    ).resolves.toEqual({ allowed: false, reason: "sso_domain" });
  });

  it("allows everything without a lookup when SSO is disabled", async () => {
    env.disableSso = true;
    givenUserById({ id: "user-1", sso: true });

    await expect(
      getLegacyLoginDecisionForUser({ userId: "user-1", email: EMAIL })
    ).resolves.toEqual({ allowed: true });
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });
});

describe("assertEmailChangeAllowed", () => {
  it("refuses a standard account that must sign in with SSO", async () => {
    givenUserById({ id: "user-1", sso: false });
    givenDomainIsSso(true);

    await expect(
      assertEmailChangeAllowed({ userId: "user-1", email: EMAIL })
    ).rejects.toMatchObject({
      status: 403,
      message: SSO_EMAIL_CHANGE_REFUSED_MESSAGE,
      shouldBeCaptured: false,
    });
  });

  it("allows an unconverted owner of the domain's SSO workspace", async () => {
    givenUserById({ id: "user-1", sso: false });
    givenDomainIsSso(true);
    givenOwnership({ ownedOrgs: 0, ownerMemberships: 1 });

    await expect(
      assertEmailChangeAllowed({ userId: "user-1", email: EMAIL })
    ).resolves.toBeUndefined();
  });

  it("allows a standard non-owner while every linked workspace has Require SSO login off", async () => {
    givenUserById({ id: "user-1", sso: false });
    givenLinkedWorkspaces([{ id: LINKED_ORG_ID, requireSsoLogin: false }]);

    await expect(
      assertEmailChangeAllowed({ userId: "user-1", email: EMAIL })
    ).resolves.toBeUndefined();
  });

  it("allows a standard account on a domain without SSO", async () => {
    givenUserById({ id: "user-1", sso: false });

    await expect(
      assertEmailChangeAllowed({ userId: "user-1", email: EMAIL })
    ).resolves.toBeUndefined();
  });

  it("does not check an account converted to SSO", async () => {
    givenUserById({ id: "user-1", sso: true });
    givenDomainIsSso(true);

    await expect(
      assertEmailChangeAllowed({ userId: "user-1", email: EMAIL })
    ).resolves.toBeUndefined();
    expect(checkDomainSSOStatus).not.toHaveBeenCalled();
  });
});
