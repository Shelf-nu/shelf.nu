/**
 * Ownership transfer eligibility: the candidate list and the transfer's own
 * check both read the `membership.eligibleAsNewOwner` policy, and the current
 * owner is found by the owner role, wherever it sits in the membership.
 *
 * @see {@link file://./service.server.ts} getOrganizationAdmins, transferOwnership
 */
import { OrganizationType } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getOrganizationAdmins, transferOwnership } from "./service.server";

// @vitest-environment node

const dbMock = vi.hoisted(() => ({
  userOrganization: { findMany: vi.fn() },
  user: { findUniqueOrThrow: vi.fn() },
  $transaction: vi.fn(),
}));

// why: the candidate query and the membership rows are the contract under
// test; they are supplied directly instead of seeded in Postgres
vi.mock("~/database/db.server", () => ({ db: dbMock }));

// why: ownership transfer sends notification emails as a side effect; the
// refused transfers here never reach them
vi.mock("~/emails/mail.server", () => ({ sendEmail: vi.fn() }));

// why: premium and Stripe paths are irrelevant to eligibility and would
// otherwise require a full Stripe client
vi.mock("~/utils/stripe.server", () => ({
  premiumIsEnabled: false,
  getUserActiveSubscription: vi.fn(),
  getUserActiveSubscriptions: vi.fn(),
  transferSubscriptionToCustomer: vi.fn(),
  createStripeCustomer: vi.fn(),
  customerHasPaymentMethod: vi.fn(),
}));

// why: tier writes are a subscription-transfer side effect that the refused
// transfers here never reach
vi.mock("../tier/service.server", () => ({ updateUserTierId: vi.fn() }));

/** A membership row shaped like `transferOwnership`'s `select` clause. */
function membership(userId: string, roles: string[]) {
  return {
    id: `uo-${userId}`,
    roles,
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
  };
}

const currentOrganization = {
  id: "org-1",
  name: "Org",
  type: OrganizationType.TEAM,
};

describe("ownership transfer eligibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.user.findUniqueOrThrow.mockResolvedValue({
      id: "owner",
      roles: [],
    });
  });

  it("lists candidates by the eligibleAsNewOwner policy", async () => {
    dbMock.userOrganization.findMany.mockResolvedValue([]);

    await getOrganizationAdmins({ organizationId: "org-1" });

    expect(dbMock.userOrganization.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org-1", roles: { hasSome: ["ADMIN"] } },
      })
    );
  });

  it("finds the current owner by the owner role", async () => {
    dbMock.userOrganization.findMany.mockResolvedValue([]);

    await transferOwnership({
      currentOrganization,
      newOwnerId: "new",
      userId: "owner",
    }).catch(() => undefined);

    expect(dbMock.userOrganization.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: "org-1",
          OR: [{ userId: "new" }, { roles: { hasSome: ["OWNER"] } }],
        },
      })
    );
  });

  it("refuses a new owner holding no eligible role", async () => {
    dbMock.userOrganization.findMany.mockResolvedValue([
      membership("owner", ["OWNER"]),
      membership("new", ["SELF_SERVICE"]),
    ]);

    await expect(
      transferOwnership({
        currentOrganization,
        newOwnerId: "new",
        userId: "owner",
      })
    ).rejects.toThrow(/not an admin/);
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it("accepts an owner whose OWNER role is not listed first", async () => {
    dbMock.userOrganization.findMany.mockResolvedValue([
      membership("owner", ["ADMIN", "OWNER"]),
      membership("new", ["BASE"]),
    ]);

    // The refusal names the new owner, so the requester was recognised as the
    // current owner even though OWNER is the second role on their membership.
    await expect(
      transferOwnership({
        currentOrganization,
        newOwnerId: "new",
        userId: "owner",
      })
    ).rejects.toThrow(/not an admin/);
  });
});
