import type Stripe from "stripe";
import { CustomerPortalForm } from "./customer-portal-form";
import type { Price } from "./prices";
import { Button } from "../shared";

export const PriceCta = ({
  price,
  activeSubscription,
}: {
  price: Price;
  activeSubscription: Stripe.Subscription | null;
}) => {
  if (price.id === "free") return null;

  if (price?.product?.metadata?.shelf_tier === "tier_2") {
    return <Button disabled>Coming soon</Button>;
  }

  if (activeSubscription) {
    return (
      <CustomerPortalForm
        buttonText={activeSubscription ? "Manage subscription" : undefined}
      />
    );
  }

  return null;
};
