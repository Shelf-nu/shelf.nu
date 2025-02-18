import { InfoIcon } from "lucide-react";
import type Stripe from "stripe";
import type { CustomerWithSubscriptions } from "~/utils/stripe.server";
import type { PriceWithProduct } from "./prices";
import { DateS } from "../shared/date";

export function SubscriptionsOverview({
  customer,
  prices,
}: {
  customer: CustomerWithSubscriptions | null;
  prices: {
    [key: string]: PriceWithProduct[];
  };
}) {
  const subscriptionsData = customer?.subscriptions.data;

  if (!customer) {
    return (
      <div>
        Your account doesn't have a customer id. Please contact support to get
        this issue resolved
      </div>
    );
  }

  return (
    <div>
      {subscriptionsData?.map((subscription) => (
        <SubscriptionBox
          subscription={subscription}
          key={subscription.id}
          prices={prices}
        />
      ))}

      {/* <CurrentPlanDetails /> */}
    </div>
  );
}

function SubscriptionBox({
  subscription,
  prices,
}: {
  subscription: Stripe.Subscription;
  prices: {
    [key: string]: PriceWithProduct[];
  };
}) {
  // console.log("subscription", subscription);
  const item = subscription.items.data[0];

  const subscriptionPrice = findPriceById(prices, item.price.id);

  let planTier, interval;
  if (subscriptionPrice) {
    // You can safely access product metadata and other fields
    planTier = subscriptionPrice.product.metadata.shelf_tier;
    interval = subscriptionPrice.recurring?.interval;
  }
  const isTrial =
    !!subscription?.trial_end && subscription.status === "trialing";
  const isActive = subscription.status === "active";

  return (
    <div className="mb-2 flex items-center gap-3 rounded border border-gray-300 p-4">
      <div className="inline-flex items-center justify-center rounded-full border-[5px] border-solid border-primary-50 bg-primary-100 p-1.5 text-primary">
        <InfoIcon />
      </div>
      <div>
        <div className="flex gap-2">
          <div className="mr-5">{subscription.id}</div>
          {[
            subscription.status,
            planTier === "tier_2" ? "Team plan" : "Plus plan",
            interval === "year" ? "Yearly billing" : "Monthly billing",
          ].map((text, index, array) => (
            <>
              <div className="font-semibold uppercase" key={text}>
                {text}
              </div>{" "}
              {index < array.length - 1 && " - "}
            </>
          ))}
        </div>
        <div className="flex gap-2">
          <div>
            <span className="font-medium">ACQUIRED ON:</span>{" "}
            <DateS date={new Date(subscription.created * 1000)} />
          </div>{" "}
          {isTrial && (
            <div>
              <span className="font-medium">DAYS LEFT ON TRIAL:</span>{" "}
              {calculateDaysLeft(subscription.trial_end as number)}
            </div>
          )}
          {isActive && (
            <div>
              <span className="font-medium">RENEWS ON:</span>{" "}
              <DateS date={new Date(subscription.current_period_end * 1000)} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Finds a price by its ID in the pricing data structure
 * @param prices - The pricing data object containing prices grouped by interval
 * @param targetId - The ID of the price to find
 * @returns The price object if found, null otherwise
 */
export function findPriceById(
  prices: { [key: string]: PriceWithProduct[] },
  targetId: string
): PriceWithProduct | null {
  // Iterate through all interval groups (month, year, etc.)
  for (const interval of Object.values(prices)) {
    const foundPrice = interval.find((price) => price.id === targetId);
    if (foundPrice) return foundPrice;
  }
  return null;
}

/**
 * Calculates the number of days left until a trial ends based on a given Unix timestamp
 * @param unixTimestamp - The Unix timestamp representing the trial end date
 * @returns The number of days left until the trial ends
 */
function calculateDaysLeft(unixTimestamp: number): number {
  const trialEndDate = new Date(unixTimestamp * 1000); // convert to milliseconds
  const currentDate = new Date();
  const differenceInMs = trialEndDate.getTime() - currentDate.getTime();
  const differenceInDays = Math.floor(differenceInMs / (1000 * 60 * 60 * 24));
  return differenceInDays;
}
