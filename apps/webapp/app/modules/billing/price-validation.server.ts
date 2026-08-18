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

import Stripe from "stripe";

import type { AdditionalData } from "~/utils/error";
import { ShelfError } from "~/utils/error";
import { stripe } from "~/utils/stripe.server";

const label = "Stripe" as const;

/** The add-ons Shelf sells, as written in Stripe product metadata. */
export type AddonType = "barcodes" | "audits";

/**
 * Retrieves a price with its product expanded, mapping ONLY a genuine
 * unknown-id response to a client error.
 *
 * The distinction matters operationally. An unconditional catch here would turn
 * a Stripe outage, a rate-limit, or rejected server credentials into an
 * uncaptured 400 telling the user their plan does not exist — hiding a billing
 * failure from error monitoring and misclassifying a retryable server fault as
 * the caller's mistake. Anything that is not "no such price" is rethrown so the
 * surrounding handler reports it as a captured 500.
 *
 * Mirrors the existing detection in `~/utils/stripe.server`.
 *
 * @param priceId - The price id supplied by the client
 * @param additionalData - Context attached to the 400, for debugging
 * @returns The resolved Stripe price, product expanded
 * @throws {ShelfError} 400 when Stripe reports no such price
 * @throws The original error for every other Stripe failure
 */
async function retrievePriceWithProduct(
  priceId: string,
  additionalData: AdditionalData
): Promise<Stripe.Price> {
  try {
    return await stripe!.prices.retrieve(priceId, { expand: ["product"] });
  } catch (cause) {
    const isUnknownPrice =
      cause instanceof Stripe.errors.StripeInvalidRequestError &&
      (cause.code === "resource_missing" || cause.statusCode === 404);

    if (!isUnknownPrice) {
      throw cause;
    }

    throw new ShelfError({
      cause,
      message: "The selected plan could not be found.",
      additionalData,
      label,
      status: 400,
      shouldBeCaptured: false,
    });
  }
}

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

  // `active` matters as much as the metadata: an archived add-on product must
  // not be sellable, and this predicate also filters the price lists the UI
  // offers.
  return (
    product.active === true &&
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

  const price = await retrievePriceWithProduct(priceId, {
    priceId,
    addonType,
  });

  // An inactive price is not purchasable; accepting one would create a
  // subscription against a price the operator has retired. `recurring` because
  // every caller creates a SUBSCRIPTION -- a one-time price would either fail
  // at Stripe or produce a subscription that never renews.
  if (
    !price.active ||
    price.type !== "recurring" ||
    !isAddonProduct(price.product, addonType)
  ) {
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

  const price = await retrievePriceWithProduct(priceId, {
    priceId,
    shelfTier,
  });

  const product = price.product;
  const isUsableProduct =
    !!product &&
    typeof product !== "string" &&
    !product.deleted &&
    product.active === true;
  const priceTier = isUsableProduct ? product.metadata?.shelf_tier : undefined;

  if (!price.active || price.type !== "recurring" || priceTier !== shelfTier) {
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
