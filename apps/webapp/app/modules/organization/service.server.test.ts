/**
 * Organization Service — ownership transfer authorization
 *
 * Pins the authorization contract of {@link transferOwnership}: only the
 * workspace's current OWNER, or a Shelf platform admin, may transfer
 * ownership. A workspace ADMIN must not.
 *
 * Regression coverage for detail.dev finding D000: the owner check compared
 * the *organization owner's* role against itself (`currentOwnerUserOrg` was
 * selected by `roles.includes(OWNER)`, so `!roles.includes(OWNER)` could never
 * be true) and never compared the requesting `userId` to anyone, letting any
 * workspace ADMIN take over the workspace.
 *
 * @see {@link file://./service.server.ts}
 * @see {@link file://./../../routes/_layout+/settings.general.tsx}
 */

import { OrganizationRoles, OrganizationType, Roles } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { transferOwnership } from "./service.server";

// @vitest-environment node

const ORG_ID = "org-1";
const OWNER_ID = "user-owner";
const ADMIN_ID = "user-admin";
const NEW_OWNER_ID = "user-new-owner";
const SHELF_ADMIN_ID = "user-shelf-admin";

type MockDb = {
  $transaction: <T>(callback: (tx: MockDb) => Promise<T>) => Promise<T>;
  user: { findUniqueOrThrow: ReturnType<typeof vi.fn> };
  userOrganization: {
    findMany: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  organization: { update: ReturnType<typeof vi.fn> };
};

const dbMock = vi.hoisted<MockDb>(() => ({
  $transaction: vi.fn(
    <T>(callback: (tx: MockDb) => Promise<T>): Promise<T> =>
      callback(dbMock as MockDb)
  ) as <T>(callback: (tx: MockDb) => Promise<T>) => Promise<T>,
  user: { findUniqueOrThrow: vi.fn() },
  userOrganization: { findMany: vi.fn(), update: vi.fn() },
  organization: { update: vi.fn() },
}));

// why: isolating database calls so the authorization branch can be unit tested
vi.mock("~/database/db.server", () => ({ db: dbMock }));

// why: ownership transfer sends notification emails as a side effect
vi.mock("~/emails/mail.server", () => ({ sendEmail: vi.fn() }));

// why: premium/Stripe paths are irrelevant to the authorization contract and
// would otherwise require a full Stripe client
vi.mock("~/utils/stripe.server", () => ({
  premiumIsEnabled: false,
  getUserActiveSubscription: vi.fn(),
  getUserActiveSubscriptions: vi.fn(),
  transferSubscriptionToCustomer: vi.fn(),
  createStripeCustomer: vi.fn(),
  customerHasPaymentMethod: vi.fn(),
}));

// why: tier writes are a subscription-transfer side effect, and these tests run
// with premiumIsEnabled false to assert only the authorization branch
vi.mock("../tier/service.server", () => ({ updateUserTierId: vi.fn() }));

const currentOrganization = {
  id: ORG_ID,
  name: "Test Org",
  type: OrganizationType.TEAM,
};

/** Builds a UserOrganization row shaped like the service's `select` clause */
function userOrg(userId: string, roles: OrganizationRoles[]) {
  return {
    id: `uo-${userId}`,
    user: {
      id: userId,
      firstName: "Test",
      lastName: "User",
      displayName: null,
      email: `${userId}@example.com`,
      roles: [],
      customerId: null,
      tierId: "free",
      usedFreeTrial: false,
    },
    roles,
  };
}

describe("transferOwnership authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    (dbMock.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
      <T>(callback: (tx: MockDb) => Promise<T>): Promise<T> => callback(dbMock)
    );

    // Default: the requesting user is NOT a Shelf platform admin
    dbMock.user.findUniqueOrThrow.mockResolvedValue({
      id: ADMIN_ID,
      roles: [],
    });

    // The service's findMany returns the org OWNER plus the new-owner candidate
    dbMock.userOrganization.findMany.mockResolvedValue([
      userOrg(OWNER_ID, [OrganizationRoles.OWNER]),
      userOrg(NEW_OWNER_ID, [OrganizationRoles.ADMIN]),
    ]);

    dbMock.userOrganization.update.mockResolvedValue({});
    dbMock.organization.update.mockResolvedValue({});
  });

  it("rejects a workspace ADMIN who is not the owner", async () => {
    await expect(
      transferOwnership({
        currentOrganization,
        newOwnerId: NEW_OWNER_ID,
        // The caller is a workspace ADMIN, not the OWNER
        userId: ADMIN_ID,
      })
    ).rejects.toThrow(/not the owner/i);

    // Nothing may be written when authorization fails
    expect(dbMock.organization.update).not.toHaveBeenCalled();
    expect(dbMock.userOrganization.update).not.toHaveBeenCalled();
  });

  it("allows the current OWNER to transfer ownership", async () => {
    dbMock.user.findUniqueOrThrow.mockResolvedValue({
      id: OWNER_ID,
      roles: [],
    });

    const { newOwner } = await transferOwnership({
      currentOrganization,
      newOwnerId: NEW_OWNER_ID,
      userId: OWNER_ID,
    });

    expect(newOwner.id).toBe(NEW_OWNER_ID);
    expect(dbMock.organization.update).toHaveBeenCalled();
  });

  it("allows a Shelf platform admin who is not an organization member", async () => {
    // Shelf admins act from the admin dashboard and are not org members, so
    // they never appear in the userOrganization rows.
    dbMock.user.findUniqueOrThrow.mockResolvedValue({
      id: SHELF_ADMIN_ID,
      roles: [{ name: Roles.ADMIN }],
    });

    const { newOwner } = await transferOwnership({
      currentOrganization,
      newOwnerId: NEW_OWNER_ID,
      userId: SHELF_ADMIN_ID,
    });

    expect(newOwner.id).toBe(NEW_OWNER_ID);
    expect(dbMock.organization.update).toHaveBeenCalled();
  });

  it("demotes the real outgoing owner, not the requesting Shelf admin", async () => {
    dbMock.user.findUniqueOrThrow.mockResolvedValue({
      id: SHELF_ADMIN_ID,
      roles: [{ name: Roles.ADMIN }],
    });

    await transferOwnership({
      currentOrganization,
      newOwnerId: NEW_OWNER_ID,
      userId: SHELF_ADMIN_ID,
    });

    // The row demoted to ADMIN must be the previous OWNER's row. This is what
    // breaks if `currentOwnerUserOrg` is repointed at the requesting user.
    expect(dbMock.userOrganization.update).toHaveBeenCalledWith({
      where: { id: `uo-${OWNER_ID}` },
      data: { roles: { set: [OrganizationRoles.ADMIN] } },
    });
  });
});
