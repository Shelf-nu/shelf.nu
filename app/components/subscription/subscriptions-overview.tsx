import type { ReactNode } from "react";
import { useMemo } from "react";
import { InfoIcon } from "lucide-react";
import type Stripe from "stripe";
import type { CustomerWithSubscriptions } from "~/utils/stripe.server";
import { tw } from "~/utils/tw";
import { CustomerPortalForm } from "./customer-portal-form";
import type { PriceWithProduct } from "./prices";
import { HelpIcon } from "../icons/library";
import { Button } from "../shared/button";
import { DateS } from "../shared/date";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../shared/tooltip";

export function SubscriptionsOverview({
  customer,
  subscriptions,
  prices,
}: {
  customer: CustomerWithSubscriptions | null;
  subscriptions: Stripe.Subscription[];
  prices: {
    [key: string]: PriceWithProduct[];
  };
}) {
  // Separate subscriptions into workspace plans and addons
  const { workspaceSubscriptions, addonSubscriptions } = useMemo(() => {
    const workspace: Stripe.Subscription[] = [];
    const addons: Stripe.Subscription[] = [];

    for (const subscription of subscriptions) {
      // Check if any item in the subscription is a workspace tier (tier_1 or tier_2)
      const isWorkspace = subscription.items.data.some((item) => {
        const product = item.price?.product;
        if (product && typeof product === "object" && "metadata" in product) {
          const tier = product.metadata?.shelf_tier;
          return tier === "tier_1" || tier === "tier_2";
        }
        // Also check in prices array
        const priceFromArray = findPriceById(prices, item.price.id);
        if (priceFromArray) {
          const tier = priceFromArray.product.metadata.shelf_tier;
          return tier === "tier_1" || tier === "tier_2";
        }
        return false;
      });

      if (isWorkspace) {
        workspace.push(subscription);
      } else {
        addons.push(subscription);
      }
    }

    return { workspaceSubscriptions: workspace, addonSubscriptions: addons };
  }, [subscriptions, prices]);

  if (!customer) {
    return (
      <div>
        Your account doesn't have a customer id. Please contact support to get
        this issue resolved
      </div>
    );
  }

  // Calculate group totals (include all non-canceled subscriptions)
  const calculateGroupTotal = (subs: Stripe.Subscription[]) =>
    subs.reduce((total, sub) => {
      // Exclude only paused and canceled subscriptions
      const shouldExclude =
        sub.status === "paused" || sub.status === "canceled";
      if (shouldExclude) return total;
      return (
        total +
        sub.items.data.reduce((acc, item) => {
          const unitAmount = item.price?.unit_amount || 0;
          return acc + unitAmount * (item.quantity || 1);
        }, 0)
      );
    }, 0);

  const workspaceTotal = calculateGroupTotal(workspaceSubscriptions);
  const addonTotal = calculateGroupTotal(addonSubscriptions);

  return (
    <div className="space-y-6">
      {workspaceSubscriptions.length > 0 && (
        <div>
          <h4 className="mb-3 text-sm font-medium uppercase text-gray-500">
            Workspace Subscriptions
          </h4>
          {workspaceSubscriptions.map((subscription) => (
            <SubscriptionBox
              subscription={subscription}
              key={subscription.id}
              prices={prices}
              customer={customer}
            />
          ))}
          <div className="mt-2 text-right font-medium">
            Subtotal:{" "}
            {new Intl.NumberFormat("en-US", {
              style: "currency",
              currency: "USD",
            }).format(workspaceTotal / 100)}
          </div>
        </div>
      )}

      {addonSubscriptions.length > 0 && (
        <div>
          <h4 className="mb-3 text-sm font-medium uppercase text-gray-500">
            Add-ons
          </h4>
          {addonSubscriptions.map((subscription) => (
            <SubscriptionBox
              subscription={subscription}
              key={subscription.id}
              prices={prices}
              customer={customer}
            />
          ))}
          <div className="mt-2 text-right font-medium">
            Subtotal:{" "}
            {new Intl.NumberFormat("en-US", {
              style: "currency",
              currency: "USD",
            }).format(addonTotal / 100)}
          </div>
        </div>
      )}
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
  customer: CustomerWithSubscriptions;
}) {
  return (
    <div>
      {subscription.items.data.map((item) => (
        <Item
          item={item}
          subscription={subscription}
          prices={prices}
          key={item.id}
        />
      ))}
    </div>
  );
}

function Item({
  item,
  subscription,
  prices,
}: {
  item: Stripe.SubscriptionItem;
  subscription: Stripe.Subscription;
  prices: {
    [key: string]: PriceWithProduct[];
  };
}) {
  const interval = item.price?.recurring?.interval;
  const isLegacyPricing = item?.price?.metadata?.legacy === "true";
  const subscriptionPrice = findPriceById(prices, item.price.id);

  // Get plan tier from the prices array if available
  const planTier = subscriptionPrice?.product.metadata.shelf_tier;

  // Get product name - prefer from prices array, fallback to item's product if expanded
  const productName = useMemo(() => {
    // First try the prices array
    if (subscriptionPrice?.product.name) {
      return subscriptionPrice.product.name;
    }
    // Fallback: check if product is expanded on the item's price
    const product = item.price?.product;
    if (product && typeof product === "object" && "name" in product) {
      return product.name;
    }
    // Last resort: use nickname from price or generic label
    return item.price?.nickname || "Subscription";
  }, [subscriptionPrice, item.price]);

  const { isTrial, isActive, isPaused } = getSubscriptionStatus(subscription);
  const costPerPrice = item?.price?.unit_amount
    ? (item?.price?.unit_amount * (item?.quantity || 1)) / 100
    : 0;

  const trialEnded =
    isPaused &&
    subscription?.trial_end &&
    subscription?.trial_end * 1000 > Date.now();

  const detailsArray = useMemo<(string | ReactNode)[]>(() => {
    // Determine the display name based on tier or product name
    const displayName =
      planTier === "tier_2"
        ? "Team plan"
        : planTier === "tier_1"
        ? "Plus plan"
        : productName;

    const arr: (string | ReactNode)[] = [
      displayName,
      formatSubscriptionStatus(subscription.status),
      interval === "year" ? "Yearly billing" : "Monthly billing",
    ];
    if (isLegacyPricing) {
      arr.unshift(
        <div className="flex items-center gap-1">
          <span>Legacy pricing</span> <LegacyPricingTooltip />
        </div>
      );
    }
    return arr;
  }, [planTier, productName, interval, subscription.status, isLegacyPricing]);

  function renderSubscriptionCost() {
    /** Cost for singular price. To get the total we still need to multiply by quantity */
    if (trialEnded)
      return (
        <>
          <div>Trial ended</div>

          <div className="text-gray-500">
            <CustomerPortalForm
              buttonText="Add payment"
              buttonProps={{
                variant: "link",
                className: tw("font-normal underline"),
              }}
              className="inline"
            />{" "}
            information to start subscription.
          </div>
        </>
      );
    if (isPaused) return "Paused";
    return (
      <>
        <div>
          {new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: "USD",
          }).format(costPerPrice)}{" "}
          / {interval}
        </div>

        {isTrial && (
          <div className="text-gray-500">
            after trial ends <TrialPaymentTooltip />
          </div>
        )}
      </>
    );
  }

  return (
    <div className="mb-2 flex items-center gap-3 rounded border border-gray-300 p-4">
      <div className="inline-flex items-center justify-center rounded-full border-[5px] border-solid border-primary-50 bg-primary-100 p-1.5 text-primary">
        <InfoIcon />
      </div>
      <div></div>
      <div className="flex w-full items-center justify-between" key={item.id}>
        <div>
          <div className="flex gap-2">
            {detailsArray.map((content, index, array) => (
              <span key={index} className="flex items-center gap-2">
                <span className="font-semibold uppercase">{content}</span>
                {index < array.length - 1 && " - "}
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            {/* Start */}
            <div>
              <span className="font-medium">ACQUIRED ON:</span>{" "}
              <DateS date={new Date(subscription.created * 1000)} />
            </div>{" "}
            {/* End */}
            <div>
              {isTrial && (
                <>
                  <span className="font-medium">DAYS LEFT ON TRIAL:</span>{" "}
                  {calculateDaysLeft(subscription.trial_end as number)}
                </>
              )}
              {isActive && (
                <>
                  <span className="font-medium">RENEWS ON:</span>{" "}
                  <DateS date={new Date(item.current_period_end * 1000)} />
                </>
              )}
              {isPaused && (
                <>
                  <span className="font-medium">PAUSED ON:</span>{" "}
                  <DateS date={new Date(item.current_period_end * 1000)} />
                </>
              )}
            </div>
            <div>
              <span className="font-medium">QUANTITY:</span>{" "}
              {(item?.quantity as number) || 1}
            </div>
          </div>
        </div>
        <div className="text-right">{renderSubscriptionCost()}</div>
      </div>
    </div>
  );
}

function TrialPaymentTooltip() {
  return (
    <TooltipProvider delayDuration={100}>
      <Tooltip>
        <TooltipTrigger className="align-middle">
          <i className="inline cursor-pointer text-gray-400 hover:text-gray-700">
            <HelpIcon />
          </i>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-[300px]">
          <p className="text-sm">
            You will not be automatically charged when your trial ends, unless
            you have already added your payment information. To manage your
            payment methods, please go to the{" "}
            <CustomerPortalForm
              buttonText="customer portal"
              className={tw("inline")}
              buttonProps={{
                variant: "link",
              }}
            />
            .
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function LegacyPricingTooltip() {
  return (
    <TooltipProvider delayDuration={100}>
      <Tooltip>
        <TooltipTrigger className="align-middle">
          <i className="inline cursor-pointer text-gray-400 hover:text-gray-700">
            <HelpIcon />
          </i>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-[300px]">
          <p>
            You are on a{" "}
            <Button
              to="https://www.shelf.nu/legacy-plan-faq"
              target="_blank"
              variant="link"
            >
              legacy pricing plan
            </Button>
            . We have since updated our pricing plans. <br />
            You can view the new pricing plans in the customer portal. If you
            cancel your subscription, you will not be able to renew it. For any
            questions - get in touch with support
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
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

/**
 * Determines the status of a subscription based on its properties
 * @param subscription - The subscription object to check the status of
 * @returns  An object containing the status of the subscription
 */
function getSubscriptionStatus(subscription: Stripe.Subscription) {
  return {
    isTrial: !!subscription?.trial_end && subscription.status === "trialing",
    isActive: subscription.status === "active",
    isPaused: subscription.status === "paused",
  };
}

/** Maps Stripe subscription status to a human-friendly label */
function formatSubscriptionStatus(status: Stripe.Subscription.Status): string {
  const statusMap: Record<Stripe.Subscription.Status, string> = {
    active: "Active",
    past_due: "Past due",
    unpaid: "Unpaid",
    canceled: "Canceled",
    incomplete: "Incomplete",
    incomplete_expired: "Expired",
    trialing: "Trialing",
    paused: "Paused",
  };
  return statusMap[status] || status;
}
