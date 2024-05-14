import type Stripe from "stripe";
import { tw } from "~/utils/tw";
import type { Price } from "./prices";
import {
  DoubleLayerIcon,
  MultiLayerIcon,
  SingleLayerIcon,
} from "../icons/library";

export const PriceBox = ({
  activePlan,
  subscription,
  price,
  isTrialSubscription,
  customPlanName,
}: {
  activePlan: Stripe.Plan | undefined;
  subscription: Stripe.Subscription | null;
  price: Price;
  isTrialSubscription: boolean;
  customPlanName?: string;
}) => {
  const amount =
    price.unit_amount != null
      ? price?.recurring?.interval === "year"
        ? price.unit_amount / 10
        : price.unit_amount
      : null;

  return (
    <div
      className={tw(
        "price-box mb-8 rounded-2xl border p-8",
        activePlan?.id === price.id || (!subscription && price.id === "free")
          ? "border-primary-500 bg-primary-50"
          : "bg-white"
      )}
      key={price.id}
    >
      <div className="text-center">
        <div className="mb-5 inline-flex items-center justify-center rounded-full border-[5px] border-solid border-primary-50 bg-primary-100 p-1.5 text-primary">
          <i className=" inline-flex min-h-[20px] min-w-[20px] items-center justify-center">
            {price.product.metadata.shelf_tier
              ? plansIconsMap[price.product.metadata.shelf_tier]
              : plansIconsMap["free"]}
          </i>
        </div>
        <div className="mb-3 flex items-center justify-center gap-2">
          <h2 className=" text-xl font-semibold text-primary-700">
            {customPlanName || price.product.name}
          </h2>
          {activePlan?.id === price.id ||
          (!subscription && price.id === "free") ? (
            <div className="rounded-2xl bg-primary-50 px-2 py-0.5 text-[12px] font-medium text-primary-700 mix-blend-multiply">
              Current {isTrialSubscription ? "(Free Trial)" : ""}
            </div>
          ) : null}
        </div>
        {amount != null ? (
          <div className="mb-3 ">
            <div className=" text-4xl font-semibold text-gray-900">
              {(amount / 100).toLocaleString("en-US", {
                style: "currency",
                currency: price.currency,
                maximumFractionDigits: 0,
              })}
              {price.recurring ? <span>/mo</span> : null}
            </div>
            <div className="text-gray-500">
              {price?.recurring?.interval === "year" &&
                `Billed annually ${(amount / 10).toLocaleString("en-US", {
                  style: "currency",
                  currency: price.currency,
                  maximumFractionDigits: 0,
                })}`}
              {price?.recurring?.interval === "month" && `Billed montly`}
            </div>
          </div>
        ) : null}
        <p className="price-slogan min-h-[48px] text-base text-gray-600">
          {price.product.metadata.slogan}
        </p>
      </div>
    </div>
  );
};

export const plansIconsMap: { [key: string]: JSX.Element } = {
  free: <SingleLayerIcon />,
  tier_1: <DoubleLayerIcon />,
  tier_2: <MultiLayerIcon />,
};
