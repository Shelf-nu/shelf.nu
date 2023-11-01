import { Form } from "@remix-run/react";
import { CustomerPortalForm } from "./customer-portal-form";
import type { Price } from "./prices";
import { Button } from "../shared";

export const PriceCta = ({
  price,
  activeSubscription,
}: {
  price: Price;
  activeSubscription: Object | null;
}) => {
  if (price.id === "free") return null;

  if (activeSubscription) {
    return (
      <CustomerPortalForm
        buttonText={activeSubscription ? "Manage subscription" : undefined}
      />
    );
  }

  return (
    <Form method="post">
      <input type="hidden" name="priceId" value={price.id} />
      <Button type="submit">Upgrade to {price.product.name}</Button>
    </Form>
  );
};
