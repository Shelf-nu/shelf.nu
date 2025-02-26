import { useMemo } from "react";
import { InfoIcon } from "lucide-react";
import type Stripe from "stripe";
import { generateRandomCode } from "~/modules/invite/helpers";
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
  const item = subscription.items.data[0];
  const subscriptionPrice = findPriceById(prices, item.price.id);
  const isLegacyPricing = item?.price?.metadata.legacy === "true";

  let planTier: string | undefined = undefined;

  if (subscriptionPrice) {
    // You can safely access product metadata and other fields
    planTier = subscriptionPrice.product.metadata.shelf_tier;
  }
  const interval =
    subscriptionPrice?.recurring?.interval ||
    (item?.price?.recurring?.interval as
      | Stripe.Price.Recurring.Interval
      | undefined);

  const { isTrial, isActive, isPaused } = getSubscriptionStatus(subscription);
  const costPerPrice =
    isActive || isTrial
      ? // @ts-ignore
        (item?.price?.unit_amount * subscription?.quantity) / 100
      : 0;

  const trialEnded =
    isPaused &&
    subscription?.trial_end &&
    subscription?.trial_end * 1000 > Date.now();
  const detailsArray = useMemo<(string | React.ReactNode)[]>(() => {
    const arr: (string | React.ReactNode)[] = [
      subscription.status,
      planTier === "tier_2" ? "Team plan" : "Plus plan",
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
  }, [planTier, interval, subscription.status, isLegacyPricing]);

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
      <div className="flex w-full items-center justify-between">
        <div>
          <div className="flex gap-2">
            <div className="mr-5">
              {" "}
              <span className="font-medium">id:</span> {subscription.id}
            </div>
            {detailsArray.map((content, index, array) => (
              <>
                <div
                  className="font-semibold uppercase"
                  key={
                    typeof content === "string"
                      ? content
                      : generateRandomCode(4)
                  }
                >
                  {content}
                </div>{" "}
                {index < array.length - 1 && " - "}
              </>
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
                  <DateS
                    date={new Date(subscription.current_period_end * 1000)}
                  />
                </>
              )}
              {isPaused && (
                <>
                  <span className="font-medium">PAUSED ON:</span>{" "}
                  <DateS
                    date={new Date(subscription.current_period_end * 1000)}
                  />
                </>
              )}
            </div>
            <div>
              <span className="font-medium">QUANTITY:</span>{" "}
              {/* @ts-ignore for some reason stipe type doesnt include quanity. @TODO - resolve this */}
              {(subscription?.quantity as number) || 1}
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
