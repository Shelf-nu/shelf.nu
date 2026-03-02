import type Stripe from "stripe";
import { FREE_PLAN } from "./helpers";
import { PriceBox } from "./price-box";
import { PriceCta } from "./price-cta";
import { AltCheckmarkIcon } from "../icons/library";
import { CrispButton } from "../marketing/crisp";

export type PriceWithProduct = Stripe.Price & {
  product: Stripe.Product;
};

export const Prices = ({ prices }: { prices: PriceWithProduct[] }) => (
  <div className="gap-8 xl:flex xl:justify-center">
    <Price key={FREE_PLAN.id} price={FREE_PLAN} />
    {prices
      .filter(
        (p) =>
          p.metadata.show_on_table &&
          p.metadata.show_on_table === "true" &&
          p.metadata.legacy !== "true"
      )
      .map((price, index) => (
        <Price
          key={price.id}
          price={price}
          previousPlanName={prices[index - 1]?.product.name}
        />
      ))}
  </div>
);

export interface PriceType {
  id: string;
  metadata?: {
    show_on_table?: boolean;
  };
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

export const Price = ({
  price,
  previousPlanName,
}: {
  price: PriceType;
  previousPlanName?: string;
}) => {
  const isFreePlan = price.id === "free";
  const isTeamPlan = price.product.metadata.shelf_tier === "tier_2";
  const features = price.product.metadata.features?.split(",") || [];

  return (
    <div className="subscription-plan mb-12 w-full xl:mb-0 xl:max-w-[410px]">
      <PriceBox price={price} />
      <div className="mb-8">
        <PriceCta price={price} />
      </div>
      {features ? (
        <>
          {!isFreePlan ? (
            <p className="mb-4 text-base font-semibold text-gray-900">
              All {previousPlanName || "Free"} features and ...
            </p>
          ) : null}

          <ul className="list-none p-0">
            {features.map((feature) => (
              <li key={feature} className="mb-4 flex gap-3">
                <i className="text-primary">
                  <AltCheckmarkIcon />
                </i>
                <span className="text-base text-gray-600">{feature}</span>
              </li>
            ))}
            {isTeamPlan && (
              <li className="mb-4 flex gap-3">
                <i className="text-primary">
                  <AltCheckmarkIcon />
                </i>
                <span className="text-base text-gray-600">
                  Optional: Single sign-on(SSO) -{" "}
                  <CrispButton
                    variant="link"
                    className="inline !w-auto text-[16px] font-normal underline"
                  >
                    contact sales
                  </CrispButton>
                </span>
              </li>
            )}
          </ul>
        </>
      ) : null}
    </div>
  );
};
