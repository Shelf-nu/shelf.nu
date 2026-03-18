import { describe, it, expect, vi, beforeEach } from "vitest";

// why: Stripe SDK makes external API calls
const { mockStripe } = vi.hoisted(() => ({
  mockStripe: {
    checkout: { sessions: { create: vi.fn() } },
    subscriptions: { create: vi.fn(), list: vi.fn(), update: vi.fn() },
    prices: { list: vi.fn() },
    products: { retrieve: vi.fn() },
    paymentMethods: { list: vi.fn() },
  },
}));

// why: control premiumIsEnabled flag
const { mockPremiumIsEnabled } = vi.hoisted(() => ({
  mockPremiumIsEnabled: { value: true },
}));

vi.mock("~/utils/stripe.server", () => ({
  stripe: mockStripe,
  get premiumIsEnabled() {
    return mockPremiumIsEnabled.value;
  },
}));

// why: Database module connects to Prisma during import
const { mockOrgUpdate } = vi.hoisted(() => ({
  mockOrgUpdate: vi.fn(),
}));

vi.mock("~/database/db.server", () => ({
  db: {
    organization: {
      update: mockOrgUpdate,
    },
  },
}));

import { ShelfError } from "~/utils/error";
import {
  createAuditAddonCheckoutSession,
  createAuditAddonTrialSubscription,
  getAuditAddonPrices,
  linkAuditAddonToOrganization,
  getAuditSubscriptionInfo,
  handleAuditAddonWebhook,
} from "./addon.server";

const baseParams = {
  priceId: "price_123",
  userId: "user_abc",
  domainUrl: "https://app.shelf.nu",
  customerId: "cus_xyz",
  organizationId: "org_456",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPremiumIsEnabled.value = true;
});

describe("createAuditAddonCheckoutSession", () => {
  it("creates checkout session with correct params and returns URL", async () => {
    mockStripe.checkout.sessions.create.mockResolvedValue({
      url: "https://checkout.stripe.com/session_abc",
    });

    const url = await createAuditAddonCheckoutSession(baseParams);

    expect(url).toBe("https://checkout.stripe.com/session_abc");
    expect(mockStripe.checkout.sessions.create).toHaveBeenCalledWith({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: "price_123", quantity: 1 }],
      success_url: "https://app.shelf.nu/audits?success=true",
      cancel_url: "https://app.shelf.nu/audits?canceled=true",
      client_reference_id: "user_abc",
      customer: "cus_xyz",
      subscription_data: {
        metadata: { organizationId: "org_456" },
      },
    });
  });

  it("throws ShelfError when stripe is not initialized", async () => {
    const stripeMod = await import("~/utils/stripe.server");
    const original = stripeMod.stripe;
    (stripeMod as any).stripe = null;
    try {
      await createAuditAddonCheckoutSession(baseParams);
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ShelfError);
    } finally {
      (stripeMod as any).stripe = original;
    }
  });

  it("throws ShelfError when session URL is null", async () => {
    mockStripe.checkout.sessions.create.mockResolvedValue({ url: null });

    try {
      await createAuditAddonCheckoutSession(baseParams);
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ShelfError);
      expect((e as ShelfError).message).toContain(
        "Something went wrong while creating audit add-on checkout session"
      );
    }
  });
});

describe("createAuditAddonTrialSubscription", () => {
  const trialParams = {
    customerId: "cus_xyz",
    priceId: "price_123",
    userId: "user_abc",
    organizationId: "org_456",
  };

  it("creates 7-day trial subscription with default_payment_method when PM available", async () => {
    mockStripe.paymentMethods.list.mockResolvedValue({
      data: [{ id: "pm_abc" }],
    });
    const mockSub = { id: "sub_123", status: "trialing" };
    mockStripe.subscriptions.create.mockResolvedValue(mockSub);

    await createAuditAddonTrialSubscription(trialParams);

    expect(mockStripe.subscriptions.create).toHaveBeenCalledWith({
      customer: "cus_xyz",
      items: [{ price: "price_123" }],
      trial_period_days: 7,
      trial_settings: {
        end_behavior: { missing_payment_method: "pause" },
      },
      default_payment_method: "pm_abc",
      metadata: { userId: "user_abc", organizationId: "org_456" },
    });
  });

  it("creates subscription without default_payment_method when none exists", async () => {
    mockStripe.paymentMethods.list.mockResolvedValue({ data: [] });
    mockStripe.subscriptions.create.mockResolvedValue({
      id: "sub_123",
      status: "trialing",
    });

    await createAuditAddonTrialSubscription(trialParams);

    expect(mockStripe.subscriptions.create).toHaveBeenCalledWith({
      customer: "cus_xyz",
      items: [{ price: "price_123" }],
      trial_period_days: 7,
      trial_settings: {
        end_behavior: { missing_payment_method: "pause" },
      },
      metadata: { userId: "user_abc", organizationId: "org_456" },
    });
    // Ensure default_payment_method is NOT in the call
    const callArgs = mockStripe.subscriptions.create.mock.calls[0][0];
    expect(callArgs).not.toHaveProperty("default_payment_method");
  });

  it("returns { subscription, hasPaymentMethod: true } when PM exists", async () => {
    mockStripe.paymentMethods.list.mockResolvedValue({
      data: [{ id: "pm_abc" }],
    });
    const mockSub = { id: "sub_123", status: "trialing" };
    mockStripe.subscriptions.create.mockResolvedValue(mockSub);

    const result = await createAuditAddonTrialSubscription(trialParams);

    expect(result).toEqual({ subscription: mockSub, hasPaymentMethod: true });
  });

  it("returns { subscription, hasPaymentMethod: false } when no PM", async () => {
    mockStripe.paymentMethods.list.mockResolvedValue({ data: [] });
    const mockSub = { id: "sub_123", status: "trialing" };
    mockStripe.subscriptions.create.mockResolvedValue(mockSub);

    const result = await createAuditAddonTrialSubscription(trialParams);

    expect(result).toEqual({ subscription: mockSub, hasPaymentMethod: false });
  });

  it("throws ShelfError when stripe is not initialized", async () => {
    const stripeMod = await import("~/utils/stripe.server");
    const original = stripeMod.stripe;
    (stripeMod as any).stripe = null;
    try {
      await createAuditAddonTrialSubscription(trialParams);
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ShelfError);
    } finally {
      (stripeMod as any).stripe = original;
    }
  });
});

describe("getAuditAddonPrices", () => {
  it("returns { month: null, year: null } when premiumIsEnabled is false", async () => {
    mockPremiumIsEnabled.value = false;

    const result = await getAuditAddonPrices();

    expect(result).toEqual({ month: null, year: null });
    expect(mockStripe.prices.list).not.toHaveBeenCalled();
  });

  it("returns { month: null, year: null } when stripe is null", async () => {
    const stripeMod = await import("~/utils/stripe.server");
    const original = stripeMod.stripe;
    (stripeMod as any).stripe = null;
    try {
      const result = await getAuditAddonPrices();
      expect(result).toEqual({ month: null, year: null });
      expect(mockStripe.prices.list).not.toHaveBeenCalled();
    } finally {
      (stripeMod as any).stripe = original;
    }
  });

  it("returns monthly and yearly prices filtered by audit addon metadata", async () => {
    const monthlyPrice = {
      id: "price_month",
      recurring: { interval: "month" },
      product: {
        metadata: { product_type: "addon", addon_type: "audits" },
      },
    };
    const yearlyPrice = {
      id: "price_year",
      recurring: { interval: "year" },
      product: {
        metadata: { product_type: "addon", addon_type: "audits" },
      },
    };
    const otherPrice = {
      id: "price_other",
      recurring: { interval: "month" },
      product: {
        metadata: { product_type: "addon", addon_type: "barcodes" },
      },
    };

    mockStripe.prices.list.mockResolvedValue({
      data: [monthlyPrice, yearlyPrice, otherPrice],
    });

    const result = await getAuditAddonPrices();

    expect(result).toEqual({ month: monthlyPrice, year: yearlyPrice });
  });

  it("returns null for missing intervals", async () => {
    const monthlyPrice = {
      id: "price_month",
      recurring: { interval: "month" },
      product: {
        metadata: { product_type: "addon", addon_type: "audits" },
      },
    };

    mockStripe.prices.list.mockResolvedValue({
      data: [monthlyPrice],
    });

    const result = await getAuditAddonPrices();

    expect(result).toEqual({ month: monthlyPrice, year: null });
  });
});

describe("linkAuditAddonToOrganization", () => {
  const linkParams = {
    customerId: "cus_xyz",
    organizationId: "org_456",
  };

  function makeSubscription(status: string, id = "sub_123") {
    return {
      id,
      status,
      metadata: {},
      items: {
        data: [
          {
            price: { product: "prod_audit" },
          },
        ],
      },
    };
  }

  it("finds active audit subscription and updates metadata with organizationId", async () => {
    const sub = makeSubscription("active");
    mockStripe.subscriptions.list.mockResolvedValue({ data: [sub] });
    mockStripe.products.retrieve.mockResolvedValue({
      metadata: { product_type: "addon", addon_type: "audits" },
    });
    mockStripe.subscriptions.update.mockResolvedValue({});
    mockOrgUpdate.mockResolvedValue({ id: "org_456" });

    await linkAuditAddonToOrganization(linkParams);

    expect(mockStripe.subscriptions.update).toHaveBeenCalledWith("sub_123", {
      metadata: { organizationId: "org_456" },
    });
  });

  it("enables auditsEnabled on the organization", async () => {
    const sub = makeSubscription("active");
    mockStripe.subscriptions.list.mockResolvedValue({ data: [sub] });
    mockStripe.products.retrieve.mockResolvedValue({
      metadata: { product_type: "addon", addon_type: "audits" },
    });
    mockStripe.subscriptions.update.mockResolvedValue({});
    mockOrgUpdate.mockResolvedValue({ id: "org_456" });

    await linkAuditAddonToOrganization(linkParams);

    expect(mockOrgUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "org_456" },
        data: expect.objectContaining({
          auditsEnabled: true,
          auditsEnabledAt: expect.any(Date),
        }),
      })
    );
  });

  it("sets usedAuditTrial when subscription is trialing", async () => {
    const sub = makeSubscription("trialing");
    mockStripe.subscriptions.list.mockResolvedValue({ data: [sub] });
    mockStripe.products.retrieve.mockResolvedValue({
      metadata: { product_type: "addon", addon_type: "audits" },
    });
    mockStripe.subscriptions.update.mockResolvedValue({});
    mockOrgUpdate.mockResolvedValue({ id: "org_456" });

    await linkAuditAddonToOrganization(linkParams);

    expect(mockOrgUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          usedAuditTrial: true,
        }),
      })
    );
  });

  it("does not set usedAuditTrial when subscription is active", async () => {
    const sub = makeSubscription("active");
    mockStripe.subscriptions.list.mockResolvedValue({ data: [sub] });
    mockStripe.products.retrieve.mockResolvedValue({
      metadata: { product_type: "addon", addon_type: "audits" },
    });
    mockStripe.subscriptions.update.mockResolvedValue({});
    mockOrgUpdate.mockResolvedValue({ id: "org_456" });

    await linkAuditAddonToOrganization(linkParams);

    const updateData = mockOrgUpdate.mock.calls[0][0].data;
    expect(updateData).not.toHaveProperty("usedAuditTrial");
  });

  it("skips subscriptions already linked to another organization", async () => {
    const linkedSub = {
      id: "sub_linked",
      status: "active",
      metadata: { organizationId: "org_other" },
      items: { data: [{ price: { product: "prod_audit" } }] },
    };
    const unlinkedSub = {
      id: "sub_unlinked",
      status: "active",
      metadata: {},
      items: { data: [{ price: { product: "prod_audit" } }] },
    };
    mockStripe.subscriptions.list.mockResolvedValue({
      data: [linkedSub, unlinkedSub],
    });
    mockStripe.products.retrieve.mockResolvedValue({
      metadata: { product_type: "addon", addon_type: "audits" },
    });
    mockStripe.subscriptions.update.mockResolvedValue({});
    mockOrgUpdate.mockResolvedValue({ id: "org_456" });

    await linkAuditAddonToOrganization(linkParams);

    expect(mockStripe.subscriptions.update).toHaveBeenCalledWith(
      "sub_unlinked",
      expect.objectContaining({
        metadata: expect.objectContaining({ organizationId: "org_456" }),
      })
    );
  });

  it("throws when no audit subscription found", async () => {
    mockStripe.subscriptions.list.mockResolvedValue({ data: [] });

    try {
      await linkAuditAddonToOrganization(linkParams);
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ShelfError);
      expect((e as ShelfError).message).toContain(
        "Something went wrong while linking audit add-on"
      );
    }
  });

  it("throws ShelfError when stripe is not initialized", async () => {
    const stripeMod = await import("~/utils/stripe.server");
    const original = stripeMod.stripe;
    (stripeMod as any).stripe = null;
    try {
      await linkAuditAddonToOrganization(linkParams);
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ShelfError);
    } finally {
      (stripeMod as any).stripe = original;
    }
  });
});

describe("getAuditSubscriptionInfo", () => {
  it("returns interval/amount/currency/status for active subscription", async () => {
    mockStripe.subscriptions.list.mockResolvedValue({
      data: [
        {
          status: "active",
          items: {
            data: [
              {
                price: {
                  product: "prod_audit",
                  recurring: { interval: "month" },
                  unit_amount: 1999,
                  currency: "usd",
                },
              },
            ],
          },
        },
      ],
    });
    mockStripe.products.retrieve.mockResolvedValue({
      metadata: { product_type: "addon", addon_type: "audits" },
    });

    const result = await getAuditSubscriptionInfo({
      customerId: "cus_xyz",
    });

    expect(result).toEqual({
      interval: "month",
      amount: 1999,
      currency: "usd",
      status: "active",
    });
  });

  it("returns null when stripe is not initialized", async () => {
    const stripeMod = await import("~/utils/stripe.server");
    const original = stripeMod.stripe;
    (stripeMod as any).stripe = null;
    try {
      const result = await getAuditSubscriptionInfo({
        customerId: "cus_xyz",
      });
      expect(result).toBeNull();
    } finally {
      (stripeMod as any).stripe = original;
    }
  });

  it("returns null when no subscription found", async () => {
    mockStripe.subscriptions.list.mockResolvedValue({ data: [] });

    const result = await getAuditSubscriptionInfo({
      customerId: "cus_xyz",
    });

    expect(result).toBeNull();
  });

  it("returns null silently on errors", async () => {
    mockStripe.subscriptions.list.mockRejectedValue(
      new Error("Stripe API error")
    );

    const result = await getAuditSubscriptionInfo({
      customerId: "cus_xyz",
    });

    expect(result).toBeNull();
  });
});

describe("handleAuditAddonWebhook", () => {
  const orgId = "org_456";

  beforeEach(() => {
    mockOrgUpdate.mockResolvedValue({ id: orgId });
  });

  it("checkout.session.completed enables auditsEnabled + auditsEnabledAt", async () => {
    await handleAuditAddonWebhook({
      eventType: "checkout.session.completed",
      organizationId: orgId,
    });

    expect(mockOrgUpdate).toHaveBeenCalledWith({
      where: { id: orgId },
      data: expect.objectContaining({
        auditsEnabled: true,
        auditsEnabledAt: expect.any(Date),
      }),
      select: { id: true },
    });
  });

  it("subscription.created enables audits + marks usedAuditTrial for trials", async () => {
    await handleAuditAddonWebhook({
      eventType: "customer.subscription.created",
      subscription: {
        trial_end: 1700000000,
        trial_start: 1699000000,
        metadata: {},
      } as any,
      organizationId: orgId,
    });

    expect(mockOrgUpdate).toHaveBeenCalledWith({
      where: { id: orgId },
      data: expect.objectContaining({
        auditsEnabled: true,
        auditsEnabledAt: expect.any(Date),
        usedAuditTrial: true,
      }),
      select: { id: true },
    });
  });

  it("subscription.created skips usedAuditTrial for transferred subscriptions", async () => {
    await handleAuditAddonWebhook({
      eventType: "customer.subscription.created",
      subscription: {
        trial_end: 1700000000,
        trial_start: 1699000000,
        metadata: { transferred_from_subscription: "sub_old" },
      } as any,
      organizationId: orgId,
    });

    const updateData = mockOrgUpdate.mock.calls[0][0].data;
    expect(updateData).not.toHaveProperty("usedAuditTrial");
    expect(updateData.auditsEnabled).toBe(true);
  });

  it("subscription.updated (active) enables audits", async () => {
    await handleAuditAddonWebhook({
      eventType: "customer.subscription.updated",
      subscription: { status: "active" } as any,
      organizationId: orgId,
    });

    expect(mockOrgUpdate).toHaveBeenCalledWith({
      where: { id: orgId },
      data: { auditsEnabled: true },
      select: { id: true },
    });
  });

  it("subscription.updated (canceled) disables audits", async () => {
    await handleAuditAddonWebhook({
      eventType: "customer.subscription.updated",
      subscription: { status: "canceled" } as any,
      organizationId: orgId,
    });

    expect(mockOrgUpdate).toHaveBeenCalledWith({
      where: { id: orgId },
      data: { auditsEnabled: false },
      select: { id: true },
    });
  });

  it("subscription.paused disables audits", async () => {
    await handleAuditAddonWebhook({
      eventType: "customer.subscription.paused",
      subscription: { status: "paused" } as any,
      organizationId: orgId,
    });

    expect(mockOrgUpdate).toHaveBeenCalledWith({
      where: { id: orgId },
      data: { auditsEnabled: false },
      select: { id: true },
    });
  });

  it("subscription.deleted disables audits", async () => {
    await handleAuditAddonWebhook({
      eventType: "customer.subscription.deleted",
      subscription: { status: "canceled" } as any,
      organizationId: orgId,
    });

    expect(mockOrgUpdate).toHaveBeenCalledWith({
      where: { id: orgId },
      data: { auditsEnabled: false },
      select: { id: true },
    });
  });

  it("unknown event makes no database call", async () => {
    await handleAuditAddonWebhook({
      eventType: "some.unknown.event",
      organizationId: orgId,
    });

    expect(mockOrgUpdate).not.toHaveBeenCalled();
  });
});
