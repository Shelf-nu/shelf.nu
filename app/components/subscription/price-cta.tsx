import { Form } from "@remix-run/react";
import { CustomerPortalForm } from "./customer-portal-form";
import type { Price } from "./prices";
import { Button } from "../shared/button";

export const PriceCta = ({
  price,
  subscription,
}: {
  price: Price;
  subscription: Object | null;
}) => {
  if (price.id === "free") return null;

  if (subscription) {
    return (
      <CustomerPortalForm
        buttonText={subscription ? "Manage subscription" : undefined}
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
