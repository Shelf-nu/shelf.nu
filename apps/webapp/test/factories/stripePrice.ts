/**
 * Stripe price/product fixtures.
 *
 * `assertPriceIsForAddon` and `assertPriceMatchesTier` decide on FOUR
 * properties of a resolved price — `active`, `type`, and the product's `active`
 * plus its metadata. A literal repeated per test has to spell all four out, and
 * every test that omits one starts passing or failing for the wrong reason.
 *
 * That is not hypothetical: adding the `product.active` requirement broke 13
 * hand-written fixtures at once, each needing the same edit. A factory makes
 * the default correct and lets a test override only the property it is about.
 *
 * @see {@link file://./../../app/modules/billing/price-validation.server.ts}
 */

import type Stripe from "stripe";

/** Overrides for {@link stripePriceFactory}. */
export type StripePriceOverrides = {
  id?: string;
  active?: boolean;
  type?: Stripe.Price.Type;
  /** Product metadata — `{ product_type, addon_type }` or `{ shelf_tier }`. */
  metadata?: Record<string, string>;
  /** Whether the PRODUCT is active, as distinct from the price. */
  productActive?: boolean;
  productDeleted?: boolean;
};

/**
 * Builds a price that passes validation by default, product expanded.
 *
 * Defaults to the barcode add-on because that is the common case; pass
 * `metadata` for a tier or the other add-on.
 *
 * @param overrides - Only the properties the test is actually about
 * @returns A Stripe price shaped as `prices.retrieve(..., { expand: ["product"] })` returns it
 */
export function stripePriceFactory(
  overrides: StripePriceOverrides = {}
): Stripe.Price {
  const {
    id = "price_1",
    active = true,
    type = "recurring",
    metadata = { product_type: "addon", addon_type: "barcodes" },
    productActive = true,
    productDeleted = false,
  } = overrides;

  return {
    id,
    active,
    type,
    product: {
      id: "prod_1",
      active: productActive,
      deleted: productDeleted,
      metadata,
    },
  } as unknown as Stripe.Price;
}

/** The metadata a tier product carries. */
export function tierMetadata(tier = "tier_2") {
  return { shelf_tier: tier };
}

/** The metadata an add-on product carries. */
export function addonMetadata(addonType: "barcodes" | "audits" = "barcodes") {
  return { product_type: "addon", addon_type: addonType };
}
