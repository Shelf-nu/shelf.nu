// @vitest-environment node

/**
 * Account subscription action: the SSO purchase gate runs before any price
 * lookup, Stripe call or tier write, for both the trial and subscribe intents.
 *
 * @see {@link file://./../../../app/routes/_layout+/account-details.subscription.tsx}
 * @see {@link file://./../../../app/modules/billing/sso-purchase-gate.server.ts}
 */
import type { ActionFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "~/database/db.server";
import { assertPriceMatchesTier } from "~/modules/billing/price-validation.server";
import { assertUserMayPurchase } from "~/modules/billing/sso-purchase-gate.server";
import { getUserByID } from "~/modules/user/service.server";
import { action } from "~/routes/_layout+/account-details.subscription";
import { ShelfError } from "~/utils/error";
import {
  createStripeCheckoutSession,
  createTeamTrialSubscription,
  getOrCreateCustomerId,
} from "~/utils/stripe.server";

// why: preventing Prisma from trying to connect to a real database; the trial
// path writes the tier through db.user.update, which must stay uncalled when
// the gate refuses.
vi.mock("~/database/db.server", () => ({
  db: { user: { update: vi.fn() } },
}));
// why: the gate is a database read covered by its own tests; here only its
// verdict matters. The pure rule stays real because the route's loader imports it.
vi.mock("~/modules/billing/sso-purchase-gate.server", async () => {
  const actual = await vi.importActual<
    typeof import("~/modules/billing/sso-purchase-gate.server")
  >("~/modules/billing/sso-purchase-gate.server");
  return { ...actual, assertUserMayPurchase: vi.fn() };
});
// why: price validation resolves prices through Stripe (network)
vi.mock("~/modules/billing/price-validation.server", () => ({
  assertPriceMatchesTier: vi.fn(),
  assertPriceIsForAddon: vi.fn(),
}));
// why: every function here is a Stripe network call or builds a Stripe URL
vi.mock("~/utils/stripe.server", () => ({
  createStripeCheckoutSession: vi.fn(),
  createTeamTrialSubscription: vi.fn(),
  getOrCreateCustomerId: vi.fn(),
  getDomainUrl: vi.fn(() => "https://app.test"),
  generateReturnUrl: vi.fn(),
}));
// why: the action reads the user through the service; no database here
vi.mock("~/modules/user/service.server", () => ({
  getUserByID: vi.fn(),
}));

// why: mocking Remix's data() so the action's error result is a readable Response
const createDataMock = vi.hoisted(() => {
  return () =>
    vi.fn((body: unknown, init?: ResponseInit) => {
      return new Response(JSON.stringify(body), {
        status: init?.status || 200,
        headers: {
          "Content-Type": "application/json",
          ...(init?.headers || {}),
        },
      });
    });
});

vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return { ...actual, data: createDataMock() };
});

/** Builds a POST to the action with a URL-encoded body (happy-dom drops FormData fields). */
function submit(intent: "subscribe" | "trial") {
  return action({
    request: new Request("https://app.test/account-details/subscription", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        priceId: "price_team",
        intent,
        shelfTier: "tier_2",
      }),
    }),
    context: {
      getSession: () => ({ userId: "user-123", email: "user@example.com" }),
    },
    params: {},
  } as unknown as ActionFunctionArgs) as unknown as Promise<Response>;
}

describe("account-details.subscription action: SSO purchase gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getUserByID).mockResolvedValue({
      customerId: null,
      firstName: "Test",
      lastName: "User",
      displayName: "Test User",
      usedFreeTrial: false,
    } as never);
    vi.mocked(getOrCreateCustomerId).mockResolvedValue("cus_123");
  });

  describe("when the gate refuses", () => {
    beforeEach(() => {
      vi.mocked(assertUserMayPurchase).mockRejectedValue(
        new ShelfError({
          cause: null,
          message: "Purchases unavailable",
          status: 403,
          shouldBeCaptured: false,
          label: "Subscription",
        })
      );
    });

    it("answers 403 and starts no checkout for the subscribe intent", async () => {
      const response = await submit("subscribe");

      expect(response.status).toBe(403);
      expect(assertPriceMatchesTier).not.toHaveBeenCalled();
      expect(getOrCreateCustomerId).not.toHaveBeenCalled();
      expect(createStripeCheckoutSession).not.toHaveBeenCalled();
    });

    it("answers 403 and starts no trial for the trial intent", async () => {
      const response = await submit("trial");

      expect(response.status).toBe(403);
      expect(createTeamTrialSubscription).not.toHaveBeenCalled();
      expect(db.user.update).not.toHaveBeenCalled();
    });
  });

  describe("when the gate allows", () => {
    it("redirects to Stripe Checkout, gating on the Team target", async () => {
      vi.mocked(assertUserMayPurchase).mockResolvedValue(undefined);
      vi.mocked(createStripeCheckoutSession).mockResolvedValue(
        "https://checkout.stripe.test/session"
      );

      const response = await submit("subscribe");

      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe(
        "https://checkout.stripe.test/session"
      );
      expect(assertUserMayPurchase).toHaveBeenCalledWith({
        userId: "user-123",
        target: "team",
      });
    });
  });
});
