/**
 * Own Plan Options
 *
 * Shown on the Subscription page to users who pay for nothing but work in a
 * workspace someone else pays for. It offers the two ways to get a plan of
 * their own: start a new Team workspace they own, or upgrade their personal
 * workspace to Plus. Neither changes their access in the workspace they are
 * in today, and the copy says so.
 *
 * Both CTAs open the full pricing table, which owns checkout.
 *
 * @see {@link file://./prices.tsx}
 * @see {@link file://./../../routes/_layout+/account-details.subscription.tsx}
 */
import { Button } from "~/components/shared/button";
import type { PriceWithProduct } from "./prices";
import { WorkspacePlanBadge } from "./workspace-plans-table";

/** Stripe `shelf_tier` values of the plans offered here */
type OfferedTier = "tier_1" | "tier_2";

/**
 * Finds the yearly price shown in the pricing table for a tier.
 *
 * Applies the same filters as `Prices`: only prices flagged `show_on_table`
 * and not flagged `legacy`, so the amount quoted here matches the table the
 * CTA opens.
 *
 * @param prices - Stripe prices grouped by recurring interval
 * @param tier - The `shelf_tier` product metadata value to match
 * @returns The matching yearly price, or `undefined` when none is listed
 */
export function findYearlyPriceForTier(
  prices: { [key: string]: PriceWithProduct[] },
  tier: OfferedTier
): PriceWithProduct | undefined {
  return (prices["year"] ?? []).find(
    (p) =>
      p.metadata.show_on_table === "true" &&
      p.metadata.legacy !== "true" &&
      p.product.metadata.shelf_tier === tier
  );
}

/**
 * Formats a price as "from $X/yr", or returns `null` when it has no amount.
 *
 * @param price - The yearly price to format
 */
function formatYearlyFrom(price: PriceWithProduct | undefined) {
  if (!price || price.unit_amount == null) {
    return null;
  }
  const amount = (price.unit_amount / 100).toLocaleString("en-US", {
    style: "currency",
    currency: price.currency,
    maximumFractionDigits: 0,
  });
  return `from ${amount}/yr`;
}

/**
 * Two cards offering the user a plan of their own.
 *
 * @param prices - Stripe prices grouped by recurring interval
 * @param currentWorkspaceName - The workspace the user is working in, named
 * in the copy to make clear it is unaffected
 * @param onComparePlans - Opens the full pricing table
 */
export function OwnPlanOptions({
  prices,
  currentWorkspaceName,
  showPersonalUpgrade = true,
  onComparePlans,
}: {
  prices: { [key: string]: PriceWithProduct[] };
  currentWorkspaceName: string;
  /** Hide the Plus card for users without a personal workspace (SSO users). */
  showPersonalUpgrade?: boolean;
  onComparePlans: () => void;
}) {
  const teamPrice = formatYearlyFrom(findYearlyPriceForTier(prices, "tier_2"));
  const plusPrice = formatYearlyFrom(findYearlyPriceForTier(prices, "tier_1"));

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-gray-600">
          You don't pay for any subscriptions yet. Want something of your own?
        </p>
        <Button
          type="button"
          variant="link"
          className="w-auto"
          onClick={onComparePlans}
        >
          Compare all plans
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-3 rounded border border-gray-300 bg-white p-4">
          <div className="flex items-center gap-2">
            <h4 className="font-semibold text-gray-900">
              Start your own Team workspace
            </h4>
            <WorkspacePlanBadge label="Team" />
          </div>
          <p className="text-sm text-gray-600">
            A new workspace that you own and pay for, with its own team members.
            It doesn't change anything in {currentWorkspaceName}.
          </p>
          <div className="mt-auto flex flex-wrap items-center gap-3">
            <Button type="button" variant="primary" onClick={onComparePlans}>
              Start a Team workspace
            </Button>
            {teamPrice ? (
              <span className="text-sm text-gray-500">{teamPrice}</span>
            ) : null}
          </div>
        </div>

        {showPersonalUpgrade ? (
          <div className="flex flex-col gap-3 rounded border border-gray-300 bg-white p-4">
            <div className="flex items-center gap-2">
              <h4 className="font-semibold text-gray-900">
                Upgrade your personal workspace
              </h4>
              <WorkspacePlanBadge label="Plus" />
            </div>
            <p className="text-sm text-gray-600">
              More features for the workspace only you use. Your access in{" "}
              {currentWorkspaceName} stays the same.
            </p>
            <div className="mt-auto flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="secondary"
                onClick={onComparePlans}
              >
                Upgrade to Plus
              </Button>
              {plusPrice ? (
                <span className="text-sm text-gray-500">{plusPrice}</span>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
