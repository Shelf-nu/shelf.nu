/**
 * Stripe add-on product identity — entitlement-bypass regression coverage.
 *
 * The add-on routes took `priceId: z.string()` from the request and handed it
 * to Stripe unvalidated. Any active recurring price was accepted, including a
 * TIER price — which granted the paid feature permanently, because the route
 * enables the flag eagerly while the resulting tier subscription never reaches
 * the add-on webhook handler that would clear it.
 *
 * detail.dev finding D094 (reported for barcodes; audits was identical).
 *
 * @see {@link file://./price-validation.server.ts}
 */

import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

// why: Stripe SDK makes external API calls
const { mockStripe } = vi.hoisted(() => ({
  mockStripe: { prices: { retrieve: vi.fn() } },
}));

vi.mock("~/utils/stripe.server", () => ({
  stripe: mockStripe,
  premiumIsEnabled: true,
}));

import {
  assertPriceIsForAddon,
  assertPriceMatchesTier,
  isAddonProduct,
} from "./price-validation.server";

// @vitest-environment node

/** The error Stripe raises for an id that does not exist. */
function missingResourceError() {
  return new Stripe.errors.StripeInvalidRequestError({
    message: "No such price",
    code: "resource_missing",
  });
}

/** A Stripe product carrying the given metadata. */
function product(metadata: Record<string, string>) {
  return {
    id: "prod_1",
    deleted: false,
    metadata,
  } as unknown as Stripe.Product;
}

const BARCODE_PRODUCT = product({
  product_type: "addon",
  addon_type: "barcodes",
});
const AUDIT_PRODUCT = product({ product_type: "addon", addon_type: "audits" });
// What a tier subscription price points at — the payload that caused the bug.
const TIER_PRODUCT = product({ shelf_tier: "tier_2" });

describe("isAddonProduct", () => {
  it("accepts the matching add-on product", () => {
    expect(isAddonProduct(BARCODE_PRODUCT, "barcodes")).toBe(true);
    expect(isAddonProduct(AUDIT_PRODUCT, "audits")).toBe(true);
  });

  it("rejects the OTHER add-on", () => {
    // `product_type === "addon"` alone would let a barcode purchase enable
    // audits, so both halves of the metadata pair are required.
    expect(isAddonProduct(AUDIT_PRODUCT, "barcodes")).toBe(false);
    expect(isAddonProduct(BARCODE_PRODUCT, "audits")).toBe(false);
  });

  it("rejects a tier product", () => {
    expect(isAddonProduct(TIER_PRODUCT, "barcodes")).toBe(false);
  });

  it("rejects a product tagged addon_type without product_type", () => {
    expect(
      isAddonProduct(product({ addon_type: "barcodes" }), "barcodes")
    ).toBe(false);
  });

  it("fails closed on an unexpanded, deleted, or absent product", () => {
    // An unexpanded product is a bare id string — reaching for `.metadata` on
    // it would silently yield undefined and read as "not an addon" by luck
    // rather than by decision.
    expect(isAddonProduct("prod_1", "barcodes")).toBe(false);
    expect(
      isAddonProduct(
        { id: "prod_1", deleted: true } as unknown as Stripe.DeletedProduct,
        "barcodes"
      )
    ).toBe(false);
    expect(isAddonProduct(null, "barcodes")).toBe(false);
    expect(isAddonProduct(undefined, "barcodes")).toBe(false);
  });
});

describe("assertPriceIsForAddon", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the price when it belongs to the add-on", async () => {
    mockStripe.prices.retrieve.mockResolvedValue({
      id: "price_1",
      active: true,
      product: BARCODE_PRODUCT,
    });

    const price = await assertPriceIsForAddon({
      priceId: "price_1",
      addonType: "barcodes",
    });

    expect(price.id).toBe("price_1");
    // The product must be resolved server-side; the caller only sent an id.
    expect(mockStripe.prices.retrieve).toHaveBeenCalledWith("price_1", {
      expand: ["product"],
    });
  });

  it("rejects a tier price — the entitlement bypass", async () => {
    mockStripe.prices.retrieve.mockResolvedValue({
      id: "price_tier",
      active: true,
      product: TIER_PRODUCT,
    });

    await expect(
      assertPriceIsForAddon({ priceId: "price_tier", addonType: "barcodes" })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejects the other add-on's price", async () => {
    mockStripe.prices.retrieve.mockResolvedValue({
      id: "price_audits",
      active: true,
      product: AUDIT_PRODUCT,
    });

    await expect(
      assertPriceIsForAddon({ priceId: "price_audits", addonType: "barcodes" })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejects an inactive price", async () => {
    mockStripe.prices.retrieve.mockResolvedValue({
      id: "price_old",
      active: false,
      product: BARCODE_PRODUCT,
    });

    await expect(
      assertPriceIsForAddon({ priceId: "price_old", addonType: "barcodes" })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("turns an unknown price into a 400, not a 500", async () => {
    // A bad id is caller error. Letting Stripe's own throw escape would make
    // it a captured 500 and page someone for a crafted request.
    mockStripe.prices.retrieve.mockRejectedValue(missingResourceError());

    await expect(
      assertPriceIsForAddon({ priceId: "nope", addonType: "barcodes" })
    ).rejects.toMatchObject({ status: 400 });
  });

  it.each([
    [
      "a rate limit",
      new Stripe.errors.StripeRateLimitError({ message: "slow down" }),
    ],
    [
      "bad server credentials",
      new Stripe.errors.StripeAuthenticationError({ message: "bad key" }),
    ],
    [
      "an outage",
      new Stripe.errors.StripeConnectionError({ message: "unreachable" }),
    ],
  ])("does NOT disguise %s as a client error", async (_label, stripeError) => {
    // These are our problem, not the caller's. Converting them to an uncaptured
    // 400 "plan not found" would hide a billing outage from error monitoring
    // and tell users their plan does not exist.
    mockStripe.prices.retrieve.mockRejectedValue(stripeError);

    await expect(
      assertPriceIsForAddon({ priceId: "price_1", addonType: "barcodes" })
    ).rejects.toBe(stripeError);
  });
});

describe("assertPriceMatchesTier", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts the price whose product carries that tier", async () => {
    mockStripe.prices.retrieve.mockResolvedValue({
      id: "price_t2",
      active: true,
      product: TIER_PRODUCT,
    });

    await expect(
      assertPriceMatchesTier({ priceId: "price_t2", shelfTier: "tier_2" })
    ).resolves.toMatchObject({ id: "price_t2" });
  });

  it("refuses a cheaper tier's price claimed as a higher tier", async () => {
    mockStripe.prices.retrieve.mockResolvedValue({
      id: "price_t1",
      active: true,
      product: product({ shelf_tier: "tier_1" }),
    });

    await expect(
      assertPriceMatchesTier({ priceId: "price_t1", shelfTier: "tier_2" })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("refuses an ADD-ON price claimed as a tier — the worst case", async () => {
    // Worst because the resulting subscription is an add-on product, so
    // `isAddonSubscription` early-returns and the webhook never corrects the
    // tier the route already wrote.
    mockStripe.prices.retrieve.mockResolvedValue({
      id: "price_barcodes",
      active: true,
      product: BARCODE_PRODUCT,
    });

    await expect(
      assertPriceMatchesTier({ priceId: "price_barcodes", shelfTier: "tier_2" })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("refuses an inactive tier price", async () => {
    mockStripe.prices.retrieve.mockResolvedValue({
      id: "price_old",
      active: false,
      product: TIER_PRODUCT,
    });

    await expect(
      assertPriceMatchesTier({ priceId: "price_old", shelfTier: "tier_2" })
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("assertPriceMatchesTier — Stripe failure classification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("turns an unknown price into a 400", async () => {
    mockStripe.prices.retrieve.mockRejectedValue(missingResourceError());

    await expect(
      assertPriceMatchesTier({ priceId: "nope", shelfTier: "tier_2" })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("lets a Stripe outage propagate so it is captured", async () => {
    const outage = new Stripe.errors.StripeConnectionError({
      message: "unreachable",
    });
    mockStripe.prices.retrieve.mockRejectedValue(outage);

    await expect(
      assertPriceMatchesTier({ priceId: "price_t2", shelfTier: "tier_2" })
    ).rejects.toBe(outage);
  });
});
