import type Stripe from "stripe";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ShelfError } from "~/utils/error";

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

import {
  createBarcodeAddonCheckoutSession,
  createBarcodeAddonTrialSubscription,
  getBarcodeAddonPrices,
  linkBarcodeAddonToOrganization,
  getBarcodeSubscriptionInfo,
  handleBarcodeAddonWebhook,
} from "./addon.server";

beforeEach(() => {
  vi.clearAllMocks();
  mockPremiumIsEnabled.value = true;
  mockOrgUpdate.mockResolvedValue({ id: "org_1" });
});

const baseCheckoutParams = {
  priceId: "price_123",
  userId: "user_1",
  domainUrl: "https://app.shelf.nu",
  customerId: "cus_123",
  organizationId: "org_1",
};

const baseTrialParams = {
  customerId: "cus_123",
  priceId: "price_123",
  userId: "user_1",
  organizationId: "org_1",
};

function makeBarcodeProduct(overrides: Partial<Stripe.Product> = {}) {
  return {
    id: "prod_barcode",
    metadata: { product_type: "addon", addon_type: "barcodes" },
    ...overrides,
  };
}

function makeNonBarcodeProduct() {
  return {
    id: "prod_other",
    metadata: { product_type: "plan", addon_type: undefined },
  };
}

function makeSubscription(
  overrides: Partial<Stripe.Subscription> = {}
): Stripe.Subscription {
  return {
    id: "sub_123",
    status: "active",
    metadata: {},
    items: {
      data: [
        {
          price: {
            product: "prod_barcode",
            recurring: { interval: "month" },
            unit_amount: 499,
            currency: "usd",
          },
        },
      ],
    },
    ...overrides,
  } as unknown as Stripe.Subscription;
}

describe("createBarcodeAddonCheckoutSession", () => {
  it("creates checkout session with correct params and returns URL", async () => {
    mockStripe.checkout.sessions.create.mockResolvedValue({
      url: "https://checkout.stripe.com/session_123",
    });

    const url = await createBarcodeAddonCheckoutSession(baseCheckoutParams);

    expect(url).toBe("https://checkout.stripe.com/session_123");
    expect(mockStripe.checkout.sessions.create).toHaveBeenCalledWith({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: "price_123", quantity: 1 }],
      success_url: "https://app.shelf.nu/assets?success=true&addon=barcodes",
      cancel_url: "https://app.shelf.nu/assets?canceled=true&addon=barcodes",
      client_reference_id: "user_1",
      customer: "cus_123",
      subscription_data: {
        metadata: { organizationId: "org_1" },
      },
    });
  });

  it("throws ShelfError when stripe is not initialized", async () => {
    const stripeMod = await import("~/utils/stripe.server");
    const original = stripeMod.stripe;
    (stripeMod as any).stripe = null;

    try {
      await createBarcodeAddonCheckoutSession(baseCheckoutParams);
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
      await createBarcodeAddonCheckoutSession(baseCheckoutParams);
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ShelfError);
    }
  });
});

describe("createBarcodeAddonTrialSubscription", () => {
  it("creates 7-day trial subscription with default_payment_method when PM available", async () => {
    mockStripe.paymentMethods.list.mockResolvedValue({
      data: [{ id: "pm_123" }],
    });
    const mockSub = makeSubscription({ status: "trialing" as any });
    mockStripe.subscriptions.create.mockResolvedValue(mockSub);

    await createBarcodeAddonTrialSubscription(baseTrialParams);

    expect(mockStripe.subscriptions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        trial_period_days: 7,
        default_payment_method: "pm_123",
      })
    );
  });

  it("creates subscription without default_payment_method when none exists", async () => {
    mockStripe.paymentMethods.list.mockResolvedValue({ data: [] });
    mockStripe.subscriptions.create.mockResolvedValue(
      makeSubscription({ status: "trialing" as any })
    );

    await createBarcodeAddonTrialSubscription(baseTrialParams);

    const callArgs = mockStripe.subscriptions.create.mock.calls[0][0];
    expect(callArgs).not.toHaveProperty("default_payment_method");
  });

  it("returns { subscription, hasPaymentMethod: true } when PM exists", async () => {
    mockStripe.paymentMethods.list.mockResolvedValue({
      data: [{ id: "pm_123" }],
    });
    const mockSub = makeSubscription({ status: "trialing" as any });
    mockStripe.subscriptions.create.mockResolvedValue(mockSub);

    const result = await createBarcodeAddonTrialSubscription(baseTrialParams);

    expect(result.subscription).toBe(mockSub);
    expect(result.hasPaymentMethod).toBe(true);
  });

  it("returns { subscription, hasPaymentMethod: false } when no PM", async () => {
    mockStripe.paymentMethods.list.mockResolvedValue({ data: [] });
    const mockSub = makeSubscription({ status: "trialing" as any });
    mockStripe.subscriptions.create.mockResolvedValue(mockSub);

    const result = await createBarcodeAddonTrialSubscription(baseTrialParams);

    expect(result.subscription).toBe(mockSub);
    expect(result.hasPaymentMethod).toBe(false);
  });

  it("throws ShelfError when stripe is not initialized", async () => {
    const stripeMod = await import("~/utils/stripe.server");
    const original = stripeMod.stripe;
    (stripeMod as any).stripe = null;

    try {
      await createBarcodeAddonTrialSubscription(baseTrialParams);
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ShelfError);
    } finally {
      (stripeMod as any).stripe = original;
    }
  });
});

describe("getBarcodeAddonPrices", () => {
  it("returns { month: null, year: null } when premiumIsEnabled is false", async () => {
    mockPremiumIsEnabled.value = false;

    const result = await getBarcodeAddonPrices();

    expect(result).toEqual({ month: null, year: null });
    expect(mockStripe.prices.list).not.toHaveBeenCalled();
  });

  it("returns { month: null, year: null } when stripe is null", async () => {
    const stripeMod = await import("~/utils/stripe.server");
    const original = stripeMod.stripe;
    (stripeMod as any).stripe = null;

    try {
      const result = await getBarcodeAddonPrices();
      expect(result).toEqual({ month: null, year: null });
      expect(mockStripe.prices.list).not.toHaveBeenCalled();
    } finally {
      (stripeMod as any).stripe = original;
    }
  });

  it("returns monthly and yearly prices filtered by barcode addon metadata", async () => {
    const monthlyPrice = {
      id: "price_month",
      recurring: { interval: "month" },
      product: makeBarcodeProduct(),
    };
    const yearlyPrice = {
      id: "price_year",
      recurring: { interval: "year" },
      product: makeBarcodeProduct(),
    };
    const otherPrice = {
      id: "price_other",
      recurring: { interval: "month" },
      product: makeNonBarcodeProduct(),
    };

    mockStripe.prices.list.mockResolvedValue({
      data: [monthlyPrice, yearlyPrice, otherPrice],
    });

    const result = await getBarcodeAddonPrices();

    expect(result.month).toBe(monthlyPrice);
    expect(result.year).toBe(yearlyPrice);
  });

  it("returns null for missing intervals", async () => {
    const monthlyPrice = {
      id: "price_month",
      recurring: { interval: "month" },
      product: makeBarcodeProduct(),
    };

    mockStripe.prices.list.mockResolvedValue({
      data: [monthlyPrice],
    });

    const result = await getBarcodeAddonPrices();

    expect(result.month).toBe(monthlyPrice);
    expect(result.year).toBeNull();
  });
});

describe("linkBarcodeAddonToOrganization", () => {
  const linkParams = { customerId: "cus_123", organizationId: "org_1" };

  it("finds active barcode subscription and updates metadata with organizationId", async () => {
    const sub = makeSubscription({
      id: "sub_barcode",
      metadata: { existing: "data" } as any,
    });
    mockStripe.subscriptions.list.mockResolvedValue({ data: [sub] });
    mockStripe.products.retrieve.mockResolvedValue(makeBarcodeProduct());
    mockOrgUpdate.mockResolvedValue({ id: "org_1" });

    await linkBarcodeAddonToOrganization(linkParams);

    expect(mockStripe.subscriptions.update).toHaveBeenCalledWith(
      "sub_barcode",
      {
        metadata: { existing: "data", organizationId: "org_1" },
      }
    );
  });

  it("enables barcodesEnabled on the organization", async () => {
    const sub = makeSubscription({ status: "active" as any });
    mockStripe.subscriptions.list.mockResolvedValue({ data: [sub] });
    mockStripe.products.retrieve.mockResolvedValue(makeBarcodeProduct());
    mockOrgUpdate.mockResolvedValue({ id: "org_1" });

    await linkBarcodeAddonToOrganization(linkParams);

    expect(mockOrgUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "org_1" },
        data: expect.objectContaining({
          barcodesEnabled: true,
          barcodesEnabledAt: expect.any(Date),
        }),
      })
    );
  });

  it("sets usedBarcodeTrial when subscription is trialing", async () => {
    const sub = makeSubscription({ status: "trialing" as any });
    mockStripe.subscriptions.list.mockResolvedValue({ data: [sub] });
    mockStripe.products.retrieve.mockResolvedValue(makeBarcodeProduct());
    mockOrgUpdate.mockResolvedValue({ id: "org_1" });

    await linkBarcodeAddonToOrganization(linkParams);

    expect(mockOrgUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          usedBarcodeTrial: true,
        }),
      })
    );
  });

  it("does not set usedBarcodeTrial when subscription is active", async () => {
    const sub = makeSubscription({ status: "active" as any });
    mockStripe.subscriptions.list.mockResolvedValue({ data: [sub] });
    mockStripe.products.retrieve.mockResolvedValue(makeBarcodeProduct());
    mockOrgUpdate.mockResolvedValue({ id: "org_1" });

    await linkBarcodeAddonToOrganization(linkParams);

    const updateData = mockOrgUpdate.mock.calls[0][0].data;
    expect(updateData).not.toHaveProperty("usedBarcodeTrial");
  });

  it("throws when no barcode subscription found", async () => {
    const sub = makeSubscription({ status: "active" as any });
    mockStripe.subscriptions.list.mockResolvedValue({ data: [sub] });
    mockStripe.products.retrieve.mockResolvedValue(makeNonBarcodeProduct());

    try {
      await linkBarcodeAddonToOrganization(linkParams);
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ShelfError);
    }
  });

  it("throws ShelfError when stripe is not initialized", async () => {
    const stripeMod = await import("~/utils/stripe.server");
    const original = stripeMod.stripe;
    (stripeMod as any).stripe = null;

    try {
      await linkBarcodeAddonToOrganization(linkParams);
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ShelfError);
    } finally {
      (stripeMod as any).stripe = original;
    }
  });
});

describe("getBarcodeSubscriptionInfo", () => {
  it("returns interval/amount/currency/status for active subscription", async () => {
    const sub = makeSubscription({
      status: "active" as any,
      items: {
        data: [
          {
            price: {
              product: "prod_barcode",
              recurring: { interval: "month" },
              unit_amount: 499,
              currency: "usd",
            },
          },
        ],
      } as any,
    });
    mockStripe.subscriptions.list.mockResolvedValue({ data: [sub] });
    mockStripe.products.retrieve.mockResolvedValue(makeBarcodeProduct());

    const result = await getBarcodeSubscriptionInfo({
      customerId: "cus_123",
    });

    expect(result).toEqual({
      interval: "month",
      amount: 499,
      currency: "usd",
      status: "active",
    });
  });

  it("returns null when stripe is not initialized", async () => {
    const stripeMod = await import("~/utils/stripe.server");
    const original = stripeMod.stripe;
    (stripeMod as any).stripe = null;

    try {
      const result = await getBarcodeSubscriptionInfo({
        customerId: "cus_123",
      });
      expect(result).toBeNull();
    } finally {
      (stripeMod as any).stripe = original;
    }
  });

  it("returns null when no subscription found", async () => {
    mockStripe.subscriptions.list.mockResolvedValue({ data: [] });

    const result = await getBarcodeSubscriptionInfo({
      customerId: "cus_123",
    });

    expect(result).toBeNull();
  });

  it("returns null silently on errors", async () => {
    mockStripe.subscriptions.list.mockRejectedValue(new Error("API error"));

    const result = await getBarcodeSubscriptionInfo({
      customerId: "cus_123",
    });

    expect(result).toBeNull();
  });
});

describe("handleBarcodeAddonWebhook", () => {
  it("checkout.session.completed enables barcodesEnabled + barcodesEnabledAt", async () => {
    await handleBarcodeAddonWebhook({
      eventType: "checkout.session.completed",
      organizationId: "org_1",
    });

    expect(mockOrgUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "org_1" },
        data: expect.objectContaining({
          barcodesEnabled: true,
          barcodesEnabledAt: expect.any(Date),
        }),
      })
    );
  });

  it("subscription.created enables barcodes + marks usedBarcodeTrial for trials", async () => {
    const sub = makeSubscription({
      trial_start: 1000,
      trial_end: 2000,
      metadata: {},
    } as any);

    await handleBarcodeAddonWebhook({
      eventType: "customer.subscription.created",
      subscription: sub,
      organizationId: "org_1",
    });

    expect(mockOrgUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          barcodesEnabled: true,
          usedBarcodeTrial: true,
        }),
      })
    );
  });

  it("subscription.created skips usedBarcodeTrial for transferred subscriptions", async () => {
    const sub = makeSubscription({
      trial_start: 1000,
      trial_end: 2000,
      metadata: { transferred_from_subscription: "sub_old" },
    } as any);

    await handleBarcodeAddonWebhook({
      eventType: "customer.subscription.created",
      subscription: sub,
      organizationId: "org_1",
    });

    const updateData = mockOrgUpdate.mock.calls[0][0].data;
    expect(updateData).not.toHaveProperty("usedBarcodeTrial");
    expect(updateData.barcodesEnabled).toBe(true);
  });

  it("subscription.updated (active) enables barcodes", async () => {
    const sub = makeSubscription({ status: "active" as any });

    await handleBarcodeAddonWebhook({
      eventType: "customer.subscription.updated",
      subscription: sub,
      organizationId: "org_1",
    });

    expect(mockOrgUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { barcodesEnabled: true },
      })
    );
  });

  it("subscription.updated (canceled) disables barcodes", async () => {
    const sub = makeSubscription({ status: "canceled" as any });

    await handleBarcodeAddonWebhook({
      eventType: "customer.subscription.updated",
      subscription: sub,
      organizationId: "org_1",
    });

    expect(mockOrgUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { barcodesEnabled: false },
      })
    );
  });

  it("subscription.paused disables barcodes", async () => {
    await handleBarcodeAddonWebhook({
      eventType: "customer.subscription.paused",
      organizationId: "org_1",
    });

    expect(mockOrgUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { barcodesEnabled: false },
      })
    );
  });

  it("subscription.deleted disables barcodes", async () => {
    await handleBarcodeAddonWebhook({
      eventType: "customer.subscription.deleted",
      organizationId: "org_1",
    });

    expect(mockOrgUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { barcodesEnabled: false },
      })
    );
  });

  it("unknown event makes no database call", async () => {
    await handleBarcodeAddonWebhook({
      eventType: "some.unknown.event",
      organizationId: "org_1",
    });

    expect(mockOrgUpdate).not.toHaveBeenCalled();
  });
});
