import { useLoaderData } from "@remix-run/react";
import type Stripe from "stripe";
import type { loader } from "~/routes/_layout+/settings.subscription";
import { tw } from "~/utils";
import { shortenIntervalString } from "~/utils/shorten-interval-string";
import { FREE_PLAN } from "./helpers";
import { PriceCta } from "./price-cta";
import {
  AltCheckmarkIcon,
  DoubleLayerIcon,
  MultiLayerIcon,
  SingleLayerIcon,
} from "../icons";

export type PriceWithProduct = Stripe.Price & {
  product: Stripe.Product;
};

export const Prices = ({ prices }: { prices: PriceWithProduct[] }) => (
  <div className="gap-8 xl:flex xl:justify-center">
    <Price key={FREE_PLAN.id} price={FREE_PLAN} />
    {prices.map((price, index) => (
      <Price
        key={price.id}
        price={price}
        previousPlanName={prices[index - 1]?.product.name}
      />
    ))}
  </div>
);

export interface Price {
  id: string;
  product: {
    name: string;
    metadata: {
      features?: string;
      slogan?: string;
      shelf_tier?: string;
    };
  };
  unit_amount: number | null;
  currency: string;
  recurring?: {
    interval: string;
  } | null;
}

const plansIconsMap: { [key: string]: JSX.Element } = {
  free: <SingleLayerIcon />,
  tier_1: <DoubleLayerIcon />,
  tier_2: <MultiLayerIcon />,
};

export const Price = ({
  price,
  previousPlanName,
}: {
  price: Price;
  previousPlanName?: string;
}) => {
  const { activeSubscription } = useLoaderData<typeof loader>();
  const activePlan = activeSubscription?.items.data[0]?.plan;
  const isFreePlan = price.id != "free";
  const features = price.product.metadata.features?.split(",") || [];

  // icons to be mapped with different plans

  return (
    <div className="subscription-plan mb-12 w-full xl:mb-0 xl:max-w-[410px]">
      <div
        className={tw(
          "mb-8 rounded-2xl border p-8",
          activePlan?.id === price.id ||
            (!activeSubscription && price.id === "free")
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
              {price.product.name}
            </h2>
            {activePlan?.id === price.id ||
            (!activeSubscription && price.id === "free") ? (
              <div className="rounded-2xl bg-primary-50 px-2 py-0.5 text-[12px] font-medium text-primary-700 mix-blend-multiply">
                Current
              </div>
            ) : null}
          </div>
          {price.unit_amount != null ? (
            <div className=" mb-3 text-4xl font-semibold text-gray-900">
              {(price.unit_amount / 100).toLocaleString("en-US", {
                style: "currency",
                currency: price.currency,
                maximumFractionDigits: 0,
              })}
              {price.recurring ? (
                <span>/{shortenIntervalString(price.recurring.interval)}</span>
              ) : null}
            </div>
          ) : null}
          <p className="min-h-[48px] text-base text-gray-600">
            {price.product.metadata.slogan}
          </p>
        </div>
      </div>
      <div className="mb-8">
        <PriceCta price={price} activeSubscription={activeSubscription} />
      </div>
      {features ? (
        <>
          {isFreePlan ? (
            <p className="mb-4 text-base font-semibold text-gray-900">
              All {previousPlanName || "Free"} features and ...
            </p>
          ) : null}

          <ul className="list-none p-0">
            {features.map((feature) => (
              <li key={feature} className="mb-4 flex gap-3">
                <i>
                  <AltCheckmarkIcon />
                </i>
                <span className="text-base text-gray-600">{feature}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
};
