import { useLoaderData } from "react-router";
import { config } from "~/config/shelf.config";
import { useDisabled } from "~/hooks/use-disabled";
import type { loader } from "~/routes/_layout+/account-details.subscription";
import type { PriceType } from "./prices";
import { Form } from "../custom-form";
import { Button } from "../shared/button";

export const PriceCta = ({ price }: { price: PriceType }) => {
  const { usedFreeTrial } = useLoaderData<typeof loader>();
  const disabled = useDisabled();

  if (price.id === "free") return null;

  const isTeamSubscriptionColumn =
    price.product.metadata.shelf_tier === "tier_2";

  return (
    <>
      <Form method="post">
        <input type="hidden" name="priceId" value={price.id} />
        <input
          type="hidden"
          name="shelfTier"
          value={price.product.metadata.shelf_tier}
        />
        <Button
          type="submit"
          name="intent"
          value="subscribe"
          variant="accent"
          disabled={disabled}
        >
          Upgrade to {price.product.name}
        </Button>

        {isTeamSubscriptionColumn && !usedFreeTrial && (
          <Button
            variant="secondary"
            className="mt-2"
            type="submit"
            name="intent"
            value="trial"
            disabled={disabled}
          >
            {disabled
              ? "Starting trial..."
              : `Start ${config.freeTrialDays} day free trial`}
          </Button>
        )}
      </Form>
    </>
  );
};
