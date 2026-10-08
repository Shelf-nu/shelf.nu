/**
 * Barcode add-on purchase route — owner-only enforcement.
 *
 * The action gated on `requirePermission(subscription, update)` alone. ADMIN
 * short-circuits to allow-all in `hasPermission`, so it cleared that gate — but
 * starting the trial writes `usedBarcodeTrial: true`, an IRREVERSIBLE flag that
 * spends the workspace's single free trial, and creates a Stripe subscription
 * that auto-charges the owner's card when the trial ends.
 *
 * The UI was already owner-only (`if (!isOwner) return null` in
 * unlock-barcodes-banner), so only a direct POST reached this.
 *
 * detail.dev finding D102.
 *
 * @see {@link file://./../../../app/routes/api+/barcode-addon.ts}
 * @see {@link file://./../../../app/utils/roles.server.ts} `assertIsOrganizationOwner`
 */

import { OrganizationRoles } from "@prisma/client";
import { ShelfError } from "~/utils/error";

// why: mocking Remix's data() so the action's error path returns a Response
// whose status we can assert (React Router v7 single fetch)
const createDataMock = vi.hoisted(() => {
  return () =>
    vi.fn((body: unknown, init?: ResponseInit) => {
      return new Response(JSON.stringify(body), {
        status: init?.status || 200,
        headers: { "Content-Type": "application/json" },
      });
    });
});

// why: React Router v7 single fetch — `data()` must return a real Response
// so the action's error path has an assertable status.
vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return { ...actual, data: createDataMock() };
});

// why: preventing Prisma from connecting to a real database. `updateMany` is
// the trial claim — its affected-row count decides whether this request is the
// one allowed to create a subscription, so tests drive that count directly.
const { mockOrgUpdate, mockOrgUpdateMany } = vi.hoisted(() => ({
  mockOrgUpdate: vi.fn(),
  mockOrgUpdateMany: vi.fn(),
}));
vi.mock("~/database/db.server", () => ({
  db: {
    organization: { update: mockOrgUpdate, updateMany: mockOrgUpdateMany },
  },
}));

// why: the permission gate is not what's under test — we want it to PASS so
// the assertion proves the owner check is what refuses, not the RBAC check.
vi.mock("~/utils/roles.server", async () => {
  const actual = await vi.importActual<typeof import("~/utils/roles.server")>(
    "~/utils/roles.server"
  );
  return { ...actual, requirePermission: vi.fn().mockResolvedValue({}) };
});

// why: external Stripe/billing calls — also the sinks we assert are unreached
vi.mock("~/modules/barcode/addon.server", () => ({
  createBarcodeAddonTrialSubscription: vi
    .fn()
    .mockResolvedValue({ hasPaymentMethod: true }),
  createBarcodeAddonCheckoutSession: vi
    .fn()
    .mockResolvedValue("https://stripe.example/checkout"),
}));

const { mockGetSelectedOrganization } = vi.hoisted(() => ({
  mockGetSelectedOrganization: vi.fn(),
}));
// why: resolves the caller's memberships from the session and DB. Mocking it
// is how this test chooses whether the caller is ADMIN or OWNER, which is the
// entire variable under test.
vi.mock("~/modules/organization/context.server", () => ({
  getSelectedOrganization: mockGetSelectedOrganization,
}));

// why: a DB read for the Stripe customer name fields; irrelevant to the owner
// check and would otherwise need a database.
vi.mock("~/modules/user/service.server", () => ({
  getUserByID: vi.fn().mockResolvedValue({
    customerId: "cus_1",
    firstName: "Ada",
    lastName: "L",
    displayName: "Ada",
  }),
}));

// why: real Stripe calls. `customerHasPaymentMethod` returning false also
// keeps the consent branch out of the way of the assertion.
vi.mock("~/utils/stripe.server", () => ({
  getOrCreateCustomerId: vi.fn().mockResolvedValue("cus_1"),
  customerHasPaymentMethod: vi.fn().mockResolvedValue(false),
  getDomainUrl: vi.fn().mockReturnValue("https://app.shelf.nu"),
}));

// why: sends a real email on the success path.
vi.mock("~/emails/stripe/barcode-trial-welcome", () => ({
  sendBarcodeTrialWelcomeEmail: vi.fn(),
}));

import {
  createBarcodeAddonCheckoutSession,
  createBarcodeAddonTrialSubscription,
} from "~/modules/barcode/addon.server";
import { action } from "~/routes/api+/barcode-addon";

// @vitest-environment node

const ORG = "org-1";

/** Makes `getSelectedOrganization` report the caller as holding `roles`. */
function callerHolds(roles: OrganizationRoles[]) {
  mockGetSelectedOrganization.mockResolvedValue({
    organizationId: ORG,
    currentOrganization: { id: ORG, usedBarcodeTrial: false },
    userOrganizations: [{ organization: { id: ORG }, roles }],
  });
}

/** POSTs to the add-on route with the given intent. */
function post(intent: "trial" | "subscribe") {
  return action({
    request: new Request("https://app.shelf.nu/api/barcode-addon", {
      method: "POST",
      body: new URLSearchParams({
        priceId: "price_1",
        intent,
        consentAcknowledged: "true",
      }),
    }),
    params: {},
    context: { getSession: () => ({ userId: "user-1", email: "a@b.c" }) },
  } as unknown as Parameters<typeof action>[0]);
}

describe("POST /api/barcode-addon", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOrgUpdate.mockResolvedValue({ id: ORG });
    // Default: this request wins the claim.
    mockOrgUpdateMany.mockResolvedValue({ count: 1 });
  });

  it("refuses an ADMIN starting the trial, and never burns the flag", async () => {
    callerHolds([OrganizationRoles.ADMIN]);

    const result = await post("trial");

    expect((result as unknown as Response).status).toBe(403);
    // The two assertions that matter: no Stripe subscription, and above all
    // `usedBarcodeTrial` is never set — that flag cannot be undone.
    expect(createBarcodeAddonTrialSubscription).not.toHaveBeenCalled();
    expect(mockOrgUpdate).not.toHaveBeenCalled();
  });

  it("refuses an ADMIN subscribing", async () => {
    callerHolds([OrganizationRoles.ADMIN]);

    const result = await post("subscribe");

    expect((result as unknown as Response).status).toBe(403);
    expect(createBarcodeAddonCheckoutSession).not.toHaveBeenCalled();
  });

  it("still lets the OWNER start the trial", async () => {
    callerHolds([OrganizationRoles.OWNER]);

    await post("trial");

    expect(createBarcodeAddonTrialSubscription).toHaveBeenCalledTimes(1);
    expect(mockOrgUpdate).toHaveBeenCalledTimes(1);
  });

  describe("one trial per workspace", () => {
    beforeEach(() => {
      callerHolds([OrganizationRoles.OWNER]);
    });

    it("claims the trial before it creates the subscription", async () => {
      await post("trial");

      // Order is the whole fix. Claiming AFTER the Stripe call leaves the
      // window exactly as it was: two requests both find the trial unused and
      // both create a real subscription.
      const claimOrder = mockOrgUpdateMany.mock.invocationCallOrder[0];
      const stripeOrder = (
        createBarcodeAddonTrialSubscription as ReturnType<typeof vi.fn>
      ).mock.invocationCallOrder[0];

      expect(claimOrder).toBeDefined();
      expect(claimOrder).toBeLessThan(stripeOrder);
    });

    it("creates nothing when another request already claimed the trial", async () => {
      // Zero rows updated is how the database reports a lost claim.
      mockOrgUpdateMany.mockResolvedValue({ count: 0 });

      const result = await post("trial");

      expect((result as unknown as Response).status).toBe(400);
      expect(createBarcodeAddonTrialSubscription).not.toHaveBeenCalled();
    });

    it("returns the claim when the failure preceded the Stripe request", async () => {
      // The add-on helper reports that it never sent the create, so nothing
      // can exist and the workspace keeps its trial.
      (
        createBarcodeAddonTrialSubscription as ReturnType<typeof vi.fn>
      ).mockRejectedValueOnce(
        new ShelfError({
          cause: null,
          message: "Stripe not initialized",
          additionalData: { subscriptionCreateAttempted: false },
          label: "Stripe",
        })
      );

      await post("trial");

      // Claim then release: the second call puts the flag back, so the
      // workspace can try again rather than losing a trial it never received.
      expect(mockOrgUpdateMany).toHaveBeenCalledTimes(2);
      expect(mockOrgUpdateMany).toHaveBeenLastCalledWith({
        where: { id: ORG, usedBarcodeTrial: true },
        data: { usedBarcodeTrial: false },
      });
      // The add-on must not be switched on for a subscription that failed.
      expect(mockOrgUpdate).not.toHaveBeenCalled();
    });

    it("keeps the claim when the create may already have succeeded", async () => {
      // A lost response is indistinguishable from a refusal, and Stripe may
      // hold a real subscription. Releasing here would let the user's retry
      // open a second one — the exact outcome the claim exists to prevent.
      (
        createBarcodeAddonTrialSubscription as ReturnType<typeof vi.fn>
      ).mockRejectedValueOnce(
        new ShelfError({
          cause: new Error("socket hang up"),
          message: "Something went wrong while creating barcode add-on trial.",
          additionalData: { subscriptionCreateAttempted: true },
          label: "Stripe",
        })
      );

      await post("trial");

      // The claim, and nothing after it.
      expect(mockOrgUpdateMany).toHaveBeenCalledTimes(1);
      expect(mockOrgUpdateMany).toHaveBeenCalledWith({
        where: { id: ORG, usedBarcodeTrial: false },
        data: { usedBarcodeTrial: true },
      });
    });
  });
});
