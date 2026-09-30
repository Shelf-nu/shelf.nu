/**
 * Add-on price selection for a billing interval.
 *
 * Stripe holds a monthly and a yearly price for each add-on, and either may be
 * missing. The interval the customer picked decides which one applies, and the
 * page uses that single choice for three things at once: the amount it displays,
 * the total it adds up, and the price id it submits.
 *
 * @see {@link file://./../routes/_welcome+/select-plan.tsx}
 */

/** The billing intervals a subscription can be on. */
export type BillingInterval = "month" | "year";

/** An add-on's prices, as Stripe is asked for them: one per interval, or none. */
export type AddonPricesByInterval<TPrice> = {
  month: TPrice | null;
  year: TPrice | null;
};

/**
 * The add-on price for the chosen interval, or null when there isn't one.
 *
 * Answering with the other interval's price would be worse than answering
 * nothing: the amount is rendered under the selected interval's suffix and
 * submitted as the price to bill, so a monthly customer would be shown an annual
 * figure as "/mo" and then charged annually. A missing price is already handled
 * everywhere this is used, by hiding the add-on for that interval.
 *
 * @param prices - The add-on's prices keyed by interval
 * @param interval - The interval the customer picked, or null if none yet
 * @returns The matching price, or null
 */
export function resolveAddonPriceForInterval<TPrice>(
  prices: AddonPricesByInterval<TPrice>,
  interval: BillingInterval | null
): TPrice | null {
  if (!interval) {
    return null;
  }

  return prices[interval] ?? null;
}
