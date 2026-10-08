/**
 * Who receives workspace-wide notifications, per audience: read from the
 * role policy table, never a hand-listed role array.
 *
 * @see {@link file://./service.server.ts} getOrganizationNotificationAudience
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getOrganizationNotificationAudience } from "./service.server";

// @vitest-environment node

const findMany = vi.hoisted(() => vi.fn());

// why: the assertion is about the query Prisma is handed; no database needed
vi.mock("~/database/db.server", () => ({
  db: { userOrganization: { findMany } },
}));

// why: the module sends ownership-transfer emails; loading the real mailer is
// irrelevant to an audience query
vi.mock("~/emails/mail.server", () => ({ sendEmail: vi.fn() }));

// why: premium and Stripe paths are irrelevant to the audience query and would
// otherwise require a full Stripe client
vi.mock("~/utils/stripe.server", () => ({
  premiumIsEnabled: false,
  getUserActiveSubscription: vi.fn(),
  getUserActiveSubscriptions: vi.fn(),
  transferSubscriptionToCustomer: vi.fn(),
  createStripeCustomer: vi.fn(),
  customerHasPaymentMethod: vi.fn(),
}));

describe("getOrganizationNotificationAudience", () => {
  beforeEach(() => {
    findMany.mockReset();
    findMany.mockResolvedValue([
      { user: { id: "u-1", email: "owner@example.com" } },
    ]);
  });

  it.each([
    // The Manager receives booking broadcasts but not low-stock alerts.
    ["orgBookingBroadcasts", ["OWNER", "ADMIN", "MANAGER"]],
    ["inventoryAlerts", ["OWNER", "ADMIN"]],
  ] as const)(
    "the %s audience is the roles whose policy grants it (%j)",
    async (audience, roles) => {
      const users = await getOrganizationNotificationAudience({
        organizationId: "org-1",
        audience,
      });

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId: "org-1",
            roles: { hasSome: [...roles] },
          },
        })
      );
      expect(users).toEqual([{ id: "u-1", email: "owner@example.com" }]);
    }
  );
});
