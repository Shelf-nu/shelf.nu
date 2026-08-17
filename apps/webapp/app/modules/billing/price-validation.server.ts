/**
 * Stripe price validation.
 *
 * Shelf sells two add-ons — barcodes and audits — as Stripe products carrying
 * `metadata.product_type === "addon"` and an `addon_type`. That metadata pair
 * is the ONLY thing distinguishing an add-on price from a tier subscription
 * price; both are ordinary recurring prices on the same Stripe account.
 *
 * The add-on purchase routes accepted a client-supplied `priceId` as a bare
 * string and handed it straight to Stripe, so any active recurring price was
 * accepted — including a TIER price. That turned a 7-day add-on trial into
 * permanent free access to the paid feature: the route enables the flag
 * eagerly, but the resulting subscription is a tier subscription, so
 * `isAddonSubscription` returns false for it and the add-on webhook handler
 * that would later clear the flag never runs.
 *
 * Validating at the entry point is what closes it: a mismatched subscription
 * is never created in the first place, so no webhook has to reason about one.
 *
 * The same class applies to TIER prices: the subscription route writes the
 * user's `tierId` from a client-supplied `shelfTier` without checking that
 * the price paid actually is that tier's price. Both live here so the two
 * halves of the billing surface validate the same way.
 *
 * @see {@link file://./../barcode/addon.server.ts}
 * @see {@link file://./../audit/addon.server.ts}
 * @see {@link file://./../stripe-webhook/helpers.server.ts} `isAddonSubscription`
 */

import type Stripe from "stripe";

import { ShelfError } from "~/utils/error";
import { stripe } from "~/utils/stripe.server";

const label = "Stripe" as const;

/** The add-ons Shelf sells, as written in Stripe product metadata. */
export type AddonType = "barcodes" | "audits";

/**
 * Whether a Stripe product is the add-on product for `addonType`.
 *
 * Both halves matter. `product_type === "addon"` alone would accept the other
 * add-on's price (buying barcodes would enable audits), and `addon_type` alone
 * would match anything an operator happened to tag.
 *
 * @param product - The expanded Stripe product, or a bare id / deleted product
 * @param addonType - Which add-on the caller expects
 * @returns `true` only if the product carries both metadata values
 */
export function isAddonProduct(
  product: Stripe.Product | Stripe.DeletedProduct | string | null | undefined,
  addonType: AddonType
): boolean {
  // A string means the caller did not expand the product, and a deleted
  // product carries no usable metadata. Fail closed for both rather than
  // reaching into a shape that isn't there.
  if (!product || typeof product === "string" || product.deleted) {
    return false;
  }

  return (
    product.metadata?.product_type === "addon" &&
    product.metadata?.addon_type === addonType
  );
}

/**
 * Asserts that a client-supplied price id really is a price for `addonType`.
 *
 * Call this before creating any subscription or checkout session from a
 * `priceId` that came from a request. Resolving the price server-side is the
 * point: the caller sends only an id, so the product metadata we check is
 * Stripe's answer, not the caller's claim.
 *
 * @param priceId - The price id supplied by the client
 * @param addonType - Which add-on the route is selling
 * @returns The resolved Stripe price
 * @throws {ShelfError} 400 if the price is unknown, inactive, or belongs to
 *   any product other than the expected add-on
 */
export async function assertPriceIsForAddon({
  priceId,
  addonType,
}: {
  priceId: string;
  addonType: AddonType;
}): Promise<Stripe.Price> {
  if (!stripe) {
    throw new ShelfError({
      cause: null,
      message: "Stripe not initialized",
      additionalData: { priceId, addonType },
      label,
    });
  }

  const price = await stripe.prices
    .retrieve(priceId, { expand: ["product"] })
    .catch((cause) => {
      throw new ShelfError({
        cause,
        message: "The selected plan could not be found.",
        additionalData: { priceId, addonType },
        label,
        status: 400,
        shouldBeCaptured: false,
      });
    });

  // An inactive price is not purchasable; accepting one would create a
  // subscription against a price the operator has retired.
  if (!price.active || !isAddonProduct(price.product, addonType)) {
    throw new ShelfError({
      cause: null,
      // Deliberately does not describe what was wrong with the price — the
      // value is caller-supplied and the distinction between "not an add-on"
      // and "inactive" is not the caller's business.
      message: "The selected plan is not available for this add-on.",
      additionalData: { priceId, addonType },
      label,
      status: 400,
      shouldBeCaptured: false,
    });
  }

  return price;
}

/**
 * Asserts that a client-supplied price id really is the price for `shelfTier`.
 *
 * The subscription route takes BOTH `priceId` and `shelfTier` from the form and
 * writes `user.tierId = shelfTier` directly, without checking that the price
 * being paid is that tier's price. So `shelfTier: "tier_2"` could be paired
 * with any cheaper active price — including an add-on price, which is the worst
 * case: `isAddonSubscription` sees an add-on product, returns early, and the
 * webhook never corrects the tier the route already wrote.
 *
 * A tier price is identified the same way an add-on price is — by its product
 * metadata (`shelf_tier`), which only Stripe can vouch for.
 *
 * @param priceId - The price id supplied by the client
 * @param shelfTier - The tier the client claims that price buys
 * @returns The resolved Stripe price
 * @throws {ShelfError} 400 if the price is unknown, inactive, or is not the
 *   price for that tier
 */
export async function assertPriceMatchesTier({
  priceId,
  shelfTier,
}: {
  priceId: string;
  shelfTier: string;
}): Promise<Stripe.Price> {
  if (!stripe) {
    throw new ShelfError({
      cause: null,
      message: "Stripe not initialized",
      additionalData: { priceId, shelfTier },
      label,
    });
  }

  const price = await stripe.prices
    .retrieve(priceId, { expand: ["product"] })
    .catch((cause) => {
      throw new ShelfError({
        cause,
        message: "The selected plan could not be found.",
        additionalData: { priceId, shelfTier },
        label,
        status: 400,
        shouldBeCaptured: false,
      });
    });

  const product = price.product;
  const priceTier =
    !product || typeof product === "string" || product.deleted
      ? undefined
      : product.metadata?.shelf_tier;

  if (!price.active || priceTier !== shelfTier) {
    throw new ShelfError({
      cause: null,
      message: "The selected plan is not available.",
      additionalData: { priceId, shelfTier, priceTier },
      label,
      status: 400,
      shouldBeCaptured: false,
    });
  }

  return price;
}
